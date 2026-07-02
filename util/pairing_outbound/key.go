// Package pairing_outbound signs node→panel requests with a shared symmetric key.
package pairing_outbound

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// KeyFromAuthSecret derives a 32-byte HMAC/JWT key from the persistent panel auth secret.
func KeyFromAuthSecret(authSecret string) [32]byte {
	return sha256.Sum256([]byte(strings.TrimSpace(authSecret)))
}

// OutboundHMACKey derives a 32-byte key from legacy public pairing material (ca + JWT public PEM).
// Deprecated: use KeyFromAuthSecret when authSecret is present in the bundle.
func OutboundHMACKey(caCertPem, jwtPublicKeyPem string) [32]byte {
	s := strings.TrimSpace(caCertPem) + "\n" + strings.TrimSpace(jwtPublicKeyPem)
	return sha256.Sum256([]byte(s))
}

// SignBody returns hex-encoded HMAC-SHA256 of body using OutboundHMACKey.
func SignBody(key [32]byte, body []byte) string {
	mac := hmac.New(sha256.New, key[:])
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// ValidSignature reports whether hexSig (v1= output) matches HMAC of body.
func ValidSignature(key [32]byte, body []byte, hexSig string) bool {
	if len(hexSig) != sha256.Size*2 { // hex of 32 bytes
		return false
	}
	expect, err := hex.DecodeString(hexSig)
	if err != nil || len(expect) != sha256.Size {
		return false
	}
	mac := hmac.New(sha256.New, key[:])
	mac.Write(body)
	return hmac.Equal(expect, mac.Sum(nil))
}
