package mesh

import (
	"context"
	"encoding/json"
	"testing"
)

func TestRelayDurablePlansPreserveInheritedPortAndManualChanges(t *testing.T) {
	slot := 2
	d := Enrolled{Node: "node-2", Slot: &slot}
	hosts := []Host{{UUID: "host-1", Address: "203.0.113.5", Port: 443, RawPort: 0, Nodes: []string{"node-2"}, Enabled: true, Eligible: true}, {UUID: "host-2", Address: "203.0.113.5", Port: 8443, Nodes: []string{"node-2"}, Enabled: true, Eligible: false}}
	plans, saved, e := PlanEnable(hosts, d, "entry.test", map[string]int{"443": 0, "8443": 1}, nil)
	if e != nil || len(plans) != 1 || len(saved) != 1 || plans[0].NewPort != 55200 {
		t.Fatal(plans, e)
	}
	patches, e := HostPatches(plans, hosts, true)
	if e != nil || len(patches) != 1 || patches[0]["originalPort"] != 0 {
		t.Fatal(patches, e)
	}
	hosts[0].Address = "entry.test"
	hosts[0].Port = 55200
	hosts[0].Enabled = false
	patches, e = HostPatches(saved, hosts, false)
	if e != nil || len(patches) != 1 || patches[0]["originalCustomized"] != false || patches[0]["restore"] != true {
		t.Fatal(patches, e)
	}
	hosts[0].Address = "manual.test"
	if _, e = HostPatches(saved, hosts, false); e == nil {
		t.Fatal("manual host edit overwritten")
	}
	if _, e = HostPatches(saved, nil, false); e != nil {
		t.Fatal("deleted host prevents cleanup", e)
	}
}
func TestRelayDoesNotOverwriteJournalWhenOriginalHostReappears(t *testing.T) {
	slot := 0
	d := Enrolled{Node: "node-2", Slot: &slot}
	hosts := []Host{{UUID: "host-1", Address: "exit.test", Port: 443, Nodes: []string{"node-2"}, Enabled: true, Eligible: true}}
	_, saved, e := PlanEnable(hosts, d, "entry.test", map[string]int{"443": 0}, nil)
	if e != nil {
		t.Fatal(e)
	}
	if _, _, e = PlanEnable(hosts, d, "entry.test", map[string]int{"443": 0}, saved); e == nil {
		t.Fatal("manually restored host accepted as new")
	}
}

func TestRelayOnlyForwardsPortsAssignedToThatExit(t *testing.T) {
	slot := 0
	c := &Controller{ctx: context.Background(), relays: map[string]*RelayState{"n2": {On: true}}, enrolled: map[string]Enrolled{"n2": {Overlay: "10.203.0.2", Slot: &slot}}, ports: map[string]int{"443": 0, "8080": 1}, bridge: func(_ context.Context, action string, body json.RawMessage) (any, error) {
		var q struct {
			IDs []int `json:"ids"`
		}
		if action != "ports" || json.Unmarshal(body, &q) != nil || len(q.IDs) != 1 || q.IDs[0] != 2 {
			t.Fatal(action, string(body))
		}
		return []int{443}, nil
	}}
	rules, e := c.forwarding("", false)
	if e != nil || len(rules) != 1 {
		t.Fatal(rules, e)
	}
	maps := rules[0]["maps"].([][]any)
	if len(maps) != 2 || maps[0][2] != 443 || maps[1][2] != 443 {
		t.Fatal("unassigned inbound port exposed", maps)
	}
}

// A connection takes the port of its inbound and the port can change while a
// relay operation waits. The plan has to follow it, otherwise the operation
// never finishes.
func TestRelayPlanFollowsTheChangedConnectionPort(t *testing.T) {
	pp := PlanPorts{Slot: 5, Ports: map[string]int{"443": 2, "444": 3}}
	plan := HostPlan{UUID: "host-121", Address: "31.76.22.31", Port: 443, RawPort: 0, NewAddress: "relay.test", NewPort: 55502}
	hosts := []Host{{UUID: "host-121", Address: "31.76.22.31", Port: 444, RawPort: 0, InboundPort: 444, Enabled: true, Eligible: true}}
	refreshed := HostPlanRefresh([]HostPlan{plan}, hosts, pp)
	if len(refreshed) != 1 || refreshed[0].Port != 444 || refreshed[0].NewPort != 55503 {
		t.Fatal(refreshed)
	}
	// the relay is switched off and the host is already published directly
	patches, e := HostPatches(refreshed, hosts, false)
	if e != nil || len(patches) != 0 {
		t.Fatal(patches, e)
	}
	// the relay is switched on and the host goes to the relay port of the
	// current connection port
	patches, e = HostPatches(refreshed, hosts, true)
	if e != nil || len(patches) != 1 || patches[0]["port"] != 55503 || patches[0]["expectedPort"] != 444 {
		t.Fatal(patches, e)
	}
}

// A connection that changed its port while the relay was on leaves the host
// on the relay port of the old connection: the mesh has to republish it.
func TestRelayDetectsADriftedRelayPort(t *testing.T) {
	pp := PlanPorts{Slot: 5, Ports: map[string]int{"443": 2, "444": 3}}
	plan := HostPlan{UUID: "host-121", Address: "31.76.22.31", Port: 443, RawPort: 0, NewAddress: "relay.test", NewPort: 55502}
	hosts := []Host{{UUID: "host-121", Address: "relay.test", Port: 55502, RawPort: 0, InboundPort: 444}}
	drifted := RelayDrift([]HostPlan{plan}, hosts, pp)
	if len(drifted) != 1 {
		t.Fatal(drifted)
	}
	if drifted[0].Port != 444 || drifted[0].NewPort != 55503 {
		t.Fatal(drifted)
	}
	patches, e := HostPatches(drifted, hosts, true)
	if e != nil || len(patches) != 1 || patches[0]["port"] != 55503 || patches[0]["expectedPort"] != 55502 {
		t.Fatal(patches, e)
	}
	// a port the mesh does not know yet is not repaired: the relay must not
	// run into a loop with a host it cannot publish
	if d := RelayDrift([]HostPlan{plan}, hosts, PlanPorts{Slot: 5, Ports: map[string]int{"443": 2}}); len(d) != 0 {
		t.Fatal(d)
	}
}

// A host that sets the port itself never follows its inbound: a changed port
// is a manual change and must not be overwritten.
func TestRelayKeepsHostsWithAnOwnPort(t *testing.T) {
	pp := PlanPorts{Slot: 5, Ports: map[string]int{"443": 2, "444": 3}}
	plan := HostPlan{UUID: "host-1", Address: "exit.test", Port: 443, RawPort: 443, NewAddress: "relay.test", NewPort: 55502}
	hosts := []Host{{UUID: "host-1", Address: "exit.test", Port: 444, RawPort: 443, InboundPort: 444}}
	refreshed := HostPlanRefresh([]HostPlan{plan}, hosts, pp)
	if len(refreshed) != 1 || refreshed[0].Port != 443 || refreshed[0].NewPort != 55502 {
		t.Fatal(refreshed)
	}
	if _, e := HostPatches(refreshed, hosts, true); e == nil {
		t.Fatal("manual port change accepted")
	}
}
