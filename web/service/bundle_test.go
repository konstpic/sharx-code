package service

import (
	"reflect"
	"testing"

	"gorm.io/gorm"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
)

func TestEffectiveInboundOrder(t *testing.T) {
	bw := func(enable bool, inbounds ...int) bundleWithHosts {
		b := bundleWithHosts{bundle: model.Bundle{Enable: enable}}
		for i, in := range inbounds {
			b.hosts = append(b.hosts, bundleHostRow{hostId: 100 + i, inboundId: in, hidden: i%2 == 1})
		}
		return b
	}
	got := effectiveInboundOrder([]bundleWithHosts{bw(true, 3, 1, 3), bw(false, 9), bw(true, 2, 1)})
	if want := []int{3, 1, 2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v (first appearance, hidden hosts count, disabled bundle ignored, no duplicates)", got, want)
	}
	if got := effectiveInboundOrder(nil); len(got) != 0 {
		t.Fatalf("no bundles, no access: %v", got)
	}
}

func TestBundleAccessLifecycle(t *testing.T) {
	db := testdb.New(t)
	svc := &BundleService{}
	a := seedInbound(t, db, 1001, model.VLESS)
	b := seedInbound(t, db, 1002, model.VLESS)
	c := seedInbound(t, db, 1003, model.Telemt)
	ha, hb, hc := seedHost(t, db, "a", "a.example.com", a.Id), seedHost(t, db, "b", "b.example.com", b.Id), seedHost(t, db, "c", "c.example.com", c.Id)
	cl := seedClient(t, db, "alice")

	basic, err := svc.Create(1, &model.Bundle{Name: "basic", Enable: true, FollowPlacements: true}, []BundleHostRef{{HostId: ha.Id}, {HostId: hb.Id}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AddClients(basic.Id, []int{cl.Id}); err != nil {
		t.Fatal(err)
	}
	rows := mappingRows(t, db, cl.Id)
	if got := mappingInbounds(rows); !reflect.DeepEqual(got, []int{a.Id, b.Id}) {
		t.Fatalf("after add: %v", got)
	}
	firstIDs := map[int]int{}
	for _, r := range rows {
		firstIDs[r.InboundId] = r.Id
	}

	// A second bundle adds an inbound; existing rows must keep their ids (Telemt secrets, etc).
	premium, err := svc.Create(1, &model.Bundle{Name: "premium", Enable: true}, []BundleHostRef{{HostId: hc.Id, Hidden: true}})
	if err != nil {
		t.Fatal(err)
	}
	diff, err := svc.SetClientBundles(cl.Id, []int{basic.Id, premium.Id})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(diff.Added, []int{c.Id}) || len(diff.Removed) != 0 {
		t.Fatalf("diff: %+v", diff)
	}
	rows = mappingRows(t, db, cl.Id)
	if got := mappingInbounds(rows); !reflect.DeepEqual(got, []int{a.Id, b.Id, c.Id}) {
		t.Fatalf("after second bundle: %v", got)
	}
	for _, r := range rows {
		if id, ok := firstIDs[r.InboundId]; ok && id != r.Id {
			t.Fatalf("row for inbound %d was recreated (id %d -> %d)", r.InboundId, id, r.Id)
		}
		if r.InboundId == c.Id && r.TelemtSecret == "" {
			t.Fatal("a new Telemt row must get a secret")
		}
	}

	// Editing a bundle's hosts changes members' access.
	diffs, err := svc.Update(&model.Bundle{Id: basic.Id, Name: "basic", Enable: true, FollowPlacements: true}, &[]BundleHostRef{{HostId: ha.Id}})
	if err != nil {
		t.Fatal(err)
	}
	if len(diffs) != 1 || !reflect.DeepEqual(diffs[0].Removed, []int{b.Id}) {
		t.Fatalf("update diffs: %+v", diffs)
	}
	if got := mappingInbounds(mappingRows(t, db, cl.Id)); !reflect.DeepEqual(got, []int{a.Id, c.Id}) {
		t.Fatalf("after update: %v", got)
	}

	// Disabling a bundle removes what only it gave.
	if _, err := svc.Update(&model.Bundle{Id: premium.Id, Name: "premium", Enable: false}, nil); err != nil {
		t.Fatal(err)
	}
	if got := mappingInbounds(mappingRows(t, db, cl.Id)); !reflect.DeepEqual(got, []int{a.Id}) {
		t.Fatalf("after disabling premium: %v", got)
	}

	// Deleting the last bundle leaves the client with nothing.
	if _, err := svc.Delete(basic.Id); err != nil {
		t.Fatal(err)
	}
	if got := mappingRows(t, db, cl.Id); len(got) != 0 {
		t.Fatalf("after delete: %v", got)
	}
}

func TestBundleRejectsLegacyAndDuplicateHosts(t *testing.T) {
	db := testdb.New(t)
	svc := &BundleService{}
	in := seedInbound(t, db, 2001, model.VLESS)
	h := seedHost(t, db, "h", "h.example.com", in.Id)
	legacy := &model.Host{UserId: 1, Name: "old", Address: "old.example.com", Enable: true, Kind: model.HostKindLegacy}
	if err := db.Create(legacy).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(1, &model.Bundle{Name: "x", Enable: true}, []BundleHostRef{{HostId: legacy.Id}}); err == nil {
		t.Error("a pre-bundle host must be rejected")
	}
	if _, err := svc.Create(1, &model.Bundle{Name: "x", Enable: true}, []BundleHostRef{{HostId: h.Id}, {HostId: h.Id}}); err == nil {
		t.Error("a host listed twice must be rejected")
	}
	if _, err := svc.Create(1, &model.Bundle{Name: " ", Enable: true}, nil); err == nil {
		t.Error("an empty name must be rejected")
	}
}

func TestSetClientAutoBundle(t *testing.T) {
	db := testdb.New(t)
	svc := &BundleService{}
	a := seedInbound(t, db, 5001, model.VLESS)
	b := seedInbound(t, db, 5002, model.VLESS)
	c := seedInbound(t, db, 5003, model.VLESS)
	ha := seedHost(t, db, "a", "a.example.com", a.Id)
	c1, c2, c3 := seedClient(t, db, "c1"), seedClient(t, db, "c2"), seedClient(t, db, "c3")

	run := func(client *model.ClientEntity, ids []int) AccessDiff {
		t.Helper()
		var d AccessDiff
		err := db.Transaction(func(tx *gorm.DB) error {
			var e error
			d, e = svc.SetClientAutoBundle(tx, client.Id, ids)
			return e
		})
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	autoCount := func() int64 {
		var n int64
		db.Model(&model.Bundle{}).Where("auto = TRUE").Count(&n)
		return n
	}

	// Two clients with the same ordered list share one auto bundle; another list gets another.
	run(c1, []int{a.Id, b.Id})
	run(c2, []int{a.Id, b.Id})
	run(c3, []int{b.Id, c.Id})
	if n := autoCount(); n != 2 {
		t.Fatalf("auto bundles: %d, want 2", n)
	}
	if got := mappingInbounds(mappingRows(t, db, c1.Id)); !reflect.DeepEqual(got, []int{a.Id, b.Id}) {
		t.Fatalf("c1: %v", got)
	}
	if got := mappingInbounds(mappingRows(t, db, c3.Id)); !reflect.DeepEqual(got, []int{b.Id, c.Id}) {
		t.Fatalf("c3: %v", got)
	}

	// A named bundle that already grants A: the API list still ends up as [A, B]; only B is personal.
	named, err := svc.Create(1, &model.Bundle{Name: "named", Enable: true, FollowPlacements: true}, []BundleHostRef{{HostId: ha.Id}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AddClients(named.Id, []int{c1.Id}); err != nil {
		t.Fatal(err)
	}
	d := run(c1, []int{a.Id, b.Id})
	if !reflect.DeepEqual(d.Order, []int{a.Id, b.Id}) {
		t.Fatalf("order: %v", d.Order)
	}
	// Dropping A from the list cannot take it from the named bundle.
	d = run(c1, []int{b.Id})
	if !reflect.DeepEqual(d.Order, []int{a.Id, b.Id}) {
		t.Fatalf("named bundle access must stay: %v", d.Order)
	}

	// An empty list removes the personal part; unused auto bundles are removed.
	run(c1, nil)
	run(c2, nil)
	run(c3, nil)
	if n := autoCount(); n != 0 {
		t.Fatalf("unused auto bundles must be garbage-collected, %d left", n)
	}
	if got := mappingInbounds(mappingRows(t, db, c2.Id)); len(got) != 0 {
		t.Fatalf("c2: %v", got)
	}
	if got := mappingInbounds(mappingRows(t, db, c1.Id)); !reflect.DeepEqual(got, []int{a.Id}) {
		t.Fatalf("c1 keeps what the named bundle grants: %v", got)
	}
}

func TestAutoBundleUsesExistingHostsOrManagedOnes(t *testing.T) {
	db := testdb.New(t)
	svc := &BundleService{}
	in := seedInbound(t, db, 6001, model.VLESS)
	only := seedInbound(t, db, 6002, model.VLESS)
	cdn := seedHost(t, db, "cdn", "cdn.example.com", in.Id)
	if _, err := svc.Create(1, &model.Bundle{Name: "named", Enable: true}, []BundleHostRef{{HostId: cdn.Id}}); err != nil {
		t.Fatal(err)
	}
	cl := seedClient(t, db, "x")
	err := db.Transaction(func(tx *gorm.DB) error {
		_, e := svc.SetClientAutoBundle(tx, cl.Id, []int{in.Id, only.Id})
		return e
	})
	if err != nil {
		t.Fatal(err)
	}
	var auto model.Bundle
	if err := db.Where("auto = TRUE").First(&auto).Error; err != nil {
		t.Fatal(err)
	}
	ids := hostIDsInBundle(t, db, auto.Id)
	if len(ids) != 2 || ids[0] != cdn.Id {
		t.Fatalf("hosts: %v (the first inbound reuses the named bundle's host)", ids)
	}
	var local model.Host
	db.First(&local, ids[1])
	if local.Kind != model.HostKindLocal || !local.Enable || *local.InboundId != only.Id {
		t.Fatalf("an inbound with no hosts anywhere gets the panel's local host: %+v", local)
	}
}

func TestBundleHostLifecycle(t *testing.T) {
	db := testdb.New(t)
	if err := (&SettingService{}).SetMultiNodeMode(true); err != nil {
		t.Fatal(err)
	}
	svc := &BundleService{}
	in := seedInbound(t, db, 7001, model.VLESS)
	n := seedNode(t, db, "DE-1", "http://10.1.1.1:8080")
	db.Create(&model.InboundNodeMapping{InboundId: in.Id, NodeId: n.Id, IncludeInSubscription: true})
	if _, _, _, err := (&HostSyncService{}).SyncAll(); err != nil {
		t.Fatal(err)
	}
	var place model.Host
	db.Where("kind = ?", model.HostKindPlacement).First(&place)
	b, _ := svc.Create(1, &model.Bundle{Name: "b", Enable: true, FollowPlacements: true}, []BundleHostRef{{HostId: place.Id}})
	cl := seedClient(t, db, "cl")
	if _, err := svc.AddClients(b.Id, []int{cl.Id}); err != nil {
		t.Fatal(err)
	}

	// A new address host is appended to bundles that follow.
	h, err := svc.CreateAddressHost(1, in.Id, HostInput{Name: "cdn", Address: "cdn.example.com", Port: 443, Enable: true, SubscriptionSNI: "cdn.example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if got := hostIDsInBundle(t, db, b.Id); !reflect.DeepEqual(got, []int{place.Id, h.Id}) {
		t.Fatalf("bundle: %v", got)
	}
	if _, err := svc.CreateAddressHost(1, in.Id, HostInput{Name: "x"}); err == nil {
		t.Fatal("an address is required")
	}

	// Editing a managed host makes it customized: the sync leaves it alone. Reset gives it back.
	if _, err := svc.UpdateBundleHost(place.Id, HostInput{Name: "DE-1", Address: "custom.example.com", Enable: true}); err != nil {
		t.Fatal(err)
	}
	(&HostSyncService{}).SyncAll()
	db.First(&place, place.Id)
	if place.Address != "custom.example.com" || !place.Customized {
		t.Fatalf("customized host must keep the operator's address: %+v", place)
	}
	if err := svc.ResetBundleHost(place.Id); err != nil {
		t.Fatal(err)
	}
	(&HostSyncService{}).SyncAll()
	db.First(&place, place.Id)
	if place.Address != "10.1.1.1" || place.Customized {
		t.Fatalf("reset must restore the placement's address: %+v", place)
	}

	// Managed hosts cannot be deleted by hand; an address host can, without losing access.
	if err := svc.DeleteBundleHost(place.Id); err == nil {
		t.Fatal("managed hosts must not be deletable")
	}
	if err := svc.DeleteBundleHost(h.Id); err != nil {
		t.Fatal(err)
	}
	if got := hostIDsInBundle(t, db, b.Id); !reflect.DeepEqual(got, []int{place.Id}) {
		t.Fatalf("after delete: %v", got)
	}
	views, err := svc.ListBundleHosts()
	if err != nil || len(views) != 1 || views[0].NodeName != "DE-1" || len(views[0].BundleIds) != 1 || views[0].InboundRemark == "" {
		t.Fatalf("views: %+v %v", views, err)
	}
	if got, _ := svc.EffectiveInbounds(cl.Id); !reflect.DeepEqual(got, []int{in.Id}) {
		t.Fatalf("access must stay: %v", got)
	}
}
