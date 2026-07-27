package xray

import "testing"

func TestSanitizeClientTLSSettings(t *testing.T) {
	in := map[string]any{
		"serverName":                       "example.com",
		"allowInsecure":                    true,
		"alpn":                             []any{"h2", "http/1.1"},
		"pinnedPeerCertificateChainSha256": []any{"abc123"},
		"settings": map[string]any{
			"fingerprint":   "chrome",
			"allowInsecure": true,
		},
	}
	out := SanitizeClientTLSSettings(in)
	if _, ok := out["allowInsecure"]; ok {
		t.Fatal("allowInsecure must be removed")
	}
	if _, ok := out["settings"]; ok {
		t.Fatal("legacy settings wrapper must be removed")
	}
	if _, ok := out["pinnedPeerCertificateChainSha256"]; ok {
		t.Fatal("legacy pin key must be renamed")
	}
	if got := out["pinnedPeerCertSha256"]; got != "abc123" {
		t.Fatalf("pinnedPeerCertSha256 = %v, want abc123", got)
	}
	if got := out["fingerprint"]; got != "chrome" {
		t.Fatalf("fingerprint = %v, want chrome", got)
	}
}

func TestSanitizeClientTLSSettings_arrayPinField(t *testing.T) {
	in := map[string]any{
		"pinnedPeerCertSha256": []any{"deadbeef", "cafebabe"},
	}
	out := SanitizeClientTLSSettings(in)
	got, ok := out["pinnedPeerCertSha256"].(string)
	if !ok {
		t.Fatalf("want string pin, got %T %v", out["pinnedPeerCertSha256"], out["pinnedPeerCertSha256"])
	}
	if got != "deadbeef,cafebabe" {
		t.Fatalf("pinnedPeerCertSha256 = %q", got)
	}
}

func TestNormalizeSubscriptionStreamSettings_dropsTLSForReality(t *testing.T) {
	stream := map[string]any{
		"security": "reality",
		"tlsSettings": map[string]any{
			"pinnedPeerCertSha256": []any{"deadbeef"},
		},
		"realitySettings": map[string]any{
			"settings": map[string]any{"publicKey": "pk"},
		},
	}
	out := NormalizeSubscriptionStreamSettings(stream)
	if _, ok := out["tlsSettings"]; ok {
		t.Fatal("tlsSettings must be removed when security is reality")
	}
}

func TestNormalizeSubscriptionStreamSettings_stringPinForTLS(t *testing.T) {
	stream := map[string]any{
		"security": "tls",
		"tlsSettings": map[string]any{
			"serverName":             "example.com",
			"pinnedPeerCertSha256": []any{"abc123"},
		},
	}
	out := NormalizeSubscriptionStreamSettings(stream)
	tls, ok := out["tlsSettings"].(map[string]any)
	if !ok {
		t.Fatal("missing tlsSettings")
	}
	got, ok := tls["pinnedPeerCertSha256"].(string)
	if !ok || got != "abc123" {
		t.Fatalf("pin = %v (%T)", tls["pinnedPeerCertSha256"], tls["pinnedPeerCertSha256"])
	}
}
