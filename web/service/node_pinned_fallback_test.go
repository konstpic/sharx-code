package service

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
)

// A freshly installed node has no pin of its own; it must follow the panel-wide pinned cores
// instead of keeping the versions its image bundles.
func TestEffectiveNodePinsFallsBackToPanel(t *testing.T) {
	testdb.New(t)
	ss := SettingService{}
	if err := ss.SetXrayPinnedVersion("v26.9.9"); err != nil {
		t.Fatal(err)
	}
	if err := ss.SetTelemtPinnedVersion("3.5.7"); err != nil {
		t.Fatal(err)
	}

	x, tm := effectiveNodePins(&model.Node{CreatedAt: time.Now().Unix()}, ss, time.Now())
	if x != "26.9.9" || tm != "3.5.7" {
		t.Fatalf("fresh node pins = %q/%q, want panel pins", x, tm)
	}

	x, tm = effectiveNodePins(&model.Node{CreatedAt: time.Now().Unix(), XrayPinnedVersion: "25.1.1"}, ss, time.Now())
	if x != "25.1.1" || tm != "3.5.7" {
		t.Fatalf("own pin must win: %q/%q", x, tm)
	}
}

// Existing nodes must never be changed implicitly: no pin means no enforcement.
func TestEffectiveNodePinsIgnoresOldNodes(t *testing.T) {
	testdb.New(t)
	ss := SettingService{}
	_ = ss.SetXrayPinnedVersion("26.9.9")
	old := &model.Node{CreatedAt: time.Now().Add(-48 * time.Hour).Unix()}
	if x, tm := effectiveNodePins(old, ss, time.Now()); x != "" || tm != "" {
		t.Fatalf("old node got pins %q/%q", x, tm)
	}
}

func TestFleetPinAndAdoption(t *testing.T) {
	db := testdb.New(t)
	ns := NodeService{}
	mk := func(name, pin string) *model.Node {
		n := &model.Node{Name: name, Address: name, ApiKey: name, XrayPinnedVersion: pin, XrayVersion: "26.1.1"}
		if err := db.Create(n).Error; err != nil {
			t.Fatal(err)
		}
		return n
	}
	mk("a", "v26.10.1")
	mk("b", "26.10.1")
	mk("c", "25.5.5")
	fresh := mk("new", "")
	x, _ := effectiveNodePins(fresh, SettingService{}, time.Now())
	if x != "26.10.1" {
		t.Fatalf("fleet pin = %q, want 26.10.1", x)
	}

	// an old node without a pin adopts what it already runs and is not enforced
	old := mk("old", "")
	db.Model(old).Update("created_at", time.Now().Add(-48*time.Hour).Unix())
	old, _ = ns.GetNode(old.Id)
	px, pt := effectiveNodePins(old, SettingService{}, time.Now())
	ns.adoptReportedCoreVersions(old, px, pt)
	got, _ := ns.GetNode(old.Id)
	if px != "" || got.XrayPinnedVersion != "26.1.1" {
		t.Fatalf("old node: enforce=%q adopted=%q", px, got.XrayPinnedVersion)
	}
}

// End to end against a fake worker: a new node reporting the image-bundled cores is brought to the
// versions the existing fleet is pinned to; an old node with no pin is left alone.
func TestMaybeReinstallPinnedCoreVersionsNewVsOldNode(t *testing.T) {
	db := testdb.New(t)
	ns := NodeService{}

	var mu sync.Mutex
	var calls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls = append(calls, r.URL.Path)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	db.Create(&model.Node{Name: "p1", Address: "p1", ApiKey: "p1", XrayPinnedVersion: "26.10.1", TelemtPinnedVersion: "3.6.0"})
	mk := func(name string, age time.Duration) *model.Node {
		n := &model.Node{Name: name, Address: srv.URL, ApiKey: name, Enable: true, Status: "online", XrayVersion: "26.9.9", TelemtVersion: "3.5.7"}
		if err := db.Create(n).Error; err != nil {
			t.Fatal(err)
		}
		db.Model(n).Update("created_at", time.Now().Add(-age).Unix())
		got, _ := ns.GetNode(n.Id)
		return got
	}

	old := mk("old", 48*time.Hour)
	ns.MaybeReinstallPinnedCoreVersions(old)
	if len(calls) != 0 {
		t.Fatalf("old node must not be touched, got %v", calls)
	}
	if g, _ := ns.GetNode(old.Id); g.XrayPinnedVersion != "26.9.9" || g.TelemtPinnedVersion != "3.5.7" {
		t.Fatalf("old node should adopt its versions, got %q/%q", g.XrayPinnedVersion, g.TelemtPinnedVersion)
	}

	fresh := mk("new", time.Minute)
	ns.MaybeReinstallPinnedCoreVersions(fresh)
	joined := strings.Join(calls, ",")
	if !strings.Contains(joined, "/api/v1/install-xray/26.10.1") || !strings.Contains(joined, "/api/v1/install-telemt/3.6.0") {
		t.Fatalf("new node not brought to fleet versions, calls: %v", calls)
	}
	if g, _ := ns.GetNode(fresh.Id); g.XrayPinnedVersion != "26.10.1" || g.TelemtPinnedVersion != "3.6.0" {
		t.Fatalf("new node pins not recorded: %q/%q", g.XrayPinnedVersion, g.TelemtPinnedVersion)
	}
}
