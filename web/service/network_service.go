package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/network/client"
	"github.com/konstpic/sharx-code/v2/network/identity"
	"github.com/konstpic/sharx-code/v2/network/protocol"
)

// CurrentRiskAckVersion identifies the exit-node risk text the owner acknowledged.
const CurrentRiskAckVersion = "sn-risk-v1"

// NetworkService orchestrates the panel's participation in SharX Network:
// enrollment, publishing nodes, provisioning consumers on its own nodes,
// consuming remote nodes, usage reporting and settlement sync.
type NetworkService struct{}

func (NetworkService) db() *gorm.DB { return database.GetDB() }

// --- participant state ---

func (s NetworkService) Participant() (*model.SnParticipant, error) {
	db := s.db()
	var p model.SnParticipant
	err := db.First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &p, err
}

func (s NetworkService) ensureParticipantRow() (*model.SnParticipant, error) {
	p, err := s.Participant()
	if err != nil {
		return nil, err
	}
	if p != nil {
		return p, nil
	}
	p = &model.SnParticipant{Id: 1, Status: "disabled"}
	return p, s.db().Create(p).Error
}

func (s NetworkService) IsEnabled() bool {
	p, err := s.Participant()
	return err == nil && p != nil && p.Enabled && p.Status == "active"
}

// Status aggregates the panel's network state for the UI.
func (s NetworkService) Status() (map[string]any, error) {
	p, err := s.Participant()
	if err != nil {
		return nil, err
	}
	out := map[string]any{
		"enabled": false, "status": "disabled", "coordinatorUrl": "", "participantId": "",
		"name": "", "balance": 0.0, "reserved": 0.0, "earnedPeriod": 0.0, "spentPeriod": 0.0,
		"emergencyShutdown": false, "lastSyncAt": 0, "error": "", "riskAckVersion": CurrentRiskAckVersion,
	}
	if p == nil {
		return out, nil
	}
	out["coordinatorUrl"] = p.CoordinatorURL
	out["participantId"] = p.ParticipantID
	out["name"] = p.Name
	out["status"] = p.Status
	out["enabled"] = p.Enabled
	out["lastSyncAt"] = p.LastSyncAt
	out["riskAckVersion"] = CurrentRiskAckVersion
	var b, r, earned, spent float64
	s.db().Raw(`SELECT
		COALESCE(SUM(CASE direction WHEN 'credit' THEN CASE WHEN status='settled' THEN amount_credits ELSE 0 END WHEN 'bonus' THEN amount_credits WHEN 'adjustment' THEN amount_credits WHEN 'release' THEN amount_credits WHEN 'debit' THEN CASE WHEN reason='usage' THEN 0 ELSE -amount_credits END WHEN 'reserve' THEN -amount_credits ELSE 0 END),0),
		COALESCE(SUM(CASE direction WHEN 'reserve' THEN amount_credits WHEN 'release' THEN -amount_credits WHEN 'debit' THEN CASE WHEN reason='usage' THEN -amount_credits ELSE 0 END ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN direction='credit' AND reason='usage' THEN amount_credits ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN direction='debit' THEN amount_credits ELSE 0 END),0)
		FROM sn_ledger_mirror`).Row().Scan(&b, &r, &earned, &spent)
	out["balance"] = round2(b)
	out["reserved"] = round2(r)
	out["earnedPeriod"] = round2(earned)
	out["spentPeriod"] = round2(spent)
	if p.Enabled {
		if cl, err := s.clientFor(p); err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			if me, err := cl.Me(ctx); err == nil {
				out["balance"] = me.BalanceCredits
				out["reserved"] = me.ReservedCredits
				out["earnedPeriod"] = me.EarnedPeriodCredits
				out["spentPeriod"] = me.SpentPeriodCredits
				out["heldCredits"] = me.HeldCredits
			}
			cancel()
		}
	}
	return out, nil
}

func round2(v float64) float64 { return float64(int64(v*100+0.5)) / 100 }

// --- coordinator client ---

func (s NetworkService) clientFor(p *model.SnParticipant) (*client.Client, error) {
	if p == nil || p.ParticipantID == "" || p.TLSCertPEM == "" {
		return nil, errors.New("network: not enrolled")
	}
	signing, err := identity.DecodeSigningKeys(p.SigningPublicKey, p.SigningPrivateKey)
	if err != nil {
		return nil, err
	}
	return client.New(client.Credentials{
		URL: p.CoordinatorURL, CertPEM: p.TLSCertPEM, KeyPEM: p.TLSKeyPEM,
		CaPEM: p.CaPEM, Signing: signing,
	})
}

