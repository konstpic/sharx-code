package authn

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sync"
	"time"
)

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

type keySet struct {
	keys    map[string]crypto.PublicKey
	fetched time.Time
}

// KeyCache keeps the signing keys of identity providers. A key set is refetched when it is older than the TTL, or at most
// once a minute when a token names a key id the cache does not know (a rotation).
type KeyCache struct {
	mu   sync.Mutex
	sets map[string]*keySet
	ttl  time.Duration
}

// NewKeyCache returns a cache with the given TTL.
func NewKeyCache(ttl time.Duration) *KeyCache { return &KeyCache{sets: map[string]*keySet{}, ttl: ttl} }

func b64(s string) ([]byte, error) { return base64.RawURLEncoding.DecodeString(s) }

func parseJWK(k jwk) (crypto.PublicKey, error) {
	switch k.Kty {
	case "RSA":
		n, err := b64(k.N)
		if err != nil {
			return nil, err
		}
		e, err := b64(k.E)
		if err != nil {
			return nil, err
		}
		if len(n) < 256 { // < 2048 bits
			return nil, errors.New("RSA key is shorter than 2048 bits")
		}
		return &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}, nil
	case "EC":
		var curve elliptic.Curve
		switch k.Crv {
		case "P-256":
			curve = elliptic.P256()
		case "P-384":
			curve = elliptic.P384()
		case "P-521":
			curve = elliptic.P521()
		default:
			return nil, fmt.Errorf("unsupported curve %q", k.Crv)
		}
		x, err := b64(k.X)
		if err != nil {
			return nil, err
		}
		y, err := b64(k.Y)
		if err != nil {
			return nil, err
		}
		pub := &ecdsa.PublicKey{Curve: curve, X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
		if !curve.IsOnCurve(pub.X, pub.Y) {
			return nil, errors.New("EC point is not on the curve")
		}
		return pub, nil
	}
	return nil, fmt.Errorf("unsupported key type %q", k.Kty)
}

func (c *KeyCache) load(ctx context.Context, url string) (*keySet, error) {
	var doc struct {
		Keys []jwk `json:"keys"`
	}
	if err := getJSON(ctx, url, "", &doc); err != nil {
		return nil, fmt.Errorf("fetch signing keys: %w", err)
	}
	ks := &keySet{keys: map[string]crypto.PublicKey{}, fetched: time.Now()}
	for _, k := range doc.Keys {
		if k.Use != "" && k.Use != "sig" {
			continue
		}
		pub, err := parseJWK(k)
		if err != nil {
			continue
		}
		ks.keys[k.Kid] = pub
	}
	if len(ks.keys) == 0 {
		return nil, errors.New("the provider published no usable signing keys")
	}
	return ks, nil
}

// Key returns the public key for kid. An empty kid is accepted only when the set has exactly one key.
func (c *KeyCache) Key(ctx context.Context, url, kid string) (crypto.PublicKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ks := c.sets[url]
	pick := func(ks *keySet) (crypto.PublicKey, bool) {
		if ks == nil {
			return nil, false
		}
		if kid == "" && len(ks.keys) == 1 {
			for _, k := range ks.keys {
				return k, true
			}
		}
		k, ok := ks.keys[kid]
		return k, ok
	}
	if ks != nil && time.Since(ks.fetched) < c.ttl {
		if k, ok := pick(ks); ok {
			return k, nil
		}
		if time.Since(ks.fetched) < time.Minute {
			return nil, errors.New("unknown signing key id")
		}
	}
	fresh, err := c.load(ctx, url)
	if err != nil {
		if ks != nil { // keep serving known keys while the provider is unreachable
			if k, ok := pick(ks); ok {
				return k, nil
			}
		}
		return nil, err
	}
	c.sets[url] = fresh
	if k, ok := pick(fresh); ok {
		return k, nil
	}
	return nil, errors.New("unknown signing key id")
}

var _ = json.Marshal
