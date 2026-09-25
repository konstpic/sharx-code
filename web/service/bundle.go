package service

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"gorm.io/gorm"
)

// BundleService manages bundles: ordered sets of hosts a client gets. Access is derived from the hosts' inbounds and
// materialised into client_inbound_mappings (the table Xray, Telemt, WireGuard and traffic keep reading).
// See docs/architecture/bundles.md.
type BundleService struct{}

// BundleHostRef is one host in a bundle (order = slice order).
type BundleHostRef struct {
	HostId int  `json:"hostId"`
	Hidden bool `json:"hidden"`
}

// AccessDiff is what a recompute changed for one client.
type AccessDiff struct {
	ClientId int
	Added    []int
	Removed  []int
	Order    []int // the resulting inbound order
}

// Changed reports whether anything moved (added, removed or reordered).
func (d AccessDiff) Changed() bool { return len(d.Added) > 0 || len(d.Removed) > 0 }

// effectiveInboundOrder returns the inbound ids a client gets, in order of first appearance: bundles in the given order,
// each bundle's hosts in their order (hidden and disabled hosts included: access does not depend on visibility).
func effectiveInboundOrder(bundles []bundleWithHosts) []int {
	var out []int
	seen := map[int]bool{}
	for _, b := range bundles {
		if !b.bundle.Enable {
			continue
		}
		for _, h := range b.hosts {
			if h.inboundId <= 0 || seen[h.inboundId] {
				continue
			}
			seen[h.inboundId] = true
			out = append(out, h.inboundId)
		}
	}
	return out
}

type bundleHostRow struct {
	hostId    int
	inboundId int
	hidden    bool
	sortOrder int
}

type bundleWithHosts struct {
	bundle model.Bundle
	hosts  []bundleHostRow
}

// loadClientBundles returns the client's bundles (membership order) with their hosts (bundle order).
func loadClientBundles(tx *gorm.DB, clientId int) ([]bundleWithHosts, error) {
	var links []model.ClientBundle
	if err := tx.Where("client_id = ?", clientId).Order("sort_order ASC, id ASC").Find(&links).Error; err != nil {
		return nil, err
	}
	out := make([]bundleWithHosts, 0, len(links))
	for _, l := range links {
		var b model.Bundle
		if err := tx.First(&b, l.BundleId).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return nil, err
		}
		type row struct {
			HostId    int
			InboundId *int
			Hidden    bool
			SortOrder int
		}
		var rows []row
		if err := tx.Raw(`SELECT bh.host_id AS host_id, h.inbound_id AS inbound_id, bh.hidden AS hidden, bh.sort_order AS sort_order
			FROM bundle_hosts bh JOIN hosts h ON h.id = bh.host_id
			WHERE bh.bundle_id = ? ORDER BY bh.sort_order ASC, bh.id ASC`, b.Id).Scan(&rows).Error; err != nil {
			return nil, err
		}
		bw := bundleWithHosts{bundle: b}
		for _, r := range rows {
			in := 0
			if r.InboundId != nil {
				in = *r.InboundId
			}
			bw.hosts = append(bw.hosts, bundleHostRow{hostId: r.HostId, inboundId: in, hidden: r.Hidden, sortOrder: r.SortOrder})
		}
		out = append(out, bw)
	}
	return out, nil
}

// EffectiveInbounds returns the ordered inbound ids the client gets from its bundles.
func (s *BundleService) EffectiveInbounds(clientId int) ([]int, error) {
	bws, err := loadClientBundles(database.GetDB(), clientId)
	if err != nil {
		return nil, err
	}
	return effectiveInboundOrder(bws), nil
}

