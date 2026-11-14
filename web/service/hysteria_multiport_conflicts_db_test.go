package service

import (
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
)

// These tests need PostgreSQL (SHARX_TEST_DB); without it they are skipped,
// like the rest of the database-backed service tests. They pin the cross-
// inbound check: a hysteria2 range must not capture another UDP listener (or
// overlap another range) on a node it is assigned to.

func hy2MultiportInboundRow(port int, tag, stream string) *model.Inbound {
	return &model.Inbound{
		UserId: 1, Enable: true, Port: port, Protocol: model.Hysteria2,
		Remark: tag, Tag: tag, Settings: `{"version":2,"clients":[]}`, Sniffing: "{}",
		StreamSettings: stream,
	}
}

func TestAssignRejectsHysteriaMultiPortConflict(t *testing.T) {
	db := testdb.New(t)
	ss := SettingService{}
	if err := ss.SetMultiNodeMode(true); err != nil {
		t.Fatal(err)
	}
	_, _, srv := captureNodeServer(t)
	n := &model.Node{Name: "hy2-conflict-node", Address: srv.URL, Enable: true, Status: "online", ApiKey: "k"}
	if err := db.Create(n).Error; err != nil {
		t.Fatal(err)
	}
	is := &InboundService{}
	ns := &NodeService{}

	owner, _, err := is.AddInbound(hy2MultiportInboundRow(443, "hy2-owner",
		`{"network":"hysteria","security":"tls","hysteriaMultiPort":"39640-39649"}`))
	if err != nil {
		t.Fatalf("add owner: %v", err)
	}
	if err := ns.AssignInboundToNodesWithBindings(owner.Id, []InboundNodeBindingInput{{NodeId: n.Id}}); err != nil {
		t.Fatalf("assign owner: %v", err)
	}

	// A UDP inbound on a port inside the range would lose all traffic to the
	// owner's REDIRECT: the assignment must be rejected.
	covered, _, err := is.AddInbound(hy2MultiportInboundRow(39645, "hy2-covered", `{"network":"hysteria"}`))
	if err != nil {
		t.Fatalf("add covered: %v", err)
	}
	err = ns.AssignInboundToNodesWithBindings(covered.Id, []InboundNodeBindingInput{{NodeId: n.Id}})
	if err == nil || !strings.Contains(err.Error(), "UDP port 39645") {
		t.Fatalf("covering range must be rejected, got %v", err)
	}

	// Two overlapping ranges would make the first REDIRECT win: reject.
	overlap, _, err := is.AddInbound(hy2MultiportInboundRow(444, "hy2-overlap",
		`{"network":"hysteria","hysteriaMultiPort":"39645-39655"}`))
	if err != nil {
		t.Fatalf("add overlap: %v", err)
	}
	err = ns.AssignInboundToNodesWithBindings(overlap.Id, []InboundNodeBindingInput{{NodeId: n.Id}})
	if err == nil || !strings.Contains(err.Error(), "overlaps") {
		t.Fatalf("overlapping range must be rejected, got %v", err)
	}

	// A disjoint range on another node is fine.
	_, _, srvOther := captureNodeServer(t)
	other := &model.Node{Name: "hy2-other-node", Address: srvOther.URL, Enable: true, Status: "online", ApiKey: "k2"}
	if err := db.Create(other).Error; err != nil {
		t.Fatal(err)
	}
	if err := ns.AssignInboundToNodesWithBindings(covered.Id, []InboundNodeBindingInput{{NodeId: other.Id}}); err != nil {
		t.Fatalf("another node must not conflict: %v", err)
	}
}

func TestUpdateRejectsHysteriaMultiPortCoveringOwnNodePeer(t *testing.T) {
	db := testdb.New(t)
	ss := SettingService{}
	if err := ss.SetMultiNodeMode(true); err != nil {
		t.Fatal(err)
	}
	_, _, srv := captureNodeServer(t)
	n := &model.Node{Name: "hy2-update-node", Address: srv.URL, Enable: true, Status: "online", ApiKey: "k3"}
	if err := db.Create(n).Error; err != nil {
		t.Fatal(err)
	}
	is := &InboundService{}
	ns := &NodeService{}

	peer, _, err := is.AddInbound(hy2MultiportInboundRow(39645, "hy2-peer", `{"network":"hysteria"}`))
	if err != nil {
		t.Fatalf("add peer: %v", err)
	}
	if err := ns.AssignInboundToNodesWithBindings(peer.Id, []InboundNodeBindingInput{{NodeId: n.Id}}); err != nil {
		t.Fatalf("assign peer: %v", err)
	}
	owner, _, err := is.AddInbound(hy2MultiportInboundRow(443, "hy2-owner2", `{"network":"hysteria"}`))
	if err != nil {
		t.Fatalf("add owner: %v", err)
	}
	if err := ns.AssignInboundToNodesWithBindings(owner.Id, []InboundNodeBindingInput{{NodeId: n.Id}}); err != nil {
		t.Fatalf("assign owner: %v", err)
	}

	upd := *owner
	upd.StreamSettings = `{"network":"hysteria","security":"tls","hysteriaMultiPort":"39640-39650"}`
	if _, _, err := is.UpdateInbound(&upd); err == nil || !strings.Contains(err.Error(), "UDP port 39645") {
		t.Fatalf("update introducing a covering range must be rejected, got %v", err)
	}

	// The same range on a node without the peer is accepted.
	_, _, srvOther := captureNodeServer(t)
	other := &model.Node{Name: "hy2-update-other", Address: srvOther.URL, Enable: true, Status: "online", ApiKey: "k4"}
	if err := db.Create(other).Error; err != nil {
		t.Fatal(err)
	}
	free, _, err := is.AddInbound(hy2MultiportInboundRow(445, "hy2-free", `{"network":"hysteria"}`))
	if err != nil {
		t.Fatalf("add free: %v", err)
	}
	if err := ns.AssignInboundToNodesWithBindings(free.Id, []InboundNodeBindingInput{{NodeId: other.Id}}); err != nil {
		t.Fatalf("assign free: %v", err)
	}
	updFree := *free
	updFree.StreamSettings = `{"network":"hysteria","security":"tls","hysteriaMultiPort":"39640-39650"}`
	if _, _, err := is.UpdateInbound(&updFree); err != nil {
		t.Fatalf("disjoint node update must pass: %v", err)
	}
}

// Port hopping needs the node agent: in single-node mode the panel core serves
// the inbound and never installs the REDIRECT rules, so the save is rejected
// instead of shipping a dead range in the subscription.
func TestAddInboundRejectsHysteriaMultiPortInSingleNodeMode(t *testing.T) {
	testdb.New(t)
	is := &InboundService{}
	_, _, err := is.AddInbound(hy2MultiportInboundRow(443, "hy2-single",
		`{"network":"hysteria","security":"tls","hysteriaMultiPort":"39640-39649"}`))
	if err == nil || !strings.Contains(err.Error(), "multi-node") {
		t.Fatalf("single-node range must be rejected, got %v", err)
	}
}
