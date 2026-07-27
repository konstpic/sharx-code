package sub

import (
	"encoding/json"
	"testing"
)

func TestSubJsonService_streamData_normalizesArrayPin(t *testing.T) {
	s := &SubJsonService{}
	raw := `{
		"security": "tls",
		"network": "tcp",
		"tlsSettings": {
			"serverName": "example.com",
			"pinnedPeerCertSha256": ["deadbeef", "cafebabe"]
		}
	}`
	out := s.streamData(raw)
	tls, ok := out["tlsSettings"].(map[string]any)
	if !ok {
		t.Fatal("missing tlsSettings")
	}
	got, ok := tls["pinnedPeerCertSha256"].(string)
	if !ok || got != "deadbeef,cafebabe" {
		t.Fatalf("pin = %v (%T)", tls["pinnedPeerCertSha256"], tls["pinnedPeerCertSha256"])
	}
}

func TestSubJsonService_streamData_dropsStrayTLSOnReality(t *testing.T) {
	s := &SubJsonService{}
	raw := `{
		"security": "reality",
		"network": "tcp",
		"tlsSettings": {
			"pinnedPeerCertSha256": ["deadbeef"]
		},
		"realitySettings": {
			"settings": {"publicKey": "pk", "fingerprint": "chrome"},
			"shortIds": ["abcd"],
			"serverNames": ["example.com"]
		}
	}`
	out := s.streamData(raw)
	if _, ok := out["tlsSettings"]; ok {
		t.Fatal("stray tlsSettings must be removed for reality inbounds")
	}
	if _, ok := out["realitySettings"].(map[string]any); !ok {
		t.Fatal("realitySettings must remain")
	}
}

func TestParseInboundStreamSettings_marshalRoundTripStringPin(t *testing.T) {
	stream := parseInboundStreamSettings(`{"security":"tls","tlsSettings":{"pinnedPeerCertSha256":["aa","bb"]}}`)
	raw, err := json.Marshal(stream)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == "" {
		t.Fatal("empty json")
	}
	tls := stream["tlsSettings"].(map[string]any)
	if _, ok := tls["pinnedPeerCertSha256"].(string); !ok {
		t.Fatalf("expected string pin after parse, got %T", tls["pinnedPeerCertSha256"])
	}
}
