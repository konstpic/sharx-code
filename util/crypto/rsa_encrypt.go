package crypto

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"math/big"
	"sync"
)

// EncryptForHapp encrypts a URL string for Happ using local RSA encryption
// Returns the encrypted string in base64 format, ready for happ://crypt4/ prefix
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

// Happ RSA-4096 public key (embedded) - V4 key from @kastov/cryptohapp library
const happPublicKeyPEM = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA3UZ0M3L4K+WjM3vkbQnz
ozHg/cRbEXvQ6i4A8RVN4OM3rK9kU01FdjyoIgywve8OEKsFnVwERZAQZ1Trv60B
hmaM76QQEE+EUlIOL9EpwKWGtTL5lYC1sT9XJMNP3/CI0gP5wwQI88cY/xedpOEB
W72EmOOShHUm/b/3m+HPmqwc4ugKj5zWV5SyiT829aFA5DxSjmIIFBAms7DafmSq
LFTYIQL5cShDY2u+/sqyAw9yZIOoqW2TFIgIHhLPWek/ocDU7zyOrlu1E0SmcQQb
LFqHq02fsnH6IcqTv3N5Adb/CkZDDQ6HvQVBmqbKZKf7ZdXkqsc/Zw27xhG7OfXC
tUmWsiL7zA+KoTd3avyOh93Q9ju4UQsHthL3Gs4vECYOCS9dsXXSHEY/1ngU/hjO
WFF8QEE/rYV6nA4PTyUvo5RsctSQL/9DJX7XNh3zngvif8LsCN2MPvx6X+zLouBX
zgBkQ9DFfZAGLWf9TR7KVjZC/3NsuUCDoAOcpmN8pENBbeB0puiKMMWSvll36+2M
YR1Xs0MgT8Y9TwhE2+TnnTJOhzmHi/BxiUlY/w2E0s4ax9GHAmX0wyF4zeV7kDkc
vHuEdc0d7vDmdw0oqCqWj0Xwq86HfORu6tm1A8uRATjb4SzjTKclKuoElVAVa5Jo
oh/uZMozC65SmDw+N5p6Su8CAwEAAQ==
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

// encryptPKCS1v15 encrypts data using RSA PKCS1 v1.5 padding
// This matches the behavior of Node.js crypto.publicEncrypt with RSA_PKCS1_PADDING
func encryptPKCS1v15(pub *rsa.PublicKey, data []byte) ([]byte, error) {
	// RSA-4096 can encrypt up to (keySize/8 - 11) bytes with PKCS1 padding
	k := (pub.N.BitLen() + 7) / 8
	if len(data) > k-11 {
		return nil, fmt.Errorf("data too large for RSA key size")
	}

	// PKCS1 v1.5 padding: 0x00 || 0x02 || PS || 0x00 || M
	// PS is a string of non-zero random bytes
	em := make([]byte, k)
	em[0] = 0x00
	em[1] = 0x02

	// Fill PS with random non-zero bytes
	psLen := k - len(data) - 3
	_, err := rand.Read(em[2 : 2+psLen])
	if err != nil {
		return nil, err
	}

	// Ensure all PS bytes are non-zero
	for i := 2; i < 2+psLen; i++ {
		for em[i] == 0 {
			_, err := rand.Read(em[i : i+1])
			if err != nil {
				return nil, err
			}
		}
	}

	em[2+psLen] = 0x00
	copy(em[3+psLen:], data)

	// Encrypt: c = m^e mod n
	c := new(big.Int).SetBytes(em)
	if c.Cmp(pub.N) >= 0 {
		return nil, fmt.Errorf("data too large for RSA key size")
	}

	m := new(big.Int).Exp(c, big.NewInt(int64(pub.E)), pub.N)
	return m.FillBytes(make([]byte, k)), nil
}

// EncryptForHappLocal encrypts a URL string locally using RSA-4096 with PKCS1 padding
// Returns the encrypted string in base64 format, ready for happ://crypt4/ prefix
// This matches the behavior of @kastov/cryptohapp library which uses PKCS1 padding
func EncryptForHappLocal(url string) (string, error) {
	// Check URL length (RSA-4096 with PKCS1 can encrypt up to (4096/8 - 11) = 501 bytes)
	if len(url) > 450 {
		return "", fmt.Errorf("URL too long for encryption (max 450 characters, got %d)", len(url))
	}

	// Load public key
	pubKey, err := loadHappPublicKey()
	if err != nil {
		return "", fmt.Errorf("failed to load Happ public key: %w", err)
	}

	urlBytes := []byte(url)

	// Encrypt using RSA with PKCS1 v1.5 padding (not OAEP!)
	// Happ crypt4 uses PKCS1 padding as per @kastov/cryptohapp library
	encrypted, err := encryptPKCS1v15(pubKey, urlBytes)
	if err != nil {
		return "", fmt.Errorf("failed to encrypt URL: %w", err)
	}

	// Encode to base64 using standard encoding with padding
	// This matches Node.js Buffer.toString('base64') behavior
	encryptedBase64 := base64.StdEncoding.EncodeToString(encrypted)
	return encryptedBase64, nil
}
