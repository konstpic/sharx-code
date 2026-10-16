package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func TestPlanPresenceWritesThrottle(t *testing.T) {
	written := map[presencePair]int64{{1, 1}: 1000}
	obs := []presenceObs{{1, 1, 20_000}, {1, 1, 40_000}, {2, 1, 20_000}}
	got := planPresenceWrites(obs[:1], written, 30_000)
	if len(got) != 0 {
		t.Fatalf("within interval must be skipped: %v", got)
	}
	got = planPresenceWrites(obs[1:], written, 30_000)
	if len(got) != 2 {
		t.Fatalf("expired and new pairs must be written: %v", got)
	}
}

func TestBuildPresenceObs(t *testing.T) {
	online := map[int]map[string]struct{}{7: {"a": {}, "ghost": {}}, 8: {"a": {}}}
	got := buildPresenceObs(online, map[string][]int{"a": {1, 2}}, 5)
	if len(got) != 4 {
		t.Fatalf("want 4 (2 ids x 2 nodes), got %v", got)
	}
}

func TestOrderConnectedNodes(t *testing.T) {
	l := []model.ClientConnectedNode{
		{NodeId: 3, LastSeenAt: 10},
		{NodeId: 2, LastSeenAt: 10},
		{NodeId: 5, LastSeenAt: 10, Online: true},
		{NodeId: 1, LastSeenAt: 5},
	}
	orderConnectedNodes(l)
	want := []int{5, 2, 3, 1}
	for i, n := range l {
		if n.NodeId != want[i] {
			t.Fatalf("pos %d: got %d want %d (%v)", i, n.NodeId, want[i], l)
		}
	}
}

func TestMergeConnectedNodesOnlineOverlay(t *testing.T) {
	c := &model.ClientEntity{}
	stored := []model.ClientConnectedNode{{NodeId: 1, NodeName: "a", LastSeenAt: 100}, {NodeId: 2, NodeName: "b", LastSeenAt: 90}}
	mergeConnectedNodes(c, stored, []int{2}, 200)
	if c.LastConnectedNode != "b" || c.LastConnectedNodeAt != 200 || !c.ConnectedNodes[0].Online || c.ConnectedNodes[1].Online {
		t.Fatalf("unexpected: %+v", c)
	}
	c2 := &model.ClientEntity{}
	mergeConnectedNodes(c2, []model.ClientConnectedNode{{NodeId: 1, NodeName: "a", LastSeenAt: 100}}, nil, 0)
	if c2.LastConnectedNode != "a" || c2.LastConnectedNodeAt != 100 {
		t.Fatalf("offline: %+v", c2)
	}
}
