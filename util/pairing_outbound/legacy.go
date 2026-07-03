package pairing_outbound

import (
	"encoding/base64"
	"encoding/json"
	"strings"
)

// IsLegacyCertBundle reports whether s is a pre-1.7 base64 JSON bundle with pairing certs/keys.
func IsLegacyCertBundle(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return false
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(decoded, &fields) != nil {
		return false
	}
	for _, k := range []string{"caCertPem", "jwtPublicKey", "nodeCertPem", "nodeKeyPem"} {
		if _, ok := fields[k]; ok {
			return true
		}
	}
	return false
}

// ExtractAuthSecretFromStored returns authSecret from a stored value: plain text, JSON bundle, or "".
// Legacy cert bundles without authSecret return "" so callers can mint a new plain secret.
func ExtractAuthSecretFromStored(stored string) string {
	stored = strings.TrimSpace(stored)
	if stored == "" {
		return ""
	}
	if IsLegacyCertBundle(stored) {
		if decoded, err := base64.StdEncoding.DecodeString(stored); err == nil {
			var payload struct {
				AuthSecret string `json:"authSecret"`
			}
			if json.Unmarshal(decoded, &payload) == nil {
				if s := strings.TrimSpace(payload.AuthSecret); s != "" && !IsLegacyCertBundle(s) {
					return s
				}
			}
		}
		return ""
	}
	if decoded, err := base64.StdEncoding.DecodeString(stored); err == nil {
		var payload struct {
			AuthSecret string `json:"authSecret"`
		}
		if json.Unmarshal(decoded, &payload) == nil {
			if s := strings.TrimSpace(payload.AuthSecret); s != "" {
				return s
			}
		}
		// Base64 JSON without authSecret (legacy bundle) — not a usable plain secret.
		var probe map[string]json.RawMessage
		if json.Unmarshal(decoded, &probe) == nil && len(probe) > 0 {
			return ""
		}
	}
	if strings.HasPrefix(stored, "{") {
		return ""
	}
	if len(stored) >= 16 {
		return stored
	}
	return ""
}
