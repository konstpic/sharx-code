// Package sub — Clash YAML subscription converter.
//
// Converts SharX subscription link strings (vless://, vmess://, trojan://,
// ss://, hysteria2://) into a minimal Clash/Mihomo YAML configuration that
// most Clash-based clients (clash-meta, Mihomo, v2rayN Clash mode, etc.) can
// import directly.
package sub

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/goccy/go-yaml"
)

// clashProxy is a Clash proxy entry.  We use map[string]any so that we can
// emit only the keys that are relevant for each protocol and avoid null
// fields in the YAML output.
type clashProxyMap = map[string]any

// LinksToClashYAML converts a slice of subscription link strings to a Clash
// YAML document body.  Links that cannot be parsed are silently skipped.
// The returned string includes the `proxies:`, `proxy-groups:`, and `rules:`
// sections that most Clash clients require.
func LinksToClashYAML(links []string) (string, error) {
	var proxies []clashProxyMap
	var names []string

	for _, raw := range links {
		raw = strings.TrimSpace(raw)
		if raw == "" || strings.HasPrefix(raw, "#") {
			continue
		}
		p := parseClashProxy(raw)
		if p == nil {
			continue
		}
		proxies = append(proxies, p)
		names = append(names, fmt.Sprint(p["name"]))
	}

	if len(proxies) == 0 {
		// Still return valid (empty) YAML so the client does not error out.
		proxies = []clashProxyMap{}
		names = []string{}
	}

	cfg := map[string]any{
		"mixed-port":       7890,
		"allow-lan":        false,
		"mode":             "rule",
		"log-level":        "info",
		"external-controller": "127.0.0.1:9090",
		"proxies": proxies,
		"proxy-groups": []any{
			map[string]any{
				"name":    "PROXY",
				"type":    "select",
				"proxies": names,
			},
		},
		"rules": []string{
			"MATCH,PROXY",
		},
	}

	out, err := yaml.Marshal(cfg)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// parseClashProxy tries to convert a single link string into a Clash proxy
// map.  Returns nil when the link cannot be parsed.
func parseClashProxy(raw string) clashProxyMap {
	switch {
	case strings.HasPrefix(raw, "vmess://"):
		return parseClashVmess(raw)
	case strings.HasPrefix(raw, "vless://"):
		return parseClashVless(raw)
	case strings.HasPrefix(raw, "trojan://"):
		return parseClashTrojan(raw)
	case strings.HasPrefix(raw, "ss://"):
		return parseClashSS(raw)
	case strings.HasPrefix(raw, "hysteria2://"),
		strings.HasPrefix(raw, "hy2://"):
		return parseClashHysteria2(raw)
	}
	return nil
}

// ─── helpers ──────────────────────────────────────────────────────────────────

func clashName(fragment, fallback string) string {
	if n := strings.TrimSpace(fragment); n != "" {
		if dec, err := url.PathUnescape(n); err == nil {
			return dec
		}
		return n
	}
	return fallback
}

// applyClashTLS adds TLS / Reality parameters to a proxy map from URL query.
func applyClashTLS(p clashProxyMap, q url.Values) {
	sec := strings.ToLower(q.Get("security"))
	if sec == "" {
		sec = "none"
	}
	switch sec {
	case "tls":
		p["tls"] = true
		if sni := q.Get("sni"); sni != "" {
			p["servername"] = sni
		}
		if fp := q.Get("fp"); fp != "" {
			p["client-fingerprint"] = fp
		}
		if alpn := q.Get("alpn"); alpn != "" {
			p["alpn"] = strings.Split(alpn, ",")
		}
	case "reality":
		p["tls"] = true
		if sni := q.Get("sni"); sni != "" {
			p["servername"] = sni
		}
		p["reality-opts"] = map[string]any{
			"public-key": q.Get("pbk"),
			"short-id":   q.Get("sid"),
		}
		if fp := q.Get("fp"); fp != "" {
			p["client-fingerprint"] = fp
		}
	}
}

// applyClashTransport fills the Clash `network` and transport-settings keys.
func applyClashTransport(p clashProxyMap, q url.Values) {
	net := strings.ToLower(q.Get("type"))
	if net == "" {
		net = "tcp"
	}
	p["network"] = net
	switch net {
	case "ws":
		wsOpts := map[string]any{}
		if path := q.Get("path"); path != "" {
			wsOpts["path"] = path
		}
		if host := q.Get("host"); host != "" {
			wsOpts["headers"] = map[string]any{"Host": host}
		}
		p["ws-opts"] = wsOpts
	case "grpc":
		grpcOpts := map[string]any{}
		if sn := q.Get("serviceName"); sn != "" {
			grpcOpts["grpc-service-name"] = sn
		}
		p["grpc-opts"] = grpcOpts
	case "h2":
		h2Opts := map[string]any{}
		if path := q.Get("path"); path != "" {
			h2Opts["path"] = path
		}
		if host := q.Get("host"); host != "" {
			h2Opts["host"] = []string{host}
		}
		p["h2-opts"] = h2Opts
	case "xhttp", "splithttp":
		xhttpOpts := map[string]any{}
		if path := q.Get("path"); path != "" {
			xhttpOpts["path"] = path
		}
		if host := q.Get("host"); host != "" {
			xhttpOpts["host"] = host
		}
		p["xhttp-opts"] = xhttpOpts
	}
}

// ─── protocol parsers ─────────────────────────────────────────────────────────

func parseClashVmess(raw string) clashProxyMap {
	b64 := strings.TrimPrefix(raw, "vmess://")
	// vmess:// payload is base64(JSON).  It may be padded or unpadded.
	padded := b64
	if rem := len(b64) % 4; rem != 0 {
		padded += strings.Repeat("=", 4-rem)
	}
	data, err := base64.StdEncoding.DecodeString(padded)
	if err != nil {
		data, err = base64.URLEncoding.DecodeString(padded)
		if err != nil {
			return nil
		}
	}
	var v map[string]any
	if err := json.Unmarshal(data, &v); err != nil {
		return nil
	}
	portVal, _ := v["port"]
	port, _ := strconv.Atoi(fmt.Sprint(portVal))
	if port == 0 {
		return nil
	}
	server, _ := v["add"].(string)
	if server == "" {
		return nil
	}
	uid, _ := v["id"].(string)
	name := clashName(fmt.Sprint(v["ps"]), fmt.Sprintf("vmess-%s:%d", server, port))

	p := clashProxyMap{
		"name":    name,
		"type":    "vmess",
		"server":  server,
		"port":    port,
		"uuid":    uid,
		"alterId": 0,
		"cipher":  "auto",
	}
	if aid, ok := v["aid"]; ok {
		if n, err := strconv.Atoi(fmt.Sprint(aid)); err == nil {
			p["alterId"] = n
		}
	}
	if sec, _ := v["scy"].(string); sec != "" {
		p["cipher"] = sec
	}
	// TLS
	if tls, _ := v["tls"].(string); strings.ToLower(tls) == "tls" {
		p["tls"] = true
		if sni, _ := v["sni"].(string); sni != "" {
			p["servername"] = sni
		}
	}
	// Transport
	net, _ := v["net"].(string)
	if net == "" {
		net = "tcp"
	}
	p["network"] = net
	switch net {
	case "ws":
		wsOpts := map[string]any{}
		if path, _ := v["path"].(string); path != "" {
			wsOpts["path"] = path
		}
		if host, _ := v["host"].(string); host != "" {
			wsOpts["headers"] = map[string]any{"Host": host}
		}
		p["ws-opts"] = wsOpts
	case "grpc":
		if sn, _ := v["path"].(string); sn != "" {
			p["grpc-opts"] = map[string]any{"grpc-service-name": sn}
		}
	case "h2":
		h2Opts := map[string]any{}
		if path, _ := v["path"].(string); path != "" {
			h2Opts["path"] = path
		}
		if host, _ := v["host"].(string); host != "" {
			h2Opts["host"] = []string{host}
		}
		p["h2-opts"] = h2Opts
	}
	return p
}

func parseClashVless(raw string) clashProxyMap {
	u, err := url.Parse(raw)
	if err != nil {
		return nil
	}
	port, _ := strconv.Atoi(u.Port())
	if port == 0 {
		return nil
	}
	uid := u.User.Username()
	server := u.Hostname()
	name := clashName(u.Fragment, fmt.Sprintf("vless-%s:%d", server, port))
	q := u.Query()

	p := clashProxyMap{
		"name":   name,
		"type":   "vless",
		"server": server,
		"port":   port,
		"uuid":   uid,
	}
	if flow := q.Get("flow"); flow != "" {
		p["flow"] = flow
	}
	applyClashTLS(p, q)
	applyClashTransport(p, q)
	return p
}

func parseClashTrojan(raw string) clashProxyMap {
	u, err := url.Parse(raw)
	if err != nil {
		return nil
	}
	port, _ := strconv.Atoi(u.Port())
	if port == 0 {
		return nil
	}
	password := u.User.Username()
	server := u.Hostname()
	name := clashName(u.Fragment, fmt.Sprintf("trojan-%s:%d", server, port))
	q := u.Query()

	p := clashProxyMap{
		"name":     name,
		"type":     "trojan",
		"server":   server,
		"port":     port,
		"password": password,
		"tls":      true, // Trojan always TLS
	}
	if sni := q.Get("sni"); sni != "" {
		p["sni"] = sni
	}
	if fp := q.Get("fp"); fp != "" {
		p["client-fingerprint"] = fp
	}
	applyClashTransport(p, q)
	return p
}

// parseClashSS parses ss:// links (both classic and SIP002).
func parseClashSS(raw string) clashProxyMap {
	// SIP002: ss://BASE64(method:password)@host:port[?plugin]#name
	// or: ss://BASE64(method:password@host:port)[#name]
	u, err := url.Parse(raw)
	if err != nil {
		return nil
	}

	var method, password, server string
	var port int

	if u.User != nil && u.Host != "" {
		// SIP002 form: userinfo = base64(method:password) or just method:password
		userRaw := u.User.Username()
		decoded, decErr := base64DecodeUnpadded(userRaw)
		if decErr == nil {
			parts := strings.SplitN(string(decoded), ":", 2)
			if len(parts) == 2 {
				method = parts[0]
				password = parts[1]
			}
		} else {
			// May already be decoded: method:password
			parts := strings.SplitN(userRaw, ":", 2)
			if len(parts) == 2 {
				method = parts[0]
				password = parts[1]
			}
		}
		server = u.Hostname()
		port, _ = strconv.Atoi(u.Port())
	} else {
		// Classic form: ss://BASE64(method:password@host:port)#name
		b64 := strings.TrimPrefix(raw, "ss://")
		if idx := strings.IndexByte(b64, '#'); idx >= 0 {
			b64 = b64[:idx]
		}
		data, err := base64DecodeUnpadded(b64)
		if err != nil {
			return nil
		}
		at := strings.LastIndexByte(string(data), '@')
		if at < 0 {
			return nil
		}
		userPart := string(data[:at])
		hostPart := string(data[at+1:])
		parts := strings.SplitN(userPart, ":", 2)
		if len(parts) != 2 {
			return nil
		}
		method = parts[0]
		password = parts[1]
		hp := strings.LastIndexByte(hostPart, ':')
		if hp < 0 {
			return nil
		}
		server = hostPart[:hp]
		port, _ = strconv.Atoi(hostPart[hp+1:])
	}

	if port == 0 || server == "" {
		return nil
	}
	name := clashName(u.Fragment, fmt.Sprintf("ss-%s:%d", server, port))
	return clashProxyMap{
		"name":     name,
		"type":     "ss",
		"server":   server,
		"port":     port,
		"cipher":   method,
		"password": password,
	}
}

func parseClashHysteria2(raw string) clashProxyMap {
	// Normalize hy2:// to hysteria2://
	normalized := strings.Replace(raw, "hy2://", "hysteria2://", 1)
	// The multi-port range ("host:39640-39649") is not a valid net/url port.
	// Clash has a single port, so collapse the range to its first member
	// (every port of the range reaches the same listener via the node NAT
	// rules) instead of dropping the whole profile.
	normalized = collapseHysteriaMultiPortLink(normalized)
	u, err := url.Parse(normalized)
	if err != nil {
		return nil
	}
	port, _ := strconv.Atoi(u.Port())
	if port == 0 {
		return nil
	}
	auth := u.User.Username()
	server := u.Hostname()
	name := clashName(u.Fragment, fmt.Sprintf("hy2-%s:%d", server, port))
	q := u.Query()

	p := clashProxyMap{
		"name":     name,
		"type":     "hysteria2",
		"server":   server,
		"port":     port,
		"password": auth,
	}
	if sni := q.Get("sni"); sni != "" {
		p["sni"] = sni
	}
	if insecure := q.Get("insecure"); insecure == "1" {
		p["skip-cert-verify"] = true
	}
	if obfs := q.Get("obfs"); obfs != "" {
		p["obfs"] = obfs
		if obfsPassword := q.Get("obfs-password"); obfsPassword != "" {
			p["obfs-password"] = obfsPassword
		}
	}
	return p
}

// base64DecodeUnpadded decodes standard or unpadded base64.
func base64DecodeUnpadded(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if rem := len(s) % 4; rem != 0 {
		s += strings.Repeat("=", 4-rem)
	}
	if out, err := base64.StdEncoding.DecodeString(s); err == nil {
		return out, nil
	}
	return base64.URLEncoding.DecodeString(s)
}
