package secretpath

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

// GenerateSegment returns a URL-safe random path segment (hex, even length).
func GenerateSegment(byteLen int) string {
	if byteLen < 8 {
		byteLen = 8
	}
	b := make([]byte, byteLen)
	if _, err := rand.Read(b); err != nil {
		panic("secretpath: crypto/rand failed: " + err.Error())
	}
	return hex.EncodeToString(b)
}

// GenerateWebBasePath returns a panel prefix like /a1b2c3.../ (not "/").
func GenerateWebBasePath() string {
	return "/" + GenerateSegment(12) + "/"
}

// GenerateSubPath returns a subscription prefix like /x9y8z7.../.
func GenerateSubPath() string {
	return "/" + GenerateSegment(12) + "/"
}

// HidesBareRoot reports whether GET / should return 404 (secret path enabled).
func HidesBareRoot(basePath string) bool {
	basePath = strings.TrimSpace(basePath)
	return basePath != "" && basePath != "/"
}
