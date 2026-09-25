package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
)

// Removing the last node from an inbound (an empty binding list) must clear the mapping the nodes page reads.
func TestAssignInboundToNoNodesClearsMappings(t *testing.T) {
	db := testdb.New(t)
	svc := &NodeService{}
	ib := seedInbound(t, db, 5201, model.VLESS)
	n := seedNode(t, db, "n1", "127.0.0.1")

	if err := svc.AssignInboundToNodesWithBindings(ib.Id, []InboundNodeBindingInput{{NodeId: n.Id}}); err != nil {
		t.Fatal(err)
	}
	got, err := svc.GetInboundsForNode(n.Id)
	if err != nil || len(got) != 1 {
		t.Fatalf("assigned: %v %v", got, err)
	}

	if err := svc.AssignInboundToNodesWithBindings(ib.Id, nil); err != nil {
		t.Fatal(err)
	}
	if got, _ := svc.GetInboundsForNode(n.Id); len(got) != 0 {
		t.Fatalf("inbound still listed on the node: %d", len(got))
	}

	if err := svc.AssignInboundToNodesWithBindings(ib.Id, []InboundNodeBindingInput{{NodeId: n.Id}}); err != nil {
		t.Fatal(err)
	}
	if err := svc.UnassignInboundFromNode(ib.Id); err != nil {
		t.Fatal(err)
	}
	if got, _ := svc.GetInboundsForNode(n.Id); len(got) != 0 {
		t.Fatalf("unassign left %d inbounds on the node", len(got))
	}
}
