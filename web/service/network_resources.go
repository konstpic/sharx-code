package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/network/protocol"
)

func consumerInboundSettings(link *protocol.SessionLink) (string, string, error) {
	if link == nil || link.Protocol != "vless-reality" || link.AccessTemplate.Security != "reality" {
		return "", "", errors.New("only VLESS+Reality network sessions can be published to clients")
	}
	if _, err := uuid.Parse(link.ClientUUID); err != nil {
		return "", "", errors.New("network session has an invalid client UUID")
	}
	if strings.TrimSpace(link.EndpointHost) == "" || link.EndpointPort < 1 || link.EndpointPort > 65535 {
		return "", "", errors.New("network session has an invalid endpoint")
	}
	at := link.AccessTemplate
	if strings.TrimSpace(at.PublicKey) == "" || strings.TrimSpace(at.SNI) == "" || len(at.ShortIDs) == 0 {
		return "", "", errors.New("network session has incomplete Reality parameters")
	}
	settings, err := json.Marshal(map[string]any{
		"clients": []map[string]any{{
			"id": link.ClientUUID, "email": link.ClientEmail,
			"flow": "xtls-rprx-vision", "level": 0,
		}},
		"decryption": "none", "fallbacks": []any{},
	})
	if err != nil {
		return "", "", err
	}
	transport := at.Transport
	if transport == "" {
		transport = "tcp"
	}
	fingerprint := at.Fingerprint
	if fingerprint == "" {
		fingerprint = "chrome"
	}
	stream, err := json.Marshal(map[string]any{
		"network": transport, "security": "reality",
		"realitySettings": map[string]any{
			"serverNames": []string{at.SNI}, "shortIds": at.ShortIDs,
			"settings": map[string]any{"publicKey": at.PublicKey, "fingerprint": fingerprint},
		},
	})
	return string(settings), string(stream), err
}

// ensureConsumerResources creates the panel-facing representation of a rented node.
// These records are never assigned to a local worker and never start a listener.
func (s NetworkService) ensureConsumerResources(sess *model.SnSession) error {
	if sess == nil || sess.Role != "consumer" {
		return errors.New("consumer session required")
	}
	var link protocol.SessionLink
	if err := json.Unmarshal([]byte(sess.Link), &link); err != nil {
		return fmt.Errorf("decode network session link: %w", err)
	}
	settings, stream, err := consumerInboundSettings(&link)
	if err != nil {
		return err
	}
	return s.db().Transaction(func(tx *gorm.DB) error {
		var current model.SnSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "id = ?", sess.Id).Error; err != nil {
			return err
		}
		var inbound model.Inbound
		if current.InboundId != nil {
			if err := tx.First(&inbound, "id = ?", *current.InboundId).Error; err != nil {
				return err
			}
		} else {
			tag := "sn-consumer-" + sess.Id
			err := tx.First(&inbound, "tag = ?", tag).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				inbound = model.Inbound{
					UserId: 1, Remark: "[SN rent] " + sess.Id[:8], Enable: true,
					Listen: "", Port: link.EndpointPort, Protocol: model.VLESS, Tag: tag,
					Settings: settings, StreamSettings: stream, Sniffing: `{"enabled":false}`,
					SnNetwork: true, SnNetworkRole: "consumer",
				}
				if err := tx.Create(&inbound).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			}
			if inbound.SnNetworkRole != "consumer" {
				return errors.New("network consumer inbound tag collision")
			}
			if err := tx.Model(&model.SnSession{}).Where("id = ?", sess.Id).Update("inbound_id", inbound.Id).Error; err != nil {
				return err
			}
			current.InboundId = &inbound.Id
		}
		var host model.Host
		err := tx.First(&host, "inbound_id = ? AND source = ?", inbound.Id, model.HostSourceNetwork).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			inboundID := inbound.Id
			host = model.Host{
				UserId: 1, Name: "SN " + sess.Id[:8], Address: link.EndpointHost, Port: link.EndpointPort,
				Remark: "SharX Network", Enable: true, SubscriptionApplyMode: "replace",
				Kind: model.HostKindAddress, InboundId: &inboundID,
				Source: model.HostSourceNetwork, Customized: true,
			}
			if err := tx.Create(&host).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		sess.InboundId = &inbound.Id
		return nil
	})
}