// RecomputeClientAccess brings client_inbound_mappings in line with the client's bundles. It is a diff: rows that stay keep
// their ids and Telemt secrets. Pushing the change to nodes is the caller's job (see the returned diff).
func (s *BundleService) RecomputeClientAccess(tx *gorm.DB, clientId int) (AccessDiff, error) {
	diff := AccessDiff{ClientId: clientId}
	bws, err := loadClientBundles(tx, clientId)
	if err != nil {
		return diff, err
	}
	want := effectiveInboundOrder(bws)
	var current []model.ClientInboundMapping
	if err := tx.Where("client_id = ?", clientId).Find(&current).Error; err != nil {
		return diff, err
	}
	have := map[int]bool{}
	for _, m := range current {
		have[m.InboundId] = true
	}
	wantSet := map[int]bool{}
	for _, id := range want {
		wantSet[id] = true
		if !have[id] {
			diff.Added = append(diff.Added, id)
		}
	}
	for id := range have {
		if !wantSet[id] {
			diff.Removed = append(diff.Removed, id)
		}
	}
	sort.Ints(diff.Removed)
	diff.Order = want
	if err := (&ClientService{}).SyncClientInboundAssignments(tx, clientId, want); err != nil {
		return diff, err
	}
	return diff, nil
}

// ---------- CRUD ----------

func normalizeBundle(b *model.Bundle) error {
	b.Name = strings.TrimSpace(b.Name)
	b.Description = strings.TrimSpace(b.Description)
	if b.Name == "" {
		return errors.New("name is required")
	}
	return nil
}

// validateBundleHosts checks that every host exists, is bound to an inbound (not a pre-bundle Host) and appears once.
func validateBundleHosts(tx *gorm.DB, hosts []BundleHostRef) error {
	seen := map[int]bool{}
	for _, h := range hosts {
		if seen[h.HostId] {
			return fmt.Errorf("host %d is listed twice", h.HostId)
		}
		seen[h.HostId] = true
		var host model.Host
		if err := tx.Select("id, kind, inbound_id").First(&host, h.HostId).Error; err != nil {
			return fmt.Errorf("host %d not found", h.HostId)
		}
		if host.Kind == model.HostKindLegacy || host.InboundId == nil {
			return fmt.Errorf("host %d is a pre-bundle host and cannot be used in a bundle", h.HostId)
		}
	}
	return nil
}

func writeBundleHosts(tx *gorm.DB, bundleId int, hosts []BundleHostRef) error {
	if err := tx.Where("bundle_id = ?", bundleId).Delete(&model.BundleHost{}).Error; err != nil {
		return err
	}
	for i, h := range hosts {
		if err := tx.Create(&model.BundleHost{BundleId: bundleId, HostId: h.HostId, SortOrder: i * 10, Hidden: h.Hidden}).Error; err != nil {
			return err
		}
	}
	return nil
}

// memberIDs returns the ids of the clients in a bundle.
func memberIDs(tx *gorm.DB, bundleId int) ([]int, error) {
	var ids []int
	err := tx.Model(&model.ClientBundle{}).Where("bundle_id = ?", bundleId).Pluck("client_id", &ids).Error
	return ids, err
}

// Create makes a bundle with its hosts.
func (s *BundleService) Create(userId int, b *model.Bundle, hosts []BundleHostRef) (*model.Bundle, error) {
	if err := normalizeBundle(b); err != nil {
		return nil, err
	}
	db := database.GetDB()
	now := time.Now().Unix()
	b.Id, b.UserId, b.CreatedAt, b.UpdatedAt = 0, userId, now, now
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := validateBundleHosts(tx, hosts); err != nil {
			return err
		}
		if err := tx.Create(b).Error; err != nil {
			return err
		}
		return writeBundleHosts(tx, b.Id, hosts)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(b.Id)
}

