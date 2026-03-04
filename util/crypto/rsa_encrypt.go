package crypto

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"sync"
)

// EncryptForHapp encrypts a URL string for Happ using local RSA encryption
// Returns the encrypted string in base64 format, ready for happ://crypt5/ prefix
func EncryptForHapp(url string) (string, error) {
	// Check URL length
	if len(url) > 450 {
		return "", fmt.Errorf("URL too long for encryption (max 450 characters, got %d)", len(url))
	}

	// Use local RSA encryption instead of API
	return EncryptForHappLocal(url)
}

// V2RayTun RSA-4096 public key (embedded)
const v2raytunPublicKeyPEM = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEArK77160gyNm0olpdA+WO
f1ClV4ndeRhBDYPQYs4hUq3YDwP1dQTdxaILcdnYJS2Wpfzqo8JiAvwhatBHJ2Kq
p/KSll5JSoqYAKj+1GdSF+nOCXc3wBeGR8mD6KdSRnoAE+x6wZcydNggQluClcx3
zTGjwWnBxUWfKlcQeHxHTtO+2i6Dga2o4it5J2uXOupEo9mrBZdc1BSKvrmoycMp
iaRF4YKRhwY1jZnEjx2BKA/xFQIDiIFQIAIKKPNKoIWbnQ66lEJSOr1DuIVGYgdr
xyupIQW3rvkGirybgx0+lIOn9J7c9doBDWHknOqGG0VeGKiVFMv5klG7KTsH89qe
nXfgrGQVEknAeGOrMPgjF+Zs52eHLeaWXCr4sCRgvAoPeBfMTfavu/Y0mnufD8SN
z8OdQSVT9jphXeM2YXtnwi971fsF97bykEK5ytco4zf9hgbEjioU7/cAvz20RyxY
EFCouOZsGXkwlUq+xDEPRIyQj2OwGl5xpjDJ4uAq5Shi4EUk01wUfRzTVDQIWJXC
O7Z9K4FcKRKY3m42fWr8fZl5rQbnmrLMLnD88n7VZBRkIhfnt7XHtTCVWBwCDqsG
ceUX0Xf+ZwQ8tNYfE5ipy6RlkuZD8Ddlpk8qhstCBu82igNfRcSsJ5KT36aAhfZ+
WYqjdHmjzdjEGJqpfg1K1JMCAwEAAQ==
-----END PUBLIC KEY-----`

// Happ RSA-4096 public key (embedded)
const happPublicKeyPEM = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAlBetA0wjbaj+h7oJ/d/h
pNrXvAcuhOdFGEFcfCxSWyLzWk4SAQ05gtaEGZyetTax2uqagi9HT6lapUSUe2S8
nMLJf5K+LEs9TYrhhBdx/B0BGahA+lPJa7nUwp7WfUmSF4hir+xka5ApHjzkAQn6
cdG6FKtSPgq1rYRPd1jRf2maEHwiP/e/jqdXLPP0SFBjWTMt/joUDgE7v/IGGB0L
Q7mGPAlgmxwUHVqP4bJnZ//5sNLxWMjtYHOYjaV+lixNSfhFM3MdBndjpkmgSfmg
D5uYQYDL29TDk6Eu+xetUEqry8ySPjUbNWdDXCglQWMxDGjaqYXMWgxBA1UKjUBW
wbgr5yKTJ7mTqhlYEC9D5V/LOnKd6pTSvaMxkHXwk8hBWvUNWAxzAf5JZ7EVE3jt
0j682+/hnmL/hymUE44yMG1gCcWvSpB3BTlKoMnl4yrTakmdkbASeFRkN3iMRewa
IenvMhzJh1fq7xwX94otdd5eLB2vRFavrnhOcN2JJAkKTnx9dwQwFpGEkg+8U613
+Tfm/f82l56fFeoFN98dD2mUFLFZoeJ5CG81ZeXrH83niI0joX7rtoAZIPWzq3Y1
Zb/Zq+kK2hSIhphY172Uvs8X2Qp2ac9UoTPM71tURsA9IvPNvUwSIo/aKlX5KE3I
VE0tje7twWXL5Gb1sfcXRzsCAwEAAQ==
-----END PUBLIC KEY-----`

var (
	v2raytunPublicKey *rsa.PublicKey
	v2raytunKeyOnce   sync.Once
	v2raytunKeyErr    error
	happPublicKey     *rsa.PublicKey
	happKeyOnce       sync.Once
	happKeyErr        error
)

