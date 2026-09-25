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
func (s *BundleService) DeleteBundleHost(id int) error {
	db := database.GetDB()
	var h model.Host
	if err := db.First(&h, id).Error; err != nil {
		return errors.New("host not found")
	}
	if h.Kind != model.HostKindAddress {
		return errors.New("managed hosts follow their placement: disable the host instead")
	}
	return db.Transaction(func(tx *gorm.DB) error { return removeManagedHost(tx, &h) })
}
