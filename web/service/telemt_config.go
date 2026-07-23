package service

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
)

// TelemtNodePayload is pushed to worker nodes alongside Xray JSON.
type TelemtNodePayload struct {
	InboundId int    `json:"inboundId"`
	Tag       string `json:"tag"`
	Toml      string `json:"toml"`
}

// telemtSettingsJSON mirrors the panel "settings" JSON for protocol telemt.
type telemtSettingsJSON struct {
	UseMiddleProxy *bool  `json:"useMiddleProxy"`
	LogLevel       string `json:"logLevel"`
	AdTag          string `json:"adTag"`
	MetricsPort    *int   `json:"metricsPort"`
	Modes          *struct {
		Classic bool `json:"classic"`
		Secure  bool `json:"secure"`
		TLS     bool `json:"tls"`
	} `json:"modes"`
	Links *struct {
		Show       string `json:"show"`
		PublicHost string `json:"publicHost"`
		PublicPort int    `json:"publicPort"`
	} `json:"links"`
	Censorship *struct {
		TLSDomain        string `json:"tlsDomain"`
		SNI              string `json:"sni"`
		Mask             *bool  `json:"mask"`
		TLSEmulation     *bool  `json:"tlsEmulation"`
		TLSFrontDir      string `json:"tlsFrontDir"`
		UnknownSniAction string `json:"unknownSniAction"`
		MaskHost         string `json:"maskHost"`
		MaskPort         *int   `json:"maskPort"`
	} `json:"censorship"`
	APIEnabled    *bool  `json:"apiEnabled"`
	APIListen     string `json:"apiListen"`
	ProxyProtocol *bool  `json:"proxyProtocol"`
	FastMode      *bool  `json:"fastMode"`
	Me2dcFallback *bool  `json:"me2dcFallback"`
	Me2dcFast     *bool  `json:"me2dcFast"`
	MiddleProxyNatIp string `json:"middleProxyNatIp"`
	TgConnect     *int   `json:"tgConnect"`
	Network       *struct {
		IPv4   *bool `json:"ipv4"`
		IPv6   *bool `json:"ipv6"`
		Prefer *int  `json:"prefer"`
	} `json:"network"`
	Timeouts *struct {
		ClientHandshake         *int `json:"clientHandshake"`
		ClientKeepalive         *int `json:"clientKeepalive"`
		ClientAck               *int `json:"clientAck"`
		ClientFirstByteIdleSecs *int `json:"clientFirstByteIdleSecs"`
	} `json:"timeouts"`
	Access *struct {
		IgnoreTimeSkew            *bool `json:"ignoreTimeSkew"`
		UserMaxUniqueIpsGlobalEach  *int  `json:"userMaxUniqueIpsGlobalEach"`
		UserMaxTcpConnsGlobalEach   *int  `json:"userMaxTcpConnsGlobalEach"`
	} `json:"access"`
}

var telemtBareKeyRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// GenerateTelemtSecretHex returns 32 lowercase hex chars (16 bytes) for Telemt [access.users].
func GenerateTelemtSecretHex() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func parseTelemtSettings(settingsJSON string) telemtSettingsJSON {
	var root map[string]any
	_ = json.Unmarshal([]byte(strings.TrimSpace(settingsJSON)), &root)
	var raw telemtSettingsJSON
	if t, ok := root["telemt"].(map[string]any); ok {
		b, _ := json.Marshal(t)
		_ = json.Unmarshal(b, &raw)
	} else {
		_ = json.Unmarshal([]byte(strings.TrimSpace(settingsJSON)), &raw)
	}
	return raw
}

