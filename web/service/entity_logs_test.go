package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/logger"
)

func TestEntityLogsNodeFilter(t *testing.T) {
	logger.SetMinEmitLevel("debug")
	logger.Emit(logger.Entry{Level: "info", Source: "node", Msg: "[Node: A] awg handshake ok", NodeID: "7", EntityType: "node", EntityID: "7", Component: "amneziawg"})
	logger.Emit(logger.Entry{Level: "warn", Source: "node", Msg: "[Node: A] telemt exited code 1", NodeID: "7", EntityType: "node", EntityID: "7", Component: "telemt"})
	logger.Emit(logger.Entry{Level: "info", Source: "node", Msg: "[Node: A] legacy entry", NodeID: "7", Component: "node"}) // pushed before entity tags existed
	logger.Emit(logger.Entry{Level: "error", Source: "node", Msg: "[Node: B] other node", NodeID: "8", EntityType: "node", EntityID: "8", Component: "telemt"})
	logger.Emit(logger.Entry{Level: "info", Msg: "balancer 7 apply", EntityType: "balancer", EntityID: "7", Component: "config"}) // same id, other type

	s := &ServerService{}
	res := s.GetEntityLogs("node", "7", EntityLogQuery{Level: "debug"})
	if len(res.Entries) != 3 {
		t.Fatalf("node 7 should see exactly its 3 entries, got %d: %+v", len(res.Entries), res.Entries)
	}
	for _, e := range res.Entries {
		if e.Component == "config" || e.Message == "[Node: B] other node" {
			t.Fatalf("foreign entry leaked: %+v", e)
		}
	}
	if len(res.Components) != 3 { // amneziawg, telemt, node
		t.Fatalf("components: %v", res.Components)
	}

	res = s.GetEntityLogs("node", "7", EntityLogQuery{Level: "debug", Component: "telemt"})
	if len(res.Entries) != 1 || res.Entries[0].Level != "warn" {
		t.Fatalf("component filter: %+v", res.Entries)
	}
	if len(res.Components) != 3 {
		t.Fatalf("component list must not shrink when a component is selected: %v", res.Components)
	}
	res = s.GetEntityLogs("node", "7", EntityLogQuery{Level: "warn"})
	if len(res.Entries) != 1 {
		t.Fatalf("level filter: %+v", res.Entries)
	}
	res = s.GetEntityLogs("node", "7", EntityLogQuery{Level: "debug", Q: "HANDSHAKE"})
	if len(res.Entries) != 1 || res.Entries[0].Component != "amneziawg" {
		t.Fatalf("substring filter: %+v", res.Entries)
	}
}

func TestPanelJournalExcludesNodeAndXray(t *testing.T) {
	logger.SetMinEmitLevel("debug")
	logger.Emit(logger.Entry{Level: "info", Source: "panel", Msg: "inbound created: id=5", Component: "inbound"})
	logger.Emit(logger.Entry{Level: "info", Source: "node", Msg: "[Node: A] panelonly-test node line", NodeID: "7", EntityType: "node", EntityID: "7"})
	logger.Emit(logger.Entry{Level: "info", Source: "xray", Msg: "panelonly-test xray line", Component: "xray"})
	res := (&ServerService{}).GetEntityLogs("panel", "0", EntityLogQuery{Level: "debug", Q: "inbound created panelonly-test"})
	if len(res.Entries) != 0 { // both terms must be present: nothing matches
		t.Fatalf("AND semantics: %+v", res.Entries)
	}
	res = (&ServerService{}).GetEntityLogs("panel", "0", EntityLogQuery{Level: "debug", Q: "inbound created"})
	if len(res.Entries) == 0 || res.Entries[0].Component != "inbound" {
		t.Fatalf("panel action missing: %+v", res.Entries)
	}
	res = (&ServerService{}).GetEntityLogs("panel", "0", EntityLogQuery{Level: "debug", Q: "panelonly-test"})
	if len(res.Entries) != 0 {
		t.Fatalf("node/xray output leaked into the panel journal: %+v", res.Entries)
	}
}

func TestLogQueryLevelsTermsAndVolume(t *testing.T) {
	logger.SetMinEmitLevel("debug")
	for i, lv := range []string{"debug", "info", "warn", "error", "error"} {
		logger.Emit(logger.Entry{Level: lv, Source: "node", Msg: "vol-test alpha beta", NodeID: "91", EntityType: "node", EntityID: "91", TsUnixMs: 1_000_000 + int64(i)*60_000})
	}
	s := &ServerService{}
	res := s.GetEntityLogs("node", "91", EntityLogQuery{Levels: []string{"error", "warn"}})
	if len(res.Entries) != 3 {
		t.Fatalf("exact level set: %d", len(res.Entries))
	}
	if res = s.GetEntityLogs("node", "91", EntityLogQuery{Level: "debug", Q: "alpha -beta"}); len(res.Entries) != 0 {
		t.Fatalf("-term must exclude: %d", len(res.Entries))
	}
	res = s.GetEntityLogs("node", "91", EntityLogQuery{Level: "debug", Count: 2})
	if res.Total != 5 || len(res.Entries) != 2 {
		t.Fatalf("total=%d returned=%d", res.Total, len(res.Entries))
	}
	var sum int
	for _, b := range res.Volume {
		sum += b.Debug + b.Info + b.Warn + b.Error
	}
	if sum != 5 {
		t.Fatalf("volume must count all matches, not the returned page: %d", sum)
	}
}
