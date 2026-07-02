// Package auth loads the node SECRET_KEY used for JWT and HMAC auth with the panel.
package auth

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/konstpic/sharx-code/v2/util/pairing_outbound"
)

// JWT claim constants (must match panel signing).
const (
	JWTIssuer   = "sharx-panel"
	JWTAudience = "sharx-node"
)

// Bundle holds the shared auth secret for the node API.
type Bundle struct {
	AuthSecret string
}

// OutboundHMACKey returns the symmetric key for node→panel HMAC signing.
func (b *Bundle) OutboundHMACKey() [32]byte {
	return pairing_outbound.KeyFromAuthSecret(b.AuthSecret)
}

// LoadBundleFromEnv reads SECRET_KEY or SHARX_NODE_SECRET_KEY.
func LoadBundleFromEnv() (*Bundle, error) {
	raw := strings.TrimSpace(os.Getenv("SECRET_KEY"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("SHARX_NODE_SECRET_KEY"))
	}
	if raw == "" {
		return nil, nil
	}
	return ParseSecretKey(raw)
}

// ParseSecretKey accepts a plain secret or legacy base64 JSON bundle (authSecret field only).
func ParseSecretKey(raw string) (*Bundle, error) {
	secret := extractSecret(raw)
	if secret == "" {
		return nil, fmt.Errorf("SECRET_KEY is empty or invalid")
	}
	return &Bundle{AuthSecret: secret}, nil
}

func extractSecret(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if decoded, err := base64.StdEncoding.DecodeString(raw); err == nil {
		var payload struct {
			AuthSecret string `json:"authSecret"`
		}
		if json.Unmarshal(decoded, &payload) == nil {
			if s := strings.TrimSpace(payload.AuthSecret); s != "" {
				return s
			}
		}
	}
	if len(raw) >= 16 && !strings.HasPrefix(raw, "{") {
		return raw
	}
	return ""
}
