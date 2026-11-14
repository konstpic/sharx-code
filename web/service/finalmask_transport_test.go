package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func TestApplyFinalmaskOnSaveRejectsTCPMaskOnKCP(t *testing.T) {
	const raw = `{"network":"kcp","finalmask":{"tcp":[{"type":"fragment","settings":{"length":"10-20"}}]}}`
	ib := inboundWithStream(raw)
	err := ApplyFinalmaskOnSave(ib)
	if err == nil {
		t.Fatal("expected transport incompatibility error")
	}
	if !strings.Contains(err.Error(), "tcp masks are not supported") {
		t.Fatalf("unexpected error: %v", err)
	}
	if ib.StreamSettings != raw {
		t.Fatalf("rejected stream settings must stay untouched, got %s", ib.StreamSettings)
	}
}

func TestApplyFinalmaskOnSaveRejectsTCPMaskOnXHTTPH3(t *testing.T) {
	const raw = `{"network":"xhttp","security":"tls","tlsSettings":{"alpn":["h3"]},` +
		`"finalmask":{"tcp":[{"type":"fragment","settings":{"length":"10-20"}}]}}`
	ib := inboundWithStream(raw)
	err := ApplyFinalmaskOnSave(ib)
	if err == nil {
		t.Fatal("expected transport incompatibility error")
	}
	if !strings.Contains(err.Error(), "ALPN h3") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestApplyFinalmaskOnSaveAllowsUDPMaskOnXHTTPH3(t *testing.T) {
	ib := inboundWithStream(`{"network":"xhttp","security":"tls","tlsSettings":{"alpn":["h3"]},` +
		`"finalmask":{"udp":[{"type":"salamander","settings":{"password":"strongpsk"}}]}}`)
	if err := ApplyFinalmaskOnSave(ib); err != nil {
		t.Fatalf("udp mask on the xhttp h3 path must be accepted: %v", err)
	}
}

func TestApplyFinalmaskOnSaveAllowsQuicParamsOnlyOnXHTTPH3(t *testing.T) {
	ib := inboundWithStream(`{"network":"xhttp","security":"tls","tlsSettings":{"alpn":["h3"]},` +
		`"finalmask":{"quicParams":{"maxIdleTimeout":30}}}`)
	if err := ApplyFinalmaskOnSave(ib); err != nil {
		t.Fatalf("quicParams-only finalmask must be accepted: %v", err)
	}
	var stream map[string]any
	if err := json.Unmarshal([]byte(ib.StreamSettings), &stream); err != nil {
		t.Fatalf("stream is not JSON: %v", err)
	}
	if _, ok := stream["finalmask"].(map[string]any)["quicParams"]; !ok {
		t.Fatalf("quicParams must survive normalization: %s", ib.StreamSettings)
	}
}

func TestApplyFinalmaskOnSaveAllowsTCPMaskOnXHTTPH3H2(t *testing.T) {
	ib := inboundWithStream(`{"network":"xhttp","security":"tls","tlsSettings":{"alpn":["h3","h2"]},` +
		`"finalmask":{"tcp":[{"type":"fragment","settings":{"length":"10-20"}}]}}`)
	if err := ApplyFinalmaskOnSave(ib); err != nil {
		t.Fatalf("xhttp with h3+h2 negotiates H2/TCP, tcp mask must be accepted: %v", err)
	}
}

func TestApplyFinalmaskOnSaveAllowsUDPMaskOnKCP(t *testing.T) {
	ib := inboundWithStream(`{"network":"kcp","finalmask":{"udp":[{"type":"salamander","settings":{"password":"strongpsk"}}]}}`)
	if err := ApplyFinalmaskOnSave(ib); err != nil {
		t.Fatalf("udp mask on kcp must be accepted: %v", err)
	}
}

// ALPN is matched verbatim: ["H3"] is not the xhttp QUIC path (the kernel
// compares NextProtocol[0] == "h3"), so it keeps TCP masks and rejects UDP ones.
func TestApplyFinalmaskOnSaveUppercaseH3StaysOnTCPSide(t *testing.T) {
	const base = `{"network":"xhttp","security":"tls","tlsSettings":{"alpn":["H3"]},`
	tcp := inboundWithStream(base + `"finalmask":{"tcp":[{"type":"fragment","settings":{"length":"10-20"}}]}}`)
	if err := ApplyFinalmaskOnSave(tcp); err != nil {
		t.Fatalf("uppercase H3 must stay on the TCP side: %v", err)
	}
	udp := inboundWithStream(base + `"finalmask":{"udp":[{"type":"salamander","settings":{"password":"strongpsk"}}]}}`)
	err := ApplyFinalmaskOnSave(udp)
	if err == nil || !strings.Contains(err.Error(), "udp masks") {
		t.Fatalf("uppercase H3 must reject udp masks, got %v", err)
	}
}

func TestApplyFinalmaskOnSaveWireguardSides(t *testing.T) {
	udp := &model.Inbound{Protocol: model.WireGuard,
		StreamSettings: `{"network":"tcp","finalmask":{"udp":[{"type":"salamander","settings":{"password":"strongpsk"}}]}}`}
	if err := ApplyFinalmaskOnSave(udp); err != nil {
		t.Fatalf("wireguard wraps the UDP side: %v", err)
	}
	tcp := &model.Inbound{Protocol: model.WireGuard,
		StreamSettings: `{"network":"tcp","finalmask":{"tcp":[{"type":"fragment","settings":{"length":"10-20"}}]}}`}
	if err := ApplyFinalmaskOnSave(tcp); err == nil {
		t.Fatal("wireguard cannot carry tcp masks")
	}
}

func TestApplyFinalmaskOnSaveRejectsRemovedTransportMasks(t *testing.T) {
	for _, network := range []string{"quic", "http", "h3"} {
		ib := inboundWithStream(`{"network":"` + network + `","finalmask":{"tcp":[{"type":"fragment","settings":{"length":"10-20"}}]}}`)
		err := ApplyFinalmaskOnSave(ib)
		if err == nil || !strings.Contains(err.Error(), "removed feature") {
			t.Fatalf("network %s must be rejected, got %v", network, err)
		}
	}
}

func TestApplyFinalmaskOnSaveAllowsKCPWithUDPHop(t *testing.T) {
	const raw = `{"network":"kcp","finalmask":{"udp":[{"type":"udphop","settings":{` +
		`"mode":"intervalremote","interval":30,"remoteIPs":["1.2.3.4"],"remotePorts":["443"]}}]}}`
	ib := inboundWithStream(raw)
	if err := ApplyFinalmaskOnSave(ib); err != nil {
		t.Fatalf("udphop is a client-side mask and must be accepted on save: %v", err)
	}
}

// udphop interval is a single Int32Range (number or "min-max"), never an array.
func TestApplyFinalmaskOnSaveRejectsUDPHopIntervalArray(t *testing.T) {
	ib := inboundWithStream(`{"network":"kcp","finalmask":{"udp":[{"type":"udphop","settings":{` +
		`"mode":"intervalremote","interval":[10,20],"remoteIPs":["1.2.3.4"],"remotePorts":["443"]}}]}}`)
	err := ApplyFinalmaskOnSave(ib)
	if err == nil || !strings.Contains(err.Error(), "single interval") {
		t.Fatalf("array interval must be rejected, got %v", err)
	}
}

// The node config must not carry client-only masks (udphop answers
// "udphop: client only" on listen), while the stored inbound row keeps them for
// the subscription link.
func TestBuildInboundXrayConfigStripsClientOnlyMasks(t *testing.T) {
	const raw = `{"network":"kcp","finalmask":{"udp":[` +
		`{"type":"salamander","settings":{"password":"strongpsk"}},` +
		`{"type":"udphop","settings":{"mode":"intervalremote","interval":30,"remoteIPs":["1.2.3.4"],"remotePorts":["443"]}}]}}`
	ib := &model.Inbound{Protocol: model.VLESS, Id: 32, Tag: "qa-finalmask", StreamSettings: raw, Settings: "{}"}

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
		t.Fatalf("finalmask must survive server-side patching: %s", cfg.StreamSettings)
	}
	udp, ok := fm["udp"].([]any)
	if !ok || len(udp) != 1 {
		t.Fatalf("udphop must be dropped from the node config, got %v", fm["udp"])
	}
	if typ, _ := udp[0].(map[string]any)["type"].(string); typ != "salamander" {
		t.Fatalf("salamander must stay in the node config, got %v", udp[0])
	}
	if ib.StreamSettings != raw {
		t.Fatal("BuildInboundXrayConfig must not mutate the stored inbound")
	}
}

