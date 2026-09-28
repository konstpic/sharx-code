package service

import (
	"errors"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"gorm.io/gorm"
)

// BundleHostView is a bundle-scheme host with what the panel shows next to it.
type BundleHostView struct {
	model.Host
	InboundRemark string   `json:"inboundRemark"`
	NodeName      string   `json:"nodeName,omitempty"`
	PoolName      string   `json:"poolName,omitempty"`
	BundleIds     []int    `json:"bundleIds"`
	BundleNames   []string `json:"bundleNames"`
}

// ListBundleHosts returns every bundle-scheme host (kind other than legacy).
func (s *BundleService) ListBundleHosts() ([]BundleHostView, error) {
	db := database.GetDB()
	var hosts []model.Host
	if err := db.Where("kind <> ?", model.HostKindLegacy).Order("inbound_id ASC, id ASC").Find(&hosts).Error; err != nil {
		return nil, err
	}
	out := make([]BundleHostView, 0, len(hosts))
	for _, h := range hosts {
		v := BundleHostView{Host: h}
		if h.InboundId != nil {
			var ib model.Inbound
			if err := db.Select("id, remark, port").First(&ib, *h.InboundId).Error; err == nil {
				v.InboundRemark = ib.Remark
			}
		}
		if h.NodeId != nil {
			var n model.Node
			if err := db.Select("id, name").First(&n, *h.NodeId).Error; err == nil {
				v.NodeName = n.Name
			}
		}
		if h.PoolId != nil {
			var name string
			_ = db.Raw("SELECT b.name FROM balancer_pools p JOIN balancers b ON b.id = p.balancer_id WHERE p.id = ?", *h.PoolId).Scan(&name).Error
			v.PoolName = name
		}
		type row struct {
			Id   int
			Name string
		}
		var rows []row
		_ = db.Raw("SELECT b.id AS id, b.name AS name FROM bundle_hosts bh JOIN bundles b ON b.id = bh.bundle_id WHERE bh.host_id = ? ORDER BY b.id", h.Id).Scan(&rows).Error
		for _, r := range rows {
			v.BundleIds = append(v.BundleIds, r.Id)
			v.BundleNames = append(v.BundleNames, r.Name)
		}
		out = append(out, v)
	}
	return out, nil
}

// HostInput are the editable fields of a bundle-scheme host.
type HostInput struct {
	Name                      string `json:"name"`
	Address                   string `json:"address"`
	Port                      int    `json:"port"`
	Remark                    string `json:"remark"`
	Enable                    bool   `json:"enable"`
	RemarkSuffix              string `json:"remarkSuffix"`
	ServerDescription         string `json:"serverDescription"`
	SubscriptionSNI           string `json:"subscriptionSni"`
	SubscriptionHttpHost      string `json:"subscriptionHttpHost"`
	SubscriptionPath          string `json:"subscriptionPath"`
	SubscriptionAlpn          string `json:"subscriptionAlpn"`
	SubscriptionFingerprint   string `json:"subscriptionFingerprint"`
	SubscriptionAllowInsecure *bool  `json:"subscriptionAllowInsecure"`
	SubscriptionSecurity      string `json:"subscriptionSecurity"`
}

func applyHostInput(h *model.Host, in HostInput) {
	h.Name = strings.TrimSpace(in.Name)
	h.Address = strings.TrimSpace(in.Address)
	h.Port = in.Port
	h.Remark = strings.TrimSpace(in.Remark)
	h.Enable = in.Enable
	h.RemarkSuffix = in.RemarkSuffix
	h.ServerDescription = in.ServerDescription
	h.SubscriptionSNI = in.SubscriptionSNI
	h.SubscriptionHttpHost = in.SubscriptionHttpHost
	h.SubscriptionPath = in.SubscriptionPath
	h.SubscriptionAlpn = in.SubscriptionAlpn
	h.SubscriptionFingerprint = in.SubscriptionFingerprint
	h.SubscriptionAllowInsecure = in.SubscriptionAllowInsecure
	h.SubscriptionSecurity = in.SubscriptionSecurity
	normalizeHostSubscriptionOverrides(h)
}

// CreateAddressHost adds a free-address host (domain, CDN) bound to one inbound. It is appended to the bundles that follow
// placements and already cover the inbound, as a legacy Host used to apply to everyone on the inbound.
func (s *BundleService) CreateAddressHost(userId, inboundId int, in HostInput) (*model.Host, error) {
	db := database.GetDB()
	var ib model.Inbound
	if err := db.Select("id").First(&ib, inboundId).Error; err != nil {
		return nil, errors.New("inbound not found")
	}
	h := &model.Host{UserId: userId, Kind: model.HostKindAddress, Source: model.HostSourceManual, Customized: true, InboundId: &inboundId}
	applyHostInput(h, in)
	if h.Name == "" || h.Address == "" {
		return nil, errors.New("name and address are required")
	}
	h.CreatedAt, h.UpdatedAt = time.Now().Unix(), time.Now().Unix()
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(h).Error; err != nil {
			return err
		}
		return followBundles(tx, inboundId, h.Id, h.Kind)
	})
	if err != nil {
		return nil, err
	}
	return h, nil
}

