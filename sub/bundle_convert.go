package sub

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/service"
	"gorm.io/gorm"
)

// The conversion from the per-client inbound lists and implicit delivery to hosts and bundles.
// See docs/architecture/bundles.md section 5: build beside the old scheme, prove equality, then switch.

// ConversionMismatch is one verification failure.
type ConversionMismatch struct {
	Client string `json:"client"`
	Check  string `json:"check"`
	Detail string `json:"detail"`
}

// ConversionReport is stored in the bundlesMigration setting and shown in the panel.
type ConversionReport struct {
	Status     string               `json:"status"` // converted | failed | rolledBack
	StartedAt  int64                `json:"startedAt"`
	FinishedAt int64                `json:"finishedAt"`
	Version    string               `json:"version,omitempty"`
	Clients    int                  `json:"clients"`
	Bundles    int                  `json:"bundles"`
	Hosts      int                  `json:"hosts"`
	Verified   int                  `json:"verified"` // clients whose subscription was compared
	Mismatches []ConversionMismatch `json:"mismatches,omitempty"`
	Error      string               `json:"error,omitempty"`
}

// ConvertOptions tunes a run (tests use the hooks).
type ConvertOptions struct {
	// BeforeVerify runs after the shadow data exists and before it is verified.
	BeforeVerify func()
	// Host is the request host used while rendering subscriptions for the comparison.
	Host string
}

type convCtx struct {
	svc          *SubService
	db           *gorm.DB
	createdHosts []int
	createdBunds []int
	hostByLegacy map[[2]int]*model.Host // (legacy host id, inbound id) -> converted host
}

// ConvertToBundles converts the panel to the bundle scheme. It is safe to call on a live panel: nothing the panel reads
// changes until the final switch, and the switch happens only when every client's subscription and access came out identical.
func ConvertToBundles(opts ConvertOptions) (*ConversionReport, error) {
	rep := &ConversionReport{StartedAt: time.Now().Unix(), Version: currentVersion()}
	settings := service.SettingService{}
	if on, _ := settings.GetBundlesEnabled(); on {
		return nil, fmt.Errorf("the bundle scheme is already active")
	}
	db := database.GetDB()
	c := &convCtx{svc: newConversionSubService(opts.Host, false), db: db, hostByLegacy: map[[2]int]*model.Host{}}

	fail := func(err error) (*ConversionReport, error) {
		c.cleanup()
		rep.Status, rep.Error, rep.FinishedAt = "failed", err.Error(), time.Now().Unix()
		saveConversionReport(rep)
		logger.Errorf("bundles: conversion failed, staying on the legacy scheme: %v", err)
		return rep, err
	}

	if err := c.backup(); err != nil {
		return fail(fmt.Errorf("backup: %w", err))
	}
	before, err := c.mappingFingerprint()
	if err != nil {
		return fail(err)
	}
	// Managed hosts (placements, pools) must exist before the old assembly is mapped onto them.
	if _, _, _, err := (&service.HostSyncService{}).SyncAll(); err != nil {
		return fail(fmt.Errorf("host sync: %w", err))
	}
	// The legacy subscription of every client, captured before anything else is built.
	clients, err := c.loadClients()
	if err != nil {
		return fail(err)
	}
	if err := c.buildShadow(rep, clients); err != nil {
		return fail(fmt.Errorf("shadow conversion: %w", err))
	}
	if opts.BeforeVerify != nil {
		opts.BeforeVerify()
	}
	mismatches := c.verify(rep, clients, opts.Host)
	after, err := c.mappingFingerprint()
	if err != nil {
		return fail(err)
	}
	if before != after {
		mismatches = append(mismatches, ConversionMismatch{Check: "rows", Detail: "client_inbound_mappings changed during the conversion"})
	}
	if len(mismatches) > 0 {
		rep.Mismatches = mismatches
		if len(rep.Mismatches) > 50 {
			rep.Mismatches = rep.Mismatches[:50]
		}
		return fail(fmt.Errorf("verification found %d difference(s); the legacy scheme stays active", len(mismatches)))
	}
	if err := settings.SetBundlesEnabled(true); err != nil {
		return fail(fmt.Errorf("switch: %w", err))
	}
	rep.Status, rep.FinishedAt = "converted", time.Now().Unix()
	saveConversionReport(rep)
	logger.Infof("bundles: converted %d clients into %d bundles and %d hosts; %d subscriptions verified identical", rep.Clients, rep.Bundles, rep.Hosts, rep.Verified)
	return rep, nil
}

func saveConversionReport(rep *ConversionReport) {
	if b, err := json.Marshal(rep); err == nil {
		_ = (&service.SettingService{}).SetBundlesMigration(string(b))
	}
}

func newConversionSubService(host string, force bool) *SubService {
	s := NewCompatSubService(false, "-ieo")
	s.address = host
	s.forceBundles = force
	return s
}

