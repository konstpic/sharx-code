package sub

import "strings"

// AppGateReason identifies why a subscription request was blocked by the client-app gate.
type AppGateReason string

const (
	AppGateReasonNone       AppGateReason = ""
	AppGateReasonUnknownApp AppGateReason = "unknown_app"
	AppGateReasonBlockedApp AppGateReason = "blocked_app"
)

// AppGateDecision is the outcome of evaluating the client-app gate for one subscription request.
type AppGateDecision struct {
	Blocked bool
	Reason  AppGateReason
}

// appKeySet parses a comma-separated app-key list into a lower-cased set.
func appKeySet(csv string) map[string]bool {
	set := map[string]bool{}
	for _, raw := range strings.Split(csv, ",") {
		if k := strings.ToLower(strings.TrimSpace(raw)); k != "" {
			set[k] = true
		}
	}
	return set
}

// EvaluateAppGate decides whether a subscription request should be blocked based on the
// User-Agent-classified client app. This is a best-effort filter, not a security boundary:
// User-Agent (and the x-client header INCY uses) is fully client-controlled and trivially
// spoofed, so it only discourages casual non-compliant clients and scrapers, not a determined
// attacker impersonating an allowed app.
//
//   - enabled=false: gate is off, always allows.
//   - requireKnownApp=true: requests classified as UAUnknown (no recognized app signature) are
//     blocked — the client must send a User-Agent (or x-client header) we recognize.
//   - blockedAppsCSV: comma-separated app keys (see UAClient.Key()) that are always blocked,
//     e.g. "incy". The blocklist wins over the allowlist.
//   - allowedAppsCSV: comma-separated app keys; when non-empty it is an allowlist — every app
//     not listed (including unrecognized ones) is blocked, so "only incy" is a single entry.
func EvaluateAppGate(uaClient UAClient, enabled bool, requireKnownApp bool, blockedAppsCSV string, allowedAppsCSV string) AppGateDecision {
	if !enabled {
		return AppGateDecision{}
	}
	if uaClient == UAUnknown && requireKnownApp {
		return AppGateDecision{Blocked: true, Reason: AppGateReasonUnknownApp}
	}
	key := uaClient.Key()
	if appKeySet(blockedAppsCSV)[key] {
		return AppGateDecision{Blocked: true, Reason: AppGateReasonBlockedApp}
	}
	if allowed := appKeySet(allowedAppsCSV); len(allowed) > 0 && !allowed[key] {
		return AppGateDecision{Blocked: true, Reason: AppGateReasonBlockedApp}
	}
	return AppGateDecision{}
}
