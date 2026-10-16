package service

import (
	"testing"
	"time"
)

func TestApplyStale(t *testing.T) {
	now := time.Now()
	prev := TelemtDCSource{Kind: "node", NodeId: 1, FetchedAt: now.Add(-time.Minute).Unix(), Instances: []TelemtDCInstance{{Remark: "a"}}}
	fresh := TelemtDCSource{Kind: "node", NodeId: 1, Error: "timeout", Instances: []TelemtDCInstance{}}

	got := applyStale(fresh, prev, true, now)
	if !got.Stale || len(got.Instances) != 1 || got.Error != "timeout" || got.FetchedAt != prev.FetchedAt {
		t.Fatalf("expected stale fallback, got %+v", got)
	}
	if g := applyStale(fresh, prev, false, now); g.Stale || len(g.Instances) != 0 {
		t.Fatalf("no history must not be stale: %+v", g)
	}
	old := prev
	old.FetchedAt = now.Add(-2 * telemtDCStaleMax).Unix()
	if g := applyStale(fresh, old, true, now); g.Stale {
		t.Fatalf("too old data must not be served: %+v", g)
	}
	ok := TelemtDCSource{Kind: "node", Instances: []TelemtDCInstance{{Remark: "b"}}}
	if g := applyStale(ok, prev, true, now); g.Stale || g.Instances[0].Remark != "b" {
		t.Fatalf("successful fetch must pass through: %+v", g)
	}
}