// loadV2RayTunPublicKey loads and parses the V2RayTun RSA-4096 public key
func loadV2RayTunPublicKey() (*rsa.PublicKey, error) {
	v2raytunKeyOnce.Do(func() {
		block, _ := pem.Decode([]byte(v2raytunPublicKeyPEM))
		if block == nil {
			v2raytunKeyErr = fmt.Errorf("failed to decode PEM block containing public key")
			return
		}

		pub, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			v2raytunKeyErr = fmt.Errorf("failed to parse public key: %w", err)
			return
		}

		rsaPub, ok := pub.(*rsa.PublicKey)
		if !ok {
			v2raytunKeyErr = fmt.Errorf("key is not RSA public key")
			return
		}

		v2raytunPublicKey = rsaPub
	})

	if v2raytunKeyErr != nil {
		return nil, v2raytunKeyErr
	}

	return v2raytunPublicKey, nil
}

// loadHappPublicKey loads and parses the Happ RSA-4096 public key
func loadHappPublicKey() (*rsa.PublicKey, error) {
	happKeyOnce.Do(func() {
		block, _ := pem.Decode([]byte(happPublicKeyPEM))
		if block == nil {
			happKeyErr = fmt.Errorf("failed to decode PEM block containing public key")
			return
		}

		pub, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			happKeyErr = fmt.Errorf("failed to parse public key: %w", err)
			return
		}

		rsaPub, ok := pub.(*rsa.PublicKey)
		if !ok {
			happKeyErr = fmt.Errorf("key is not RSA public key")
			return
		}

		happPublicKey = rsaPub
	})

	if happKeyErr != nil {
		return nil, happKeyErr
	}

	return happPublicKey, nil
}

// EncryptForV2RayTunLocal encrypts a URL string locally using RSA-4096
// Returns the encrypted string in base64 format, ready for v2raytun://crypt/ prefix
func EncryptForV2RayTunLocal(url string) (string, error) {
	// Check URL length (RSA-4096 can encrypt up to ~446 bytes, but we limit to 450 for consistency)
	if len(url) > 450 {
		return "", fmt.Errorf("URL too long for encryption (max 450 characters, got %d)", len(url))
	}

	// Load public key
	pubKey, err := loadV2RayTunPublicKey()
	if err != nil {
		return "", fmt.Errorf("failed to load V2RayTun public key: %w", err)
	}

	// RSA-4096 can encrypt up to (keySize/8 - 11) bytes = (4096/8 - 11) = 501 bytes
	// But we limit to 450 characters for safety
	urlBytes := []byte(url)

	// Encrypt using RSA-OAEP with SHA-256
	// V2RayTun uses OAEP padding with SHA-256 hash
	hash := sha256.New()
	encrypted, err := rsa.EncryptOAEP(
		hash,
		rand.Reader,
		pubKey,
		urlBytes,
		nil, // No label
	)
	if err != nil {
		return "", fmt.Errorf("failed to encrypt URL: %w", err)
	}

	// Encode to base64
	encryptedBase64 := base64.StdEncoding.EncodeToString(encrypted)
	return encryptedBase64, nil
}

// EncryptForV2RayTun encrypts a URL string for V2RayTun using local RSA encryption
// Returns the encrypted string in base64 format, ready for v2raytun://crypt/ prefix
func EncryptForV2RayTun(url string) (string, error) {
	// Check URL length
	if len(url) > 450 {
		return "", fmt.Errorf("URL too long for encryption (max 450 characters, got %d)", len(url))
	}

	// Use local RSA encryption instead of API
	return EncryptForV2RayTunLocal(url)
}

// EncryptForHappLocal encrypts a URL string locally using RSA-4096
// Returns the encrypted string in base64 format, ready for happ://crypt5/ prefix
func EncryptForHappLocal(url string) (string, error) {
	// Check URL length (RSA-4096 can encrypt up to ~446 bytes, but we limit to 450 for consistency)
	if len(url) > 450 {
		return "", fmt.Errorf("URL too long for encryption (max 450 characters, got %d)", len(url))
	}

	// Load public key
	pubKey, err := loadHappPublicKey()
	if err != nil {
		return "", fmt.Errorf("failed to load Happ public key: %w", err)
	}

	// RSA-4096 can encrypt up to (keySize/8 - 11) bytes = (4096/8 - 11) = 501 bytes
	// But we limit to 450 characters for safety
	urlBytes := []byte(url)

	// Encrypt using RSA-OAEP with SHA-256
	// Happ uses OAEP padding with SHA-256 hash
	hash := sha256.New()
	encrypted, err := rsa.EncryptOAEP(
		hash,
		rand.Reader,
		pubKey,
		urlBytes,
		nil, // No label
	)
	if err != nil {
		return "", fmt.Errorf("failed to encrypt URL: %w", err)
	}

	// Encode to base64
	encryptedBase64 := base64.StdEncoding.EncodeToString(encrypted)
	return encryptedBase64, nil
}
