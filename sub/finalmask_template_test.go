package sub

import (
	"encoding/json"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func templateService(t *testing.T, raw string) *SubJsonService {
	t.Helper()
	s := &SubJsonService{}
	s.applyTemplates("", "", "", "", raw)
	return s
}

func tcpTypesOf(fm map[string]any) []string {
	var out []string
	arr, _ := fm["tcp"].([]any)
	for _, item := range arr {
		el, ok := item.(map[string]any)
		if !ok {
			continue
		}
		typ, _ := el["type"].(string)
		out = append(out, typ)
	}
	return out
}

// The inbound finalmask wins per side; missing sides are filled from the
// template and quicParams are merged with the inbound keys taking precedence.
func TestApplyFinalmaskDefaultsInboundWins(t *testing.T) {
	s := templateService(t, `{"tcp":[{"type":"sudoku","settings":{"password":"tplpassw"}}],`+
		`"udp":[{"type":"salamander","settings":{"password":"strongpsk"}}],`+
		`"quicParams":{"maxIdleTimeout":60,"keepAlivePeriod":10}}`)
	stream := map[string]any{
		// masque with both ALPN tokens carries both mask sides (transport.go
		// SidesFor), so the merge rules can be observed in one object.
		"network":     "masque",
		"security":    "tls",
		"tlsSettings": map[string]any{"alpn": []any{"h2", "h3"}},
		"finalmask": map[string]any{
			"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{
				"packets": "tlshello", "lengths": []any{"100-200"}, "delays": []any{"1-2"},
			}}},
			"quicParams": map[string]any{"maxIdleTimeout": 30},
		},
	}
	inbound := &model.Inbound{Id: 1, Tag: "vless-tcp", Protocol: model.VLESS}

	s.applyFinalmaskDefaults(stream, inbound)

	fm, ok := stream["finalmask"].(map[string]any)
	if !ok {
		t.Fatalf("finalmask missing: %v", stream)
	}
	if got := tcpTypesOf(fm); len(got) != 1 || got[0] != "fragment" {
		t.Fatalf("inbound tcp[] must win, got %v", got)
	}
	if got := udpTypesOf(fm); len(got) != 1 || got[0] != "salamander" {
		t.Fatalf("template udp[] must fill the empty side, got %v", got)
	}
	qp, _ := fm["quicParams"].(map[string]any)
	if qp["maxIdleTimeout"] != float64(30) {
		t.Fatalf("inbound quicParams key must win, got %v", qp)
	}
	if qp["keepAlivePeriod"] != float64(10) {
		t.Fatalf("template quicParams must be merged in, got %v", qp)
	}
}

// An empty/absent slot keeps the outgoing stream byte-for-byte identical.
func TestApplyFinalmaskDefaultsEmptySlotIsNoOp(t *testing.T) {
	stream := map[string]any{
		"network":  "tcp",
		"security": "tls",
		"finalmask": map[string]any{
			"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{"lengths": []any{"10-20"}}}},
		},
	}
	before, _ := json.Marshal(stream)
	for _, slot := range []string{"", "  ", "{}", `{"udp":[]}`} {
		s := templateService(t, slot)
		s.applyFinalmaskDefaults(stream, &model.Inbound{Protocol: model.VLESS})
		after, _ := json.Marshal(stream)
		if string(before) != string(after) {
			t.Fatalf("slot %q must not change the stream:\nbefore %s\nafter  %s", slot, before, after)
		}
	}
}

// The template side that the inbound transport cannot carry is dropped instead
// of failing the whole subscription.
func TestApplyFinalmaskDefaultsDropsIncompatibleSide(t *testing.T) {
	s := templateService(t, `{"tcp":[{"type":"fragment","settings":{"lengths":["10-20"]}}],`+
		`"udp":[{"type":"salamander","settings":{"password":"strongpsk"}}]}`)
	stream := map[string]any{"network": "hysteria", "security": "tls"}
	inbound := &model.Inbound{Id: 5, Tag: "hy2", Protocol: model.Hysteria2}

	s.applyFinalmaskDefaults(stream, inbound)

	fm, ok := stream["finalmask"].(map[string]any)
	if !ok {
		t.Fatalf("finalmask missing: %v", stream)
	}
	if got := tcpTypesOf(fm); len(got) != 0 {
		t.Fatalf("tcp masks are not carried by hysteria2 and must be dropped, got %v", got)
	}
	if got := udpTypesOf(fm); len(got) != 1 || got[0] != "salamander" {
		t.Fatalf("udp mask must stay on hysteria2, got %v", got)
	}
}