// backup copies the tables the conversion reads, with their ids, so nothing has to be reconstructed on a rollback.
func (c *convCtx) backup() error {
	for _, t := range []string{"client_inbound_mappings", "hosts", "host_inbound_mappings", "inbound_node_mappings"} {
		name := t + "_pre_bundles"
		var n int64
		if err := c.db.Raw("SELECT count(*) FROM information_schema.tables WHERE table_name = ?", name).Scan(&n).Error; err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		if err := c.db.Exec(fmt.Sprintf("CREATE TABLE %s AS SELECT * FROM %s", name, t)).Error; err != nil {
			return err
		}
	}
	return nil
}

// mappingFingerprint is a cheap digest of client_inbound_mappings (ids, order, secrets) to prove the table was not touched.
func (c *convCtx) mappingFingerprint() (string, error) {
	var out string
	err := c.db.Raw(`SELECT COALESCE(md5(string_agg(id || ':' || client_id || ':' || inbound_id || ':' || sort_order || ':' || COALESCE(telemt_secret,'') || ':' || COALESCE(telemt_ad_tag,''), ',' ORDER BY id)), '') FROM client_inbound_mappings`).Scan(&out).Error
	return out, err
}

type convClient struct {
	client   model.ClientEntity
	inbounds []int // mapping order
}

func (c *convCtx) loadClients() ([]convClient, error) {
	var cl []model.ClientEntity
	if err := c.db.Order("id ASC").Find(&cl).Error; err != nil {
		return nil, err
	}
	out := make([]convClient, 0, len(cl))
	for _, e := range cl {
		var rows []model.ClientInboundMapping
		if err := c.db.Where("client_id = ?", e.Id).Order("sort_order ASC, id ASC").Find(&rows).Error; err != nil {
			return nil, err
		}
		cc := convClient{client: e}
		for _, r := range rows {
			cc.inbounds = append(cc.inbounds, r.InboundId)
		}
		out = append(out, cc)
	}
	return out, nil
}

// hostsForInbound maps the old assembly of one inbound onto hosts, in the order the old subscription listed them, and
// appends the managed hosts the old assembly did not list (excluded nodes) so nothing is lost from the bundle.
func (c *convCtx) hostsForInbound(inboundId int) ([]convHost, error) {
	var ib model.Inbound
	if err := c.db.First(&ib, inboundId).Error; err != nil {
		return nil, err
	}
	prepared := c.svc.prepareInboundForSubscription(&ib)
	prepared.SubHostsSet = false
	rows, _ := c.svc.getAddressesForInbound(prepared)

	var list []convHost
	seen := map[int]bool{}
	add := func(h *model.Host) {
		if h != nil && !seen[h.Id] {
			seen[h.Id] = true
			list = append(list, convHost{host: *h})
		}
	}
	for _, ap := range rows {
		switch ap.Src.Kind {
		case model.HostKindPlacement:
			var h model.Host
			if err := c.db.Where("kind = ? AND inbound_id = ? AND node_id = ?", model.HostKindPlacement, inboundId, ap.Src.NodeId).First(&h).Error; err != nil {
				return nil, fmt.Errorf("inbound %d: no placement host for node %d: %w", inboundId, ap.Src.NodeId, err)
			}
			add(&h)
		case model.HostKindPool:
			var h model.Host
			if err := c.db.Where("kind = ? AND pool_id = ?", model.HostKindPool, ap.Src.PoolId).First(&h).Error; err != nil {
				return nil, fmt.Errorf("inbound %d: no pool host for pool %d: %w", inboundId, ap.Src.PoolId, err)
			}
			add(&h)
		case model.HostKindAddress:
			h, err := c.convertLegacyHost(ap.Src.HostId, inboundId)
			if err != nil {
				return nil, err
			}
			add(h)
		default: // local
			h, err := c.localHost(inboundId, true)
			if err != nil {
				return nil, err
			}
			add(h)
		}
	}
	if len(list) == 0 {
		h, err := c.localHost(inboundId, true)
		if err != nil {
			return nil, err
		}
		add(h)
	}
	// Managed hosts the old assembly did not list (a node excluded from the subscription, nodes hidden by a Host in replace
	// mode): keep them in the bundle as hidden, so they still count for access and for follow-placements.
	var extra []model.Host
	if err := c.db.Where("inbound_id = ? AND kind IN ?", inboundId, []string{model.HostKindPlacement, model.HostKindPool}).Order("id ASC").Find(&extra).Error; err != nil {
		return nil, err
	}
	for i := range extra {
		if !seen[extra[i].Id] {
			seen[extra[i].Id] = true
			list = append(list, convHost{host: extra[i], hidden: true})
		}
	}
	return list, nil
}

// convHost is a host in a converted bundle; hidden ones grant access without being listed.
type convHost struct {
	host   model.Host
	hidden bool
}

