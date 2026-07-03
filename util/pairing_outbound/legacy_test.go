package pairing_outbound

import (
	"encoding/base64"
	"testing"
)

func TestIsLegacyCertBundle_detectsOldBundle(t *testing.T) {
	legacy := base64.StdEncoding.EncodeToString([]byte(`{"caCertPem":"x","jwtPublicKey":"y"}`))
	if !IsLegacyCertBundle(legacy) {
		t.Fatal("expected legacy cert bundle")
	}
}

func TestExtractAuthSecretFromStored_rejectsLegacyBundleWithoutAuthSecret(t *testing.T) {
	legacy := base64.StdEncoding.EncodeToString([]byte(`{"caCertPem":"x","jwtPublicKey":"y","nodeCertPem":"z"}`))
	if got := ExtractAuthSecretFromStored(legacy); got != "" {
		t.Fatalf("legacy bundle must not become secret, got len=%d", len(got))
	}
}

func TestExtractAuthSecretFromStored_plainSecret(t *testing.T) {
	plain := "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789ab"
	if got := ExtractAuthSecretFromStored(plain); got != plain {
		t.Fatalf("plain secret mismatch")
	}
}

func TestExtractAuthSecretFromStored_jsonAuthSecret(t *testing.T) {
	raw := base64.StdEncoding.EncodeToString([]byte(`{"authSecret":"my-plain-secret-value-here"}`))
	if got := ExtractAuthSecretFromStored(raw); got != "my-plain-secret-value-here" {
		t.Fatalf("got %q", got)
	}
}
