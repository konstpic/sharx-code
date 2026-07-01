package service

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestIsShadowsocks2022Method(t *testing.T) {
	if !IsShadowsocks2022Method("2022-blake3-aes-256-gcm") {
		t.Fatal("expected 2022 method")
	}
	if IsShadowsocks2022Method("aes-256-gcm") {
		t.Fatal("classic method must not be 2022")
	}
}

func TestRandomShadowsocksServerPasswordLengths(t *testing.T) {
	p256, err := RandomShadowsocksServerPassword("2022-blake3-aes-256-gcm")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(p256)
	if err != nil || len(raw) != 32 {
		t.Fatalf("256 server key: got %d bytes", len(raw))
	}
	p128, err := RandomShadowsocksServerPassword("2022-blake3-aes-128-gcm")
	if err != nil {
		t.Fatal(err)
	}
	raw, err = base64.StdEncoding.DecodeString(p128)
	if err != nil || len(raw) != 16 {
		t.Fatalf("128 server key: got %d bytes", len(raw))
	}
	classic, err := RandomShadowsocksServerPassword("aes-256-gcm")
	if err != nil || len(classic) != 32 {
		t.Fatalf("classic password len=%d", len(classic))
	}
}

func TestSanitizeShadowsocksInboundSettingsStripsClientMethod(t *testing.T) {
	in := `{
  "method": "2022-blake3-aes-256-gcm",
  "password": "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
  "clients": [{"email":"u1","method":"aes-256-gcm","password":"x"}]
}`
	out, err := SanitizeShadowsocksInboundSettings(in)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, `"method": "aes-256-gcm"`) {
		t.Fatalf("client method must be stripped: %s", out)
	}
}

func TestEnsureShadowsocksUserPasswordRegeneratesInvalid2022Key(t *testing.T) {
	fixed, err := EnsureShadowsocksUserPassword("2022-blake3-aes-256-gcm", "JTukCSGEOry0lv94jhj7PNFjhI41fs9O")
	if err != nil {
		t.Fatal(err)
	}
	if fixed == "JTukCSGEOry0lv94jhj7PNFjhI41fs9O" {
		t.Fatal("expected regeneration of invalid SS2022 key")
	}
	if !shadowsocks2022KeyValid("2022-blake3-aes-256-gcm", fixed) {
		t.Fatalf("regenerated key invalid: %q", fixed)
	}
}

func TestSanitizeShadowsocksInboundSettingsClassicClientMethod(t *testing.T) {
	in := `{
  "method": "chacha20-poly1305",
  "password": "serverpw",
  "clients": [{"email":"u1","password":"clientpw"}]
}`
	out, err := SanitizeShadowsocksInboundSettings(in)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"method": "chacha20-poly1305"`) {
		t.Fatalf("client must inherit inbound method: %s", out)
	}
}

func TestSanitizeShadowsocksInboundSettingsFixesInvalid2022ClientKey(t *testing.T) {
	in := `{
  "method": "2022-blake3-aes-256-gcm",
  "password": "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
  "clients": [{"email":"u1","password":"JTukCSGEOry0lv94jhj7PNFjhI41fs9O"}]
}`
	out, err := SanitizeShadowsocksInboundSettings(in)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "JTukCSGEOry0lv94jhj7PNFjhI41fs9O") {
		t.Fatalf("invalid client key must be replaced: %s", out)
	}
}
