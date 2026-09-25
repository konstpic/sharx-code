package sub

import (
	"fmt"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	"github.com/konstpic/sharx-code/v2/web/service"
	"gorm.io/gorm"
)

const testHost = "panel.example.com"

type world struct {
	db      *gorm.DB
	clients map[string]*model.ClientEntity
	in      map[string]*model.Inbound
}

func (w *world) inbound(t *testing.T, key string, port int, proto model.Protocol) *model.Inbound {
	t.Helper()
	ib := &model.Inbound{
		UserId: 1, Enable: true, Port: port, Protocol: proto, Remark: "in-" + key, Tag: fmt.Sprintf("inbound-%d", port),
		Settings: `{"clients":[],"decryption":"none"}`, StreamSettings: `{"network":"tcp","security":"none","tcpSettings":{"header":{"type":"none"}}}`, Sniffing: "{}",
	}
	if err := w.db.Create(ib).Error; err != nil {
		t.Fatal(err)
	}
	w.in[key] = ib
	return ib
}

func (w *world) client(t *testing.T, name string, enable bool, inbounds ...string) {
	t.Helper()
	c := &model.ClientEntity{UserId: 1, Name: name, UUID: "11111111-2222-3333-4444-" + fmt.Sprintf("%012d", len(w.clients)+1), Password: "pw-" + name, Enable: enable, Status: "active", SubID: "sub-" + name}
	if err := w.db.Create(c).Error; err != nil {
		t.Fatal(err)
	}
	w.clients[name] = c
	for i, key := range inbounds {
		m := &model.ClientInboundMapping{ClientId: c.Id, InboundId: w.in[key].Id, SortOrder: i} // deliberately not multiples of 10
		if err := w.db.Create(m).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func (w *world) place(t *testing.T, inboundKey string, node *model.Node, include bool, pubAddr string, pubPort int, suffix string) {
	t.Helper()
	m := &model.InboundNodeMapping{InboundId: w.in[inboundKey].Id, NodeId: node.Id, IncludeInSubscription: include, PublishedAddress: pubAddr, PublishedPort: pubPort, SubscriptionRemarkSuffix: suffix}
	if err := w.db.Create(m).Error; err != nil {
		t.Fatal(err)
	}
}

// legacyHost creates a pre-bundle Host mapped to the given inbounds.
func (w *world) legacyHost(t *testing.T, name, addr string, port int, mode string, inbounds ...string) *model.Host {
	t.Helper()
	h := &model.Host{UserId: 1, Name: name, Address: addr, Port: port, Enable: true, SubscriptionApplyMode: mode, SubscriptionSNI: "sni." + addr, SubscriptionSecurity: "tls", Kind: model.HostKindLegacy}
	if err := w.db.Create(h).Error; err != nil {
		t.Fatal(err)
	}
	for _, k := range inbounds {
		if err := w.db.Create(&model.HostInboundMapping{HostId: h.Id, InboundId: w.in[k].Id}).Error; err != nil {
			t.Fatal(err)
		}
	}
	return h
}

func seedWorld(t *testing.T) *world {
	t.Helper()
	db := testdb.New(t)
	if err := (&service.SettingService{}).SetMultiNodeMode(true); err != nil {
		t.Fatal(err)
	}
	w := &world{db: db, clients: map[string]*model.ClientEntity{}, in: map[string]*model.Inbound{}}
	de := &model.Node{Name: "DE-1", Address: "http://10.0.0.1:8080", Enable: true, Status: "online"}
	fi := &model.Node{Name: "FI-1", Address: "http://fin.example.com:8080", Enable: true, Status: "online"}
	db.Create(de)
	db.Create(fi)

	w.inbound(t, "A", 443, model.VLESS)
	w.inbound(t, "B", 8443, model.VLESS)
	w.inbound(t, "C", 9443, model.VLESS) // no node: panel address
	w.inbound(t, "D", 7443, model.VLESS)
	w.place(t, "A", de, true, "", 0, "")
	w.place(t, "A", fi, true, "eu.example.com", 8443, "-eu")
	w.place(t, "B", fi, true, "", 0, "")
	w.place(t, "D", de, false, "", 0, "") // excluded from the subscription
	w.place(t, "D", fi, true, "", 0, "-d")

	w.legacyHost(t, "cdn", "cdn.example.com", 443, model.HostSubscriptionApplyPrepend, "A")
	w.legacyHost(t, "front", "front.example.com", 0, model.HostSubscriptionApplyReplace, "B")

	bal := &model.Balancer{Name: "LB", Address: "lb.example.com", ApiAddress: "http://lb:8080", Engine: "haproxy", Enable: true, Status: "unknown"}
	db.Create(bal)
	db.Create(&model.BalancerPool{BalancerId: bal.Id, InboundId: w.in["B"].Id, ListenPort: 34444, Algorithm: "roundrobin", SubEnabled: true, SubMode: "prepend", AutoMembers: true, Enable: true})
	db.Create(&model.BalancerPool{BalancerId: bal.Id, InboundId: w.in["D"].Id, ListenPort: 7443, Algorithm: "roundrobin", SubEnabled: true, SubMode: "append", AutoMembers: true, Enable: true})

	w.client(t, "c1", true, "A", "B")
	w.client(t, "c2", true, "B", "A") // same inbounds, other order
	w.client(t, "c3", true, "C", "D")
	w.client(t, "c4", true)           // no inbounds
	w.client(t, "c5", false, "A")     // disabled
	w.client(t, "c6", true, "A", "B") // same list as c1: shares its bundle
	return w
}

func captureSubs(w *world, active bool) map[string]string {
	s := NewCompatSubService(false, "-ieo")
	out := map[string]string{}
	for name, c := range w.clients {
		lines, last, tr, err := s.GetSubs(c.SubID, testHost, nil)
		out[name] = fmt.Sprintf("%s|%d|%+v|%v", strings.Join(lines, "\n"), last, tr, err)
	}
	return out
}

func TestConversionKeepsEverySubscriptionIdentical(t *testing.T) {
	w := seedWorld(t)
	before := captureSubs(w, false)
	for name, v := range before {
		if name == "c1" && strings.Count(v, "vless://") < 4 {
			t.Fatalf("the scenario must produce several entries for c1, got:\n%s", v)
		}
	}

	rep, err := ConvertToBundles(ConvertOptions{Host: testHost})
	if err != nil {
		t.Fatalf("conversion: %v (report %+v)", err, rep)
	}
	if rep.Status != "converted" || len(rep.Mismatches) != 0 {
		t.Fatalf("report: %+v", rep)
	}
	if rep.Bundles != 4 {
		t.Fatalf("distinct ordered lists: [A,B] [B,A] [C,D] [A] = 4 bundles, got %d", rep.Bundles)
	}
	if on, _ := (&service.SettingService{}).GetBundlesEnabled(); !on {
		t.Fatal("the switch must be on after a verified conversion")
	}

	after := captureSubs(w, true)
	for name, want := range before {
		if after[name] != want {
			t.Errorf("client %s changed:\nBEFORE:\n%s\nAFTER:\n%s", name, want, after[name])
		}
	}

	// Access rows are untouched and clients share bundles by exact list.
	var n int64
	database.GetDB().Model(&model.ClientBundle{}).Count(&n)
	if n != 5 { // c1 c2 c3 c5 c6 (c4 has nothing)
		t.Fatalf("memberships: %d", n)
	}
	for _, tb := range []string{"client_inbound_mappings_pre_bundles", "hosts_pre_bundles"} {
		var c int64
		if err := database.GetDB().Raw("SELECT count(*) FROM information_schema.tables WHERE table_name = ?", tb).Scan(&c).Error; err != nil || c != 1 {
			t.Errorf("backup table %s missing", tb)
		}
	}
}

func TestConversionRefusesToSwitchOnADifference(t *testing.T) {
	w := seedWorld(t)
	before := captureSubs(w, false)
	rep, err := ConvertToBundles(ConvertOptions{Host: testHost, BeforeVerify: func() {
		// Corrupt one converted host: the verification must catch it and leave the panel on the old scheme.
		if err := w.db.Exec("UPDATE hosts SET address = 'wrong.example.com' WHERE kind = 'placement' AND server_description = '' AND address = 'eu.example.com'").Error; err != nil {
			t.Fatal(err)
		}
	}})
	if err == nil {
		t.Fatalf("a tampered conversion must fail: %+v", rep)
	}
	if rep == nil || rep.Status != "failed" || len(rep.Mismatches) == 0 {
		t.Fatalf("report: %+v", rep)
	}
	if on, _ := (&service.SettingService{}).GetBundlesEnabled(); on {
		t.Fatal("the switch must stay off")
	}
	// The old scheme is untouched and still serves the same subscriptions; shadow data is gone.
	after := captureSubs(w, false)
	for name, want := range before {
		if after[name] != want {
			t.Errorf("client %s changed after a failed conversion", name)
		}
	}
	var n int64
	database.GetDB().Model(&model.Bundle{}).Count(&n)
	if n != 0 {
		t.Fatalf("shadow bundles must be removed after a failure, %d left", n)
	}
}
