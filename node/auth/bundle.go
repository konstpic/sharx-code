// Package auth parses SECRET_KEY (base64 JSON) bundles and holds TLS/JWT material for the node API.
package auth

import (
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
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

// PairingPayload is the JSON inside SECRET_KEY after base64 decode.
type PairingPayload struct {
	CACertPem    string `json:"caCertPem"`
	JWTPublicKey string `json:"jwtPublicKey,omitempty"`
	NodeCertPem  string `json:"nodeCertPem"`
	NodeKeyPem   string `json:"nodeKeyPem"`
	AuthSecret   string `json:"authSecret,omitempty"`
}

// Bundle holds parsed pairing data for the API server.
type Bundle struct {
	Payload      PairingPayload
	AuthSecret   string
	TLSCert      tls.Certificate
	ClientCAPool *x509.CertPool
	JWTPublicKey *rsa.PublicKey
}

// OutboundHMACKey returns the symmetric key for node→panel HMAC signing.
func (b *Bundle) OutboundHMACKey() [32]byte {
	if strings.TrimSpace(b.AuthSecret) != "" {
		return pairing_outbound.KeyFromAuthSecret(b.AuthSecret)
	}
	return pairing_outbound.OutboundHMACKey(b.Payload.CACertPem, b.Payload.JWTPublicKey)
}

// UsesAuthSecret reports whether panel↔node JWT/HMAC uses the persistent auth secret.
func (b *Bundle) UsesAuthSecret() bool {
	return strings.TrimSpace(b.AuthSecret) != ""
}

// LoadBundleFromEnv reads SECRET_KEY or SHARX_NODE_SECRET_KEY and parses it.
func LoadBundleFromEnv() (*Bundle, error) {
	raw := strings.TrimSpace(os.Getenv("SECRET_KEY"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("SHARX_NODE_SECRET_KEY"))
	}
	if raw == "" {
		return nil, nil
	}
	return ParseSecretKeyBase64(raw)
}

// ParseSecretKeyBase64 decodes base64 JSON into a Bundle with loaded keys and TLS cert.
func ParseSecretKeyBase64(b64 string) (*Bundle, error) {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64))
	if err != nil {
		return nil, fmt.Errorf("SECRET_KEY base64: %w", err)
	}
	var p PairingPayload
	if err := json.Unmarshal(decoded, &p); err != nil {
		return nil, fmt.Errorf("SECRET_KEY JSON: %w", err)
	}
	if p.CACertPem == "" || p.NodeCertPem == "" || p.NodeKeyPem == "" {
		return nil, fmt.Errorf("SECRET_KEY missing required TLS fields (caCertPem, nodeCertPem, nodeKeyPem)")
	}
	if strings.TrimSpace(p.AuthSecret) == "" && strings.TrimSpace(p.JWTPublicKey) == "" {
		return nil, fmt.Errorf("SECRET_KEY missing authSecret (or legacy jwtPublicKey)")
	}
	tlsCert, err := tls.X509KeyPair([]byte(p.NodeCertPem), []byte(p.NodeKeyPem))
	if err != nil {
		return nil, fmt.Errorf("node TLS key pair: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM([]byte(p.CACertPem)) {
		return nil, fmt.Errorf("caCertPem: no certificates parsed")
	}
	var pub *rsa.PublicKey
	if strings.TrimSpace(p.JWTPublicKey) != "" {
		pub, err = parseRSAPublicKeyFromPEM([]byte(p.JWTPublicKey))
		if err != nil {
			return nil, fmt.Errorf("jwtPublicKey: %w", err)
		}
	}
	return &Bundle{
		Payload:      p,
		AuthSecret:   strings.TrimSpace(p.AuthSecret),
		TLSCert:      tlsCert,
		ClientCAPool: pool,
		JWTPublicKey: pub,
	}, nil
}

func parseRSAPublicKeyFromPEM(pemBytes []byte) (*rsa.PublicKey, error) {
	for {
		var block *pem.Block
		block, pemBytes = pem.Decode(pemBytes)
		if block == nil {
			return nil, fmt.Errorf("no PEM block")
		}
		if block.Type != "PUBLIC KEY" && block.Type != "RSA PUBLIC KEY" {
			continue
		}
		any, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		pub, ok := any.(*rsa.PublicKey)
		if !ok {
			return nil, fmt.Errorf("JWT public key is not RSA")
		}
		return pub, nil
	}
}
