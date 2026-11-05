package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	"github.com/konstpic/sharx-code/v2/network/protocol"
)

func TestValidatePublish(t *testing.T) {
	valid := PublishParams{
		Label: "DE-1", Security: "reality", TrafficLimitGB: 500,
		SpeedLimitMbps: 50, ReserveMbps: 50, MaxSessions: 10, PriceCreditsPerGB: 1, RiskAck: true,
	}
	if err := (NetworkService{}).validatePublish(valid); err != nil {
		t.Fatalf("valid params rejected: %v", err)
	}
	cases := []func(*PublishParams){
		func(p *PublishParams) { p.RiskAck = false },
		func(p *PublishParams) { p.Security = "tls" },
		func(p *PublishParams) { p.TrafficLimitGB = 0 },
		func(p *PublishParams) { p.SpeedLimitMbps = 0 },
		func(p *PublishParams) { p.MaxSessions = 0 },
		func(p *PublishParams) { p.Label = "" },
	}
	for i, mutate := range cases {
		p := valid
		mutate(&p)
		if err := (NetworkService{}).validatePublish(p); err == nil {
			t.Fatalf("case %d must be rejected", i)
		}
	}
}

func TestNetworkStreamSettingsIncludeRealityPublicKey(t *testing.T) {
	settings := networkStreamSettings(map[string]any{"privateKey": "private", "publicKey": "public"}, "abcd0123")
	reality, ok := settings["realitySettings"].(map[string]any)
	if !ok {
		t.Fatal("reality settings missing")
	}
	if reality["publicKey"] != "public" || reality["privateKey"] != "private" {
		t.Fatalf("key pair not preserved: %#v", reality)
	}
}

func TestConsumerResourcesRequireExplicitBundleAssignment(t *testing.T) {
	db := testdb.New(t)
	service := NetworkService{}
	newSession := func(id, clientUUID string) model.SnSession {
		link := protocol.SessionLink{
			Protocol: "vless-reality", EndpointHost: "de.example.com", EndpointPort: 443,
			ClientUUID: clientUUID, ClientEmail: "sn-x",
			AccessTemplate: protocol.AccessTemplate{
				Security: "reality", Transport: "tcp", SNI: "www.microsoft.com",
				PublicKey: "PUBKEY", ShortIDs: []string{"abcd0123"}, Fingerprint: "chrome",
			},
		}
		linkJSON, _ := json.Marshal(link)
		sess := model.SnSession{Id: id, Role: "consumer", CoordinatorNodeId: "node-uuid-1", Link: string(linkJSON), Status: "active"}
		if err := db.Create(&sess).Error; err != nil {
			t.Fatal(err)
		}
		if err := service.ensureConsumerResources(&sess); err != nil {
			t.Fatal(err)
		}
		return sess
	}
	first := newSession("11111111-1111-1111-1111-111111111111", "11111111-2222-3333-4444-555555555555")
	second := newSession("22222222-2222-2222-2222-222222222222", "22222222-3333-4444-5555-666666666666")
	if first.InboundId == nil || second.InboundId == nil {
		t.Fatal("every rented node must have its own immutable inbound")
	}
	var inbound model.Inbound
	if err := db.First(&inbound, *first.InboundId).Error; err != nil {
		t.Fatal(err)
	}
	if inbound.SnNetworkRole != "consumer" || !strings.Contains(inbound.Settings, "11111111-2222-3333-4444-555555555555") {
		t.Fatalf("remote session credential not preserved: %+v", inbound)
	}
	var host model.Host
	if err := db.First(&host, "inbound_id = ? AND source = ?", inbound.Id, model.HostSourceNetwork).Error; err != nil {
		t.Fatal(err)
	}
	if host.Address != "de.example.com" || host.Port != 443 || host.InboundId == nil || *host.InboundId != inbound.Id {
		t.Fatalf("fixed host does not match remote endpoint: %+v", host)
	}
	var mappings int64
	db.Model(&model.InboundNodeMapping{}).Where("inbound_id = ?", inbound.Id).Count(&mappings)
	if mappings != 0 {
		t.Fatal("consumer inbound must never be assigned to local worker nodes")
	}
	client := model.ClientEntity{UserId: 1, Name: "explicit-client", UUID: "33333333-3333-3333-3333-333333333333", Enable: true, SubID: "explicit"}
	if err := db.Create(&client).Error; err != nil {
		t.Fatal(err)
	}
	bundle, err := service.CreateBundle(1, "Rented DE", []string{first.Id, second.Id})
	if err != nil {
		t.Fatal(err)
	}
	if bundle.ClientCount != 0 {
		t.Fatal("creating a bundle must not assign clients")
	}
	db.Model(&model.ClientInboundMapping{}).Where("client_id = ?", client.Id).Count(&mappings)
	if mappings != 0 {
		t.Fatal("rented node appeared in client access before explicit assignment")
	}
	if err := service.AssignBundle(1, bundle.Id, []int{client.Id}); err != nil {
		t.Fatal(err)
	}
	var assigned []int
	if err := db.Model(&model.ClientInboundMapping{}).Where("client_id = ?", client.Id).Order("inbound_id").Pluck("inbound_id", &assigned).Error; err != nil {
		t.Fatal(err)
	}
	if len(assigned) != 2 {
		t.Fatalf("explicit bundle assignment must grant both rented inbounds: %v", assigned)
	}
	service.setConsumerResourcesEnabled(first.Id, false)
	if err := db.First(&inbound, *first.InboundId).Error; err != nil {
		t.Fatal(err)
	}
	if inbound.Enable {
		t.Fatal("closed session inbound must be disabled")
	}
	if err := (&HostService{}).UpdateHost(1, &model.Host{Id: host.Id, Name: "changed"}); err == nil {
		t.Fatal("network-managed host must be immutable")
	}
	if err := (&HostService{}).DeleteHost(1, host.Id); err == nil {
		t.Fatal("network-managed host must not be deleted directly")
	}
	if _, err := (&InboundService{}).DelInbound(inbound.Id); err == nil {
		t.Fatal("network-managed inbound must not be deleted directly")
	}
}

