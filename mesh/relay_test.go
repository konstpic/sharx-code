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