func (c *convCtx) localHost(inboundId int, enable bool) (*model.Host, error) {
	var h model.Host
	err := c.db.Where("kind = ? AND inbound_id = ?", model.HostKindLocal, inboundId).First(&h).Error
	if err == nil {
		if enable && !h.Enable {
			_ = c.db.Model(&model.Host{}).Where("id = ?", h.Id).Update("enable", true).Error
			h.Enable = true
		}
		return &h, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}
	id := inboundId
	nh := &model.Host{
		UserId: 1, Name: "panel", Enable: enable, Kind: model.HostKindLocal, Source: model.HostSourceLegacy, InboundId: &id,
		SubscriptionApplyMode: model.HostSubscriptionApplyReplace,
	}
	if err := c.db.Create(nh).Error; err != nil {
		return nil, err
	}
	c.createdHosts = append(c.createdHosts, nh.Id)
	return nh, nil
}

// convertLegacyHost turns one pre-bundle Host into an address host bound to a single inbound, keeping every override.
func (c *convCtx) convertLegacyHost(legacyId, inboundId int) (*model.Host, error) {
	key := [2]int{legacyId, inboundId}
	if h, ok := c.hostByLegacy[key]; ok {
		return h, nil
	}
	var old model.Host
	if err := c.db.First(&old, legacyId).Error; err != nil {
		return nil, fmt.Errorf("legacy host %d: %w", legacyId, err)
	}
	id := inboundId
	nh := old
	nh.Id = 0
	nh.Kind, nh.Source, nh.InboundId, nh.NodeId, nh.PoolId = model.HostKindAddress, model.HostSourceLegacy, &id, nil, nil
	nh.Customized = true
	nh.Enable = true
	if err := c.db.Create(&nh).Error; err != nil {
		return nil, err
	}
	c.createdHosts = append(c.createdHosts, nh.Id)
	c.hostByLegacy[key] = &nh
	return &nh, nil
}

// buildShadow creates the bundles and memberships: one bundle per distinct ordered inbound list.
func (c *convCtx) buildShadow(rep *ConversionReport, clients []convClient) error {
	perInbound := map[int][]convHost{}
	groups := map[string][]convClient{}
	var order []string
	for _, cl := range clients {
		if len(cl.inbounds) == 0 {
			continue
		}
		key := joinInts(cl.inbounds)
		if _, ok := groups[key]; !ok {
			order = append(order, key)
		}
		groups[key] = append(groups[key], cl)
		for _, in := range cl.inbounds {
			if _, ok := perInbound[in]; !ok {
				hs, err := c.hostsForInbound(in)
				if err != nil {
					return err
				}
				perInbound[in] = hs
			}
		}
	}
	now := time.Now().Unix()
	for n, key := range order {
		members := groups[key]
		ins := members[0].inbounds
		var names []string
		for _, in := range ins {
			var ib model.Inbound
			if err := c.db.Select("id, remark, port").First(&ib, in).Error; err == nil {
				nm := strings.TrimSpace(ib.Remark)
				if nm == "" {
					nm = fmt.Sprintf("#%d", ib.Id)
				}
				names = append(names, nm)
			}
		}
		name := strings.Join(names, " + ")
		if len(name) > 60 {
			name = fmt.Sprintf("Bundle %d (%d inbounds)", n+1, len(ins))
		}
		b := &model.Bundle{UserId: 1, Name: name, Description: "Converted from per-client inbound lists", Enable: true, FollowPlacements: true, SortOrder: n * 10, CreatedAt: now, UpdatedAt: now}
		if err := c.db.Create(b).Error; err != nil {
			return err
		}
		c.createdBunds = append(c.createdBunds, b.Id)
		seenHost := map[int]bool{}
		i := 0
		for _, in := range ins {
			for _, ch := range perInbound[in] {
				h := ch.host
				if seenHost[h.Id] {
					continue
				}
				seenHost[h.Id] = true
				if err := c.db.Create(&model.BundleHost{BundleId: b.Id, HostId: h.Id, SortOrder: i * 10, Hidden: ch.hidden}).Error; err != nil {
					return err
				}
				i++
			}
		}
		for _, m := range members {
			if err := c.db.Create(&model.ClientBundle{ClientId: m.client.Id, BundleId: b.Id, CreatedAt: now}).Error; err != nil {
				return err
			}
			rep.Clients++
		}
		rep.Bundles++
	}
	rep.Hosts = len(c.createdHosts)
	return nil
}

func joinInts(v []int) string {
	parts := make([]string, len(v))
	for i, x := range v {
		parts[i] = fmt.Sprint(x)
	}
	return strings.Join(parts, ",")
}