// --- enrollment lifecycle ---

func (s NetworkService) Enroll(coordinatorURL, inviteCode, name string) error {
	coordinatorURL = strings.TrimRight(strings.TrimSpace(coordinatorURL), "/")
	if !strings.HasPrefix(coordinatorURL, "https://") && !strings.HasPrefix(coordinatorURL, "http://") {
		return errors.New("coordinator URL must start with http(s)://")
	}
	if len(strings.TrimSpace(inviteCode)) == 0 {
		return errors.New("invite code required")
	}
	if len(strings.TrimSpace(name)) == 0 || len(name) > 80 {
		return errors.New("name required (1-80 chars)")
	}
	signing, err := identity.GenerateSigningKeys()
	if err != nil {
		return err
	}
	tlsKeys, err := identity.GenerateTLSKeys()
	if err != nil {
		return err
	}
	csrPEM, err := tlsKeys.CSRPEM()
	if err != nil {
		return err
	}
	resp, err := client.Enroll(context.Background(), coordinatorURL, protocol.EnrollRequest{
		InviteCode: strings.TrimSpace(inviteCode), Name: strings.TrimSpace(name),
		CSRPem: string(csrPEM), SigningPublicKey: signing.EncodePublic(),
	})
	if err != nil {
		var ce *client.CoordinatorError
		if errors.As(err, &ce) {
			return fmt.Errorf("enrollment rejected: %s", ce.Message)
		}
		return fmt.Errorf("enrollment failed: %w", err)
	}
	keyPEM, err := tlsKeys.EncodePrivatePEM()
	if err != nil {
		return err
	}
	p, err := s.ensureParticipantRow()
	if err != nil {
		return err
	}
	p.ParticipantID = resp.ParticipantID
	p.CoordinatorURL = coordinatorURL
	p.Name = strings.TrimSpace(name)
	p.Status = "active"
	p.Enabled = true
	p.TLSCertPEM = resp.CertificatePEM
	p.TLSKeyPEM = keyPEM
	p.CaPEM = resp.CAPEM
	p.SigningPublicKey = signing.EncodePublic()
	p.SigningPrivateKey = signing.EncodePrivate()
	p.RiskAckVersion = ""
	p.RiskAckAt = 0
	p.EnrolledAt = time.Now().Unix()
	return s.db().Save(p).Error
}

// SetEnabled toggles participation; disabling drains sessions and publications.
func (s NetworkService) SetEnabled(enabled bool) error {
	p, err := s.ensureParticipantRow()
	if err != nil {
		return err
	}
	if enabled {
		if p.Status != "active" {
			return errors.New("enroll first")
		}
		p.Enabled = true
		return s.db().Save(p).Error
	}
	p.Enabled = false
	if err := s.db().Save(p).Error; err != nil {
		return err
	}
	return s.drainAll("network disabled")
}

// Leave drains everything and wipes local network credentials.
func (s NetworkService) Leave() error {
	if err := s.drainAll("panel left network"); err != nil {
		logger.Warningf("network leave: drain: %v", err)
	}
	return s.db().Exec(`UPDATE sn_participant SET
		participant_id = '', status = 'disabled', enabled = false,
		tls_cert_pem = '', tls_key_pem = '', signing_public_key = '', signing_private_key = '',
		sync_cursor = 0, sync_cursor_consumer = 0, updated_at = ? WHERE id = 1`, time.Now().Unix()).Error
}

func (s NetworkService) drainAll(reason string) error {
	defer s.quarantineLocalNetwork()
	p, err := s.Participant()
	if err != nil {
		return err
	}
	cl, err := s.clientFor(p)
	if err != nil {
		return nil // offline drain: local state stays; coordinator will time out sessions
	}
	var sessions []model.SnSession
	if err := s.db().Where("role = 'provider' AND status IN ('provisioning','active','degraded')").Find(&sessions).Error; err == nil {
		for i := range sessions {
			_ = cl.CloseSession(context.Background(), sessions[i].Id, reason)
		}
	}
	if err := s.db().Where("role = 'consumer' AND status IN ('active','degraded')").Find(&sessions).Error; err == nil {
		for i := range sessions {
			_ = cl.CloseSession(context.Background(), sessions[i].Id, reason)
		}
	}
	var nodes []model.SnSharedNode
	if err := s.db().Where("status = 'published'").Find(&nodes).Error; err == nil {
		for i := range nodes {
			if nodes[i].CoordinatorNodeId != "" {
				_ = cl.DeleteNode(context.Background(), nodes[i].CoordinatorNodeId)
			}
		}
	}
	return nil
}

