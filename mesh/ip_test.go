package mesh

import (
	"github.com/konstpic/sharx-code/v2/mesh/protocol"
	"testing"
)

func TestIPChangeNeedsThreeDistinctFreshReports(t *testing.T) {
	c := &Controller{ipCount: map[string]int{}, ipSeen: map[string]string{}, ipTS: map[string]int64{}}
	report := func(ts int64, ip string) bool {
		return c.observeIP("n2", "77.91.72.1", protocol.Observation{TS: ts, IP: ip}, 1000)
	}
	if report(990, "77.91.72.153") {
		t.Fatal("single observation accepted")
	}
	for i := 0; i < 5; i++ {
		if report(990, "77.91.72.153") {
			t.Fatal("same leased report counted twice")
		}
	}
	if report(995, "77.91.72.153") || !report(1000, "77.91.72.153") {
		t.Fatal("three distinct reports not counted")
	}
	if report(1001, "172.30.203.14") || c.ipCount["n2"] != 0 {
		t.Fatal("private IP accepted")
	}
	if report(1001, "77.91.72.152") {
		t.Fatal("new candidate inherited prior count")
	}
	if report(900, "77.91.72.152") {
		t.Fatal("stale report accepted")
	}
}