// UpdateBundleHost edits a host. Editing a managed host (placement, pool, local) marks it customized, so the sync stops
// overwriting the operator's values; ResetBundleHost hands it back.
func (s *BundleService) UpdateBundleHost(id int, in HostInput) (*model.Host, error) {
	db := database.GetDB()
	var h model.Host
	if err := db.First(&h, id).Error; err != nil {
		return nil, errors.New("host not found")
	}
	if h.Kind == model.HostKindLegacy {
		return nil, errors.New("this is a pre-bundle host")
	}
	applyHostInput(&h, in)
	if h.Name == "" || (h.Kind != model.HostKindLocal && h.Address == "") {
		return nil, errors.New("name and address are required")
	}
	if h.Kind != model.HostKindAddress {
		h.Customized = true
	}
	if err := db.Save(&h).Error; err != nil {
		return nil, err
	}
	return &h, nil
}

// ResetBundleHost makes a managed host follow its placement or pool again; the next sync restores the values.
func (s *BundleService) ResetBundleHost(id int) error {
	db := database.GetDB()
	res := db.Model(&model.Host{}).Where("id = ? AND kind IN ?", id, []string{model.HostKindPlacement, model.HostKindPool, model.HostKindLocal}).Update("customized", false)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("only managed hosts can be reset")
	}
	go TriggerHostSync()
	return nil
}

// DeleteBundleHost removes a free-address host. Managed hosts follow their placement and cannot be deleted by hand. A bundle
// that would lose its last host for the inbound keeps the access through a hidden local host.
// deletableHostKinds are the host kinds an operator may remove entirely from the Hosts page.
// "local" (the panel's own fallback address for an inbound with no other delivery entry) is
// deliberately excluded: it is structural, not something an operator adds or would want gone.
var deletableHostKinds = map[string]bool{
	model.HostKindAddress:   true,
	model.HostKindLegacy:    true,
	model.HostKindPlacement: true,
	model.HostKindPool:      true,
	model.HostKindLocal:     true,
}

// DeleteBundleHost removes a host entirely (not just from one bundle): it disappears from every
// bundle that listed it, and clients keep their inbound access through whatever else the bundle
// still contains. For a placement/pool host (mirrors a node/balancer-pool binding), the deletion
// is remembered (see SuppressHostRecreation) so the next host sync does not recreate it — without
// that, this used to be pointless: the host would reappear within 30s, which is why the panel used
// to refuse to delete anything but a manually added "address" host at all.
func (s *BundleService) DeleteBundleHost(id int) error {
	db := database.GetDB()
	var h model.Host
	if err := db.First(&h, id).Error; err != nil {
		return errors.New("host not found")
	}
	if !deletableHostKinds[h.Kind] {
		return errors.New("this host cannot be deleted: disable it instead")
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := SuppressHostRecreation(tx, &h); err != nil {
			return err
		}
		return removeManagedHost(tx, &h)
	})
}

// ListSuppressedHosts returns every host deletion host_sync will not undo, with enough context to
// show and reverse in the UI. RestoreSuppressedHost removes the suppression by id so the next host
// sync recreates the host normally (a no-op if the underlying inbound/node/pool no longer exists).
type SuppressedHostView struct {
	Id            int    `json:"id"`
	Kind          string `json:"kind"`
	InboundId     int    `json:"inboundId,omitempty"`
	InboundRemark string `json:"inboundRemark,omitempty"`
	NodeName      string `json:"nodeName,omitempty"`
	PoolBalancer  string `json:"poolBalancer,omitempty"`
	CreatedAt     int64  `json:"createdAt"`
}

func (s *BundleService) ListSuppressedHosts() ([]SuppressedHostView, error) {
	db := database.GetDB()
	var rows []model.HostSyncSuppression
	if err := db.Order("created_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]SuppressedHostView, 0, len(rows))
	for _, r := range rows {
		v := SuppressedHostView{Id: r.Id, Kind: r.Kind, CreatedAt: r.CreatedAt}
		if r.InboundId != nil {
			v.InboundId = *r.InboundId
			var ib model.Inbound
			if db.Select("remark").First(&ib, *r.InboundId).Error == nil {
				v.InboundRemark = ib.Remark
			}
		}
		if r.NodeId != nil {
			var n model.Node
			if db.Select("name").First(&n, *r.NodeId).Error == nil {
				v.NodeName = n.Name
			}
		}
		if r.PoolId != nil {
			var name string
			db.Raw(`SELECT b.name FROM balancer_pools p JOIN balancers b ON b.id = p.balancer_id WHERE p.id = ?`, *r.PoolId).Scan(&name)
			v.PoolBalancer = name
		}
		out = append(out, v)
	}
	return out, nil
}

func (s *BundleService) RestoreSuppressedHost(id int) error {
	db := database.GetDB()
	if err := db.Delete(&model.HostSyncSuppression{}, id).Error; err != nil {
		return err
	}
	TriggerHostSync()
	return nil
}
