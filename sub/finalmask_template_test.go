package sub

import (
	"encoding/json"
	"fmt"
	"strings"
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

func noteContains(notes []string, want string) bool {
	for _, n := range notes {
		if strings.Contains(n, want) {
			return true
		}
	}
	return false
}

// The inbound finalmask wins per side; a missing side is filled from the slot
// (client-transparent masks only). masque with both ALPN tokens carries both
// mask sides (transport.go SidesFor), so both rules fit one object.
func TestApplyFinalmaskDefaultsInboundWins(t *testing.T) {
	s := templateService(t, `{"tcp":[{"type":"fragment","settings":{"lengths":["300-400"]}}],`+
		`"udp":[{"type":"udphop","settings":{"mode":"intervalremote","interval":30,`+
		`"remoteIPs":["1.2.3.4"],"remotePorts":["443"]}}]}`)
	own := map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{
			"packets": "tlshello", "lengths": []any{"100-200"}, "delays": []any{"1-2"},
		}}},
	}
	stream := map[string]any{
		"network":     "masque",
		"security":    "tls",
		"tlsSettings": map[string]any{"alpn": []any{"h2", "h3"}},
		"finalmask":   own,
	}
	inbound := &model.Inbound{Id: 1, Tag: "vless-masque", Protocol: model.VLESS}

	notes := s.applyFinalmaskDefaults(stream, inbound, own)
	if len(notes) != 0 {
		t.Fatalf("unexpected warnings: %v", notes)
	}
	fm, ok := stream["finalmask"].(map[string]any)
	if !ok {
		t.Fatalf("finalmask missing: %v", stream)
	}
	if got := tcpTypesOf(fm); len(got) != 1 || got[0] != "fragment" {
		t.Fatalf("inbound tcp[] must win, got %v", got)
	}
	tcp, _ := fm["tcp"].([]any)
	settings, _ := tcp[0].(map[string]any)["settings"].(map[string]any)
	if settings["lengths"].([]any)[0] != "100-200" {
		t.Fatalf("inbound tcp settings must be kept verbatim, got %v", settings)
	}
	if got := udpTypesOf(fm); len(got) != 1 || got[0] != "udphop" {
		t.Fatalf("empty udp side must be filled with udphop from the slot, got %v", got)
	}
}

// quicParams are applied from the slot only on the xhttp h3 QUIC path, and the
// inbound keys win in the deep merge.
func TestApplyFinalmaskDefaultsQuicParamsOnH3(t *testing.T) {
	s := templateService(t, `{"quicParams":{"maxIdleTimeout":60,"keepAlivePeriod":10}}`)
	own := map[string]any{"quicParams": map[string]any{"maxIdleTimeout": 30}}
	stream := map[string]any{
		"network":     "xhttp",
		"security":    "tls",
		"tlsSettings": map[string]any{"alpn": []any{"h3"}},
		"finalmask":   own,
	}
	notes := s.applyFinalmaskDefaults(stream, &model.Inbound{Id: 2, Tag: "h3", Protocol: model.VLESS}, own)
	if len(notes) != 0 {
		t.Fatalf("unexpected warnings: %v", notes)
	}
	fm, _ := stream["finalmask"].(map[string]any)
	qp, _ := fm["quicParams"].(map[string]any)
	if fmt.Sprint(qp["maxIdleTimeout"]) != "30" {
		t.Fatalf("inbound quicParams key must win, got %v", qp)
	}
	if fmt.Sprint(qp["keepAlivePeriod"]) != "10" {
		t.Fatalf("slot quicParams must be merged in on the h3 path, got %v", qp)
	}
}

// On a non-QUIC transport quicParams from the slot are dropped and reported.
func TestApplyFinalmaskDefaultsQuicParamsDroppedOffQUIC(t *testing.T) {
	s := templateService(t, `{"quicParams":{"maxIdleTimeout":60}}`)
	stream := map[string]any{"network": "hysteria", "security": "tls"}
	notes := s.applyFinalmaskDefaults(stream, &model.Inbound{Id: 3, Tag: "hy2", Protocol: model.Hysteria2}, nil)
	if _, has := stream["finalmask"]; has {
		t.Fatalf("quicParams must not be applied from the slot off the QUIC path: %v", stream)
	}
	if !noteContains(notes, "quicParams") {
		t.Fatalf("the dropped quicParams must be reported, got %v", notes)
	}
}