func telemtTomlUserKey(email string) string {
	email = strings.TrimSpace(email)
	if email == "" {
		return `""`
	}
	if telemtBareKeyRe.MatchString(email) {
		return email
	}
	return `"` + strings.ReplaceAll(strings.ReplaceAll(email, `\`, `\\`), `"`, `\"`) + `"`
}

// TelemtAccessUser is a row for [access.users] (Telemt user + mapping secret).
type TelemtAccessUser struct {
	Email  string
	Secret string
	Enable bool
	// Optional [access.user_data_quota] / [access.user_expirations] / [access.user_max_unique_ips].
	// Zero / empty values are omitted from generated TOML.
	DataQuotaBytes    uint64
	ExpirationRFC3339 string
	MaxUniqueIPs      int
	// SourceDenyCIDRs become [access.user_source_deny] (per-username CIDRs, Telemt SharX fork).
	SourceDenyCIDRs []string
	// Optional per-user ad tag → [access.user_ad_tags].
	AdTag string
}

// BuildTelemtToml builds a Telemt config.toml for one inbound.
// workDirAbs is the per-inbound directory on the node (for tls_front_dir); if empty, uses "tlsfront" relative.
func BuildTelemtToml(inbound *model.Inbound, users []TelemtAccessUser, publicHost string, publicPort int, workDirAbs string) (string, error) {
	if inbound == nil {
		return "", fmt.Errorf("inbound is nil")
	}
	cfg := parseTelemtSettings(inbound.Settings)
	useMiddle := true
	if cfg.UseMiddleProxy != nil {
		useMiddle = *cfg.UseMiddleProxy
	}
	logLevel := strings.TrimSpace(cfg.LogLevel)
	if logLevel == "" {
		logLevel = "normal"
	}
	classic, secure, tlsMode := false, false, true
	if cfg.Modes != nil {
		classic = cfg.Modes.Classic
		secure = cfg.Modes.Secure
		tlsMode = cfg.Modes.TLS
	}
	show := "*"
	if cfg.Links != nil && strings.TrimSpace(cfg.Links.Show) != "" {
		show = cfg.Links.Show
	}
	if strings.TrimSpace(publicHost) != "" {
		// node binding overrides JSON
		if cfg.Links == nil {
			cfg.Links = &struct {
				Show       string `json:"show"`
				PublicHost string `json:"publicHost"`
				PublicPort int    `json:"publicPort"`
			}{}
		}
		cfg.Links.PublicHost = strings.TrimSpace(publicHost)
		if publicPort > 0 {
			cfg.Links.PublicPort = publicPort
		}
	}
	tlsDomain := "petrovich.ru"
	mask := true
	tlsEmu := true
	tlsFront := "tlsfront"
	unknownSni := ""
	if cfg.Censorship != nil {
		td := strings.TrimSpace(cfg.Censorship.TLSDomain)
		if td == "" {
			td = strings.TrimSpace(cfg.Censorship.SNI)
		}
		if td != "" {
			tlsDomain = td
		}
		if cfg.Censorship.Mask != nil {
			mask = *cfg.Censorship.Mask
		}
		if cfg.Censorship.TLSEmulation != nil {
			tlsEmu = *cfg.Censorship.TLSEmulation
		}
		if strings.TrimSpace(cfg.Censorship.TLSFrontDir) != "" {
			tlsFront = strings.TrimSpace(cfg.Censorship.TLSFrontDir)
		}
		unknownSni = strings.TrimSpace(cfg.Censorship.UnknownSniAction)
	}
	if workDirAbs != "" {
		tlsFront = strings.TrimRight(workDirAbs, `/`) + "/tlsfront"
	}

	// Localhost-only control API: required for GET /v1/stats/users accounting on the node/panel.
	apiEnabled := true
	if cfg.APIEnabled != nil {
		apiEnabled = *cfg.APIEnabled
	}
	apiPort := 9091
	if inbound.Id > 0 {
		apiPort = 9100 + inbound.Id
		if apiPort > 65535 {
			apiPort = 20000 + (inbound.Id % 45536)
		}
	}
	apiListen := fmt.Sprintf("127.0.0.1:%d", apiPort)
	if strings.TrimSpace(cfg.APIListen) != "" {
		apiListen = strings.TrimSpace(cfg.APIListen)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "### Generated by SharX for inbound %s (id=%d)\n", inbound.Tag, inbound.Id)
	fmt.Fprintf(&b, "[general]\nuse_middle_proxy = %v\n", useMiddle)
	if tag := strings.TrimSpace(cfg.AdTag); tag != "" {
		fmt.Fprintf(&b, "ad_tag = %q\n", tag)
	}
	if cfg.FastMode != nil {
		fmt.Fprintf(&b, "fast_mode = %v\n", *cfg.FastMode)
	}
	if cfg.Me2dcFallback != nil {
		fmt.Fprintf(&b, "me2dc_fallback = %v\n", *cfg.Me2dcFallback)
	}
	if cfg.Me2dcFast != nil {
		fmt.Fprintf(&b, "me2dc_fast = %v\n", *cfg.Me2dcFast)
	}
	if natIP := strings.TrimSpace(cfg.MiddleProxyNatIp); natIP != "" {
		fmt.Fprintf(&b, "middle_proxy_nat_ip = %q\n", natIP)
	}
	if cfg.TgConnect != nil && *cfg.TgConnect > 0 {
		fmt.Fprintf(&b, "tg_connect = %d\n", *cfg.TgConnect)
	}
	fmt.Fprintf(&b, "log_level = %q\n\n", logLevel)
	fmt.Fprintf(&b, "[general.modes]\nclassic = %v\nsecure = %v\ntls = %v\n\n", classic, secure, tlsMode)
	fmt.Fprintf(&b, "[general.links]\nshow = %q\n", show)
	if cfg.Links != nil && strings.TrimSpace(cfg.Links.PublicHost) != "" {
		fmt.Fprintf(&b, "public_host = %q\n", cfg.Links.PublicHost)
		if cfg.Links.PublicPort > 0 {
			fmt.Fprintf(&b, "public_port = %d\n", cfg.Links.PublicPort)
		}
	}
	fmt.Fprintf(&b, "\n")
	if cfg.Network != nil && (cfg.Network.IPv4 != nil || cfg.Network.IPv6 != nil || cfg.Network.Prefer != nil) {
		fmt.Fprintf(&b, "[network]\n")
		if cfg.Network.IPv4 != nil {
			fmt.Fprintf(&b, "ipv4 = %v\n", *cfg.Network.IPv4)
		}
		if cfg.Network.IPv6 != nil {
			fmt.Fprintf(&b, "ipv6 = %v\n", *cfg.Network.IPv6)
		}
		if cfg.Network.Prefer != nil && (*cfg.Network.Prefer == 4 || *cfg.Network.Prefer == 6) {
			fmt.Fprintf(&b, "prefer = %d\n", *cfg.Network.Prefer)
		}
		fmt.Fprintf(&b, "\n")
	}
	fmt.Fprintf(&b, "[server]\nport = %d\n", inbound.Port)
	metricsPort := 0
	if cfg.MetricsPort != nil && *cfg.MetricsPort > 0 {
		metricsPort = *cfg.MetricsPort
	} else if apiPort > 0 {
		metricsPort = apiPort + 1000
	}
	if metricsPort > 0 {
		fmt.Fprintf(&b, "metrics_port = %d\n", metricsPort)
	}
	if cfg.ProxyProtocol != nil && *cfg.ProxyProtocol {
		fmt.Fprintf(&b, "proxy_protocol = true\n")
	}
	fmt.Fprintf(&b, "\n")
	fmt.Fprintf(&b, "[server.api]\nenabled = %v\nlisten = %q\nwhitelist = [\"127.0.0.1/32\", \"::1/128\"]\n\n", apiEnabled, apiListen)
	listenIP := strings.TrimSpace(inbound.Listen)
	if listenIP == "" {
		listenIP = "0.0.0.0"
	}
	fmt.Fprintf(&b, "[[server.listeners]]\nip = %q\n\n", listenIP)
	fmt.Fprintf(&b, "[censorship]\ntls_domain = %q\nmask = %v\ntls_emulation = %v\ntls_front_dir = %q\n", tlsDomain, mask, tlsEmu, tlsFront)
	if cfg.Censorship != nil {
		if mh := strings.TrimSpace(cfg.Censorship.MaskHost); mh != "" {
			fmt.Fprintf(&b, "mask_host = %q\n", mh)
		}
		if cfg.Censorship.MaskPort != nil && *cfg.Censorship.MaskPort > 0 {
			fmt.Fprintf(&b, "mask_port = %d\n", *cfg.Censorship.MaskPort)
		}
	}
	if unknownSni != "" {
		fmt.Fprintf(&b, "unknown_sni_action = %q\n", unknownSni)
	}
	fmt.Fprintf(&b, "\n")
	if cfg.Timeouts != nil {
		var timeoutLines []string
		if cfg.Timeouts.ClientHandshake != nil && *cfg.Timeouts.ClientHandshake > 0 {
			timeoutLines = append(timeoutLines, fmt.Sprintf("client_handshake = %d\n", *cfg.Timeouts.ClientHandshake))
		}
		if cfg.Timeouts.ClientFirstByteIdleSecs != nil && *cfg.Timeouts.ClientFirstByteIdleSecs >= 0 {
			timeoutLines = append(timeoutLines, fmt.Sprintf("client_first_byte_idle_secs = %d\n", *cfg.Timeouts.ClientFirstByteIdleSecs))
		}
		if cfg.Timeouts.ClientKeepalive != nil && *cfg.Timeouts.ClientKeepalive > 0 {
			timeoutLines = append(timeoutLines, fmt.Sprintf("client_keepalive = %d\n", *cfg.Timeouts.ClientKeepalive))
		}
		if cfg.Timeouts.ClientAck != nil && *cfg.Timeouts.ClientAck > 0 {
			timeoutLines = append(timeoutLines, fmt.Sprintf("client_ack = %d\n", *cfg.Timeouts.ClientAck))
		}
		if len(timeoutLines) > 0 {
			fmt.Fprintf(&b, "[timeouts]\n")
			for _, line := range timeoutLines {
				fmt.Fprint(&b, line)
			}
			fmt.Fprintf(&b, "\n")
		}
	}
	var accessScalars []string
	if cfg.Access != nil {
		if cfg.Access.IgnoreTimeSkew != nil && *cfg.Access.IgnoreTimeSkew {
			accessScalars = append(accessScalars, "ignore_time_skew = true\n")
		}
		if cfg.Access.UserMaxUniqueIpsGlobalEach != nil && *cfg.Access.UserMaxUniqueIpsGlobalEach >= 0 {
			accessScalars = append(accessScalars, fmt.Sprintf("user_max_unique_ips_global_each = %d\n", *cfg.Access.UserMaxUniqueIpsGlobalEach))
		}
		if cfg.Access.UserMaxTcpConnsGlobalEach != nil && *cfg.Access.UserMaxTcpConnsGlobalEach >= 0 {
			accessScalars = append(accessScalars, fmt.Sprintf("user_max_tcp_conns_global_each = %d\n", *cfg.Access.UserMaxTcpConnsGlobalEach))
		}
	}
	if len(accessScalars) > 0 {
		fmt.Fprintf(&b, "[access]\n")
		for _, line := range accessScalars {
			fmt.Fprint(&b, line)
		}
		fmt.Fprintf(&b, "\n")
	}
	var written []TelemtAccessUser
	fmt.Fprintf(&b, "[access.users]\n")
	for _, u := range users {
		if !u.Enable || strings.TrimSpace(u.Email) == "" || len(strings.TrimSpace(u.Secret)) != 32 {
			continue
		}
		sec := strings.ToLower(strings.TrimSpace(u.Secret))
		fmt.Fprintf(&b, "%s = %q\n", telemtTomlUserKey(u.Email), sec)
		written = append(written, u)
	}

	var quotaLines, expLines, ipLines []string
	for _, u := range written {
		key := telemtTomlUserKey(u.Email)
		if u.DataQuotaBytes > 0 {
			quotaLines = append(quotaLines, fmt.Sprintf("%s = %d\n", key, u.DataQuotaBytes))
		}
		if u.ExpirationRFC3339 != "" {
			expLines = append(expLines, fmt.Sprintf("%s = %q\n", key, u.ExpirationRFC3339))
		}
		if u.MaxUniqueIPs > 0 {
			ipLines = append(ipLines, fmt.Sprintf("%s = %d\n", key, u.MaxUniqueIPs))
		}
	}
	if len(quotaLines) > 0 {
		fmt.Fprintf(&b, "\n[access.user_data_quota]\n")
		for _, line := range quotaLines {
			fmt.Fprint(&b, line)
		}
	}
	if len(expLines) > 0 {
		fmt.Fprintf(&b, "\n[access.user_expirations]\n")
		for _, line := range expLines {
			fmt.Fprint(&b, line)
		}
	}
	if len(ipLines) > 0 {
		fmt.Fprintf(&b, "\n[access.user_max_unique_ips]\n")
		for _, line := range ipLines {
			fmt.Fprint(&b, line)
		}
	}
	var denyLines []string
	for _, u := range written {
		if len(u.SourceDenyCIDRs) == 0 {
			continue
		}
		key := telemtTomlUserKey(u.Email)
		parts := make([]string, 0, len(u.SourceDenyCIDRs))
		for _, c := range u.SourceDenyCIDRs {
			c = strings.TrimSpace(c)
			if c != "" {
				parts = append(parts, fmt.Sprintf("%q", c))
			}
		}
		if len(parts) == 0 {
			continue
		}
		denyLines = append(denyLines, fmt.Sprintf("%s = [%s]\n", key, strings.Join(parts, ", ")))
	}
	if len(denyLines) > 0 {
		fmt.Fprintf(&b, "\n[access.user_source_deny]\n")
		for _, line := range denyLines {
			fmt.Fprint(&b, line)
		}
	}
	var adTagLines []string
	for _, u := range written {
		tag := strings.ToLower(strings.TrimSpace(u.AdTag))
		if len(tag) != 32 {
			continue
		}
		adTagLines = append(adTagLines, fmt.Sprintf("%s = %q\n", telemtTomlUserKey(u.Email), tag))
	}
	if len(adTagLines) > 0 {
		fmt.Fprintf(&b, "\n[access.user_ad_tags]\n")
		for _, line := range adTagLines {
			fmt.Fprint(&b, line)
		}
	}
	return b.String(), nil
}

// TelemtAccessUsersForInbound loads enabled clients with a Telemt secret for the inbound.
func TelemtAccessUsersForInbound(inboundId int) ([]TelemtAccessUser, error) {
	db := database.GetDB()
	var maps []model.ClientInboundMapping
	if err := db.Where("inbound_id = ?", inboundId).Find(&maps).Error; err != nil {
		return nil, err
	}
	seenID := make(map[int]struct{})
	clientIds := make([]int, 0, len(maps))
	for _, m := range maps {
		if _, ok := seenID[m.ClientId]; ok {
			continue
		}
		seenID[m.ClientId] = struct{}{}
		clientIds = append(clientIds, m.ClientId)
	}
	denyByClient := blockedTelemtDenyCIDRsByClientID(clientIds)

	out := make([]TelemtAccessUser, 0, len(maps))
	for _, m := range maps {
		secret := strings.TrimSpace(m.TelemtSecret)
		if secret == "" || len(secret) != 32 {
			continue
		}
		var c model.ClientEntity
		if err := db.First(&c, m.ClientId).Error; err != nil {
			continue
		}
		if !c.Enable {
			continue
		}
		em := strings.TrimSpace(c.Name)
		if em == "" {
			continue
		}
		u := TelemtAccessUser{Email: em, Secret: secret, Enable: true}
		if c.TotalGB > 0 {
			u.DataQuotaBytes = uint64(math.Round(c.TotalGB * float64(1024*1024*1024)))
		}
		if c.ExpiryTime > 0 {
			u.ExpirationRFC3339 = time.UnixMilli(c.ExpiryTime).UTC().Format(time.RFC3339)
		}
		if c.IPLimitEnabled && c.MaxIPs > 0 {
			u.MaxUniqueIPs = c.MaxIPs
		} else if c.HWIDEnabled && c.MaxHWID > 0 {
			u.MaxUniqueIPs = c.MaxHWID
		}
		if d := denyByClient[c.Id]; len(d) > 0 {
			u.SourceDenyCIDRs = append([]string(nil), d...)
		}
		if tag := strings.TrimSpace(m.TelemtAdTag); tag != "" {
			u.AdTag = tag
		}
		out = append(out, u)
	}
	return out, nil
}

// telemtDenyCIDRFromStoredIP normalizes a panel session IP to a CIDR for Telemt [access.user_source_deny].
func telemtDenyCIDRFromStoredIP(stored string) string {
	n := NormalizeClientIP(stored)
	if n == "" {
		return ""
	}
	ip := net.ParseIP(n)
	if ip == nil {
		return ""
	}
	if ip4 := ip.To4(); ip4 != nil {
		return ip4.String() + "/32"
	}
	return ip.String() + "/128"
}

func blockedTelemtDenyCIDRsByClientID(clientIds []int) map[int][]string {
	if len(clientIds) == 0 {
		return nil
	}
	db := database.GetDB()
	var rows []model.ClientBlockedSessionIP
	if err := db.Where("client_id IN ?", clientIds).Find(&rows).Error; err != nil {
		return nil
	}
	uniq := make(map[int]map[string]struct{})
	for _, r := range rows {
		cidr := telemtDenyCIDRFromStoredIP(r.IP)
		if cidr == "" {
			continue
		}
		if uniq[r.ClientId] == nil {
			uniq[r.ClientId] = make(map[string]struct{})
		}
		uniq[r.ClientId][cidr] = struct{}{}
	}
	out := make(map[int][]string, len(uniq))
	for cid, set := range uniq {
		for c := range set {
			out[cid] = append(out[cid], c)
		}
	}
	return out
}

// BackfillTelemtSecretsForInbound sets telemt_secret on mappings that are missing it for a Telemt inbound.
func BackfillTelemtSecretsForInbound(inboundId int) error {
	db := database.GetDB()
	var ib model.Inbound
	if err := db.Select("id", "protocol").First(&ib, inboundId).Error; err != nil {
		return err
	}
	if model.NormalizeProtocol(ib.Protocol) != model.Telemt {
		return nil
	}
	var maps []model.ClientInboundMapping
	if err := db.Where("inbound_id = ?", inboundId).Find(&maps).Error; err != nil {
		return err
	}
	for _, m := range maps {
		if strings.TrimSpace(m.TelemtSecret) != "" {
			continue
		}
		sec, err := GenerateTelemtSecretHex()
		if err != nil {
			return err
		}
		if err := db.Model(&model.ClientInboundMapping{}).Where("id = ?", m.Id).Update("telemt_secret", sec).Error; err != nil {
			return err
		}
	}
	return nil
}

func BuildTelemtPayloadsForNode(node *model.Node, ibs []*model.Inbound) ([]TelemtNodePayload, error) {
	if node == nil {
		return []TelemtNodePayload{}, nil
	}
	// Return a non-nil empty slice (not nil) so JSON marshals to `[]` instead of `null`.
	// The worker treats `null`/missing as "do not change Telemt", but the caller's intent here
	// is "this node has no Telemt inbounds assigned → stop every Telemt sidecar".
	if len(ibs) == 0 {
		return []TelemtNodePayload{}, nil
	}
	ns := NodeService{}
	out := make([]TelemtNodePayload, 0)
	for _, ib := range ibs {
		if ib == nil || !ib.Enable {
			continue
		}
		if model.NormalizeProtocol(ib.Protocol) != model.Telemt {
			continue
		}
		users, err := TelemtAccessUsersForInbound(ib.Id)
		if err != nil {
			return nil, err
		}
		views, err := ns.GetInboundNodeBindingViews(ib.Id)
		if err != nil {
			return nil, err
		}
		var pubHost string
		var pubPort int
		for _, v := range views {
			if v.NodeId == node.Id {
				pubHost = strings.TrimSpace(v.PublishedAddress)
				pubPort = v.PublishedPort
				break
			}
		}
		workDir := fmt.Sprintf("/app/telemt/%s", ib.Tag)
		tomlStr, err := BuildTelemtToml(ib, users, pubHost, pubPort, workDir)
		if err != nil {
			return nil, err
		}
		out = append(out, TelemtNodePayload{InboundId: ib.Id, Tag: ib.Tag, Toml: tomlStr})
	}
	return out, nil
}

// BuildTelemtPayloadsStandalone builds Telemt TOML payloads for every enabled Telemt inbound
// when Xray runs on the panel host (!multiNode). Node assignment / published address are not used;
// links.publicHost / publicPort in inbound JSON control subscription links unless overridden in UI.
func BuildTelemtPayloadsStandalone() ([]TelemtNodePayload, error) {
	db := database.GetDB()
	var inbounds []model.Inbound
	if err := db.Where("enable = ?", true).Find(&inbounds).Error; err != nil {
		return nil, err
	}
	base := filepath.Join(config.GetDataFolderPath(), "telemt")
	out := make([]TelemtNodePayload, 0)
	for i := range inbounds {
		ib := &inbounds[i]
		if model.NormalizeProtocol(ib.Protocol) != model.Telemt {
			continue
		}
		users, err := TelemtAccessUsersForInbound(ib.Id)
		if err != nil {
			return nil, err
		}
		workDir := filepath.Join(base, ib.Tag)
		tomlStr, err := BuildTelemtToml(ib, users, "", 0, workDir)
		if err != nil {
			return nil, err
		}
		out = append(out, TelemtNodePayload{InboundId: ib.Id, Tag: ib.Tag, Toml: tomlStr})
	}
	return out, nil
}

// PreviewTelemtToml returns the Telemt config.toml that would be deployed for this inbound (wizard preview).
// When inbound.Id > 0, [access.users] is filled from the database; for a new inbound the section is empty until clients are assigned.
func PreviewTelemtToml(inbound *model.Inbound) (string, error) {
	if inbound == nil {
		return "", fmt.Errorf("inbound is nil")
	}
	if model.NormalizeProtocol(inbound.Protocol) != model.Telemt {
		return "", fmt.Errorf("not a telemt inbound")
	}
	tag := strings.TrimSpace(inbound.Tag)
	if tag == "" {
		tag = "inbound-preview"
	}
	var users []TelemtAccessUser
	if inbound.Id > 0 {
		u, err := TelemtAccessUsersForInbound(inbound.Id)
		if err != nil {
			return "", err
		}
		users = u
	}
	workDir := filepath.Join(config.GetDataFolderPath(), "telemt", tag)
	return BuildTelemtToml(inbound, users, "", 0, workDir)
}
