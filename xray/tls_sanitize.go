package xray

import "strings"

// tlsPinnedPeerCertKeys lists legacy panel / 3x-ui field names for certificate pinning.
var tlsPinnedPeerCertKeys = []string{
	"pinnedPeerCertSha256",
	"pinnedPeerCertificateChainSha256",
}

// PinnedPeerCertSha256FromTLS extracts a comma-separated pin list from tlsSettings (any supported key).
func PinnedPeerCertSha256FromTLS(tls map[string]any) string {
	if tls == nil {
		return ""
	}
	for _, key := range tlsPinnedPeerCertKeys {
		switch v := tls[key].(type) {
		case string:
			if s := strings.TrimSpace(v); s != "" {
				return s
			}
		case []any:
			var parts []string
			for _, item := range v {
				if s, ok := item.(string); ok {
					if t := strings.TrimSpace(s); t != "" {
						parts = append(parts, t)
					}
				}
			}
			if len(parts) > 0 {
				return strings.Join(parts, ",")
			}
		case []string:
			var parts []string
			for _, s := range v {
				if t := strings.TrimSpace(s); t != "" {
					parts = append(parts, t)
				}
			}
			if len(parts) > 0 {
				return strings.Join(parts, ",")
			}
		}
	}
	return ""
}

// SanitizeClientTLSSettings prepares tlsSettings for Xray client outbounds / streamSettings.
// Removes deprecated allowInsecure, normalizes pin field name, lifts fingerprint from legacy nested settings.
func SanitizeClientTLSSettings(tls map[string]any) map[string]any {
	if tls == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(tls))
	for k, v := range tls {
		switch k {
		case "allowInsecure", "settings":
			continue
		case "pinnedPeerCertSha256", "pinnedPeerCertificateChainSha256":
			continue
		default:
			out[k] = v
		}
	}
	if nested, ok := tls["settings"].(map[string]any); ok {
		if fp, ok := nested["fingerprint"].(string); ok && strings.TrimSpace(fp) != "" {
			if _, has := out["fingerprint"]; !has {
				out["fingerprint"] = strings.TrimSpace(fp)
			}
		}
		if ech, ok := nested["echConfigList"].(string); ok && strings.TrimSpace(ech) != "" {
			if _, has := out["echConfigList"]; !has {
				out["echConfigList"] = strings.TrimSpace(ech)
			}
		}
	}
	if pin := PinnedPeerCertSha256FromTLS(tls); pin != "" {
		out["pinnedPeerCertSha256"] = pin
	} else {
		delete(out, "pinnedPeerCertSha256")
	}
	delete(out, "allowInsecure")
	delete(out, "pinnedPeerCertificateChainSha256")
	return out
}

// NormalizeSubscriptionStreamSettings sanitizes inbound streamSettings for client subscriptions.
// Legacy panel / Xray 2026+ configs may store pinnedPeerCertSha256 as a JSON array; INCY and
// older Xray clients expect a comma-separated string in tlsSettings.
func NormalizeSubscriptionStreamSettings(stream map[string]any) map[string]any {
	if stream == nil {
		return map[string]any{}
	}
	security, _ := stream["security"].(string)
	if tls, ok := stream["tlsSettings"].(map[string]any); ok {
		stream["tlsSettings"] = SanitizeClientTLSSettings(tls)
	} else if security == "tls" {
		stream["tlsSettings"] = SanitizeClientTLSSettings(nil)
	}
	if security != "tls" {
		delete(stream, "tlsSettings")
	}
	return stream
}