// Update changes a bundle. hosts == nil leaves the host list alone. Members are recomputed; the returned diffs tell the
// caller which clients changed access.
func (s *BundleService) Update(b *model.Bundle, hosts *[]BundleHostRef) ([]AccessDiff, error) {
	if err := normalizeBundle(b); err != nil {
		return nil, err
	}
	db := database.GetDB()
	var diffs []AccessDiff
	err := db.Transaction(func(tx *gorm.DB) error {
		var cur model.Bundle
		if err := tx.First(&cur, b.Id).Error; err != nil {
			return errors.New("bundle not found")
		}
		if err := tx.Model(&model.Bundle{}).Where("id = ?", b.Id).Updates(map[string]any{
			"name": b.Name, "description": b.Description, "enable": b.Enable,
			"follow_placements": b.FollowPlacements, "updated_at": time.Now().Unix(),
		}).Error; err != nil {
			return err
		}
		if hosts != nil {
			if err := validateBundleHosts(tx, *hosts); err != nil {
				return err
			}
			if err := writeBundleHosts(tx, b.Id, *hosts); err != nil {
				return err
			}
		}
		ids, err := memberIDs(tx, b.Id)
		if err != nil {
			return err
		}
		diffs, err = s.recomputeMany(tx, ids)
		return err
	})
	return diffs, err
}

func (s *BundleService) recomputeMany(tx *gorm.DB, clientIds []int) ([]AccessDiff, error) {
	var out []AccessDiff
	for _, id := range clientIds {
		d, err := s.RecomputeClientAccess(tx, id)
		if err != nil {
			return nil, err
		}
		if d.Changed() {
			out = append(out, d)
		}
	}
	return out, nil
}

// Delete removes a bundle; its members lose the access only it gave them.
func (s *BundleService) Delete(id int) ([]AccessDiff, error) {
	db := database.GetDB()
	var diffs []AccessDiff
	err := db.Transaction(func(tx *gorm.DB) error {
		ids, err := memberIDs(tx, id)
		if err != nil {
			return err
		}
		if err := tx.Delete(&model.Bundle{}, id).Error; err != nil { // cascades to bundle_hosts and client_bundles
			return err
		}
		diffs, err = s.recomputeMany(tx, ids)
		return err
	})
	return diffs, err
}

// Get returns a bundle with its hosts and member count.
func (s *BundleService) Get(id int) (*model.Bundle, error) {
	db := database.GetDB()
	var b model.Bundle
	if err := db.First(&b, id).Error; err != nil {
		return nil, err
	}
	if err := fillBundle(db, &b); err != nil {
		return nil, err
	}
	return &b, nil
}

