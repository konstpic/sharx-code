package service

import (
	"reflect"
	"testing"

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