// verify compares, for every client, the access and the subscription produced by the bundle scheme with the old scheme.
func (c *convCtx) verify(rep *ConversionReport, clients []convClient, host string) []ConversionMismatch {
	var out []ConversionMismatch
	legacy := newConversionSubService(host, false)
	shadow := newConversionSubService(host, true)
	bundles := service.BundleService{}
	for _, cl := range clients {
		name := cl.client.Name
		want, _ := bundles.EffectiveInbounds(cl.client.Id)
		if joinInts(want) != joinInts(cl.inbounds) {
			out = append(out, ConversionMismatch{Client: name, Check: "access", Detail: fmt.Sprintf("bundles give %v, the client has %v", want, cl.inbounds)})
			continue
		}
		if cl.client.SubID == "" {
			continue
		}
		oldLines, oldLast, oldTr, oldErr := legacy.GetSubs(cl.client.SubID, host, nil)
		newLines, newLast, newTr, newErr := shadow.GetSubs(cl.client.SubID, host, nil)
		if errString(oldErr) != errString(newErr) {
			out = append(out, ConversionMismatch{Client: name, Check: "subscription", Detail: fmt.Sprintf("error differs: %q vs %q", errString(oldErr), errString(newErr))})
			continue
		}
		if normalizeLines(oldLines) != normalizeLines(newLines) || oldLast != newLast || oldTr != newTr {
			out = append(out, ConversionMismatch{Client: name, Check: "subscription", Detail: firstDifference(strings.Split(normalizeLines(oldLines), "\n"), strings.Split(normalizeLines(newLines), "\n"))})
			continue
		}
		rep.Verified++
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Client < out[j].Client })
	return out
}

// Reality links are randomised on every request: spiderX always, and server name and short id when the inbound lists several.
// No two renderings of the same subscription agree on them, so they are masked on Reality lines. Everything else on those
// lines (address, port, key, flow, type, fragment) and every other line must match exactly.
var (
	randomLinkParam  = regexp.MustCompile(`([?&])spx=[^&#\s]*`)
	realityRandomKey = regexp.MustCompile(`([?&])(sni|sid|spx)=[^&#\s]*`)
)

func normalizeLines(lines []string) string {
	all := strings.Split(strings.Join(lines, "\n"), "\n")
	for i, l := range all {
		if strings.Contains(l, "security=reality") {
			all[i] = realityRandomKey.ReplaceAllString(l, "${1}${2}=*")
		} else {
			all[i] = randomLinkParam.ReplaceAllString(l, "${1}spx=*")
		}
	}
	return strings.Join(all, "\n")
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func firstDifference(a, b []string) string {
	n := len(a)
	if len(b) > n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		var x, y string
		if i < len(a) {
			x = a[i]
		}
		if i < len(b) {
			y = b[i]
		}
		if x != y {
			return fmt.Sprintf("line %d: %q != %q", i+1, x, y)
		}
	}
	return "traffic or last-online differ"
}

// cleanup removes the shadow data after a failed run. Hosts made by the managed sync are left: they are cheap and correct.
func (c *convCtx) cleanup() {
	for _, id := range c.createdBunds {
		_ = c.db.Delete(&model.Bundle{}, id).Error // cascades to bundle_hosts and client_bundles
	}
	for _, id := range c.createdHosts {
		_ = c.db.Delete(&model.Host{}, id).Error
	}
}

// AutoConvertOnStartup runs the conversion once after an upgrade, in the background, after the panel is serving. It never
// blocks startup and never retries a failed conversion of the same version by itself: the operator can retry from the panel.
func AutoConvertOnStartup() {
	time.Sleep(20 * time.Second)
	settings := service.SettingService{}
	if on, _ := settings.GetBundlesEnabled(); on {
		return
	}
	if raw, _ := settings.GetBundlesMigration(); raw != "" {
		var prev ConversionReport
		if json.Unmarshal([]byte(raw), &prev) == nil && prev.Version == currentVersion() && (prev.Status == "failed" || prev.Status == "rolledBack") {
			return
		}
	}
	logger.Infof("bundles: starting the automatic conversion to the bundle scheme")
	if _, err := ConvertToBundles(ConvertOptions{Host: "conversion.local"}); err != nil {
		logger.Warningf("bundles: automatic conversion did not switch: %v", err)
	}
}

// RollbackBundles returns to the pre-bundle scheme. Legacy tables were never modified, so this only flips the switch; what is
// lost is delivery edits made in bundle mode. Access data is current in client_inbound_mappings.
func RollbackBundles() error {
	settings := service.SettingService{}
	if err := settings.SetBundlesEnabled(false); err != nil {
		return err
	}
	rep := &ConversionReport{Status: "rolledBack", FinishedAt: time.Now().Unix(), Version: currentVersion()}
	saveConversionReport(rep)
	logger.Warningf("bundles: switched back to the legacy scheme")
	return nil
}

func currentVersion() string { return config.GetVersion() }
