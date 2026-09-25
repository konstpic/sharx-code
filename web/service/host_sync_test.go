package service

import (
	"reflect"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	"gorm.io/gorm"
)

func hostIDsInBundle(t *testing.T, db *gorm.DB, bundleId int) []int {
	t.Helper()
	var ids []int
	if err := db.Model(&model.BundleHost{}).Where("bundle_id = ?", bundleId).Order("sort_order ASC, id ASC").Pluck("host_id", &ids).Error; err != nil {
		t.Fatal(err)
	}
	return ids
}

func TestHostNodeAddress(t *testing.T) {
	for in, want := range map[string]string{
		"http://82.23.249.122:8080": "82.23.249.122", "https://node.example.com": "node.example.com",
		"node.example.com:9000": "node.example.com", "http://fin.sharxconnect.app:8080/": "fin.sharxconnect.app", "": "",
	} {
		if got := hostNodeAddress(in); got != want {
			t.Errorf("%q: got %q want %q", in, got, want)
		}
	}
}

func TestPlacementHostsFollowAndKeepAccess(t *testing.T) {
	db := testdb.New(t)
	if err := (&SettingService{}).SetMultiNodeMode(true); err != nil {
		t.Fatal(err)
	}
	sync := &HostSyncService{}
	bundles := &BundleService{}
	in := seedInbound(t, db, 3001, model.VLESS)
	n1 := seedNode(t, db, "DE-1", "http://10.0.0.1:8080")
	n2 := seedNode(t, db, "FI-1", "http://fin.example.com:8080")

	if err := db.Create(&model.InboundNodeMapping{InboundId: in.Id, NodeId: n1.Id, SortOrder: 0, IncludeInSubscription: true, SubscriptionRemarkSuffix: "-de"}).Error; err != nil {
		t.Fatal(err)
	}
	if c, u, r, err := sync.SyncAll(); err != nil || c != 1 || u != 0 || r != 0 {
		t.Fatalf("first sync: %d %d %d %v", c, u, r, err)
	}
	var p1 model.Host
	if err := db.Where("kind = ? AND node_id = ?", model.HostKindPlacement, n1.Id).First(&p1).Error; err != nil {
		t.Fatal(err)
	}
	if p1.Name != "DE-1" || p1.Address != "10.0.0.1" || p1.Port != 0 || !p1.Enable || p1.RemarkSuffix != "-de" || *p1.InboundId != in.Id {
		t.Fatalf("placement host: %+v", p1)
	}
	if c, u, r, _ := sync.SyncAll(); c+u+r != 0 {
		t.Fatalf("sync must be idempotent: %d %d %d", c, u, r)
	}

	// A bundle that follows placements and already covers the inbound picks up a new node.
	custom := seedHost(t, db, "cdn", "cdn.example.com", in.Id)
	b, err := bundles.Create(1, &model.Bundle{Name: "b", Enable: true, FollowPlacements: true}, []BundleHostRef{{HostId: p1.Id}, {HostId: custom.Id}})
	if err != nil {
		t.Fatal(err)
	}
	noFollow, err := bundles.Create(1, &model.Bundle{Name: "nf", Enable: true, FollowPlacements: false}, []BundleHostRef{{HostId: p1.Id}})
	if err != nil {
		t.Fatal(err)
	}
	db.Create(&model.InboundNodeMapping{InboundId: in.Id, NodeId: n2.Id, SortOrder: 1, IncludeInSubscription: true, PublishedAddress: "eu.example.com", PublishedPort: 8443})
	if c, _, _, err := sync.SyncAll(); err != nil || c != 1 {
		t.Fatalf("second node: %d %v", c, err)
	}
	var p2 model.Host
	db.Where("kind = ? AND node_id = ?", model.HostKindPlacement, n2.Id).First(&p2)
	if p2.Address != "eu.example.com" || p2.Port != 8443 {
		t.Fatalf("published address/port must win: %+v", p2)
	}
	if got, want := hostIDsInBundle(t, db, b.Id), []int{p1.Id, p2.Id, custom.Id}; !reflect.DeepEqual(got, want) {
		t.Fatalf("follow bundle: got %v want %v (new host goes right after the inbound's placements, before the CDN host? no: after the group)", got, want)
	}
	if got := hostIDsInBundle(t, db, noFollow.Id); !reflect.DeepEqual(got, []int{p1.Id}) {
		t.Fatalf("a bundle that does not follow must stay as is: %v", got)
	}

	// Changing the mapping updates the host, unless an operator customized it.
	db.Model(&model.InboundNodeMapping{}).Where("node_id = ?", n2.Id).Update("published_address", "eu2.example.com")
	db.Model(&model.Host{}).Where("id = ?", p1.Id).Update("customized", true)
	db.Model(&model.InboundNodeMapping{}).Where("node_id = ?", n1.Id).Update("published_address", "should-not-apply.example.com")
	if _, u, _, _ := sync.SyncAll(); u != 1 {
		t.Fatalf("only the non-customized host is updated, got %d", u)
	}
	db.First(&p1, p1.Id)
	db.First(&p2, p2.Id)
	if p1.Address != "10.0.0.1" || p2.Address != "eu2.example.com" {
		t.Fatalf("p1=%s p2=%s", p1.Address, p2.Address)
	}

	// Excluding a node from the subscription disables its host but keeps it (and the access it grants).
	db.Model(&model.InboundNodeMapping{}).Where("node_id = ?", n2.Id).Update("include_in_subscription", false)
	sync.SyncAll()
	db.First(&p2, p2.Id)
	if p2.Enable {
		t.Fatal("excluded node must disable the placement host")
	}

	// Unassigning the inbound from every node must not take the clients' access with it.
	cl := seedClient(t, db, "bob")
	if _, err := bundles.AddClients(noFollow.Id, []int{cl.Id}); err != nil {
		t.Fatal(err)
	}
	db.Where("inbound_id = ?", in.Id).Delete(&model.InboundNodeMapping{})
	if _, _, r, err := sync.SyncAll(); err != nil || r != 2 {
		t.Fatalf("both placement hosts must go: removed=%d err=%v", r, err)
	}
	ids := hostIDsInBundle(t, db, noFollow.Id)
	if len(ids) != 1 {
		t.Fatalf("bundle must get a replacement host: %v", ids)
	}
	var local model.Host
	db.First(&local, ids[0])
	if local.Kind != model.HostKindLocal || *local.InboundId != in.Id {
		t.Fatalf("replacement must be the inbound's local host: %+v", local)
	}
	var link model.BundleHost
	db.Where("bundle_id = ?", noFollow.Id).First(&link)
	if !link.Hidden {
		t.Fatal("the replacement is hidden: it keeps access without changing delivery")
	}
	if got, _ := bundles.EffectiveInbounds(cl.Id); !reflect.DeepEqual(got, []int{in.Id}) {
		t.Fatalf("access must survive: %v", got)
	}
}

