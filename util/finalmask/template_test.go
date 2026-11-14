package finalmask

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

// The inbound finalmask wins per side: a non-empty inbound tcp[] keeps the
// template tcp[] out, while an empty side is filled from the template.
func TestMergeTemplateInboundWins(t *testing.T) {
	inbound := map[string]any{
		"tcp":        []any{map[string]any{"type": "fragment", "settings": map[string]any{"lengths": []any{"10-20"}}}},
		"quicParams": map[string]any{"maxIdleTimeout": 30, "congestion": "bbr"},
	}
	template := map[string]any{
		"tcp": []any{map[string]any{"type": "sudoku", "settings": map[string]any{"password": "tplpassw"}}},
		"udp": []any{map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}}},
		"quicParams": map[string]any{
			"maxIdleTimeout": 60, "keepAlivePeriod": 10,
		},
	}

	merged := MergeTemplate(inbound, template)
	if merged == nil {
		t.Fatal("expected a merged finalmask")
	}
	if got := typeOfFirst(t, merged, "tcp"); got != "fragment" {
		t.Fatalf("inbound tcp[] must win, got %q", got)
	}
	if got := typeOfFirst(t, merged, "udp"); got != "salamander" {
		t.Fatalf("empty inbound udp[] must be filled from the template, got %q", got)
	}
	qp, _ := merged["quicParams"].(map[string]any)
	if qp["maxIdleTimeout"] != float64(30) {
		t.Fatalf("inbound quicParams key must win, got %v", qp["maxIdleTimeout"])
	}
	if qp["keepAlivePeriod"] != float64(10) {
		t.Fatalf("template quicParams keys must be merged in, got %v", qp)
	}

	// Inputs are not mutated.
	if got := typeOfFirst(t, inbound, "tcp"); got != "fragment" {
		t.Fatalf("inbound mutated: %v", inbound)
	}
	if _, has := inbound["udp"]; has {
		t.Fatalf("inbound mutated with a template side: %v", inbound)
	}
	if got := typeOfFirst(t, template, "tcp"); got != "sudoku" {
		t.Fatalf("template mutated: %v", template)
	}
	if tplQP, _ := template["quicParams"].(map[string]any); tplQP["maxIdleTimeout"] != 60 {
		t.Fatalf("template quicParams mutated: %v", template["quicParams"])
	}
}

func typeOfFirst(t *testing.T, fm map[string]any, side string) string {
	t.Helper()
	arr, _ := fm[side].([]any)
	if len(arr) == 0 {
		t.Fatalf("side %q is empty in %s", side, mustJSON(t, fm))
	}
	el, _ := arr[0].(map[string]any)
	typ, _ := el["type"].(string)
	return typ
}

// An empty slot is a no-op: the inbound finalmask comes back unchanged.
func TestMergeTemplateEmptySlotIsNoOp(t *testing.T) {
	inbound := tcpFragmentFM()
	for _, template := range []map[string]any{
		nil,
		{},
		{"tcp": []any{}},
		{"udp": []any{}, "quicParams": map[string]any{}},
	} {
		got := MergeTemplate(inbound, template)
		if !reflect.DeepEqual(got, inbound) {
			t.Fatalf("empty template must not change the inbound: got %s", mustJSON(t, got))
		}
	}
}

// A subscription template fills a finalmask for an inbound that has none.
func TestMergeTemplateFillsFromScratch(t *testing.T) {
	merged := MergeTemplate(nil, udpSalamanderFM())
	if merged == nil {
		t.Fatal("expected the template masks")
	}
	if got := typeOfFirst(t, merged, "udp"); got != "salamander" {
		t.Fatalf("udp mask missing: %s", mustJSON(t, merged))
	}
}

// WithoutForbiddenSides drops only the sides the transport cannot carry; the
// rest of the object (including client-side udphop) is preserved.
func TestWithoutForbiddenSides(t *testing.T) {
	stream := map[string]any{"network": "kcp"}
	fm := map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{"lengths": []any{"10-20"}}}},
		"udp": []any{map[string]any{"type": "udphop", "settings": map[string]any{
			"mode": "intervalremote", "interval": 30,
			"remoteIPs": []any{"1.2.3.4"}, "remotePorts": []any{"443"},
		}}},
	}
	filtered, dropped := WithoutForbiddenSides("vless", stream, fm)
	if len(dropped) != 1 || dropped[0] != "tcp" {
		t.Fatalf("dropped = %v, want [tcp]", dropped)
	}
	if _, has := filtered["tcp"]; has {
		t.Fatalf("tcp side must be dropped: %s", mustJSON(t, filtered))
	}
	if got := typeOfFirst(t, filtered, "udp"); got != "udphop" {
		t.Fatalf("client-only udphop must stay in the client subscription, got %q", got)
	}
	if _, has := fm["tcp"]; !has {
		t.Fatal("input must not be mutated")
	}
}

func TestWithoutForbiddenSidesRemovedTransportDropsBoth(t *testing.T) {
	fm := tcpFragmentFM()
	fm["udp"] = udpSalamanderFM()["udp"]
	filtered, dropped := WithoutForbiddenSides("vless", map[string]any{"network": "quic"}, fm)
	if filtered != nil {
		t.Fatalf("removed transport must drop the whole mask set, got %s", mustJSON(t, filtered))
	}
	if !reflect.DeepEqual(dropped, []string{"tcp", "udp"}) {
		t.Fatalf("dropped = %v", dropped)
	}
}

func TestWithoutForbiddenSidesCompatibleKeepsEverything(t *testing.T) {
	fm := tcpFragmentFM()
	filtered, dropped := WithoutForbiddenSides("vless", map[string]any{"network": "tcp"}, fm)
	if len(dropped) != 0 {
		t.Fatalf("nothing must be dropped, got %v", dropped)
	}
	if !reflect.DeepEqual(filtered, fm) {
		t.Fatalf("compatible mask must be returned unchanged: %s", mustJSON(t, filtered))
	}
}

func TestParseObject(t *testing.T) {
	fm, err := ParseObject(" ")
	if err != nil || fm != nil {
		t.Fatalf("empty slot = (%v, %v), want (nil, nil)", fm, err)
	}
	fm, err = ParseObject(`{"tcp":[{"type":"fragment","settings":{"lengths":["10-20"]}}]}`)
	if err != nil || !HasContent(fm) {
		t.Fatalf("valid object: (%v, %v)", fm, err)
	}
	if _, err := ParseObject(`{"tcp":`); err == nil {
		t.Fatal("broken JSON must be rejected")
	}
	if _, err := ParseObject(`[{"type":"fragment"}]`); err == nil ||
		!strings.Contains(err.Error(), "JSON object") {
		t.Fatalf("non-object JSON must be rejected, got %v", err)
	}
}
