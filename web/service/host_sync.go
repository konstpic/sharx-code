package service

import (
	"net"
	"strings"
	"sync"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"gorm.io/gorm"
)

// HostSyncService keeps the managed hosts (placement, pool, local) in step with the deployment facts they mirror: inbound
// node bindings, balancer pools and single-node inbounds. It is idempotent and cheap, so it runs after the mutations that
// matter and on a timer as a safety net. Hosts an operator has edited (customized) are never overwritten.
// See docs/architecture/bundles.md section 4.1.
type HostSyncService struct{}

// hostNodeAddress reduces a node API address ("http://1.2.3.4:8080") to its host, like the subscription does.
func hostNodeAddress(nodeAddress string) string {
	a := strings.TrimSpace(nodeAddress)
	a = strings.TrimPrefix(strings.TrimPrefix(a, "http://"), "https://")
	if i := strings.IndexByte(a, '/'); i >= 0 {
		a = a[:i]
	}
	if h, _, err := net.SplitHostPort(a); err == nil {
		return h
	}
	return a
}

// SyncAll reconciles every managed host. Returns the number of hosts created, updated and removed.
func (s *HostSyncService) SyncAll() (created, updated, removed int, err error) {
	db := database.GetDB()
	multi, _ := (&SettingService{}).GetMultiNodeMode()
	err = db.Transaction(func(tx *gorm.DB) error {
		var e error
		if created, updated, removed, e = s.syncPlacements(tx, multi); e != nil {
			return e
		}
		c2, u2, r2, e := s.syncPools(tx)
		if e != nil {
			return e
		}
		created, updated, removed = created+c2, updated+u2, removed+r2
		c3, u3, r3, e := s.syncLocal(tx, multi)
		created, updated, removed = created+c3, updated+u3, removed+r3
		return e
	})
	return
}

func (s *HostSyncService) syncPlacements(tx *gorm.DB, multi bool) (created, updated, removed int, err error) {
	type row struct {
		InboundId, NodeId                     int
		PublishedAddress                      string
		PublishedPort                         int
		IncludeInSubscription                 bool
		SubscriptionRemarkSuffix, ServerDescr string
		NodeName, NodeAddress                 string
	}
	var rows []row
	if err = tx.Raw(`SELECT m.inbound_id AS inbound_id, m.node_id AS node_id, m.published_address AS published_address,
			m.published_port AS published_port, m.include_in_subscription AS include_in_subscription,
			m.subscription_remark_suffix AS subscription_remark_suffix, m.server_description AS server_descr,
			n.name AS node_name, n.address AS node_address
		FROM inbound_node_mappings m JOIN nodes n ON n.id = m.node_id ORDER BY m.inbound_id, m.sort_order, m.id`).Scan(&rows).Error; err != nil {
		return
	}
	var existing []model.Host
	if err = tx.Where("kind = ?", model.HostKindPlacement).Find(&existing).Error; err != nil {
		return
	}
	byKey := map[[2]int]*model.Host{}
	for i := range existing {
		h := &existing[i]
		if h.InboundId != nil && h.NodeId != nil {
			byKey[[2]int{*h.InboundId, *h.NodeId}] = h
		}
	}
	keep := map[int]bool{}
	if multi {
		for _, r := range rows {
			addr := strings.TrimSpace(r.PublishedAddress)
			if addr == "" {
				addr = hostNodeAddress(r.NodeAddress)
			}
			if addr == "" {
				continue
			}
			inb, node := r.InboundId, r.NodeId
			want := model.Host{
				Name: r.NodeName, Address: addr, Port: r.PublishedPort, Enable: r.IncludeInSubscription,
				RemarkSuffix: r.SubscriptionRemarkSuffix, ServerDescription: r.ServerDescr,
			}
			if h, ok := byKey[[2]int{inb, node}]; ok {
				keep[h.Id] = true
				if h.Customized {
					continue
				}
				if h.Name != want.Name || h.Address != want.Address || h.Port != want.Port || h.Enable != want.Enable ||
					h.RemarkSuffix != want.RemarkSuffix || h.ServerDescription != want.ServerDescription {
					if err = tx.Model(&model.Host{}).Where("id = ?", h.Id).Updates(map[string]any{
						"name": want.Name, "address": want.Address, "port": want.Port, "enable": want.Enable,
						"remark_suffix": want.RemarkSuffix, "server_description": want.ServerDescription,
					}).Error; err != nil {
						return
					}
					updated++
				}
				continue
			}
			nh := &model.Host{
				UserId: 1, Name: want.Name, Address: want.Address, Port: want.Port, Enable: want.Enable,
				Kind: model.HostKindPlacement, Source: model.HostSourcePlacement, InboundId: &inb, NodeId: &node,
				RemarkSuffix: want.RemarkSuffix, ServerDescription: want.ServerDescription, SubscriptionApplyMode: model.HostSubscriptionApplyReplace,
			}
			if err = tx.Create(nh).Error; err != nil {
				return
			}
			created++
			keep[nh.Id] = true
			if err = followBundles(tx, inb, nh.Id, nh.Kind); err != nil {
				return
			}
		}
	}
	for i := range existing {
		h := &existing[i]
		if keep[h.Id] {
			continue
		}
		if err = removeManagedHost(tx, h); err != nil {
			return
		}
		removed++
	}
	return
}