func (s NetworkService) activeClient() (*client.Client, *model.SnParticipant, error) {
	p, err := s.Participant()
	if err != nil || p == nil || p.ParticipantID == "" || !p.Enabled {
		return nil, p, errors.New("network not active")
	}
	cl, err := s.clientFor(p)
	return cl, p, err
}

// RenewCertificateIfNeeded renews the mTLS certificate when close to expiry.
func (s NetworkService) RenewCertificateIfNeeded() error {
	p, err := s.Participant()
	if err != nil || p == nil || p.ParticipantID == "" {
		return nil
	}
	// Expiry is tracked by the coordinator; renew proactively once a week.
	if p.EnrolledAt != 0 && time.Now().Unix()-p.EnrolledAt < 24*3600*7 {
		return nil
	}
	cl, err := s.clientFor(p)
	if err != nil {
		return nil
	}
	tlsKeys, err := identity.DecodeTLSKeys(p.TLSKeyPEM)
	if err != nil {
		return nil
	}
	csrPEM, err := tlsKeys.CSRPEM()
	if err != nil {
		return err
	}
	certPEM, _, err := cl.RenewCert(context.Background(), string(csrPEM))
	if err != nil {
		return nil // soft-fail; retried next tick
	}
	return s.db().Model(&model.SnParticipant{}).Where("id = 1").Updates(map[string]any{
		"tls_cert_pem": certPEM, "enrolled_at": time.Now().Unix(),
	}).Error
}

// --- publishing nodes (provider role) ---

type PublishParams struct {
	NodeID            int
	Label             string
	Country           string
	Security          string // reality (v1); tls rejected with guidance
	TrafficLimitGB    float64
	SpeedLimitMbps    int
	ReserveMbps       int
	MaxSessions       int
	PriceCreditsPerGB float64
	RiskAck           bool
}

func (s NetworkService) validatePublish(p PublishParams) error {
	if !p.RiskAck {
		return errors.New("risk acknowledgment required")
	}
	if p.Security != "reality" {
		return errors.New("only VLESS+Reality is supported in this version")
	}
	if p.TrafficLimitGB < 1 || p.TrafficLimitGB > 1000000 {
		return errors.New("traffic limit out of range")
	}
	if p.SpeedLimitMbps < 1 || p.SpeedLimitMbps > 10000 {
		return errors.New("speed limit out of range")
	}
	if p.ReserveMbps < 0 || p.ReserveMbps > 10000 {
		return errors.New("reserve out of range")
	}
	if p.MaxSessions < 1 || p.MaxSessions > 100 {
		return errors.New("max sessions out of range (1..100)")
	}
	if len(strings.TrimSpace(p.Label)) == 0 || len(p.Label) > 80 {
		return errors.New("label required (1-80 chars)")
	}
	return nil
}

