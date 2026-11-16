package finalmask

import (
	"encoding/json"
	"testing"
)

// noise is a UDP mask the pinned kernel (26.10.31) accepts on the client
// side, so it must survive the share-link whitelist in Marshal.
func TestMarshalKeepsNoiseUDP(t *testing.T) {
	fm := map[string]any{
		"udp": []any{
			map[string]any{"type": "noise", "settings": map[string]any{
				"noise": []any{map[string]any{"type": "str", "packet": "noise"}},
			}},
		},
	}
	raw, ok := Marshal(fm)
	if !ok {
		t.Fatal("noise must survive the link whitelist")
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("fm is not valid JSON: %v (%s)", err, raw)
	}
	arr, _ := out["udp"].([]any)
	if len(arr) != 1 {
		t.Fatalf("expected one udp mask, got %v", out)
	}
	el, _ := arr[0].(map[string]any)
	if el["type"] != "noise" {
		t.Fatalf("udp mask type = %v, want noise", el["type"])
	}
	st, _ := el["settings"].(map[string]any)
	if _, ok := st["noise"]; !ok {
		t.Fatalf("noise settings lost: %v", el)
	}
}

// A mixed noise+udphop list keeps both, with the socket-replacing udphop last.
func TestMarshalKeepsNoiseBeforeUDPHop(t *testing.T) {
	fm := map[string]any{
		"udp": []any{
			map[string]any{"type": "noise", "settings": map[string]any{
				"noise": []any{map[string]any{"type": "str", "packet": "noise"}},
			}},
			map[string]any{"type": "udphop", "settings": map[string]any{
				"interval": 30, "remoteIPs": []any{"1.2.3.4"}, "remotePorts": []any{"27000-27100"},
			}},
		},
	}
	raw, ok := Marshal(fm)
	if !ok {
		t.Fatal("expected fm")
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("fm is not valid JSON: %v", err)
	}
	arr, _ := out["udp"].([]any)
	types := make([]string, 0, len(arr))
	for _, item := range arr {
		el, _ := item.(map[string]any)
		typ, _ := el["type"].(string)
		types = append(types, typ)
	}
	if len(types) != 2 || types[0] != "noise" || types[1] != "udphop" {
		t.Fatalf("udp masks = %v, want [noise udphop]", types)
	}
}