func (s *HostSyncService) syncPools(tx *gorm.DB) (created, updated, removed int, err error) {
	type row struct {
		PoolId, InboundId, ListenPort, InboundPort int
		PoolEnable, SubEnabled, BalancerEnable     bool
		BalancerName, BalancerAddress              string
	}
	var rows []row
	if err = tx.Raw(`SELECT p.id AS pool_id, p.inbound_id AS inbound_id, p.listen_port AS listen_port, i.port AS inbound_port,
			p.enable AS pool_enable, p.sub_enabled AS sub_enabled, b.enable AS balancer_enable, b.name AS balancer_name, b.address AS balancer_address
		FROM balancer_pools p JOIN balancers b ON b.id = p.balancer_id JOIN inbounds i ON i.id = p.inbound_id ORDER BY p.id`).Scan(&rows).Error; err != nil {
		return
	}
	var existing []model.Host
	if err = tx.Where("kind = ?", model.HostKindPool).Find(&existing).Error; err != nil {
		return
	}
	byPool := map[int]*model.Host{}
	for i := range existing {
		if existing[i].PoolId != nil {
			byPool[*existing[i].PoolId] = &existing[i]
		}
	}
	keep := map[int]bool{}
	for _, r := range rows {
		port := r.ListenPort
		if port == r.InboundPort {
			port = 0
		}
		enable := r.PoolEnable && r.SubEnabled && r.BalancerEnable && strings.TrimSpace(r.BalancerAddress) != ""
		if h, ok := byPool[r.PoolId]; ok {
			keep[h.Id] = true
			if h.Customized {
				continue
			}
			if h.Name != r.BalancerName || h.Address != r.BalancerAddress || h.Port != port || h.Enable != enable {
				if err = tx.Model(&model.Host{}).Where("id = ?", h.Id).Updates(map[string]any{
					"name": r.BalancerName, "address": r.BalancerAddress, "port": port, "enable": enable,
				}).Error; err != nil {
					return
				}
				updated++
			}
			continue
		}
		inb, pool := r.InboundId, r.PoolId
		nh := &model.Host{
			UserId: 1, Name: r.BalancerName, Address: r.BalancerAddress, Port: port, Enable: enable,
			Kind: model.HostKindPool, Source: model.HostSourcePool, InboundId: &inb, PoolId: &pool, SubscriptionApplyMode: model.HostSubscriptionApplyReplace,
		}
		if err = tx.Create(nh).Error; err != nil {
			return
		}
		created++
		keep[nh.Id] = true
		if err = followBundles(tx, inb, nh.Id, nh.Kind); err != nil {
			return
		}
	}
	for i := range existing {
		if keep[existing[i].Id] {
			continue
		}
		if err = removeManagedHost(tx, &existing[i]); err != nil {
			return
		}
		removed++
	}
	return
}

