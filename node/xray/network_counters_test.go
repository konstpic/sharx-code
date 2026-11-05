package xray

import (
	core "github.com/konstpic/sharx-code/v2/xray"
	"testing"
)

func TestNetworkCountersSurviveResetAndWorkerRestart(t *testing.T) {
	t.Setenv("SHARX_NODE_DATA_DIR", t.TempDir())
	m := NewManager()
	traffic := func(up int64) []*core.ClientTraffic {
		return []*core.ClientTraffic{{Email: "sn-test", Up: up}, {Email: "own-client", Up: 9000}, {Email: "snv-probe", Up: 64000}}
	}
	for _, step := range []struct {
		up    int64
		reset bool
		want  int64
	}{{100, true, 100}, {50, false, 150}, {50, false, 150}, {50, true, 150}, {20, false, 170}} {
		totals, err := m.accumulateNetworkCounters(traffic(step.up), step.reset)
		if err != nil {
			t.Fatal(err)
		}
		if totals["sn-test"][0] != step.want {
			t.Fatalf("counter drift: %+v want %d", totals, step.want)
		}
		if _, ok := totals["snv-probe"]; ok {
			t.Fatal("verifier probe included in customer billing")
		}
		if _, ok := totals["own-client"]; ok {
			t.Fatal("own client included in network evidence")
		}
	}
	restarted := NewManager()
	totals, err := restarted.accumulateNetworkCounters(traffic(5), false)
	if err != nil || totals["sn-test"][0] != 175 {
		t.Fatalf("restart lost or duplicated counters: %+v %v", totals, err)
	}
}
