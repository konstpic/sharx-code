package sub

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"strings"
)

// telemtTlsDomainForSubLink returns censorship fake-TLS domain for tg:// secret suffix (Telemt build_user_links).
// Empty / missing JSON falls back to the same default as web/service BuildTelemtToml.
func telemtTlsDomainForSubLink(settingsJSON string) string {
	var root map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(settingsJSON)), &root); err != nil {
		return "petrovich.ru"
	}
	t, ok := root["telemt"].(map[string]any)
	if !ok {
		return "petrovich.ru"
	}
	c, ok := t["censorship"].(map[string]any)
	if !ok {
		return "petrovich.ru"
	}
	td := ""
	if v, ok := c["tlsDomain"].(string); ok {
		td = strings.TrimSpace(v)
	}
	if td == "" {
		if v, ok := c["sni"].(string); ok {
			td = strings.TrimSpace(v)
		}
	}
	if td == "" {
		return "petrovich.ru"
	}
	return td
}

// telemtTgProxySecretForLink builds the `secret` query value for tg://proxy (lowercase hex).
// Fake-TLS: "ee" + 32-hex user secret + hex(UTF-8 tls_domain) — same string layout as telemt api users build_user_links.
// Secure: "dd" + 32-hex; classic: 32-hex only.
func telemtTgProxySecretForLink(raw16 []byte, tlsMode, secure bool, tlsDomain string) string {
	keyHex := strings.ToLower(hex.EncodeToString(raw16))
	switch {
	case tlsMode:
		d := strings.TrimSpace(tlsDomain)
		if d != "" {
			return "ee" + keyHex + strings.ToLower(hex.EncodeToString([]byte(d)))
		}
		return "ee" + keyHex
	case secure:
		return "dd" + keyHex
	default:
		return keyHex
	}
}

// telemtWebProxyLink returns the WEB link and whether WEB mode owns link generation.
// Enabled but incomplete WEB configurations must not fall back to a TCP MTProxy link.
func telemtWebProxyLink(settingsJSON string, raw16 []byte) (string, bool) {
	var cfg struct {
		Telemt struct {
			Web struct {
				Enabled           bool   `json:"enabled"`
				VhostHost         string `json:"vhostHost"`
				FrontPort         int    `json:"frontPort"`
				ProfileSecretMode string `json:"profileSecretMode"`
			} `json:"web"`
			Params map[string]json.RawMessage `json:"params"`
		} `json:"telemt"`
	}
	if err := json.Unmarshal([]byte(settingsJSON), &cfg); err != nil || !cfg.Telemt.Web.Enabled {
		return "", false
	}
	web := cfg.Telemt.Web
	host := strings.ToLower(strings.TrimSpace(web.VhostHost))
	// Telegram WEB requires HTTPS on port 443; there is no port field in its link.
	if host == "" || len(raw16) != 16 || (web.FrontPort > 0 && web.FrontPort != 443) {
		return "", true
	}
	// Match the config generator: unknown/omitted profileSecretMode defaults to dd.
	secure := strings.TrimSpace(web.ProfileSecretMode) != "plain"
	secret := telemtTgProxySecretForLink(raw16, false, secure, "")
	// A vhost base_path ([[web.vhosts]].base_path, set via the parameter catalog) moves the WEB
	// endpoint under a prefix: the link carries "host/base_path" percent-encoded, and the secret
	// becomes base64url(0x70 || client_secret) without padding (Telemt WEB_PROXY docs).
	var basePath string
	if raw, ok := cfg.Telemt.Params["web.vhosts.base_path"]; ok {
		_ = json.Unmarshal(raw, &basePath)
		basePath = strings.Trim(strings.TrimSpace(basePath), "/")
	}
	if basePath != "" {
		clientSecret, err := hex.DecodeString(secret)
		if err != nil {
			return "", true
		}
		enc := base64.RawURLEncoding.EncodeToString(append([]byte{0x70}, clientSecret...))
		return "tg://webproxy?server=" + url.QueryEscape(host+"/"+basePath) + "&secret=" + enc, true
	}
	return "tg://webproxy?server=" + url.QueryEscape(host) + "&secret=" + secret, true
}

func isTelemtProxyLink(link string) bool {
	lower := strings.ToLower(link)
	return strings.HasPrefix(lower, "tg://proxy?") || strings.HasPrefix(lower, "tg://webproxy?")
}