// An empty/absent slot keeps the outgoing stream byte-for-byte identical.
func TestApplyFinalmaskDefaultsEmptySlotIsNoOp(t *testing.T) {
	own := map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{"lengths": []any{"10-20"}}}},
	}
	stream := map[string]any{"network": "tcp", "security": "tls", "finalmask": own}
	before, _ := json.Marshal(stream)
	for _, slot := range []string{"", "  ", "{}", `{"udp":[]}`} {
		s := templateService(t, slot)
		if notes := s.applyFinalmaskDefaults(stream, &model.Inbound{Protocol: model.VLESS}, own); len(notes) != 0 {
			t.Fatalf("slot %q must not warn: %v", slot, notes)
		}
		after, _ := json.Marshal(stream)
		if string(before) != string(after) {
			t.Fatalf("slot %q must not change the stream:\nbefore %s\nafter  %s", slot, before, after)
		}
	}
}

// The side the effective transport cannot carry is dropped instead of failing
// the whole subscription (hysteria2 is UDP-only).
func TestApplyFinalmaskDefaultsDropsIncompatibleSide(t *testing.T) {
	s := templateService(t, `{"tcp":[{"type":"fragment","settings":{"lengths":["10-20"]}}],`+
		`"udp":[{"type":"udphop","settings":{"mode":"intervalremote","interval":30,`+
		`"remoteIPs":["1.2.3.4"],"remotePorts":["443"]}}]}`)
	stream := map[string]any{"network": "hysteria", "security": "tls"}
	notes := s.applyFinalmaskDefaults(stream, &model.Inbound{Id: 5, Tag: "hy2", Protocol: model.Hysteria2}, nil)

	fm, ok := stream["finalmask"].(map[string]any)
	if !ok {
		t.Fatalf("finalmask missing: %v", stream)
	}
	if got := tcpTypesOf(fm); len(got) != 0 {
		t.Fatalf("tcp masks are not carried by hysteria2 and must be dropped, got %v", got)
	}
	if got := udpTypesOf(fm); len(got) != 1 || got[0] != "udphop" {
		t.Fatalf("udp mask must stay on hysteria2, got %v", got)
	}
	if !noteContains(notes, `"hysteria"`) {
		t.Fatalf("the dropped side must name the transport, got %v", notes)
	}
}

// Payload-transforming masks are never applied from the slot: the slot is used
// exactly when the inbound has no server-side mask, so such a mask would make
// the subscription silently dead (probe: kcp server without masks + client
// salamander accepts the connection, then times out).
func TestApplyFinalmaskDefaultsDropsPayloadTransformingTypes(t *testing.T) {
	s := templateService(t, `{"tcp":[{"type":"fragment","settings":{"lengths":["10-20"]}}],`+
		`"udp":[{"type":"salamander","settings":{"password":"strongpsk"}},`+
		`{"type":"sudoku","settings":{"password":"otherpass"}}]}`)
	stream := map[string]any{"network": "hysteria", "security": "tls"}
	notes := s.applyFinalmaskDefaults(stream, &model.Inbound{Id: 6, Tag: "hy2", Protocol: model.Hysteria2}, nil)

	// fragment is transparent but the hysteria2 transport has no TCP side.
	if _, has := stream["finalmask"]; has {
		t.Fatalf("no mask may be applied here, got %v", stream["finalmask"])
	}
	for _, want := range []string{"salamander", "sudoku"} {
		if !noteContains(notes, want) {
			t.Fatalf("dropped type %q must be reported, got %v", want, notes)
		}
	}
}

