package auth

import (
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestParseSecretKeyPlain(t *testing.T) {
	b, err := ParseSecretKey("my-plain-node-secret-32chars-x")
	if err != nil {
		t.Fatal(err)
	}
	if b.AuthSecret != "my-plain-node-secret-32chars-x" {
		t.Fatalf("got %q", b.AuthSecret)
	}
}

func TestParseSecretKeyLegacyJSON(t *testing.T) {
	raw, _ := json.Marshal(map[string]string{"authSecret": "legacy-secret-value-1234567890"})
	b64 := base64.StdEncoding.EncodeToString(raw)
	b, err := ParseSecretKey(b64)
	if err != nil {
		t.Fatal(err)
	}
	if b.AuthSecret != "legacy-secret-value-1234567890" {
		t.Fatalf("got %q", b.AuthSecret)
	}
}
