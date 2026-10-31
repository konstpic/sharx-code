package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	"github.com/konstpic/sharx-code/v2/mesh"
)

func TestMeshSettingsRejectShellSyntaxAndBadPorts(t *testing.T) {
	good := MeshSettings{Interval: 30, SNI: "probe.example.com", ProbePorts: []int{443}, RelayAddress: "relay.example.com", BalancerUUID: "pool-2"}
	if e := ValidateMeshSettings(good); e != nil {
		t.Fatal(e)
	}
	for _, bad := range []string{"$(id)", "x;touch /tmp/pwn", "a b", "https://probe.example.com/", "-o/tmp/pwn"} {
		c := good
		c.SNI = bad
		if ValidateMeshSettings(c) == nil {
			t.Errorf("unsafe SNI accepted: %q", bad)
		}
	}
	for _, ports := range [][]int{{0}, {65536}, {443, 443}} {
		c := good
		c.ProbePorts = ports
		if ValidateMeshSettings(c) == nil {
			t.Error("bad ports", ports)
		}
	}
	c := good
	c.ProbePorts = nil
	c.SNI = ""
	if e := ValidateMeshSettings(c); e != nil {
		t.Fatal("observe-only mode rejected", e)
	}
}
func TestMeshIPReplacementPreservesAPIURL(t *testing.T) {
	got, e := meshNodeURL("https://185.149.146.159:8443/api/worker", "77.91.72.153")
	if e != nil || got != "https://77.91.72.153:8443/api/worker" {
		t.Fatal(got, e)
	}
	if _, e = meshNodeURL("http://user:password@old:8080", "77.91.72.153"); e == nil {
		t.Fatal("credential-bearing URL accepted")
	}
}
func meshJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, e := json.Marshal(v)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func TestMeshStandaloneRejectsAllOperations(t *testing.T) {
	testdb.New(t)
	t.Setenv("XUI_MESH_STATE_DIR", filepath.Join(t.TempDir(), "mesh"))
	if _, e := MeshAction(context.Background(), "enroll", meshJSON(t, map[string]any{})); e == nil {
		t.Fatal("standalone accepted mesh operation")
	}
	if e := SaveMeshConfig(MeshSettings{Enabled: true, Interval: 30}); e == nil {
		t.Fatal("standalone accepted enabling mesh")
	}
	if _, e := os.Stat(meshDirectory()); !os.IsNotExist(e) {
		t.Fatal("standalone created mesh state")
	}
}
func TestMeshHostRelayCompareAndRestorePreservesMetadata(t *testing.T) {
	db := testdb.New(t)
	t.Setenv("XUI_MESH_STATE_DIR", t.TempDir())
	if e := (&SettingService{}).SetMultiNodeMode(true); e != nil {
		t.Fatal(e)
	}
	n := seedNode(t, db, "entry", "http://198.51.100.1:8080")
	ib := seedInbound(t, db, 443, model.VLESS)
	h := model.Host{Name: "direct", Address: "198.51.100.1", Kind: model.HostKindPlacement, NodeId: &n.Id, InboundId: &ib.Id, Port: 0, Enable: true, Customized: false}
	if e := db.Create(&h).Error; e != nil {
		t.Fatal(e)
	}
	patch := map[string]any{"uuid": fmt.Sprint("host-", h.Id), "address": "relay.example.com", "port": 55000, "expectedAddress": h.Address, "expectedPort": 443, "originalPort": 0, "originalCustomized": false}
	if _, e := meshBridge(context.Background(), "host-patch", meshJSON(t, patch)); e != nil {
		t.Fatal(e)
	}
	db.First(&h, h.Id)
	if h.Address != "relay.example.com" || !h.Customized || h.Port != 55000 {
		t.Fatalf("relay not protected from host sync: %+v", h)
	}
	// An operator's concurrent edit must not be overwritten, even with a valid old journal.
	db.Model(&h).Update("address", "manual.example.com")
	patch["restore"] = true
	patch["address"] = "198.51.100.1"
	patch["port"] = 443
	patch["expectedAddress"] = "relay.example.com"
	patch["expectedPort"] = 55000
	if _, e := meshBridge(context.Background(), "host-patch", meshJSON(t, patch)); e == nil {
		t.Fatal("manual host edit overwritten")
	}
	db.Model(&h).Updates(map[string]any{"address": "relay.example.com", "enable": false})
	hosts, e := meshHosts(db)
	if e != nil || len(hosts) != 1 || hosts[0].Enabled {
		t.Fatal("disabled hosts must remain visible for restore", hosts, e)
	}
	if _, e := meshBridge(context.Background(), "host-patch", meshJSON(t, patch)); e != nil {
		t.Fatal(e)
	}
	db.First(&h, h.Id)
	if h.Address != "198.51.100.1" || h.Port != 0 || h.Customized || h.Enable {
		t.Fatalf("restore lost original metadata or re-enabled host: %+v", h)
	}
}
func TestMeshPoolExclusionsDoNotChangeManualSettingsOrOtherPools(t *testing.T) {
	testdb.New(t)
	t.Setenv("XUI_MESH_STATE_DIR", t.TempDir())
	if e := (&SettingService{}).SetMultiNodeMode(true); e != nil {
		t.Fatal(e)
	}
	mesh.AtomicJSON(filepath.Join(meshDirectory(), "settings.json"), MeshSettings{Enabled: true, Interval: 30, BalancerUUID: "pool-1"})
	mesh.AtomicJSON(filepath.Join(meshDirectory(), "balancer.json"), map[string]map[string]bool{"pool-1": {"node-1": true}, "pool-2": {"node-1": true}})
	b := &model.Balancer{Id: 1, Engine: "haproxy"}
	for _, id := range []int{1, 2} {
		b.Pools = append(b.Pools, model.BalancerPool{Id: id, Enable: true, InboundPort: 443 + id, Transport: "tcp", Algorithm: "roundrobin", Members: []model.BalancerPoolMember{{NodeId: 1, Enable: true, Weight: 7, NodeAddr: "10.0.0.1"}, {NodeId: 2, Enable: false, Weight: 9, NodeAddr: "10.0.0.2"}}})
	}
	spec := (&BalancerService{}).buildSpecFor(b)
	if len(spec.Pools) != 1 || spec.Pools[0].ID != 2 || len(spec.Pools[0].Members) != 1 || spec.Pools[0].Members[0].Weight != 7 {
		t.Fatalf("mesh affected manual settings or unselected pool: %+v", spec)
	}
	if !b.Pools[0].Members[0].Enable || b.Pools[0].Members[1].Enable {
		t.Fatal("manual pool flags mutated")
	}
}
