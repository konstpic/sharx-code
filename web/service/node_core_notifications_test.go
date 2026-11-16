package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func TestNodeCoreAlertLifecycle(t *testing.T) {
	tracker := &nodeCoreAlertTracker{}
	key := nodeCoreAlertKey{1, "Xray"}
	for i, sample := range []struct {
		status          string
		down, recovered bool
	}{
		{"stopped", false, false}, {"error", true, false},
		{"error", false, false}, {"stopped", false, false},
		{"running", false, false}, {"running", false, true},
		{"running", false, false}, {"error", false, false}, {"error", true, false},
	} {
		down, recovered := tracker.observe(key, true, sample.status)
		if down != sample.down || recovered != sample.recovered {
			t.Fatalf("sample %d: got down=%v recovered=%v", i, down, recovered)
		}
	}
}

func TestNodeCoreAlertsIgnoreUnknownAndUnusedCores(t *testing.T) {
	tracker := &nodeCoreAlertTracker{}
	key := nodeCoreAlertKey{1, "Telemt"}
	tracker.observe(key, true, "stopped")
	tracker.observe(key, true, "unknown")
	if down, _ := tracker.observe(key, true, "stopped"); down {
		t.Fatal("unknown status must break the failure streak")
	}
	tracker.observe(key, false, "stopped")
	if len(tracker.states) != 0 {
		t.Fatal("unused core retained an incident")
	}
	if down, recovered := tracker.observe(key, true, "running"); down || recovered {
		t.Fatal("core configuration removal must not create a recovery alert")
	}
}

func TestNodeCoreAlertIsolationAndWorkerOutage(t *testing.T) {
	tracker := &nodeCoreAlertTracker{}
	a, b := nodeCoreAlertKey{1, "Xray"}, nodeCoreAlertKey{2, "Xray"}
	tracker.observe(a, true, "stopped")
	if down, _ := tracker.observe(b, true, "stopped"); down {
		t.Fatal("nodes share a streak")
	}
	tracker.suspendNode(1)
	if down, _ := tracker.observe(a, true, "stopped"); down {
		t.Fatal("worker outage counted as a core observation")
	}
	tracker.observe(a, true, "stopped")
	tracker.observe(a, true, "running")
	tracker.suspendNode(1)
	if _, recovered := tracker.observe(a, true, "running"); recovered {
		t.Fatal("worker outage counted as recovery")
	}
	if _, recovered := tracker.observe(a, true, "running"); !recovered {
		t.Fatal("confirmed recovery missing")
	}
	tracker.resetNode(1)
	if _, ok := tracker.states[a]; ok {
		t.Fatal("removed node retained state")
	}
	if _, ok := tracker.states[b]; !ok {
		t.Fatal("reset affected another node")
	}
}

func TestExpectedNodeCoresAndNotificationDefault(t *testing.T) {
	if defaultValueMap["tgBotNodeCoreNotify"] != "false" {
		t.Fatal("notifications must be opt-in")
	}
	expected := expectedNodeCores([]*model.Inbound{
		nil, {Enable: false, Protocol: model.VLESS},
		{Enable: true, Protocol: model.Telemt}, {Enable: true, Protocol: model.AmneziaWG},
	})
	if expected["Xray"] || !expected["Telemt"] || !expected["AmneziaWG"] {
		t.Fatalf("unexpected cores: %v", expected)
	}
	if !expectedNodeCores([]*model.Inbound{{Enable: true, Protocol: model.VLESS}})["Xray"] {
		t.Fatal("enabled Xray inbound omitted")
	}
}