// PublishNode publishes a worker node to the network (idempotent per node).
func (s NetworkService) PublishNode(params PublishParams) error {
	if err := s.validatePublish(params); err != nil {
		return err
	}
	nodeService := NodeService{}
	node, err := nodeService.GetNode(params.NodeID)
	if err != nil {
		return errors.New("node not found")
	}
	if node.Status != "online" {
		return fmt.Errorf("node is not online (status %s)", node.Status)
	}
	var existing model.SnSharedNode
	if err := s.db().Where("node_id = ? AND status <> 'retired'", params.NodeID).First(&existing).Error; err == nil {
		// Update limits on the existing publication.
		return s.UpdateNode(existing.Id, params)
	}

	inbound, err := s.ensureNetworkInbound(node, params)
	if err != nil {
		return err
	}

	if err := s.enforceNetworkQoS(node, inbound.Port, params); err != nil {
		return fmt.Errorf("cannot publish without enforced QoS: %w", err)
	}
	cl, _, err := s.activeClient()
	if err != nil {
		return err
	}
	endpointHost := nodeEndpointHost(node)
	var stream map[string]any
	_ = json.Unmarshal([]byte(inbound.StreamSettings), &stream)
	reality, _ := stream["realitySettings"].(map[string]any)
	tpl := protocol.AccessTemplate{
		Security: "reality", Transport: "tcp",
		SNI:         firstString(reality["serverNames"]),
		PublicKey:   stringOf(reality["publicKey"]),
		ShortIDs:    toStringSlice(reality["shortIds"]),
		Fingerprint: "chrome",
	}
	country := strings.ToUpper(strings.TrimSpace(params.Country))
	if country == "" {
		country = "UN"
	}
	var evidenceKey struct {
		PublicKey string `json:"public_key"`
	}
	if err := nodeService.networkEvidenceRequest(context.Background(), node, nil, &evidenceKey); err != nil {
		return err
	}
	shared := protocol.SharedNode{EvidencePublicKey: evidenceKey.PublicKey,
		NodeRef: fmt.Sprintf("%d", node.Id), Label: params.Label,
		Country: country, Protocols: []string{"vless-reality"},
		EndpointHost: endpointHost, EndpointPort: inbound.Port, AccessTemplate: tpl,
		CapacityMbps:   bandwidthOrDefault(node.BandwidthMbps, 1000),
		SpeedLimitMbps: params.SpeedLimitMbps, ReserveMbps: params.ReserveMbps,
		MaxSessions: params.MaxSessions, TrafficLimitGB: params.TrafficLimitGB,
		PriceCreditsPerGB: params.PriceCreditsPerGB,
	}
	created, err := cl.CreateNode(context.Background(), uuid.NewString(), shared)
	if err != nil {
		var ce *client.CoordinatorError
		if errors.As(err, &ce) && ce.Code == "invalid_argument" {
			return errors.New(ce.Message)
		}
		return fmt.Errorf("coordinator rejected node: %w", err)
	}
	rec := model.SnSharedNode{
		NodeId: params.NodeID, CoordinatorNodeId: created.ID, Label: params.Label,
		Protocols: `["vless-reality"]`, TrafficLimitGB: params.TrafficLimitGB,
		SpeedLimitMbps: params.SpeedLimitMbps, ReserveMbps: params.ReserveMbps,
		MaxSessions: params.MaxSessions, PriceCreditsPerGB: created.PriceCreditsPerGB,
		Enabled: true, RiskAck: true, Status: "published",
	}
	snapshot, _ := json.Marshal(created)
	rec.CoordinatorSnapshot = string(snapshot)
	if err := s.db().Create(&rec).Error; err != nil {
		return err
	}
	logger.Infof("SharX Network: published node %d as %s (%s:%d)", node.Id, created.ID, endpointHost, inbound.Port)
	return nil
}

func bandwidthOrDefault(v, def int) int {
	if v <= 0 {
		return def
	}
	return v
}

func nodeEndpointHost(node *model.Node) string {
	addr := strings.TrimPrefix(node.Address, "http://")
	addr = strings.TrimPrefix(addr, "https://")
	if i := strings.IndexByte(addr, ':'); i >= 0 {
		addr = addr[:i]
	}
	return addr
}

