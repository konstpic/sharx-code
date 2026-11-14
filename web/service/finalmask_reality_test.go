package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func realityStreamWithFinalmask(finalmask string) string {
	return `{"network":"tcp","security":"reality","realitySettings":{` +
		`"dest":"www.microsoft.com:443","serverNames":["www.microsoft.com"],` +
		`"privateKey":"REDACTED","shortIds":["0123456789abcdef"]}` + finalmask + `}`
}

// REALITY + tcp[] crashes the kernel on the first handshake
// (XTLS/Xray-core#6453) while the config itself passes `xray -test`, so the
// panel must reject the save instead of shipping it to the node.
func TestApplyFinalmaskOnSaveRejectsTCPMaskWithReality(t *testing.T) {
	ib := inboundWithStream(realityStreamWithFinalmask(`,"finalmask":{"tcp":` +
		`[{"type":"fragment","settings":{"packets":"tlshello","lengths":["100-200"],"delays":["1-2"]}}]}`))
	err := ApplyFinalmaskOnSave(ib)
	if err == nil {
		t.Fatal("expected reality_tcp_forbidden")
	}
	if !strings.Contains(err.Error(), "invalid finalmask:") {
		t.Fatalf("unexpected error format: %v", err)
	}
	if !strings.Contains(err.Error(), "REALITY") || !strings.Contains(err.Error(), "XTLS/Xray-core#6453") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

// A udp[] mask is harmless next to REALITY (the TCP transport never wraps it),
// but the pre-existing transport gate still rejects it on a tcp inbound because
// the mask would be a silent no-op. The save error must therefore come from the
// transport layer — the REALITY rule must not fire for udp[].
func TestApplyFinalmaskOnSaveRealityUDPMaskFailsOnTransportNotReality(t *testing.T) {
	ib := inboundWithStream(realityStreamWithFinalmask(`,"finalmask":{"udp":` +
		`[{"type":"salamander","settings":{"password":"strongpsk"}}]}`))
	err := ApplyFinalmaskOnSave(ib)
	if err == nil {
		t.Fatal("a udp mask on a tcp transport must still be rejected")
	}
	if strings.Contains(err.Error(), "REALITY") || strings.Contains(err.Error(), "6453") {
		t.Fatalf("udp-only masks must not trigger the REALITY rule: %v", err)
	}
	if !strings.Contains(err.Error(), "udp masks are not supported") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestApplyFinalmaskOnSaveAllowsQuicParamsOnlyWithReality(t *testing.T) {
	ib := inboundWithStream(realityStreamWithFinalmask(`,"finalmask":{"quicParams":{"maxIdleTimeout":30}}`))
	if err := ApplyFinalmaskOnSave(ib); err != nil {
		t.Fatalf("quicParams-only finalmask on REALITY must be accepted: %v", err)
	}
}

func TestApplyFinalmaskOnSaveAllowsTCPMaskWithTLS(t *testing.T) {
	ib := inboundWithStream(`{"network":"tcp","security":"tls","tlsSettings":{"alpn":["h2"]},` +
		`"finalmask":{"tcp":[{"type":"fragment","settings":{"lengths":["10-20"]}}]}}`)
	if err := ApplyFinalmaskOnSave(ib); err != nil {
		t.Fatalf("tcp mask next to TLS must be accepted: %v", err)
	}
}

// Legacy rows saved before the gate existed must never reach the node config:
// the tcp side is cut out of the finalmask block while udp masks stay.
func TestBuildInboundXrayConfigStripsTCPMaskOnReality(t *testing.T) {
	raw := realityStreamWithFinalmask(`,"finalmask":{"tcp":` +
		`[{"type":"fragment","settings":{"packets":"tlshello","lengths":["100-200"],"delays":["1-2"]}}],` +
		`"udp":[{"type":"salamander","settings":{"password":"strongpsk"}}]}`)
	ib := &model.Inbound{Protocol: model.VLESS, Id: 7, Tag: "legacy-reality", StreamSettings: raw, Settings: "{}"}

	cfg := BuildInboundXrayConfig(ib, "", "")
	if cfg == nil {
		t.Fatal("expected a config")
	}
	var stream map[string]any
	if err := json.Unmarshal(cfg.StreamSettings, &stream); err != nil {
		t.Fatalf("stream settings are not JSON: %v", err)
	}
	fm, ok := stream["finalmask"].(map[string]any)
	if !ok {
		t.Fatalf("udp mask must survive the reality strip: %s", cfg.StreamSettings)
	}
	if _, has := fm["tcp"]; has {
		t.Fatalf("tcp masks must be cut out of a REALITY node config: %s", cfg.StreamSettings)
	}
	udp, _ := fm["udp"].([]any)
	if len(udp) != 1 {
		t.Fatalf("udp masks must stay, got %v", fm["udp"])
	}
	if ib.StreamSettings != raw {
		t.Fatal("BuildInboundXrayConfig must not mutate the stored inbound")
	}
}

func TestBuildInboundXrayConfigDropsFinalmaskIfOnlyTCPMaskOnReality(t *testing.T) {
	raw := realityStreamWithFinalmask(`,"finalmask":{"tcp":` +
		`[{"type":"fragment","settings":{"packets":"tlshello","lengths":["100-200"],"delays":["1-2"]}}]}`)
	ib := &model.Inbound{Protocol: model.VLESS, Id: 8, Tag: "legacy-reality", StreamSettings: raw, Settings: "{}"}

	cfg := BuildInboundXrayConfig(ib, "", "")
	if cfg == nil {
		t.Fatal("expected a config")
	}
	var stream map[string]any
	if err := json.Unmarshal(cfg.StreamSettings, &stream); err != nil {
		t.Fatalf("stream settings are not JSON: %v", err)
	}
	if _, has := stream["finalmask"]; has {
		t.Fatalf("empty finalmask must be removed from the node config: %s", cfg.StreamSettings)
	}
}

// The reality strip is scoped to security=reality: a TLS inbound keeps its
// tcp fragment untouched.
func TestBuildInboundXrayConfigKeepsTCPMaskOnTLS(t *testing.T) {
	raw := `{"network":"tcp","security":"tls","tlsSettings":{"alpn":["h2"]},` +
		`"finalmask":{"tcp":[{"type":"fragment","settings":{"packets":"tlshello","lengths":["100-200"],"delays":["1-2"]}}]}}`
	ib := &model.Inbound{Protocol: model.VLESS, Id: 9, Tag: "tls-fragment", StreamSettings: raw, Settings: "{}"}

	cfg := BuildInboundXrayConfig(ib, "", "")
	if cfg == nil {
		t.Fatal("expected a config")
	}
	var stream map[string]any
	if err := json.Unmarshal(cfg.StreamSettings, &stream); err != nil {
		t.Fatalf("stream settings are not JSON: %v", err)
	}
	fm, ok := stream["finalmask"].(map[string]any)
	if !ok {
		t.Fatalf("tls inbound must keep its fragment: %s", cfg.StreamSettings)
	}
	tcp, _ := fm["tcp"].([]any)
	if len(tcp) != 1 {
		t.Fatalf("tcp fragment must stay, got %v", fm["tcp"])
	}
	if typ, _ := tcp[0].(map[string]any)["type"].(string); typ != "fragment" {
		t.Fatalf("unexpected mask type %v", tcp[0])
	}
}