func TestPickPortAvoidsNodePorts(t *testing.T) {
	db := testdb.New(t)
	node := model.Node{Name: "n1", Address: "http://10.0.0.1:8080", Status: "online"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	ib := model.Inbound{UserId: 1, Remark: "x", Enable: true, Port: 30000, Protocol: "vless", Tag: "t1"}
	if err := db.Create(&ib).Error; err != nil {
		t.Fatal(err)
	}
	mapping := model.InboundNodeMapping{InboundId: ib.Id, NodeId: node.Id}
	if err := db.Create(&mapping).Error; err != nil {
		t.Fatal(err)
	}
	port, err := (NetworkService{}).pickPort(node.Id)
	if err != nil {
		t.Fatal(err)
	}
	if port == 30000 {
		t.Fatal("picked a used port")
	}
	if port < 20000 || port > 60000 {
		t.Fatalf("port out of range: %d", port)
	}
}

func TestProviderUsageCountersUsePersistentNodeTotals(t *testing.T) {
	db := testdb.New(t)
	entity := model.ClientEntity{Name: "sn-provider-session", UUID: "11111111-2222-3333-4444-555555555555"}
	if err := db.Create(&entity).Error; err != nil {
		t.Fatal(err)
	}
	nodeID := 7
	sess := model.SnSession{ClientEmail: entity.Name, NodeId: &nodeID}
	up, down, ok := (NetworkService{}).providerUsageCounters(&sess)
	if ok || up != 0 || down != 0 {
		t.Fatal("missing persistent counters must not produce a usage report")
	}
	if err := db.Create(&model.ClientNodeTraffic{ClientId: entity.Id, NodeId: 7, Up: 100, Down: 200}).Error; err != nil {
		t.Fatal(err)
	}
	up, down, ok = (NetworkService{}).providerUsageCounters(&sess)
	if !ok || up != 100 || down != 200 {
		t.Fatalf("unexpected counters: up=%d down=%d ok=%v", up, down, ok)
	}
	if err := db.Model(&model.ClientNodeTraffic{}).Where("client_id = ? AND node_id = ?", entity.Id, 7).
		Updates(map[string]any{"up": 150, "down": 350}).Error; err != nil {
		t.Fatal(err)
	}
	up, down, ok = (NetworkService{}).providerUsageCounters(&sess)
	if !ok || up != 150 || down != 350 {
		t.Fatalf("updated cumulative counters not used: up=%d down=%d ok=%v", up, down, ok)
	}
}

func TestProviderWorkerConfigPreservesVisionFlow(t *testing.T) {
	inbound := &model.Inbound{
		Protocol: model.VLESS, SnNetwork: true, SnNetworkRole: "provider",
		Settings:       `{"clients":[],"decryption":"none"}`,
		StreamSettings: `{"network":"tcp","security":"reality"}`,
	}
	clients := []*model.ClientEntity{{
		Name: "sn-provider", UUID: "11111111-2222-3333-4444-555555555555", Enable: true, Status: "active",
	}}
	raw, err := (&InboundService{}).BuildSettingsFromClientEntities(inbound, clients)
	if err != nil {
		t.Fatal(err)
	}
	var settings struct {
		Clients []map[string]any `json:"clients"`
	}
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		t.Fatal(err)
	}
	if len(settings.Clients) != 1 || settings.Clients[0]["flow"] != "xtls-rprx-vision" {
		t.Fatalf("provider flow must survive a full worker config rebuild: %s", raw)
	}
}

func TestEnrollValidation(t *testing.T) {
	if err := (NetworkService{}).Enroll("ftp://x", "code", "name"); err == nil {
		t.Fatal("non-http URL must be rejected")
	}
	if err := (NetworkService{}).Enroll("https://x", "", "name"); err == nil {
		t.Fatal("empty invite must be rejected")
	}
}