// udphop is client-only and transparent for the peer: it stays in the client
// JSON subscription (ServerView must not be applied here).
func TestApplyFinalmaskDefaultsKeepsClientOnlyMasks(t *testing.T) {
	s := templateService(t, `{"udp":[{"type":"udphop","settings":{"mode":"intervalremote","interval":30,`+
		`"remoteIPs":["1.2.3.4"],"remotePorts":["443"]}}]}`)
	stream := map[string]any{"network": "kcp"}
	notes := s.applyFinalmaskDefaults(stream, &model.Inbound{Id: 7, Tag: "kcp", Protocol: model.VLESS}, nil)
	if len(notes) != 0 {
		t.Fatalf("unexpected warnings: %v", notes)
	}
	fm, ok := stream["finalmask"].(map[string]any)
	if !ok {
		t.Fatalf("udphop must be applied: %v", stream)
	}
	if got := udpTypesOf(fm); len(got) != 1 || got[0] != "udphop" {
		t.Fatalf("udphop must stay in the client subscription, got %v", got)
	}
}

// Protocols outside the finalmask-capable set keep their stream settings
// untouched even when the slot is configured.
func TestApplyFinalmaskDefaultsSkipsNonMaskProtocols(t *testing.T) {
	s := templateService(t, `{"tcp":[{"type":"fragment","settings":{"lengths":["10-20"]}}]}`)
	stream := map[string]any{"network": "tcp"}
	s.applyFinalmaskDefaults(stream, &model.Inbound{Protocol: model.Mixed}, nil)
	if _, has := stream["finalmask"]; has {
		t.Fatalf("mixed/socks outbound must not receive the template: %v", stream)
	}
}

// The emitted object is normalized even when it came from legacy shapes: an
// element-level password is lifted into settings.password.
func TestApplyFinalmaskDefaultsNormalizesLegacyShapes(t *testing.T) {
	s := templateService(t, `{"tcp":[{"type":"fragment","settings":{"lengths":["10-20"],"delays":["1-2"]}}]}`)
	own := map[string]any{
		"udp": []any{map[string]any{"type": "salamander", "password": "legacy-pass"}},
	}
	stream := map[string]any{"network": "masque", "security": "tls",
		"tlsSettings": map[string]any{"alpn": []any{"h2", "h3"}}, "finalmask": own}
	s.applyFinalmaskDefaults(stream, &model.Inbound{Id: 8, Tag: "legacy", Protocol: model.VLESS}, own)

	fm, ok := stream["finalmask"].(map[string]any)
	if !ok {
		t.Fatalf("finalmask missing: %v", stream)
	}
	udp, _ := fm["udp"].([]any)
	if len(udp) != 1 {
		t.Fatalf("udp masks = %v", fm["udp"])
	}
	el, _ := udp[0].(map[string]any)
	settings, _ := el["settings"].(map[string]any)
	if settings["password"] != "legacy-pass" {
		t.Fatalf("legacy element password must be normalized into settings.password: %v", el)
	}
}

// The transport gate runs against the effective stream of each outbound, i.e.
// after forceTls: with forceTls "none" the xhttp+h3 inbound leaves the QUIC
// path, so its TCP side becomes legal again.
func TestApplyFinalmaskDefaultsRecheckAfterForceTls(t *testing.T) {
	s := templateService(t, `{"tcp":[{"type":"fragment","settings":{"lengths":["10-20"]}}]}`)
	inbound := &model.Inbound{Id: 9, Tag: "xhttp", Protocol: model.VLESS}

	h3Stream := map[string]any{"network": "xhttp", "security": "tls",
		"tlsSettings": map[string]any{"alpn": []any{"h3"}}}
	notes := s.applyFinalmaskDefaults(h3Stream, inbound, nil)
	if _, has := h3Stream["finalmask"]; has {
		t.Fatalf("tcp masks must not be applied on the QUIC path: %v", h3Stream)
	}
	if !noteContains(notes, "tcp") {
		t.Fatalf("the dropped tcp side must be reported, got %v", notes)
	}

	// forceTls "none" drops tlsSettings -> no ALPN -> xhttp stays on TCP.
	plainStream := map[string]any{"network": "xhttp", "security": "none"}
	if notes := s.applyFinalmaskDefaults(plainStream, inbound, nil); len(notes) != 0 {
		t.Fatalf("unexpected warnings after forceTls none: %v", notes)
	}
	fm, ok := plainStream["finalmask"].(map[string]any)
	if !ok {
		t.Fatalf("tcp fragment must survive on the forced-plain stream: %v", plainStream)
	}
	if got := tcpTypesOf(fm); len(got) != 1 || got[0] != "fragment" {
		t.Fatalf("unexpected tcp masks: %v", got)
	}
}

