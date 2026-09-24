package service

import (
	"encoding/json"
	"strings"
)

func summaryStr(m map[string]any, k string) string {
	s, _ := m[k].(string)
	return strings.ToLower(strings.TrimSpace(s))
}

// SummarizeTemplate derives a small, non-sensitive digest of a template for gallery cards
// (same shape the templates hub returns for cloud templates).
func SummarizeTemplate(kind string, raw []byte) map[string]any {
	out := map[string]any{}
	var doc map[string]any
	if json.Unmarshal(raw, &doc) != nil || doc == nil {
		return out
	}
	switch kind {
	case "inbound":
		if p := summaryStr(doc, "protocol"); p != "" {
			out["protocol"] = p
		}
		if n, ok := doc["port"].(float64); ok && n > 0 && n < 65536 {
			out["port"] = int(n)
		}
		if ss, ok := doc["streamSettings"].(map[string]any); ok {
			if n := summaryStr(ss, "network"); n != "" {
				out["network"] = n
			}
			if s := summaryStr(ss, "security"); s != "" {
				out["security"] = s
			}
		}
	case "xray_config":
		if outs, ok := doc["outbounds"].([]any); ok {
			out["outbounds"] = len(outs)
		}
		if r, ok := doc["routing"].(map[string]any); ok {
			if rules, ok := r["rules"].([]any); ok {
				out["rules"] = len(rules)
			}
		}
		if d, ok := doc["dns"].(map[string]any); ok {
			if servers, ok := d["servers"].([]any); ok {
				out["dnsServers"] = len(servers)
			}
		}
	}
	return out
}
