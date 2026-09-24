package web

import (
	"os"
	"strings"
)

// defaultTrustedProxies are the networks a local reverse proxy (nginx, Traefik, a Docker bridge) sits in.
// Public addresses are never trusted by default, so internet clients cannot forge X-Forwarded-For.
var defaultTrustedProxies = []string{
	"127.0.0.0/8", "::1/128",
	"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7",
}

// trustedProxyCIDRs returns XUI_TRUSTED_PROXIES (comma separated IPs/CIDRs) or the defaults.
func trustedProxyCIDRs() []string {
	raw := strings.TrimSpace(os.Getenv("XUI_TRUSTED_PROXIES"))
	if raw == "" {
		return defaultTrustedProxies
	}
	var out []string
	for _, p := range strings.Split(raw, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