// syncLocal keeps one 'local' host per inbound that is referenced by a bundle host or lives on the panel. A local host
// delivers the address the panel itself is reached at (resolved per request). It is enabled only while the inbound has
// no node placement in multi-node mode, exactly when the old subscription fell back to the panel address.
func (s *HostSyncService) syncLocal(tx *gorm.DB, multi bool) (created, updated, removed int, err error) {
	var existing []model.Host
	if err = tx.Where("kind = ?", model.HostKindLocal).Find(&existing).Error; err != nil {
		return
	}
	for i := range existing {
		h := &existing[i]
		if h.InboundId == nil {
			continue
		}
		hasPlacement := false
		if multi {
			var n int64
			if err = tx.Model(&model.Host{}).Where("kind = ? AND inbound_id = ? AND enable = ?", model.HostKindPlacement, *h.InboundId, true).Count(&n).Error; err != nil {
				return
			}
			hasPlacement = n > 0
		}
		want := !hasPlacement
		if !h.Customized && h.Enable != want {
			if err = tx.Model(&model.Host{}).Where("id = ?", h.Id).Update("enable", want).Error; err != nil {
				return
			}
			updated++
		}
	}
	return
}

// ensureLocalHost returns the inbound's local host, creating it when missing.
func ensureLocalHost(tx *gorm.DB, inboundId int) (*model.Host, error) {
	var h model.Host
	err := tx.Where("kind = ? AND inbound_id = ?", model.HostKindLocal, inboundId).First(&h).Error
	if err == nil {
		return &h, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}
	id := inboundId
	nh := &model.Host{
		UserId: 1, Name: "panel", Enable: false, Kind: model.HostKindLocal, Source: model.HostSourcePlacement, InboundId: &id,
		SubscriptionApplyMode: model.HostSubscriptionApplyReplace,
	}
	if err := tx.Create(nh).Error; err != nil {
		return nil, err
	}
	return nh, nil
}

// removeManagedHost deletes a managed host whose placement or pool is gone. A bundle that would lose its last host for the
// inbound (and so the clients' access to it) gets a hidden local host in that place first: access to an inbound must not
// depend on where it is deployed.
func removeManagedHost(tx *gorm.DB, h *model.Host) error {
	if h.InboundId != nil {
		var links []model.BundleHost
		if err := tx.Where("host_id = ?", h.Id).Find(&links).Error; err != nil {
			return err
		}
		for _, l := range links {
			var others int64
			if err := tx.Raw(`SELECT count(*) FROM bundle_hosts bh JOIN hosts x ON x.id = bh.host_id
				WHERE bh.bundle_id = ? AND x.inbound_id = ? AND x.id <> ?`, l.BundleId, *h.InboundId, h.Id).Scan(&others).Error; err != nil {
				return err
			}
			if others > 0 {
				continue
			}
			local, err := ensureLocalHost(tx, *h.InboundId)
			if err != nil {
				return err
			}
			var have int64
			if err := tx.Model(&model.BundleHost{}).Where("bundle_id = ? AND host_id = ?", l.BundleId, local.Id).Count(&have).Error; err != nil {
				return err
			}
			if have == 0 {
				if err := tx.Create(&model.BundleHost{BundleId: l.BundleId, HostId: local.Id, SortOrder: l.SortOrder, Hidden: true}).Error; err != nil {
					return err
				}
			}
		}
	}
	return tx.Delete(&model.Host{}, h.Id).Error
}

