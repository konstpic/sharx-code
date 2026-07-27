package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/conndrop"
	"github.com/konstpic/sharx-code/v2/xray"
)

func TestMergeOfflineBlockedSessionRowsDropAvailableFromNodes(t *testing.T) {
	results := []ClientSessionNodeResult{
		{NodeName: "worker-a", DropAvailable: false},
		{NodeName: "worker-b", DropAvailable: true},
	}
	merged := mergeOfflineBlockedSessionRows(results, []string{"198.51.100.77"})
	if len(merged) != 3 {
		t.Fatalf("len = %d, want 3", len(merged))
	}
	offline := merged[2]
	if !offline.IsOfflineBlockedGroup {
		t.Fatal("expected offline blocked group row")
	}
	if !offline.DropAvailable {
		t.Fatal("expected dropAvailable when any node reports dropAvailable")
	}
}

func TestMergeOfflineBlockedSessionRowsDropAvailableFromConndrop(t *testing.T) {
	results := []ClientSessionNodeResult{{NodeName: "Local", DropAvailable: false}}
	merged := mergeOfflineBlockedSessionRows(results, []string{"198.51.100.77"})
	if len(merged) != 2 {
		t.Fatalf("len = %d, want 2", len(merged))
	}
	offline := merged[1]
	want := conndrop.Available()
	if offline.DropAvailable != want {
		t.Fatalf("dropAvailable = %v, want %v", offline.DropAvailable, want)
	}
}

func TestMergeOfflineBlockedSessionRowsSkipsDuplicateIPs(t *testing.T) {
	results := []ClientSessionNodeResult{
		{
			NodeName: "Local",
			Sessions: []xray.OnlineIPSession{{IP: "198.51.100.77", LastSeen: 1}},
		},
	}
	merged := mergeOfflineBlockedSessionRows(results, []string{"198.51.100.77", "203.0.113.1"})
	if len(merged) != 2 {
		t.Fatalf("len = %d, want 2 (no offline row when all blocked IPs are live)", len(merged))
	}
}
