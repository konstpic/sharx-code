package protocol

import (
	"encoding/base64"
	"math"
	"testing"
)

func graph(edges ...[2]string) Graph {
	g := Graph{}
	for _, e := range edges {
		if g[e[0]] == nil {
			g[e[0]] = map[string]Link{}
		}
		if g[e[1]] == nil {
			g[e[1]] = map[string]Link{}
		}
		g[e[0]][e[1]] = Link{OK: true, RTT: 10}
		g[e[1]][e[0]] = Link{OK: true, RTT: 10}
	}
	return g
}
func TestTransitRequiresBothDirectionsAndNeverRecurses(t *testing.T) {
	nodes := map[string]Node{"n1": {}, "n2": {}, "n3": {}, "n4": {}}
	g := graph([2]string{"n1", "n2"}, [2]string{"n2", "n3"}, [2]string{"n3", "n4"})
	if h := NextHops(nodes, g, "n1", nil, nil); h["n3"] != "n2" || h["n4"] != "" {
		t.Fatal(h)
	}
	delete(g["n2"], "n1")
	if h := NextHops(nodes, g, "n1", nil, nil); h["n3"] != "" {
		t.Fatal(h)
	}
}
func TestQualityHysteresisAndDirectRecovery(t *testing.T) {
	nodes := map[string]Node{"n1": {}, "n2": {}, "n3": {}, "n4": {}}
	g := graph([2]string{"n1", "n2"}, [2]string{"n2", "n4"}, [2]string{"n1", "n3"}, [2]string{"n3", "n4"})
	current := map[string]string{"n4": "n3"}
	if got := NextHops(nodes, g, "n1", current, nil)["n4"]; got != "n3" {
		t.Fatal(got)
	}
	if got := NextHops(nodes, g, "n1", current, map[string]float64{"n3": 4})["n4"]; got != "n2" {
		t.Fatal(got)
	}
	g["n1"]["n4"] = Link{OK: true}
	g["n4"]["n1"] = Link{OK: true}
	if got := NextHops(nodes, g, "n1", current, nil)["n4"]; got != "" {
		t.Fatal(got)
	}
	if math.IsNaN(cost(Graph{"n1": {"n2": {RTT: math.NaN()}}}, "n1", "n2")) {
		t.Fatal("NaN routing cost")
	}
}
func TestTrackerDebouncesAndReportsLoss(t *testing.T) {
	tr := &Tracker{}
	for i := 0; i < 2; i++ {
		if !tr.Update(0, false).OK {
			t.Fatal("too early down")
		}
	}
	if tr.Update(0, false).OK {
		t.Fatal("did not go down")
	}
	for i := 0; i < 2; i++ {
		if tr.Update(10, true).OK {
			t.Fatal("too early recovery")
		}
	}
	r := tr.Update(10, true)
	if !r.OK || r.Loss != .5 {
		t.Fatal(r)
	}
}
func TestRegistryRejectsUntrustedValues(t *testing.T) {
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	valid := func() map[string]Node {
		return map[string]Node{"n1": {Underlay: "172.30.203.11", Overlay: "10.203.0.1", Pubkey: key}}
	}
	if e := Validate(valid()); e != nil {
		t.Fatal(e)
	}
	for _, bad := range []Node{{Underlay: "127.0.0.1", Overlay: "10.203.0.1", Pubkey: key}, {Underlay: "172.30.203.11;reboot", Overlay: "10.203.0.1", Pubkey: key}, {Underlay: "172.30.203.11", Overlay: "10.203.0.201", Pubkey: key}, {Underlay: "172.30.203.11", Overlay: "10.203.0.1", Pubkey: "garbage"}} {
		n := valid()
		n["n1"] = bad
		if Validate(n) == nil {
			t.Fatal(bad)
		}
	}
	n := valid()
	n["n2"] = n["n1"]
	if Validate(n) == nil {
		t.Fatal("duplicate overlay accepted")
	}
}