func (s NetworkService) setConsumerResourcesEnabled(sessionID string, enabled bool) {
	var sess model.SnSession
	if err := s.db().First(&sess, "id = ? AND role = 'consumer'", sessionID).Error; err != nil || sess.InboundId == nil {
		return
	}
	_ = s.db().Model(&model.Inbound{}).Where("id = ? AND sn_network_role = 'consumer'", *sess.InboundId).Update("enable", enabled).Error
	_ = s.db().Model(&model.Host{}).Where("inbound_id = ? AND source = ?", *sess.InboundId, model.HostSourceNetwork).Update("enable", enabled).Error
}

// CreateBundle explicitly groups rented resources; it does not assign any client.
func (s NetworkService) CreateBundle(userID int, name string, sessionIDs []string) (*model.Bundle, error) {
	if len(sessionIDs) == 0 || len(sessionIDs) > 50 {
		return nil, errors.New("select between 1 and 50 rented nodes")
	}
	refs := make([]BundleHostRef, 0, len(sessionIDs))
	seen := map[string]bool{}
	for _, id := range sessionIDs {
		if seen[id] {
			return nil, errors.New("a rented node cannot be added twice")
		}
		seen[id] = true
		var sess model.SnSession
		if err := s.db().First(&sess, "id = ? AND role = 'consumer'", id).Error; err != nil {
			return nil, fmt.Errorf("rented session %s not found", id)
		}
		if sess.Status != protocol.SessionActive && sess.Status != protocol.SessionDegraded {
			return nil, fmt.Errorf("session %s is not active", id)
		}
		if sess.InboundId == nil {
			return nil, fmt.Errorf("session %s has no immutable inbound", id)
		}
		var host model.Host
		if err := s.db().First(&host, "inbound_id = ? AND source = ? AND enable = TRUE", *sess.InboundId, model.HostSourceNetwork).Error; err != nil {
			return nil, fmt.Errorf("session %s has no active fixed host", id)
		}
		refs = append(refs, BundleHostRef{HostId: host.Id})
	}
	bundle := &model.Bundle{Name: strings.TrimSpace(name), Description: "SharX Network rented nodes", Enable: true}
	return (&BundleService{}).Create(userID, bundle, refs)
}

// AssignBundle is the only operation that grants a client access to rented nodes.
func (s NetworkService) AssignBundle(userID, bundleID int, clientIDs []int) error {
	if bundleID <= 0 || len(clientIDs) == 0 || len(clientIDs) > 500 {
		return errors.New("bundle and between 1 and 500 clients required")
	}
	var bundle model.Bundle
	if err := s.db().First(&bundle, "id = ? AND user_id = ?", bundleID, userID).Error; err != nil {
		return errors.New("bundle not found")
	}
	var networkHosts int64
	if err := s.db().Model(&model.BundleHost{}).
		Joins("JOIN hosts ON hosts.id = bundle_hosts.host_id").
		Where("bundle_hosts.bundle_id = ? AND hosts.source = ?", bundleID, model.HostSourceNetwork).
		Count(&networkHosts).Error; err != nil || networkHosts == 0 {
		return errors.New("bundle does not contain SharX Network hosts")
	}
	seen := map[int]bool{}
	unique := make([]int, 0, len(clientIDs))
	for _, id := range clientIDs {
		if id <= 0 || seen[id] {
			return errors.New("client IDs must be positive and unique")
		}
		seen[id] = true
		unique = append(unique, id)
	}
	diffs, err := (&BundleService{}).AddClients(bundleID, unique)
	if err != nil {
		return err
	}
	clients := &ClientService{}
	for _, diff := range diffs {
		changed := append(append([]int{}, diff.Added...), diff.Removed...)
		clients.PushClientAccessChange(diff.ClientId, changed)
	}
	return nil
}

func (s NetworkService) consumerResourceDetails(sess *model.SnSession) (int, int, []int) {
	if sess.InboundId == nil {
		return 0, 0, []int{}
	}
	var host model.Host
	if err := s.db().First(&host, "inbound_id = ? AND source = ?", *sess.InboundId, model.HostSourceNetwork).Error; err != nil {
		return *sess.InboundId, 0, []int{}
	}
	var bundleIDs []int
	_ = s.db().Model(&model.BundleHost{}).Where("host_id = ?", host.Id).Order("bundle_id ASC").Pluck("bundle_id", &bundleIDs).Error
	return *sess.InboundId, host.Id, bundleIDs
}