func TestPoolHostSync(t *testing.T) {
	db := testdb.New(t)
	sync := &HostSyncService{}
	bundles := &BundleService{}
	in := seedInbound(t, db, 4001, model.VLESS)
	seed := seedHost(t, db, "cdn", "cdn.example.com", in.Id)
	b, _ := bundles.Create(1, &model.Bundle{Name: "b", Enable: true, FollowPlacements: true}, []BundleHostRef{{HostId: seed.Id}})

	bal := &model.Balancer{Name: "LB", Address: "lb.example.com", ApiAddress: "http://lb:8080", Engine: "haproxy", Enable: true, Status: "unknown"}
	if err := db.Create(bal).Error; err != nil {
		t.Fatal(err)
	}
	pool := &model.BalancerPool{BalancerId: bal.Id, InboundId: in.Id, ListenPort: in.Port, Algorithm: "roundrobin", SubEnabled: true, SubMode: "prepend", AutoMembers: true, Enable: true}
	if err := db.Create(pool).Error; err != nil {
		t.Fatal(err)
	}
	if c, _, _, err := sync.SyncAll(); err != nil || c != 1 {
		t.Fatalf("pool host: %d %v", c, err)
	}
	var h model.Host
	if err := db.Where("kind = ? AND pool_id = ?", model.HostKindPool, pool.Id).First(&h).Error; err != nil {
		t.Fatal(err)
	}
	if h.Name != "LB" || h.Address != "lb.example.com" || h.Port != 0 || !h.Enable {
		t.Fatalf("pool host: %+v (port equal to the inbound's is stored as 0)", h)
	}
	if got := hostIDsInBundle(t, db, b.Id); !reflect.DeepEqual(got, []int{seed.Id, h.Id}) {
		t.Fatalf("bundle: %v", got)
	}
	// Hiding the pool from subscriptions disables the host; deleting the pool removes it.
	db.Model(&model.BalancerPool{}).Where("id = ?", pool.Id).Updates(map[string]any{"sub_enabled": false, "listen_port": 34444})
	sync.SyncAll()
	db.First(&h, h.Id)
	if h.Enable || h.Port != 34444 {
		t.Fatalf("after change: %+v", h)
	}
	db.Delete(&model.BalancerPool{}, pool.Id)
	if _, _, r, _ := sync.SyncAll(); r != 1 {
		t.Fatalf("removed=%d", r)
	}
	if got := hostIDsInBundle(t, db, b.Id); !reflect.DeepEqual(got, []int{seed.Id}) {
		t.Fatalf("bundle after pool removal: %v", got)
	}
}
