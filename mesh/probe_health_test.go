package mesh

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/konstpic/sharx-code/v2/mesh/agent"
)

func TestIndependentProbeHealth(t *testing.T) {
	c := Controller{ctx: context.Background(), enrolled: map[string]Enrolled{"entry": {Role: "entry", Transport: "embedded"}, "exit": {Role: "exit"}}, health: map[string]*ExitHealth{}}
	c.settings.Probes = []ProbeTarget{{Port: 443, SNI: "working.example"}, {Port: 8443, SNI: "broken.example"}}
	working := true
	c.bridge = func(_ context.Context, _ string, raw json.RawMessage) (any, error) {
		var q struct{ Data agent.ProbeRequest }
		if err := json.Unmarshal(raw, &q); err != nil {
			return nil, err
		}
		path := agent.PathResult{Total: 3}
		if working && q.Data.SNI == "working.example" {
			path.OK = 3
		}
		return map[string]map[string]agent.PathResult{"exit": {"direct": path}}, nil
	}
	for _, want := range []bool{true, false} {
		working = want
		for i := 0; i < 3; i++ {
			c.probe()
		}
		if h := c.health["exit"].Direct.Healthy; h == nil || *h != want {
			t.Fatalf("expected exit health %t, got %+v", want, c.health["exit"])
		}
		if len(c.targets["exit"]) != 2 || c.matrix["entry"]["exit"]["direct"].Total != 6 {
			t.Fatal("missing individual probes or aggregate samples")
		}
	}
}