// Regression for the QA inbound id=32 (vless/tcp + header-custom): the real
// payload must reach the node config untouched, not be dropped as invalid.
func TestBuildInboundXrayConfigKeepsInbound32HeaderCustom(t *testing.T) {
	const mask = `{"type":"header-custom","settings":{` +
		`"clients":[[{"type":"hex","packet":"0d0a0d0a"}]],` +
		`"servers":[[{"type":"hex","packet":"0d0a"}]]}}`
	const raw = `{"network":"tcp","security":"tls","tlsSettings":{"alpn":["h2","http/1.1"]},` +
		`"finalmask":{"tcp":[` + mask + `]}}`
	ib := &model.Inbound{Protocol: model.VLESS, Id: 32, Tag: "qa-finalmask", StreamSettings: raw, Settings: "{}"}

	if err := ApplyFinalmaskOnSave(ib); err != nil {
		t.Fatalf("inbound 32 must pass save validation: %v", err)
	}
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
		t.Fatalf("header-custom mask must survive BuildInboundXrayConfig: %s", cfg.StreamSettings)
	}
	tcp, ok := fm["tcp"].([]any)
	if !ok || len(tcp) != 1 {
		t.Fatalf("header-custom must stay in the node config, got %v", fm["tcp"])
	}
	el, _ := tcp[0].(map[string]any)
	if typ, _ := el["type"].(string); typ != "header-custom" {
		t.Fatalf("unexpected mask type: %v", el)
	}
	settings, _ := el["settings"].(map[string]any)
	if settings == nil || settings["clients"] == nil || settings["servers"] == nil {
		t.Fatalf("header-custom settings must be preserved verbatim, got %v", el)
	}
}
