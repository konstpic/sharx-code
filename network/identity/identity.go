// Package identity manages the panel's SharX Network cryptographic identity:
// an ed25519 usage-report signing key and an ECDSA P-256 TLS key (CSR for enrollment).
package identity

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"errors"
)

// SigningKeys holds the ed25519 identity used to sign usage reports.
type SigningKeys struct {
	Public  ed25519.PublicKey
	Private ed25519.PrivateKey
}

func GenerateSigningKeys() (*SigningKeys, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	return &SigningKeys{Public: pub, Private: priv}, nil
}

// EncodePublic returns the base64 public key for enrollment.
func (k *SigningKeys) EncodePublic() string { return base64.StdEncoding.EncodeToString(k.Public) }

// EncodePrivate returns a compact base64 storage form of the private key.
func (k *SigningKeys) EncodePrivate() string { return base64.StdEncoding.EncodeToString(k.Private) }

// DecodeSigningKeys restores keys from stored strings.
func DecodeSigningKeys(pubB64, privB64 string) (*SigningKeys, error) {
	pub, err := base64.StdEncoding.DecodeString(pubB64)
	if err != nil {
		return nil, err
	}
	priv, err := base64.StdEncoding.DecodeString(privB64)
	if err != nil {
		return nil, err
	}
	if len(pub) != ed25519.PublicKeySize || len(priv) != ed25519.PrivateKeySize {
		return nil, errors.New("invalid stored signing keys")
	}
	return &SigningKeys{Public: ed25519.PublicKey(pub), Private: ed25519.PrivateKey(priv)}, nil
}

// TLSKeys holds the panel's ECDSA P-256 keypair for mTLS with the coordinator.
type TLSKeys struct {
	Key *ecdsa.PrivateKey
}

func GenerateTLSKeys() (*TLSKeys, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	return &TLSKeys{Key: key}, nil
}

// CSRPEM builds a certificate signing request PEM for enrollment/renewal.
func (t *TLSKeys) CSRPEM() ([]byte, error) {
	tpl := &x509.CertificateRequest{
		Subject:  pkix.Name{CommonName: "sharx-panel"},
		DNSNames: []string{"sharx-panel"},
	}
	csr, err := x509.CreateCertificateRequest(rand.Reader, tpl, t.Key)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr}), nil
}

// EncodePrivatePEM stores the TLS private key as PEM.
func (t *TLSKeys) EncodePrivatePEM() (string, error) {
	raw, err := x509.MarshalECPrivateKey(t.Key)
	if err != nil {
		return "", err
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: raw})), nil
}

// DecodeTLSKeys restores a TLS keypair from stored PEM.
func DecodeTLSKeys(privPEM string) (*TLSKeys, error) {
	block, _ := pem.Decode([]byte(privPEM))
	if block == nil {
		return nil, errors.New("invalid TLS private key PEM")
	}
	key, err := x509.ParseECPrivateKey(block.Bytes)
	if err != nil {
		// PKCS#8 fallback.
		parsed, err2 := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err2 != nil {
			return nil, err
		}
		ecKey, ok := parsed.(*ecdsa.PrivateKey)
		if !ok {
			return nil, errors.New("TLS private key is not ECDSA")
		}
		return &TLSKeys{Key: ecKey}, nil
	}
	return &TLSKeys{Key: key}, nil
}
