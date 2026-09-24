package service

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Shared-template sanitizers: everything published to the templates hub must be free of credentials,
// per-client data and host-specific values. The hub rejects known secret fields as a second line of defence.

const shareFormatVersion = 1

// secretFieldNames are removed anywhere in a shared document (case-insensitive).
var secretFieldNames = map[string]bool{
	"privatekey": true, "password": true, "secret": true, "secretkey": true, "presharedkey": true,
	"psk": true, "token": true, "apikey": true, "api_key": true, "authtoken": true, "auth_password": true,
}

// shareableXrayOutbounds carry no upstream credentials.
var shareableXrayOutbounds = map[string]bool{"freedom": true, "blackhole": true, "dns": true, "loopback": true}

// scrubSecrets deletes secret fields recursively and records their dotted paths.
func scrubSecrets(v any, path string, removed *[]string) any {
	switch x := v.(type) {
	case map[string]any:
		for k, child := range x {
			p := k
			if path != "" {
				p = path + "." + k
			}
			lk := strings.ToLower(k)
			if secretFieldNames[lk] {
				if s, isStr := child.(string); !isStr || s != "" {
					*removed = append(*removed, p)
				}
				delete(x, k)
				continue
			}
			if lk == "clients" {
				if arr, ok := child.([]any); ok && len(arr) > 0 {
					*removed = append(*removed, p)
				}
				x[k] = []any{}
				continue
			}
			x[k] = scrubSecrets(child, p, removed)
		}
		return x
	case []any:
		for i, c := range x {
			x[i] = scrubSecrets(c, fmt.Sprintf("%s[%d]", path, i), removed)
		}
		return x
	}
	return v
}

func parseJSONObject(raw string) (map[string]any, error) {
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}, nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return nil, err
	}
	if m == nil {
		m = map[string]any{}
	}
	return m, nil
}

func pick(src map[string]any, keys ...string) map[string]any {
	out := map[string]any{}
	for _, k := range keys {
		if v, ok := src[k]; ok {
			out[k] = v
		}
	}
	return out
}

// SanitizeInboundSettings keeps only protocol-level, non-secret settings.
func SanitizeInboundSettings(protocol, raw string) (map[string]any, []string, error) {
	src, err := parseJSONObject(raw)
	if err != nil {
		return nil, nil, fmt.Errorf("inbound settings are not valid JSON: %w", err)
	}
	var warns []string
	var out map[string]any
	switch protocol {
	case "vless":
		out = pick(src, "fallbacks")
		out["decryption"] = "none"
		if d, _ := src["decryption"].(string); d != "" && d != "none" {
			warns = append(warns, "settings.decryption: VLESS encryption key removed (generate a new one after import)")
		}
	case "vmess":
		out = pick(src)
	case "trojan":
		out = pick(src, "fallbacks")
	case "shadowsocks":
		out = pick(src, "method", "network")
		warns = append(warns, "settings.password: Shadowsocks password removed")
	case "hysteria", "hysteria2":
		out = pick(src, "version")
	case "mixed", "socks", "http":
		out = pick(src, "auth", "udp", "ip")
		if _, ok := src["accounts"]; ok {
			warns = append(warns, "settings.accounts: accounts removed")
		}
	case "telemt", "amneziawg", "wireguard":
		out = sanitizeSidecarSettings(protocol, src, &warns)
	default:
		return nil, nil, fmt.Errorf("inbounds of protocol %q cannot be shared", protocol)
	}
	if arr, ok := src["clients"].([]any); ok && len(arr) > 0 {
		warns = append(warns, fmt.Sprintf("settings.clients: %d client(s) removed", len(arr)))
	}
	return out, warns, nil
}

// hostSpecificSidecarKeys are dropped from Telemt / WireGuard / AmneziaWG settings: they identify the source
// server or account rather than describe a reusable setup.
var hostSpecificSidecarKeys = map[string]bool{
	"adtag": true, "publichost": true, "middleproxynatip": true, "headerprotectionkey": true,
	"peers": true, "users": true, "accounts": true,
}

