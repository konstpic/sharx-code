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

// EvaluateAppGate decides whether a subscription request should be blocked based on the
// User-Agent-classified client app. This is a best-effort filter, not a security boundary:
// User-Agent (and the x-client header INCY uses) is fully client-controlled and trivially
// spoofed, so it only discourages casual non-compliant clients and scrapers, not a determined
// attacker impersonating an allowed app.
//
//   - enabled=false: gate is off, always allows.
//   - requireKnownApp=true: requests classified as UAUnknown (no recognized app signature) are
//     blocked — the client must send a User-Agent (or x-client header) we recognize.
//   - blockedAppsCSV: comma-separated app keys (see UAClient.Key()) that are always blocked
//     regardless of requireKnownApp, e.g. "incy" to block a specific unwanted client.
func EvaluateAppGate(uaClient UAClient, enabled bool, requireKnownApp bool, blockedAppsCSV string) AppGateDecision {
	if !enabled {
		return AppGateDecision{}
	}
	if uaClient == UAUnknown && requireKnownApp {
		return AppGateDecision{Blocked: true, Reason: AppGateReasonUnknownApp}
	}
	key := uaClient.Key()
	for _, raw := range strings.Split(blockedAppsCSV, ",") {
		blocked := strings.ToLower(strings.TrimSpace(raw))
		if blocked != "" && blocked == key {
			return AppGateDecision{Blocked: true, Reason: AppGateReasonBlockedApp}
		}
	}
	return AppGateDecision{}
}
