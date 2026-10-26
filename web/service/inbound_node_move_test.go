package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
)

// Moving an inbound from one node to another keeps what describes it in the subscription, and the VLESS flow that lives in the
// inbound's own settings is not touched by the assignment.
func TestMovingInboundToAnotherNodeKeepsDescriptionAndFlow(t *testing.T) {
	db := testdb.New(t)
	ns := NodeService{}
	ib := seedInbound(t, db, 8443, model.VLESS)
	settings := `{"clients":[{"id":"6f1c5a52-1b1e-4c6f-9d0a-2c2d6f4b7a11","flow":"xtls-rprx-vision"}]}`
	db.Model(ib).Updates(map[string]any{"enable": false, "settings": settings})
	a, b := seedNode(t, db, "a", "a.example"), seedNode(t, db, "b", "b.example")

	yes := true
	if err := ns.AssignInboundToNodesWithBindings(ib.Id, []InboundNodeBindingInput{{NodeId: a.Id, IncludeInSubscription: &yes,
		PublishedAddress: "a.public", SubscriptionRemarkSuffix: "-NL", ServerDescription: "fast server"}}); err != nil {
		t.Fatal(err)
	}
	if err := ns.AssignInboundToNode(ib.Id, b.Id); err != nil {
		t.Fatal(err)
	}
	var m model.InboundNodeMapping
	if err := db.Where("inbound_id = ?", ib.Id).First(&m).Error; err != nil {
		t.Fatal(err)
	}
	if m.NodeId != b.Id || m.ServerDescription != "fast server" || m.SubscriptionRemarkSuffix != "-NL" || !m.IncludeInSubscription {
		t.Fatalf("description and suffix must follow the inbound: %+v", m)
	}
	if m.PublishedAddress != "" {
		t.Fatalf("the old server's published address must not move to the new node: %q", m.PublishedAddress)
	}
	var after model.Inbound
	db.First(&after, ib.Id)
	if got := VLESSFlowFromInboundSettings(after.Settings); got != "xtls-rprx-vision" {
		t.Fatalf("VLESS flow changed by the move: %q", got)
	}
}
