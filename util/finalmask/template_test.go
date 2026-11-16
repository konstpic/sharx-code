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

// The slot only fills client-transparent masks: fragment (TCP segmentation) and
// udphop (client-only). Payload-transforming types need the same mask on the
// server, which a slot applied to an inbound without masks cannot guarantee.
func TestTemplateSlotViewTransparentTypesOnly(t *testing.T) {
	tpl := map[string]any{
		"tcp": []any{
			map[string]any{"type": "fragment", "settings": map[string]any{"lengths": []any{"10-20"}}},
			map[string]any{"type": "sudoku", "settings": map[string]any{"password": "slotpassw"}},
			map[string]any{"type": "header-custom", "settings": map[string]any{}},
		},
		"udp": []any{
			map[string]any{"type": "udphop", "settings": map[string]any{
				"mode": "intervalremote", "interval": 30,
				"remoteIPs": []any{"1.2.3.4"}, "remotePorts": []any{"443"},
			}},
			map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}},
		},
	}
	view, dropped := TemplateSlotView(tpl, map[string]any{"network": "tcp"})
	if got := typeOfFirst(t, view, "tcp"); got != "fragment" {
		t.Fatalf("only fragment may survive on tcp, got %q", got)
	}
	if got := typeOfFirst(t, view, "udp"); got != "udphop" {
		t.Fatalf("only udphop may survive on udp, got %q", got)
	}
	want := []string{"sudoku", "header-custom", "salamander"}
	if !reflect.DeepEqual(dropped, want) {
		t.Fatalf("dropped = %v, want %v", dropped, want)
	}
	// The slot object itself must not be mutated.
	if got := typeOfFirst(t, tpl, "tcp"); got != "fragment" {
		t.Fatalf("template mutated: %s", mustJSON(t, tpl))
	}
}

func TestTemplateSlotViewQuicParamsOnlyOnQUICPath(t *testing.T) {
	tpl := map[string]any{"quicParams": map[string]any{"maxIdleTimeout": 30, "congestion": "bbr"}}

	// xhttp + ALPN ["h3"] is the QUIC path: quicParams tune the local QUIC
	// stack there (probe: client quicParams against a server without them
	// served traffic normally), so they are applied.
	h3 := map[string]any{"network": "xhttp", "security": "tls", "tlsSettings": map[string]any{"alpn": []any{"h3"}}}
	view, dropped := TemplateSlotView(tpl, h3)
	if _, ok := view["quicParams"]; !ok || len(dropped) != 0 {
		t.Fatalf("quicParams must be applied on the xhttp h3 path: %v dropped=%v", view, dropped)
	}
	if !StreamUsesQUIC(h3) {
		t.Fatal("StreamUsesQUIC must report the h3 path")
	}

	// Everywhere else the QUIC knobs are symmetric connection settings the
	// operator must set on the inbound; the slot must not ship them.
	for name, stream := range map[string]map[string]any{
		"hysteria2": {"network": "hysteria", "security": "tls"},
		"xhttp h2":  {"network": "xhttp", "security": "tls", "tlsSettings": map[string]any{"alpn": []any{"h3", "h2"}}},
		"tcp":       {"network": "tcp"},
	} {
		view, dropped = TemplateSlotView(tpl, stream)
		if view != nil {
			t.Fatalf("%s: quicParams must not be applied from the slot: %v", name, view)
		}
		if !reflect.DeepEqual(dropped, []string{"quicParams"}) {
			t.Fatalf("%s: dropped = %v", name, dropped)
		}
	}
}

func TestSlotUnappliedTypes(t *testing.T) {
	fm := map[string]any{
		"tcp": []any{
			map[string]any{"type": "fragment"},
			map[string]any{"type": "xmc", "settings": map[string]any{}},
		},
		"udp": []any{
			map[string]any{"type": "udphop", "settings": map[string]any{}},
			map[string]any{"type": "salamander", "settings": map[string]any{}},
			map[string]any{"type": "Salamander", "settings": map[string]any{}},
		},
	}
	got := SlotUnappliedTypes(fm)
	if !reflect.DeepEqual(got, []string{"xmc", "salamander"}) {
		t.Fatalf("unapplied = %v, want [xmc salamander]", got)
	}
	if types := SlotUnappliedTypes(nil); types != nil {
		t.Fatalf("nil slot = %v", types)
	}
}

// The merge result is normalized for the client side: legacy fragment ranges
// (length/delay) are expanded and an element-level legacy password is lifted
// into settings.password, which keeps the emitted subscription canonical even
// for rows that bypassed the save-time normalization.
func TestSlotMergeResultIsNormalized(t *testing.T) {
	own := map[string]any{
		"udp": []any{map[string]any{"type": "salamander", "password": "legacy-pass"}},
	}
	tpl := map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{"lengths": []any{"100-200"}, "delays": []any{"1-2"}}}},
	}
	view, dropped := TemplateSlotView(tpl, map[string]any{"network": "masque",
		"security": "tls", "tlsSettings": map[string]any{"alpn": []any{"h2", "h3"}}})
	if len(dropped) != 0 {
		t.Fatalf("fragment must survive the slot policy, dropped=%v", dropped)
	}
	merged := NormalizeFinalmask(MergeTemplate(own, view), false)
	if merged == nil {
		t.Fatal("expected a merged finalmask")
	}

	tcp, _ := merged["tcp"].([]any)
	if len(tcp) != 1 {
		t.Fatalf("tcp masks = %v", merged["tcp"])
	}
	settings, _ := tcp[0].(map[string]any)["settings"].(map[string]any)
	// Normalization mirrors the last range into the legacy single-value fields
	// the kernel still reads (withLegacyFragmentRanges behaviour).
	if settings["length"] != "100-200" || settings["delay"] != "1-2" {
		t.Fatalf("legacy fragment range fields must be filled: %v", settings)
	}

	udp, _ := merged["udp"].([]any)
	if len(udp) != 1 {
		t.Fatalf("udp masks = %v", merged["udp"])
	}
	el, _ := udp[0].(map[string]any)
	elSettings, _ := el["settings"].(map[string]any)
	if elSettings["password"] != "legacy-pass" {
		t.Fatalf("element-level password must be lifted into settings.password: %v", el)
	}
	if _, has := el["password"]; has {
		t.Fatalf("legacy element password must be removed: %v", el)
	}

	// Idempotent for an already normalized object.
	again := NormalizeFinalmask(merged, false)
	if !reflect.DeepEqual(merged, again) {
		t.Fatalf("normalization must be idempotent:\n1 %s\n2 %s", mustJSON(t, merged), mustJSON(t, again))
	}
}
