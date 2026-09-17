package job

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/xray"
)

func TestRankedSessionIPsFromResults_newestKeepsOldest(t *testing.T) {
	results := []service.ClientSessionNodeResult{{
		Sessions: []xray.OnlineIPSession{
			{IP: "1.1.1.1", LastSeen: 100},
			{IP: "2.2.2.2", LastSeen: 200},
			{IP: "3.3.3.3", LastSeen: 300},
		},
	}}
	ranked := rankedSessionIPsFromResults(results, "newest", 300, 0)
	if len(ranked) != 3 {
		t.Fatalf("expected 3 IPs, got %d", len(ranked))
	}
	if ranked[0].IP != "1.1.1.1" || ranked[2].IP != "3.3.3.3" {
		t.Fatalf("newest policy should sort ascending by LastSeen: %+v", ranked)
	}
	excess := ranked[2:]
	if len(excess) != 1 || excess[0].IP != "3.3.3.3" {
		t.Fatalf("expected newest IP as excess, got %+v", excess)
	}
}

func TestRankedSessionIPsFromResults_oldestKeepsNewest(t *testing.T) {
	results := []service.ClientSessionNodeResult{{
		Sessions: []xray.OnlineIPSession{
			{IP: "1.1.1.1", LastSeen: 100},
			{IP: "2.2.2.2", LastSeen: 200},
			{IP: "3.3.3.3", LastSeen: 300},
		},
	}}
	ranked := rankedSessionIPsFromResults(results, "oldest", 300, 0)
	if ranked[0].IP != "3.3.3.3" || ranked[2].IP != "1.1.1.1" {
		t.Fatalf("oldest policy should sort descending by LastSeen: %+v", ranked)
	}
	excess := ranked[2:]
	if len(excess) != 1 || excess[0].IP != "1.1.1.1" {
		t.Fatalf("expected oldest IP as excess, got %+v", excess)
	}
}

// TestRankedSessionIPsFromResults_recencyFiltersStaleCGNATIPs is the regression test for the
// mobile-CGNAT false-positive: Xray's online-IP map never expires entries on its own, so a
// client whose carrier rotated through several IPs over time would otherwise accumulate all of
// them as "online" even though only the most recent one is actually active.
func TestRankedSessionIPsFromResults_recencyFiltersStaleCGNATIPs(t *testing.T) {
	now := int64(1_000_000)
	results := []service.ClientSessionNodeResult{{
		Sessions: []xray.OnlineIPSession{
			{IP: "1.1.1.1", LastSeen: now - 86400}, // a day old — stale carrier-rotated IP
			{IP: "2.2.2.2", LastSeen: now - 3600},  // an hour old — also stale
			{IP: "3.3.3.3", LastSeen: now - 30},    // 30s old — genuinely active right now
		},
	}}
	ranked := rankedSessionIPsFromResults(results, "newest", now, 300) // 5-minute recency window
	if len(ranked) != 1 {
		t.Fatalf("expected only the recently-seen IP to count, got %+v", ranked)
	}
	if ranked[0].IP != "3.3.3.3" {
		t.Fatalf("expected 3.3.3.3 (recent) to survive the recency filter, got %+v", ranked)
	}
}

func TestRankedSessionIPsFromResults_recencyDisabledKeepsOldBehavior(t *testing.T) {
	now := int64(1_000_000)
	results := []service.ClientSessionNodeResult{{
		Sessions: []xray.OnlineIPSession{
			{IP: "1.1.1.1", LastSeen: now - 86400},
			{IP: "2.2.2.2", LastSeen: now - 30},
		},
	}}
	ranked := rankedSessionIPsFromResults(results, "newest", now, 0)
	if len(ranked) != 2 {
		t.Fatalf("recencyWindowSec<=0 should disable filtering, got %+v", ranked)
	}
}

// TestRankedSessionIPsFromResults_recencyIgnoresZeroLastSeen covers the synthetic
// "offline blocked" rows (LastSeen: 0) mergeOfflineBlockedSessionRows injects, which must always
// remain visible (so the admin can unblock them) regardless of the recency window.
func TestRankedSessionIPsFromResults_recencyIgnoresZeroLastSeen(t *testing.T) {
	now := int64(1_000_000)
	results := []service.ClientSessionNodeResult{{
		Sessions: []xray.OnlineIPSession{
			{IP: "9.9.9.9", LastSeen: 0},
		},
	}}
	ranked := rankedSessionIPsFromResults(results, "newest", now, 300)
	if len(ranked) != 1 || ranked[0].IP != "9.9.9.9" {
		t.Fatalf("expected the LastSeen=0 synthetic row to survive recency filtering, got %+v", ranked)
	}
}
