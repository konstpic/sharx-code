package sub

import (
	"encoding/base64"
	"strings"
	"unicode/utf8"
)

const maxSubscriptionServerDescriptionRunes = 30

// NormalizeSubscriptionServerDescription trims and caps text for share-link / INCY fragments.
func NormalizeSubscriptionServerDescription(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if utf8.RuneCountInString(s) <= maxSubscriptionServerDescriptionRunes {
		return s
	}
	runes := []rune(s)
	return string(runes[:maxSubscriptionServerDescriptionRunes])
}

// FormatShareLinkFragment builds #name or #name?serverDescription=base64 per INCY share-links.
func FormatShareLinkFragment(name, serverDescription string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Server"
	}
	desc := NormalizeSubscriptionServerDescription(serverDescription)
	if desc == "" {
		return name
	}
	b64 := base64.StdEncoding.EncodeToString([]byte(desc))
	return name + "?serverDescription=" + b64
}

func subscriptionServerDescriptionFromPanelInfo(text string) string {
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Server description:") {
			return NormalizeSubscriptionServerDescription(strings.TrimSpace(strings.TrimPrefix(line, "Server description:")))
		}
	}
	return ""
}