// followBundles adds a new managed host to every bundle that follows placements and already covers the inbound. A new
// node placement goes right after that bundle's existing placements of the inbound (so nodes stay together, as in the old
// subscription); anything else goes after the inbound's last host.
func followBundles(tx *gorm.DB, inboundId, hostId int, kind string) error {
	var bundleIds []int
	if err := tx.Raw(`SELECT DISTINCT b.id FROM bundles b
		JOIN bundle_hosts bh ON bh.bundle_id = b.id JOIN hosts h ON h.id = bh.host_id
		WHERE b.follow_placements = TRUE AND h.inbound_id = ? ORDER BY b.id`, inboundId).Scan(&bundleIds).Error; err != nil {
		return err
	}
	for _, bid := range bundleIds {
		var have int64
		if err := tx.Model(&model.BundleHost{}).Where("bundle_id = ? AND host_id = ?", bid, hostId).Count(&have).Error; err != nil {
			return err
		}
		if have > 0 {
			continue
		}
		var links []model.BundleHost
		if err := tx.Where("bundle_id = ?", bid).Order("sort_order ASC, id ASC").Find(&links).Error; err != nil {
			return err
		}
		inGroup := map[int]bool{}
		var groupHosts []int
		q := tx.Model(&model.Host{}).Where("inbound_id = ?", inboundId)
		if kind == model.HostKindPlacement {
			var placements int64
			if err := tx.Model(&model.Host{}).Where("inbound_id = ? AND kind = ? AND id IN (SELECT host_id FROM bundle_hosts WHERE bundle_id = ?)", inboundId, model.HostKindPlacement, bid).Count(&placements).Error; err != nil {
				return err
			}
			if placements > 0 {
				q = q.Where("kind = ?", model.HostKindPlacement)
			}
		}
		if err := q.Pluck("id", &groupHosts).Error; err != nil {
			return err
		}
		for _, id := range groupHosts {
			inGroup[id] = true
		}
		last := -1
		for i, l := range links {
			if inGroup[l.HostId] {
				last = i
			}
		}
		// If the bundle lists none of the inbound's placements (they are all hidden or disabled, e.g. a Host replaced them in
		// the old scheme), a new one stays hidden too: adding a node must not undo that choice.
		hidden := false
		if kind == model.HostKindPlacement {
			var total, visible int64
			base := "inbound_id = ? AND kind = ? AND id IN (SELECT host_id FROM bundle_hosts WHERE bundle_id = ?"
			if err := tx.Model(&model.Host{}).Where(base+")", inboundId, model.HostKindPlacement, bid).Count(&total).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.Host{}).Where(base+" AND hidden = FALSE) AND enable = TRUE", inboundId, model.HostKindPlacement, bid).Count(&visible).Error; err != nil {
				return err
			}
			hidden = total > 0 && visible == 0
		}
		ordered := make([]model.BundleHost, 0, len(links)+1)
		ordered = append(ordered, links[:last+1]...)
		ordered = append(ordered, model.BundleHost{BundleId: bid, HostId: hostId, Hidden: hidden})
		ordered = append(ordered, links[last+1:]...)
		for i := range ordered {
			if ordered[i].Id == 0 {
				ordered[i].SortOrder = i * 10
				if err := tx.Create(&ordered[i]).Error; err != nil {
					return err
				}
			} else if ordered[i].SortOrder != i*10 {
				if err := tx.Model(&model.BundleHost{}).Where("id = ?", ordered[i].Id).Update("sort_order", i*10).Error; err != nil {
					return err
				}
			}
		}
	}
	return nil
}

var (
	hostSyncMu      sync.Mutex
	hostSyncRunning bool
	hostSyncAgain   bool
)

// TriggerHostSync reconciles the managed hosts in the background once the bundle scheme is active. Calls that arrive while a
// run is in progress are folded into one follow-up run, so a burst of edits costs two syncs at most.
func TriggerHostSync() {
	if !(&BundleService{}).BundlesActive() {
		return
	}
	hostSyncMu.Lock()
	if hostSyncRunning {
		hostSyncAgain = true
		hostSyncMu.Unlock()
		return
	}
	hostSyncRunning = true
	hostSyncMu.Unlock()
	go func() {
		for {
			if _, _, _, err := (&HostSyncService{}).SyncAll(); err != nil {
				logger.Warningf("host sync: %v", err)
			}
			hostSyncMu.Lock()
			if !hostSyncAgain {
				hostSyncRunning = false
				hostSyncMu.Unlock()
				return
			}
			hostSyncAgain = false
			hostSyncMu.Unlock()
		}
	}()
}
