package service

import (
	"regexp"
	"strings"
)

// SubscriptionSubIDToken is the placeholder token accepted in subscription
// response values that may embed the requesting client's subId.
const SubscriptionSubIDToken = "{subid}"

// subscriptionSubIDPlaceholderRe matches the subId placeholder in its lenient
// spellings: {subid}, {{subid}}, any letter case, and optional inner spaces
// ({ subid }, {{ SUBID }}).
var subscriptionSubIDPlaceholderRe = regexp.MustCompile(`(?i)\{\{?\s*subid\s*\}?\}`)

// sanitizeSubscriptionSubID drops ASCII control characters (C0 and DEL) from the
// subId before it is embedded into a response value. The subId arrives from the
// request path, and a CR/LF would otherwise inject extra lines into the Happ
// body meta comments (for example a forged "#announce: ..." line).
func sanitizeSubscriptionSubID(subID string) string {
	if subID == "" {
		return subID
	}
	return strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, subID)
}

// ExpandSubscriptionPlaceholders replaces every subId placeholder in value with
// subID and returns the expanded string.
//
// The placeholder is resolved only when a subscription response is rendered (the
// subId is the one the client asked for), so a single configured value yields a
// per-user URL. An empty subID removes the token; a subID containing '$' is
// inserted literally (a function-based replacement is used, not an expansion
// template), and control characters are stripped from it so the value stays on
// one line. Only the value passed by the caller is touched: no other response
// field (supportUrl, announce, extraHeaders, ...) supports the placeholder.
func ExpandSubscriptionPlaceholders(value, subID string) string {
	if value == "" || !strings.Contains(value, "{") {
		return value
	}
	safeSubID := sanitizeSubscriptionSubID(subID)
	return subscriptionSubIDPlaceholderRe.ReplaceAllStringFunc(value, func(string) string {
		return safeSubID
	})
}
