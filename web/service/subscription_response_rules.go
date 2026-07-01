package service

import (
	"encoding/base64"
	"strconv"
	"strings"
)

// ProfileTitleHTTPValue returns the Profile-Title header value (base64-encoded).
func ProfileTitleHTTPValue(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}
	if strings.HasPrefix(title, "base64:") {
		return title
	}
	return "base64:" + base64.StdEncoding.EncodeToString([]byte(title))
}

// ProfileTitleBodyValue returns the profile-title body comment value (plain text).
func ProfileTitleBodyValue(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}
	if strings.HasPrefix(title, "base64:") {
		raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(title, "base64:"))
		if err == nil {
			return string(raw)
		}
	}
	return title
}

// AnnounceHTTPValue returns the Announce header value (base64-encoded UTF-8).
func AnnounceHTTPValue(announce string) string {
	announce = strings.TrimSpace(announce)
	if announce == "" {
		return ""
	}
	if strings.HasPrefix(announce, "base64:") {
		return announce
	}
	return "base64:" + base64.StdEncoding.EncodeToString([]byte(announce))
}

// AnnounceBodyValue returns the announce body comment value (plain text).
func AnnounceBodyValue(announce string) string {
	announce = strings.TrimSpace(announce)
	if announce == "" {
		return ""
	}
	if strings.HasPrefix(announce, "base64:") {
		raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(announce, "base64:"))
		if err == nil {
			return string(raw)
		}
	}
	return announce
}

// EffectiveAnnounce picks client-level announce over config announce.
func EffectiveAnnounce(clientAnnounce, configAnnounce string) string {
	if strings.TrimSpace(clientAnnounce) != "" {
		return strings.TrimSpace(clientAnnounce)
	}
	return strings.TrimSpace(configAnnounce)
}

// ProfileUpdateIntervalValue returns the interval hours sent to clients (default 12).
func ProfileUpdateIntervalValue(rr *SharxSubpageResponseRules) int {
	if rr == nil || rr.ProfileUpdateInterval <= 0 {
		return 12
	}
	return rr.ProfileUpdateInterval
}

// ProfileUpdateIntervalBodyLine formats #profile-update-interval for subscription body.
func ProfileUpdateIntervalBodyLine(rr *SharxSubpageResponseRules) string {
	if rr == nil || !ResponseHeaderDeliversBody(rr.ProfileUpdateIntervalDelivery) {
		return ""
	}
	return subscriptionBodyMetaLine("profile-update-interval", strconv.Itoa(ProfileUpdateIntervalValue(rr)))
}

// SubscriptionBodyMetaLine formats a Happ body meta comment (#key: value).
func SubscriptionBodyMetaLine(key, value string) string {
	return subscriptionBodyMetaLine(key, value)
}

// subscriptionBodyMetaLine formats a Happ body meta comment (#key: value).
func subscriptionBodyMetaLine(key, value string) string {
	key = strings.ToLower(strings.TrimSpace(key))
	val := strings.TrimSpace(value)
	if key == "" || val == "" {
		return ""
	}
	if key == "providerid" {
		return "#providerid " + val + "\n"
	}
	return "#" + key + ": " + val + "\n"
}