// Hysteria (v1/v2) outbounds must carry the masks in the JSON subscription:
// genHy keeps streamSettings.finalmask on the stream root.
func TestGenHyKeepsFinalmaskInJSONSubscription(t *testing.T) {
	s := templateService(t, `{"udp":[{"type":"udphop","settings":{"mode":"intervalremote","interval":30,`+
		`"remoteIPs":["1.2.3.4"],"remotePorts":["443"]}}]}`)
	stream := map[string]any{"network": "hysteria", "security": "tls", "tlsSettings": map[string]any{}}
	inbound := &model.Inbound{Id: 10, Tag: "hy2", Protocol: model.Hysteria2, Settings: `{"version":2}`, Port: 443, Listen: "example.com"}
	inbound.StreamSettings = `{"network":"hysteria","security":"tls"}`

	s.applyFinalmaskDefaults(stream, inbound, nil)
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
	if got := udpTypesOf(fm); len(got) != 1 || got[0] != "udphop" {
		t.Fatalf("unexpected udp masks: %v", got)
	}
}

// Regression: the reference subscription (/sub/{id}) is built from the inbound
// stream only, so a configured slot must not leak into its `fm=` parameter even
// when the JSON-subscription path ran first for the same inbound.
func TestReferenceSubscriptionUnaffectedByFinalMaskSlot(t *testing.T) {
	inbound := &model.Inbound{
		Id: 11, Tag: "vless", Protocol: model.VLESS,
		StreamSettings: `{"network":"masque","security":"tls",` +
			`"tlsSettings":{"alpn":["h2","h3"]},"finalmask":{"tcp":[{"type":"fragment",` +
			`"settings":{"packets":"tlshello","lengths":["100-200"],"delays":["1-2"]}}]}}`,
	}
	s := templateService(t, `{"udp":[{"type":"udphop","settings":{"mode":"intervalremote",`+
		`"interval":30,"remoteIPs":["1.2.3.4"],"remotePorts":["443"]}}]}`)

	// JSON-subscription path first: the slot fills the empty udp side.
	jsonStream := s.streamData(inbound.StreamSettings)
	own, _ := jsonStream["finalmask"].(map[string]any)
	if notes := s.applyFinalmaskDefaults(jsonStream, inbound, own); len(notes) != 0 {
		t.Fatalf("unexpected warnings: %v", notes)
	}
	jsonFM, _ := jsonStream["finalmask"].(map[string]any)
	if got := udpTypesOf(jsonFM); len(got) != 1 || got[0] != "udphop" {
		t.Fatalf("the JSON subscription must receive the slot mask, got %v", got)
	}

	// Reference-link path: parses the inbound stream itself.
	var linkStream map[string]any
	if err := json.Unmarshal([]byte(inbound.StreamSettings), &linkStream); err != nil {
		t.Fatal(err)
	}
	params := map[string]string{"type": "tcp"}
	applyFinalMaskParams(linkStream, model.VLESS, params)
	fm := decodeFM(t, params["fm"])
	if got := tcpTypesOf(fm); len(got) != 1 || got[0] != "fragment" {
		t.Fatalf("link fm must mirror the inbound tcp mask, got %v", got)
	}
	if _, has := fm["udp"]; has {
		t.Fatalf("the JSON template must not leak into the reference link: %v", fm)
	}
}
