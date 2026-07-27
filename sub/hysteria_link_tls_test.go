package sub

import "testing"

func TestApplyXrayQueryTLSPin(t *testing.T) {
	params := map[string]string{"allowInsecure": "1", "sni": "example.com"}
	tls := map[string]any{
		"pinnedPeerCertSha256": "abc123",
	}
	if !applyXrayQueryTLSPin(tls, params) {
		t.Fatal("expected pin applied")
	}
	if params["pcs"] != "abc123" {
		t.Fatalf("pcs = %q", params["pcs"])
	}
	if _, ok := params["allowInsecure"]; ok {
		t.Fatal("allowInsecure must be removed when pin is set")
	}
}

func TestFinalizeTLSQueryParams_allowInsecureFallback(t *testing.T) {
	params := map[string]string{}
	tls := map[string]any{
		"allowInsecure": true,
	}
	finalizeTLSQueryParams(tls, params)
	if params["allowInsecure"] != "1" {
		t.Fatalf("allowInsecure = %q, want 1", params["allowInsecure"])
	}
	if params["pcs"] != "" {
		t.Fatal("pcs should be empty")
	}
}

func TestApplyHysteriaTLSPinParams(t *testing.T) {
	params := map[string]string{"insecure": "1", "sni": "example.com"}
	tls := map[string]interface{}{
		"serverName":                       "example.com",
		"pinnedPeerCertificateChainSha256": []interface{}{"deadbeef"},
	}
	applyHysteriaTLSPinParams(tls, params)
	if got := params["pinSHA256"]; got != "deadbeef" {
		t.Fatalf("pinSHA256 = %q, want deadbeef", got)
	}
	if _, ok := params["pcs"]; ok {
		t.Fatal("pcs must not be set for hysteria2 share links")
	}
	if _, ok := params["insecure"]; ok {
		t.Fatal("insecure must be removed when pin is set")
	}
}

func TestApplyVmessTLSPin(t *testing.T) {
	baseObj := map[string]any{"allowInsecure": true}
	tls := map[string]any{"pinnedPeerCertSha256": "cafe"}
	if !applyVmessTLSPin(tls, baseObj) {
		t.Fatal("expected pin applied")
	}
	if baseObj["pinnedPeerCertSha256"] != "cafe" {
		t.Fatalf("pin field = %v", baseObj["pinnedPeerCertSha256"])
	}
	if _, ok := baseObj["allowInsecure"]; ok {
		t.Fatal("allowInsecure must be removed")
	}
}

func TestFinalizeHysteriaTLSParams_insecureFallback(t *testing.T) {
	params := map[string]string{}
	tls := map[string]interface{}{
		"settings": map[string]interface{}{"allowInsecure": true},
	}
	finalizeHysteriaTLSParams(tls, params)
	if params["insecure"] != "1" {
		t.Fatalf("insecure = %q, want 1", params["insecure"])
	}
	if params["pinSHA256"] != "" {
		t.Fatal("pinSHA256 should be empty without pin")
	}
}

func TestTlsQueryKeysStrippedForPlainSecurity(t *testing.T) {
	for _, key := range []string{"alpn", "sni", "fp", "allowInsecure", "pcs", "pinnedPeerCertSha256", "insecure", "pinSHA256"} {
		if !tlsQueryKeysStrippedForPlainSecurity(key) {
			t.Fatalf("%q should be stripped", key)
		}
	}
	if tlsQueryKeysStrippedForPlainSecurity("flow") {
		t.Fatal("flow must not be stripped")
	}
}

func TestFinalizeVmessTLSBase_allowInsecureFallback(t *testing.T) {
	baseObj := map[string]any{}
	tls := map[string]any{"settings": map[string]any{"allowInsecure": true}}
	finalizeVmessTLSBase(tls, baseObj)
	if baseObj["allowInsecure"] != true {
		t.Fatalf("allowInsecure = %v", baseObj["allowInsecure"])
	}
}