// Client-only masks stay in the JSON subscription (it is a client config):
// ServerView must not be applied here.
func TestApplyFinalmaskDefaultsKeepsClientOnlyMasks(t *testing.T) {
	s := templateService(t, `{"udp":[{"type":"salamander","settings":{"password":"strongpsk"}},`+
		`{"type":"udphop","settings":{"mode":"intervalremote","interval":30,`+
		`"remoteIPs":["1.2.3.4"],"remotePorts":["443"]}}]}`)
	stream := map[string]any{"network": "kcp"}
	s.applyFinalmaskDefaults(stream, &model.Inbound{Protocol: model.VLESS})

	fm, _ := stream["finalmask"].(map[string]any)
	if got := udpTypesOf(fm); len(got) != 2 || got[1] != "udphop" {
		t.Fatalf("udphop must stay in the client subscription, got %v", got)
	}
}

// Protocols outside the finalmask-capable set keep their stream settings
// untouched even when the slot is configured.
func TestApplyFinalmaskDefaultsSkipsNonMaskProtocols(t *testing.T) {
	s := templateService(t, `{"tcp":[{"type":"fragment","settings":{"lengths":["10-20"]}}]}`)
	stream := map[string]any{"network": "tcp"}
	s.applyFinalmaskDefaults(stream, &model.Inbound{Protocol: model.Mixed})
	if _, has := stream["finalmask"]; has {
		t.Fatalf("mixed/socks outbound must not receive the template: %v", stream)
	}
}

// Hysteria (v1/v2) outbounds must carry the masks in the JSON subscription:
// genHy keeps streamSettings.finalmask on the stream root.
func TestGenHyKeepsFinalmaskInJSONSubscription(t *testing.T) {
	s := templateService(t, `{"udp":[{"type":"salamander","settings":{"password":"strongpsk"}}]}`)
	stream := map[string]any{"network": "hysteria", "security": "tls", "tlsSettings": map[string]any{}}
	inbound := &model.Inbound{Id: 6, Tag: "hy2", Protocol: model.Hysteria2, Settings: `{"version":2}`, Port: 443, Listen: "example.com"}
	inbound.StreamSettings = `{"network":"hysteria","security":"tls"}`

	s.applyFinalmaskDefaults(stream, inbound)
	out := s.genHy(inbound, stream, model.Client{Email: "c@example.com", Password: "pass", Auth: "auth"})
	if len(out) == 0 {
		t.Fatal("genHy returned nothing")
	}
	var parsed struct {
		StreamSettings map[string]any `json:"streamSettings"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("outbound is not JSON: %v", err)
	}
	fm, ok := parsed.StreamSettings["finalmask"].(map[string]any)
	if !ok {
		t.Fatalf("hysteria outbound must carry finalmask: %s", out)
	}
	if got := udpTypesOf(fm); len(got) != 1 || got[0] != "salamander" {
		t.Fatalf("unexpected udp masks: %v", got)
	}
}

// Regression: the reference subscription (/sub/{id}) is built by the share-link
// builders, which never consult the JSON templates. The link `fm=` parameter
// therefore carries the inbound masks only.
func TestLinkSubscriptionIgnoresFinalMaskDefaults(t *testing.T) {
	_ = templateService(t, `{"udp":[{"type":"salamander","settings":{"password":"strongpsk"}}]}`)
	stream := map[string]any{
		"network": "tcp",
		"finalmask": map[string]any{
			"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{"lengths": []any{"10-20"}}}},
		},
	}
	params := map[string]string{"type": "tcp"}
	applyFinalMaskParams(stream, model.VLESS, params)
	fm := decodeFM(t, params["fm"])
	if got := tcpTypesOf(fm); len(got) != 1 || got[0] != "fragment" {
		t.Fatalf("link fm must mirror the inbound tcp mask, got %v", got)
	}
	if _, has := fm["udp"]; has {
		t.Fatalf("the JSON template must not leak into the reference link: %v", fm)
	}
}
