// Package auth loads the node SECRET_KEY used for JWT and HMAC auth with the panel.
package auth

import (
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

// ParseSecretKey accepts a plain 128-char secret or legacy base64 JSON with authSecret only.
func ParseSecretKey(raw string) (*Bundle, error) {
	secret := pairing_outbound.ExtractAuthSecretFromStored(raw)
	if secret == "" {
		return nil, fmt.Errorf("SECRET_KEY is empty or invalid (use plain secret from panel Settings → Nodes)")
	}
	return &Bundle{AuthSecret: secret}, nil
}