// sanitizeSidecarSettings keeps the protocol tuning (obfuscation, censorship, modes, MTU, …) and removes keys,
// peers, ad tags and host addresses. Works on a copy at any nesting depth, so both flat and {"telemt": {...}} shapes are covered.
func sanitizeSidecarSettings(protocol string, src map[string]any, warns *[]string) map[string]any {
	var strip func(v any, path string) any
	strip = func(v any, path string) any {
		switch x := v.(type) {
		case map[string]any:
			out := make(map[string]any, len(x))
			for k, child := range x {
				p := k
				if path != "" {
					p = path + "." + k
				}
				lk := strings.ToLower(k)
				if hostSpecificSidecarKeys[lk] {
					if !isEmptyShareValue(child) {
						*warns = append(*warns, "settings."+p+": removed (specific to the source server)")
					}
					continue
				}
				if secretFieldNames[lk] {
					if !isEmptyShareValue(child) {
						*warns = append(*warns, "settings."+p+": secret removed")
					}
					continue
				}
				if lk == "clients" {
					out[k] = []any{}
					continue
				}
				out[k] = strip(child, p)
			}
			return out
		case []any:
			out := make([]any, len(x))
			for i, c := range x {
				out[i] = strip(c, path)
			}
			return out
		}
		return v
	}
	res, _ := strip(src, "").(map[string]any)
	if res == nil {
		res = map[string]any{}
	}
	if protocol == "wireguard" || protocol == "amneziawg" {
		res["peers"] = []any{}
		*warns = append(*warns, "settings.secretKey: interface key removed (a new one is generated on import)")
	}
	return res
}

func isEmptyShareValue(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case string:
		return x == ""
	case []any:
		return len(x) == 0
	case map[string]any:
		return len(x) == 0
	}
	return false
}

// SanitizeStreamSettings removes keys, certificates and host-specific values from streamSettings.
func SanitizeStreamSettings(raw string) (map[string]any, []string, error) {
	m, err := parseJSONObject(raw)
	if err != nil {
		return nil, nil, fmt.Errorf("streamSettings are not valid JSON: %w", err)
	}
	var warns []string
	if rs, ok := m["realitySettings"].(map[string]any); ok {
		if s, _ := rs["privateKey"].(string); s != "" {
			warns = append(warns, "streamSettings.realitySettings.privateKey: Reality key removed (generate a new pair after import)")
		}
		rs["privateKey"] = ""
		delete(rs, "publicKey")
		rs["shortIds"] = []any{}
	}
	if ts, ok := m["tlsSettings"].(map[string]any); ok {
		if certs, ok := ts["certificates"].([]any); ok && len(certs) > 0 {
			warns = append(warns, "streamSettings.tlsSettings.certificates: certificate paths removed")
		}
		ts["certificates"] = []any{}
		if s, _ := ts["serverName"].(string); s != "" {
			warns = append(warns, "streamSettings.tlsSettings.serverName: domain removed")
		}
		ts["serverName"] = ""
		delete(ts, "pinnedPeerCertSha256")
	}
	if _, ok := m["externalProxy"]; ok {
		delete(m, "externalProxy")
		warns = append(warns, "streamSettings.externalProxy: external hosts removed")
	}
	var removed []string
	scrubSecrets(m, "streamSettings", &removed)
	for _, p := range removed {
		warns = append(warns, p+": secret removed")
	}
	return m, warns, nil
}

// SharedInboundContent builds the publishable document for one inbound.
func SharedInboundContent(protocol string, port int, settingsRaw, streamRaw, sniffingRaw, trafficReset string) (map[string]any, []string, error) {
	settings, w1, err := SanitizeInboundSettings(protocol, settingsRaw)
	if err != nil {
		return nil, nil, err
	}
	stream, w2, err := SanitizeStreamSettings(streamRaw)
	if err != nil {
		return nil, nil, err
	}
	sniffing, err := parseJSONObject(sniffingRaw)
	if err != nil {
		return nil, nil, fmt.Errorf("sniffing is not valid JSON: %w", err)
	}
	doc := map[string]any{
		"formatVersion":  shareFormatVersion,
		"protocol":       protocol,
		"port":           port,
		"settings":       settings,
		"streamSettings": stream,
		"sniffing":       sniffing,
	}
	if trafficReset != "" {
		doc["trafficReset"] = trafficReset
	}
	return doc, append(w1, w2...), nil
}

// SanitizeXrayTemplate prepares a full Xray core template for sharing: credential-bearing outbounds are dropped.
func SanitizeXrayTemplate(raw string) (map[string]any, []string, error) {
	m, err := parseJSONObject(raw)
	if err != nil {
		return nil, nil, fmt.Errorf("xray template is not valid JSON: %w", err)
	}
	var warns []string
	if outs, ok := m["outbounds"].([]any); ok {
		kept := make([]any, 0, len(outs))
		for _, o := range outs {
			om, _ := o.(map[string]any)
			proto, _ := om["protocol"].(string)
			if shareableXrayOutbounds[proto] {
				kept = append(kept, o)
				continue
			}
			tag, _ := om["tag"].(string)
			warns = append(warns, fmt.Sprintf("outbounds: %s outbound %q removed (may contain credentials)", proto, tag))
		}
		m["outbounds"] = kept
	}
	var removed []string
	scrubSecrets(m, "", &removed)
	sort.Strings(removed)
	for _, p := range removed {
		warns = append(warns, p+": secret removed")
	}
	return m, warns, nil
}
