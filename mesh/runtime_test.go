package mesh

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestStandaloneNeverCreatesMeshStateOrStartsChild(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "not-created")
	r := &Runtime{Dir: dir, Gate: func() bool { return false }}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r.Start(ctx)
	defer r.Stop()
	if r.Enabled() {
		t.Fatal("standalone enabled mesh")
	}
	if _, e := r.Call(ctx, "status", nil); e == nil {
		t.Fatal("standalone accepted a mesh call")
	}
	time.Sleep(40 * time.Millisecond)
	if _, e := os.Stat(dir); !os.IsNotExist(e) {
		t.Fatal("standalone created controller state")
	}
}
func TestAtomicStateIsPrivateAndSurvivesReplacement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "settings.json")
	for _, on := range []bool{true, false} {
		if e := AtomicJSON(path, map[string]bool{"enabled": on}); e != nil {
			t.Fatal(e)
		}
	}
	info, e := os.Stat(path)
	if e != nil {
		t.Fatal(e)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatal(info.Mode())
	}
	b, _ := os.ReadFile(path)
	var v map[string]bool
	if json.Unmarshal(b, &v) != nil || v["enabled"] {
		t.Fatal(string(b))
	}
}
func TestEmbeddedControllerLifecycle(t *testing.T) {
	dir := t.TempDir()
	if e := AtomicJSON(filepath.Join(dir, "settings.json"), map[string]any{"enabled": true, "interval": 15}); e != nil {
		t.Fatal(e)
	}
	var mode atomic.Bool
	mode.Store(true)
	r := &Runtime{Dir: dir, Gate: mode.Load, Bridge: func(ctx context.Context, action string, body json.RawMessage) (any, error) { return []any{}, nil }}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r.Start(ctx)
	defer r.Stop()
	until := time.Now().Add(10 * time.Second)
	var b json.RawMessage
	var err error
	for time.Now().Before(until) {
		b, err = r.Call(ctx, "status", nil)
		if err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil {
		t.Fatal("controller did not start", r.State(), err)
	}
	var s map[string]any
	if json.Unmarshal(b, &s) != nil || s["etcd_mtls"] != true {
		t.Fatal(string(b))
	}
	for _, name := range []string{"id_ed25519", "ca.key", "ca.crt"} {
		info, e := os.Stat(filepath.Join(dir, name))
		if e != nil || info.Mode().Perm() != 0600 {
			t.Fatal("state permissions", name, e)
		}
	}
	r.RequestRestart()
	if _, e := r.Call(ctx, "probe", nil); e == nil {
		t.Fatal("controller accepted a new operation while a restart was pending")
	}
	until = time.Now().Add(8 * time.Second)
	for time.Now().Before(until) {
		_, err = r.Call(ctx, "status", nil)
		if err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil {
		t.Fatal("controller did not resume after configuration restart", err)
	}
	mode.Store(false)
	until = time.Now().Add(4 * time.Second)
	for time.Now().Before(until) && r.State()["running"] == true {
		time.Sleep(50 * time.Millisecond)
	}
	if r.State()["running"] == true {
		t.Fatal("controller stayed alive in standalone mode")
	}
	if _, err = r.Call(ctx, "status", nil); err == nil {
		t.Fatal("mode guard bypass")
	}
}
