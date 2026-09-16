package amneziawg

import (
	"path/filepath"
	"testing"

	"github.com/konstpic/sharx-code/v2/node/nodecache"
)

// commitReplaySnapshot writes to the cache path (if set) as a side effect of a successful
// Apply(); it's exercised directly here (same package) since a full Apply() round-trip needs
// a real amneziawg-go binary that isn't available in this sandbox.
func TestCommitReplaySnapshot_WritesCacheFile(t *testing.T) {
	m := NewManager()
	cachePath := filepath.Join(t.TempDir(), "amneziawg.json")
	m.SetCachePath(cachePath)

	payloads := []Payload{{InboundId: 1, Tag: "awg-a", Iface: "awg0", Conf: "# a"}}
	m.commitReplaySnapshot(payloads)

	var onDisk []Payload
	found, err := nodecache.Load(cachePath, &onDisk)
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	if !found || len(onDisk) != 1 || onDisk[0].Tag != "awg-a" {
		t.Fatalf("expected cache to contain the applied payload, got found=%v %+v", found, onDisk)
	}
}

func TestLoadAndApplyCache_NoCacheFileIsNoOp(t *testing.T) {
	m := NewManager()
	m.SetCachePath(filepath.Join(t.TempDir(), "does-not-exist.json"))
	if err := m.LoadAndApplyCache(); err != nil {
		t.Fatalf("expected no error when no cache file exists yet, got %v", err)
	}
	if m.RunningCount() != 0 {
		t.Fatalf("expected no sidecars started, got %d", m.RunningCount())
	}
}

func TestLoadAndApplyCache_BlankPathIsNoOp(t *testing.T) {
	m := NewManager() // cachePath left unset
	if err := m.LoadAndApplyCache(); err != nil {
		t.Fatalf("expected no error with no cache path configured, got %v", err)
	}
}