func firstString(v any) string {
	if arr, ok := v.([]any); ok && len(arr) > 0 {
		if s, ok := arr[0].(string); ok {
			return s
		}
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func stringOf(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func toStringSlice(v any) []string {
	out := []string{}
	if arr, ok := v.([]any); ok {
		for _, item := range arr {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

func networkStreamSettings(keyPair map[string]any, shortID string) map[string]any {
	return map[string]any{
		"network": "tcp", "security": "reality",
		"realitySettings": map[string]any{
			"show": false, "dest": "www.microsoft.com:443", "xver": 0,
			"serverNames": []string{"www.microsoft.com"},
			"privateKey":  keyPair["privateKey"],
			"publicKey":   keyPair["publicKey"],
			"shortIds":    []string{shortID},
		},
	}
}

// ensureNetworkInbound creates (or reuses) the dedicated network inbound on the node.
func (s NetworkService) ensureNetworkInbound(node *model.Node, params PublishParams) (*model.Inbound, error) {
	tag := fmt.Sprintf("sharxnet-%d", node.Id)
	var inbound model.Inbound
	if err := s.db().Where("tag = ?", tag).First(&inbound).Error; err == nil {
		return &inbound, nil
	}
	port, err := s.pickPort(node.Id)
	if err != nil {
		return nil, err
	}
	keyPair, err := s.realityKeyPair()
	if err != nil {
		return nil, fmt.Errorf("reality key generation: %w", err)
	}
	shortID := randomHex(4)
	settings, _ := json.Marshal(map[string]any{
		"clients": []any{}, "decryption": "none", "fallbacks": []any{},
	})
	streamSettings, _ := json.Marshal(networkStreamSettings(keyPair, shortID))
	sniffing, _ := json.Marshal(map[string]any{
		"enabled": true, "destOverride": []string{"http", "tls", "quic"},
	})
	inbound = model.Inbound{
		UserId: 1, Remark: "[SN] " + params.Label, Enable: true, Listen: "", Port: port,
		Protocol: "vless", Tag: tag, Settings: string(settings),
		StreamSettings: string(streamSettings), Sniffing: string(sniffing), SnNetwork: true, SnNetworkRole: "provider",
	}
	inboundService := InboundService{}
	created, _, err := inboundService.AddInbound(&inbound)
	if err != nil {
		return nil, fmt.Errorf("create network inbound: %w", err)
	}
	nodeService := NodeService{}
	err = nodeService.AssignInboundToNodesWithBindings(created.Id, []InboundNodeBindingInput{{
		NodeId:                node.Id,
		PublishedAddress:      nodeEndpointHost(node),
		PublishedPort:         port,
		IncludeInSubscription: netBoolPtr(false),
		ServerDescription:     "[SharX Network] " + params.Label,
	}})
	if err != nil {
		return nil, fmt.Errorf("assign network inbound to node: %w", err)
	}
	return created, nil
}

func netBoolPtr(v bool) *bool { return &v }

func (s NetworkService) realityKeyPair() (map[string]any, error) {
	serverService := ServerService{}
	raw, err := serverService.GetNewX25519Cert()
	if err != nil {
		return nil, err
	}
	pair, ok := raw.(map[string]any)
	if !ok {
		return nil, errors.New("unexpected x25519 output")
	}
	return pair, nil
}

// pickPort chooses a free port on the node (20000-60000).
func (s NetworkService) pickPort(nodeId int) (int, error) {
	nodeService := NodeService{}
	existing, err := nodeService.GetInboundsForNode(nodeId)
	if err != nil {
		return 0, err
	}
	used := map[int]bool{}
	for _, ib := range existing {
		used[ib.Port] = true
	}
	var panelPorts []int
	s.db().Model(&model.Inbound{}).Where("listen = '' OR listen = '0.0.0.0'").Pluck("port", &panelPorts)
	for _, p := range panelPorts {
		used[p] = true
	}
	for i := 0; i < 200; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(40001))
		if err != nil {
			return 0, err
		}
		port := int(n.Int64()) + 20000
		if !used[port] {
			return port, nil
		}
	}
	return 0, errors.New("no free port on node")
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return strings.ToLower(hex.EncodeToString(b))
}

func (s NetworkService) UpdateNode(id int, params PublishParams) error {
	if err := s.validatePublish(params); err != nil {
		return err
	}
	var rec model.SnSharedNode
	if err := s.db().First(&rec, id).Error; err != nil {
		return errors.New("publication not found")
	}
	cl, _, err := s.activeClient()
	if err != nil {
		return err
	}
	var snapshot protocol.SharedNode
	if err := json.Unmarshal([]byte(rec.CoordinatorSnapshot), &snapshot); err != nil {
		return errors.New("invalid coordinator snapshot")
	}
	wasPaused := rec.Paused
	snapshot.Label = params.Label
	snapshot.TrafficLimitGB = params.TrafficLimitGB
	snapshot.SpeedLimitMbps = params.SpeedLimitMbps
	snapshot.ReserveMbps = params.ReserveMbps
	snapshot.MaxSessions = params.MaxSessions
	// Atomically validate the contract change and pause admission before touching
	// worker state. An active contract rejects changed limits at the coordinator.
	snapshot.Status = protocol.NodeStatusPaused
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	updated, err := cl.UpdateNode(ctx, rec.CoordinatorNodeId, snapshot)
	if err != nil {
		return err
	}
	encoded, _ := json.Marshal(updated)
	if err := s.db().Model(&rec).Updates(map[string]any{"paused": true, "coordinator_snapshot": string(encoded)}).Error; err != nil {
		return err
	}
	ns := NodeService{}
	node, err := ns.GetNode(rec.NodeId)
	if err != nil {
		return err
	}
	var ib model.Inbound
	if err := s.db().Where("tag=?", fmt.Sprintf("sharxnet-%d", rec.NodeId)).First(&ib).Error; err != nil {
		return err
	}
	if err := s.enforceNetworkQoS(node, ib.Port, params); err != nil {
		return fmt.Errorf("publication remains paused: %w", err)
	}
	rec.Label = params.Label
	rec.TrafficLimitGB = params.TrafficLimitGB
	rec.SpeedLimitMbps = params.SpeedLimitMbps
	rec.ReserveMbps = params.ReserveMbps
	rec.MaxSessions = params.MaxSessions
	rec.Paused = true
	rec.CoordinatorSnapshot = string(encoded)
	rec.PriceCreditsPerGB = updated.PriceCreditsPerGB
	if err := s.db().Save(&rec).Error; err != nil {
		return err
	}
	if !wasPaused {
		updated.Status = protocol.NodeStatusActive
		resumed, err := cl.UpdateNode(ctx, rec.CoordinatorNodeId, *updated)
		if err != nil {
			return fmt.Errorf("limits applied; publication remains paused: %w", err)
		}
		encoded, _ = json.Marshal(resumed)
		return s.db().Model(&rec).Updates(map[string]any{"paused": false, "coordinator_snapshot": string(encoded)}).Error
	}
	return nil
}

func (s NetworkService) SetNodePaused(id int, paused bool) error {
	var rec model.SnSharedNode
	if err := s.db().First(&rec, id).Error; err != nil {
		return errors.New("publication not found")
	}
	rec.Paused = paused
	if err := s.db().Save(&rec).Error; err != nil {
		return err
	}
	cl, _, err := s.activeClient()
	if err != nil {
		return nil
	}
	var snapshot protocol.SharedNode
	if err := json.Unmarshal([]byte(rec.CoordinatorSnapshot), &snapshot); err == nil {
		if paused {
			snapshot.Status = protocol.NodeStatusPaused
		} else {
			snapshot.Status = protocol.NodeStatusActive
		}
		if updated, err := cl.UpdateNode(context.Background(), rec.CoordinatorNodeId, snapshot); err == nil {
			b, _ := json.Marshal(updated)
			s.db().Model(&rec).Updates(map[string]any{"coordinator_snapshot": string(b), "price_credits_per_gb": updated.PriceCreditsPerGB})
		}
	}
	return nil
}

// UnpublishNode drains and retires the publication (keeps the inbound disabled for history).
func (s NetworkService) UnpublishNode(id int) error {
	var rec model.SnSharedNode
	if err := s.db().First(&rec, id).Error; err != nil {
		return errors.New("publication not found")
	}
	cl, _, err := s.activeClient()
	if err == nil && rec.CoordinatorNodeId != "" {
		_ = cl.DeleteNode(context.Background(), rec.CoordinatorNodeId)
	}
	rec.Status = "retired"
	rec.Enabled = false
	if err := s.db().Save(&rec).Error; err != nil {
		return err
	}
	// Disable the dedicated inbound so no third-party traffic is accepted.
	s.db().Model(&model.Inbound{}).Where("tag = ?", fmt.Sprintf("sharxnet-%d", rec.NodeId)).Update("enable", false)
	return nil
}

func (s NetworkService) PublishedNodes() ([]map[string]any, error) {
	var recs []model.SnSharedNode
	if err := s.db().Order("id DESC").Find(&recs).Error; err != nil {
		return nil, err
	}
	nodeService := NodeService{}
	out := make([]map[string]any, 0, len(recs))
	for i := range recs {
		nodeName := ""
		nodeOnline := false
		if node, err := nodeService.GetNode(recs[i].NodeId); err == nil && node != nil {
			nodeName = node.Name
			nodeOnline = node.Status == "online"
		}
		var snapshot protocol.SharedNode
		_ = json.Unmarshal([]byte(recs[i].CoordinatorSnapshot), &snapshot)
		var protocols []string
		_ = json.Unmarshal([]byte(recs[i].Protocols), &protocols)
		out = append(out, map[string]any{
			"id": recs[i].Id, "nodeId": recs[i].NodeId, "nodeName": nodeName, "nodeOnline": nodeOnline,
			"coordinatorNodeId": recs[i].CoordinatorNodeId, "label": recs[i].Label, "protocols": protocols,
			"trafficLimitGB": recs[i].TrafficLimitGB, "speedLimitMbps": recs[i].SpeedLimitMbps,
			"reserveMbps": recs[i].ReserveMbps, "maxSessions": recs[i].MaxSessions,
			"priceCreditsPerGB": recs[i].PriceCreditsPerGB, "enabled": recs[i].Enabled,
			"paused": recs[i].Paused, "status": recs[i].Status, "error": recs[i].Error,
			"activeSessions": snapshot.ActiveSessions, "trafficUsedGB": snapshot.TrafficUsedGB,
		})
	}
	return out, nil
}

// --- consumer role ---

func (s NetworkService) Catalog(country, proto string, needMbps int) ([]protocol.Candidate, error) {
	cl, _, err := s.activeClient()
	if err != nil {
		return nil, err
	}
	return cl.Catalog(context.Background(), country, proto, needMbps)
}

func (s NetworkService) OpenSession(nodeID string, quotaGB float64, quote ...int64) (*model.SnSession, error) {
	if quotaGB < 0.1 || quotaGB > 10000 {
		return nil, errors.New("quota out of range (0.1..10000)")
	}
	cl, _, err := s.activeClient()
	if err != nil {
		return nil, err
	}
	clientRef := uuid.New()
	if len(quote) != 2 || quote[0] <= 0 || quote[1] <= 0 {
		return nil, errors.New("explicit operator tariff and reserve budget required")
	}
	sess, err := cl.OpenSessionAtQuote(context.Background(), uuid.NewString(), nodeID, clientRef.String(),
		"vless-reality", quotaGB, 0, quote[0], quote[1])
	if err != nil {
		var ce *client.CoordinatorError
		if errors.As(err, &ce) {
			return nil, errors.New(ce.Message)
		}
		return nil, err
	}
	linkJSON, _ := json.Marshal(sess.Link)
	rec := model.SnSession{
		Id: sess.ID, Role: "consumer", CoordinatorNodeId: sess.NodeID,
		PeerParticipantId: sess.ProviderID,
		ClientRef:         sess.ClientRef, Protocol: sess.Protocol, QuotaGB: quotaGB,
		Status: sess.Status, Link: string(linkJSON), SyncSeq: sess.ChangeSeq, OpenedAt: time.Now().Unix(),
	}
	if sess.Link != nil {
		rec.ClientEmail = sess.Link.ClientEmail
	}
	if err := s.db().Where("id = ?", rec.Id).Assign(rec).FirstOrCreate(&rec).Error; err != nil {
		_ = cl.CloseSession(context.Background(), sess.ID, "local resource creation failed")
		return nil, err
	}
	if err := s.ensureConsumerResources(&rec); err != nil {
		_ = cl.CloseSession(context.Background(), sess.ID, "local resource creation failed")
		return nil, err
	}
	return &rec, nil
}

func (s NetworkService) CloseSession(id, reason string) error {
	var rec model.SnSession
	if err := s.db().First(&rec, "id = ?", id).Error; err != nil {
		return errors.New("session not found")
	}
	if rec.Status == "closed" {
		return nil
	}
	cl, _, err := s.activeClient()
	if err != nil {
		return err
	}
	if err := cl.CloseSession(context.Background(), id, reason); err != nil {
		return err
	}
	if rec.Role == "consumer" {
		s.setConsumerResourcesEnabled(id, false)
	}
	return nil
}

func (s NetworkService) DisputeSession(id, reason string, claimedBytes int64) error {
	cl, _, err := s.activeClient()
	if err != nil {
		return err
	}
	return cl.DisputeSession(context.Background(), id, reason, claimedBytes)
}

func (s NetworkService) Sessions(role string) ([]map[string]any, error) {
	q := s.db().Model(&model.SnSession{}).Order("updated_at DESC").Limit(500)
	if role == "provider" || role == "consumer" {
		q = q.Where("role = ?", role)
	}
	var rows []model.SnSession
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for i := range rows {
		item := map[string]any{
			"id": rows[i].Id, "role": rows[i].Role, "coordinatorNodeId": rows[i].CoordinatorNodeId,
			"peerParticipantId": rows[i].PeerParticipantId, "clientEntityId": rows[i].ClientEntityId,
			"clientEmail": rows[i].ClientEmail, "protocol": rows[i].Protocol, "quotaGB": rows[i].QuotaGB,
			"status": rows[i].Status, "usageUpBytes": rows[i].UsageUpBytes, "usageDownBytes": rows[i].UsageDownBytes,
			"openedAt": rows[i].OpenedAt, "closedAt": rows[i].ClosedAt,
		}
		if rows[i].Role == "consumer" {
			inboundID, hostID, bundleIDs := s.consumerResourceDetails(&rows[i])
			item["inboundId"], item["hostId"], item["bundleIds"] = inboundID, hostID, bundleIDs
		}
		out = append(out, item)
	}
	return out, nil
}

// Ledger returns mirrored ledger entries with a cursor.
func (s NetworkService) Ledger(cursor int64, limit int) ([]map[string]any, int64, error) {
	if limit < 1 || limit > 1000 {
		limit = 200
	}
	var rows []model.SnLedgerMirror
	err := s.db().Where("ts > ?", cursor).Order("ts ASC").Limit(limit).Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	out := make([]map[string]any, 0, len(rows))
	var next int64
	for i := range rows {
		out = append(out, map[string]any{
			"entryUid": rows[i].EntryUID, "direction": rows[i].Direction, "amountCredits": rows[i].AmountCredits,
			"amountBytes": rows[i].AmountBytes, "counterpartyParticipantId": rows[i].CounterpartyParticipantID,
			"sessionId": rows[i].SessionID, "status": rows[i].Status, "reason": rows[i].Reason,
			"memo": rows[i].Memo, "ts": rows[i].Ts,
		})
		if rows[i].Ts > next {
			next = rows[i].Ts
		}
	}
	return out, next, nil
}

// Overview aggregates dashboard numbers.
func (s NetworkService) Overview() (map[string]any, error) {
	st, err := s.Status()
	if err != nil {
		return nil, err
	}
	var servedUp, servedDown, receivedUp, receivedDown int64
	s.db().Model(&model.SnSession{}).Where("role = 'provider'").Select("COALESCE(SUM(usage_up_bytes),0), COALESCE(SUM(usage_down_bytes),0)").Row().Scan(&servedUp, &servedDown)
	s.db().Model(&model.SnSession{}).Where("role = 'consumer'").Select("COALESCE(SUM(usage_up_bytes),0), COALESCE(SUM(usage_down_bytes),0)").Row().Scan(&receivedUp, &receivedDown)
	var publishedNodes, provSess, consSess int64
	s.db().Model(&model.SnSharedNode{}).Where("status = 'published'").Count(&publishedNodes)
	s.db().Model(&model.SnSession{}).Where("role = 'provider' AND status IN ('provisioning','active','degraded')").Count(&provSess)
	s.db().Model(&model.SnSession{}).Where("role = 'consumer' AND status IN ('active','degraded')").Count(&consSess)
	return map[string]any{
		"balance": st["balance"], "reserved": st["reserved"],
		"earnedPeriod": st["earnedPeriod"], "spentPeriod": st["spentPeriod"], "heldCredits": st["heldCredits"],
		"servedUpGB": servedUp / 1e9, "servedDownGB": servedDown / 1e9,
		"receivedUpGB": receivedUp / 1e9, "receivedDownGB": receivedDown / 1e9,
		"publishedNodes": publishedNodes, "activeProviderSessions": provSess, "activeConsumerSessions": consSess,
	}, nil
}

// Quarantine only network sessions and queue retryable socket/user revocations.
func (s NetworkService) quarantineLocalNetwork() {
	var sessions []model.SnSession
	if s.db().Where("status <> 'closed'").Find(&sessions).Error != nil {
		return
	}
	for _, session := range sessions {
		if session.Role == "consumer" {
			s.setConsumerResourcesEnabled(session.Id, false)
			continue
		}
		if session.NodeId == nil {
			continue
		}
		var link protocol.SessionLink
		if json.Unmarshal([]byte(session.Link), &link) != nil {
			continue
		}
		payload, _ := json.Marshal(map[string]string{"inbound_tag": fmt.Sprintf("sharxnet-%d", *session.NodeId), "email": link.ClientEmail, "probe_email": probeEmail(link.ProbeUUID)})
		s.enqueueOnce(session.Id, *session.NodeId, "remove_user", string(payload))
	}
}