// List returns all bundles (manual first) with hosts and member counts.
func (s *BundleService) List() ([]*model.Bundle, error) {
	db := database.GetDB()
	var out []*model.Bundle
	if err := db.Order("auto ASC, sort_order ASC, id ASC").Find(&out).Error; err != nil {
		return nil, err
	}
	for _, b := range out {
		if err := fillBundle(db, b); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func fillBundle(db *gorm.DB, b *model.Bundle) error {
	var n int64
	if err := db.Model(&model.ClientBundle{}).Where("bundle_id = ?", b.Id).Count(&n).Error; err != nil {
		return err
	}
	b.ClientCount = int(n)
	var rows []model.BundleHost
	if err := db.Where("bundle_id = ?", b.Id).Order("sort_order ASC, id ASC").Find(&rows).Error; err != nil {
		return err
	}
	for i := range rows {
		var h model.Host
		if err := db.First(&h, rows[i].HostId).Error; err == nil {
			rows[i].Host = &h
		}
	}
	b.Hosts = rows
	return nil
}

// ---------- membership ----------

// SetClientBundles replaces a client's bundle list (order kept) and recomputes its access.
func (s *BundleService) SetClientBundles(clientId int, bundleIds []int) (AccessDiff, error) {
	db := database.GetDB()
	var diff AccessDiff
	err := db.Transaction(func(tx *gorm.DB) error {
		seen := map[int]bool{}
		clean := make([]int, 0, len(bundleIds))
		for _, id := range bundleIds {
			if id > 0 && !seen[id] {
				var c int64
				if err := tx.Model(&model.Bundle{}).Where("id = ?", id).Count(&c).Error; err != nil || c == 0 {
					return fmt.Errorf("bundle %d not found", id)
				}
				seen[id] = true
				clean = append(clean, id)
			}
		}
		if err := tx.Where("client_id = ?", clientId).Delete(&model.ClientBundle{}).Error; err != nil {
			return err
		}
		now := time.Now().Unix()
		for i, id := range clean {
			if err := tx.Create(&model.ClientBundle{ClientId: clientId, BundleId: id, SortOrder: i * 10, CreatedAt: now}).Error; err != nil {
				return err
			}
		}
		var err error
		diff, err = s.RecomputeClientAccess(tx, clientId)
		return err
	})
	return diff, err
}

// AddClients puts clients into a bundle (idempotent) and recomputes their access.
func (s *BundleService) AddClients(bundleId int, clientIds []int) ([]AccessDiff, error) {
	db := database.GetDB()
	var diffs []AccessDiff
	err := db.Transaction(func(tx *gorm.DB) error {
		var c int64
		if err := tx.Model(&model.Bundle{}).Where("id = ?", bundleId).Count(&c).Error; err != nil || c == 0 {
			return errors.New("bundle not found")
		}
		now := time.Now().Unix()
		for _, id := range clientIds {
			var n int64
			if err := tx.Model(&model.ClientBundle{}).Where("client_id = ? AND bundle_id = ?", id, bundleId).Count(&n).Error; err != nil {
				return err
			}
			if n > 0 {
				continue
			}
			var maxOrder *int
			_ = tx.Model(&model.ClientBundle{}).Where("client_id = ?", id).Select("MAX(sort_order)").Scan(&maxOrder).Error
			next := 0
			if maxOrder != nil {
				next = *maxOrder + 10
			}
			if err := tx.Create(&model.ClientBundle{ClientId: id, BundleId: bundleId, SortOrder: next, CreatedAt: now}).Error; err != nil {
				return err
			}
		}
		var err error
		diffs, err = s.recomputeMany(tx, clientIds)
		return err
	})
	return diffs, err
}

// RemoveClients takes clients out of a bundle and recomputes their access.
func (s *BundleService) RemoveClients(bundleId int, clientIds []int) ([]AccessDiff, error) {
	db := database.GetDB()
	var diffs []AccessDiff
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("bundle_id = ? AND client_id IN ?", bundleId, clientIds).Delete(&model.ClientBundle{}).Error; err != nil {
			return err
		}
		var err error
		diffs, err = s.recomputeMany(tx, clientIds)
		return err
	})
	return diffs, err
}

// SubscriptionHosts returns, per inbound, the hosts that deliver it to the client in the subscription: the client's
// enabled bundles in order, each bundle's hosts in order, without hidden or disabled hosts, each host once. The map only has
// keys for inbounds the client's bundles cover; a covered inbound whose hosts are all hidden or disabled maps to an empty
// slice (access without delivery).
func (s *BundleService) SubscriptionHosts(clientId int) (map[int][]model.Host, error) {
	db := database.GetDB()
	bws, err := loadClientBundles(db, clientId)
	if err != nil {
		return nil, err
	}
	out := map[int][]model.Host{}
	seenHost := map[int]bool{}
	for _, b := range bws {
		if !b.bundle.Enable {
			continue
		}
		for _, h := range b.hosts {
			if h.inboundId <= 0 {
				continue
			}
			if _, ok := out[h.inboundId]; !ok {
				out[h.inboundId] = []model.Host{}
			}
			if h.hidden || seenHost[h.hostId] {
				continue
			}
			var host model.Host
			if err := db.First(&host, h.hostId).Error; err != nil {
				continue
			}
			if !host.Enable {
				continue
			}
			seenHost[h.hostId] = true
			out[h.inboundId] = append(out[h.inboundId], host)
		}
	}
	return out, nil
}

// BundlesActive reports whether the bundle scheme drives access and delivery.
func (s *BundleService) BundlesActive() bool {
	on, err := (&SettingService{}).GetBundlesEnabled()
	return err == nil && on
}
