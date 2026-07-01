package secretpath

import (
	"fmt"
	"strings"
	"unicode"
)

// NormalizePathPrefix validates and normalizes a URL path prefix (/segment/ or / for default).
func NormalizePathPrefix(path string, minSegmentLen int) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" || path == "/" {
		return "/", nil
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if !strings.HasSuffix(path, "/") {
		path += "/"
	}
	seg := strings.Trim(path, "/")
	if seg == "" {
		return "/", nil
	}
	if minSegmentLen > 0 && len(seg) < minSegmentLen {
		return "", fmt.Errorf("path segment must be at least %d characters", minSegmentLen)
	}
	for _, r := range seg {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' {
			continue
		}
		return "", fmt.Errorf("path segment may only contain letters, digits, hyphen and underscore")
	}
	return path, nil
}

// NormalizeWebBasePath validates a panel URL prefix (min 8 chars when not root).
func NormalizeWebBasePath(path string) (string, error) {
	return NormalizePathPrefix(path, 8)
}

// NormalizeSubPath validates a subscription URL prefix (min 3 chars when not root).
func NormalizeSubPath(path string) (string, error) {
	return NormalizePathPrefix(path, 3)
}
