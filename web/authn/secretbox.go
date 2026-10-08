// Package authn is the provider-agnostic sign-in layer: OpenID Connect and plain OAuth 2.0 clients driven entirely by
// configuration (endpoints, scopes, claim mapping), the rules that turn identity-provider attributes into panel roles, and
// the helpers they need (sealed secrets, one-time login state). It knows nothing about the panel's users or HTTP routes.
package authn

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

const sealPrefix = "enc:v1:"

func boxKey(secret []byte) []byte {
	h := sha256.Sum256(append([]byte("sharx/authn/client-secret/v1\x00"), secret...))
	return h[:]
}

// Seal encrypts a client secret with AES-256-GCM under a key derived from the panel secret. An empty value stays empty.
func Seal(secret []byte, plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	block, err := aes.NewCipher(boxKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return sealPrefix + base64.RawURLEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plain), nil)), nil
}

// Open decrypts a value produced by Seal.
func Open(secret []byte, sealed string) (string, error) {
	if sealed == "" {
		return "", nil
	}
	if !strings.HasPrefix(sealed, sealPrefix) {
		return "", errors.New("authn: secret is not sealed")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(sealed, sealPrefix))
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(boxKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("authn: sealed secret is truncated")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return "", errors.New("authn: cannot open sealed secret (the panel secret changed?)")
	}
	return string(plain), nil
}
