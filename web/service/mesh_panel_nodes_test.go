package service

import (
	"github.com/konstpic/sharx-code/v2/database/model"
	"testing"
)

func TestResolveMeshPanelNode(t *testing.T) {
	nodes := []model.Node{{Id: 1, Address: "https://10.0.0.10:443"}, {Id: 2, Address: "https://10.0.0.1:443"}}
	for _, tc := range []struct {
		entry enrolledEntry
		want  int
	}{
		{enrolledEntry{Host: "10.0.0.1"}, 2},
		{enrolledEntry{Node: "node-1", Host: "10.0.0.1"}, 1},
		{enrolledEntry{Node: "balancer-1", Host: "10.0.0.1"}, 0},
		{enrolledEntry{Node: "node-3", Host: "10.0.0.1"}, 0},
	} {
		got := 0
		if n := resolveMeshPanelNode(tc.entry, nodes); n != nil {
			got = n.Id
		}
		if got != tc.want {
			t.Errorf("%+v resolved to %d, want %d", tc.entry, got, tc.want)
		}
	}
	nodes = append(nodes, model.Node{Id: 3, Address: "http://10.0.0.1:80"})
	if resolveMeshPanelNode(enrolledEntry{Host: "10.0.0.1"}, nodes) != nil {
		t.Fatal("ambiguous legacy address resolved")
	}
}
