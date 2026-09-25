package service

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/node/telemtweb"
)

// TelemtNodePayload is pushed to worker nodes alongside Xray JSON.
type TelemtNodePayload struct {
	InboundId int    `json:"inboundId"`
	Tag       string `json:"tag"`
	Toml      string `json:"toml"`
}

// telemtSettingsJSON mirrors the panel "settings" JSON for protocol telemt.
type telemtSettingsJSON struct {
	UseMiddleProxy   *bool    `json:"useMiddleProxy"`
	LogLevel         string   `json:"logLevel"`
	AdTag            string   `json:"adTag"`
	MetricsPort      *int     `json:"metricsPort"`
	MetricsListen    string   `json:"metricsListen"`
	MetricsWhitelist []string `json:"metricsWhitelist"`
	Modes            *struct {
		Classic bool `json:"classic"`
		Secure  bool `json:"secure"`
		TLS     bool `json:"tls"`
	} `json:"modes"`
	Links *struct {
		Show       string `json:"show"`
		PublicHost string `json:"publicHost"`
		PublicPort int    `json:"publicPort"`
	} `json:"links"`
	Censorship *struct {
		TLSDomain             string   `json:"tlsDomain"`
		SNI                   string   `json:"sni"`
		TLSDomains            []string `json:"tlsDomains"`
		Mask                  *bool    `json:"mask"`
		TLSEmulation          *bool    `json:"tlsEmulation"`
		TLSFrontDir           string   `json:"tlsFrontDir"`
		UnknownSniAction      string   `json:"unknownSniAction"`
		MaskHost              string   `json:"maskHost"`
		MaskPort              *int     `json:"maskPort"`
		MaskProxyProtocol     *int     `json:"maskProxyProtocol"`
		ServerHelloDelayMinMs *int     `json:"serverHelloDelayMinMs"`
		ServerHelloDelayMaxMs *int     `json:"serverHelloDelayMaxMs"`
	} `json:"censorship"`
	APIEnabled               *bool  `json:"apiEnabled"`
	APIListen                string `json:"apiListen"`
	APIAuthHeader            string `json:"apiAuthHeader"`
	MinimalRuntimeEnabled    *bool  `json:"minimalRuntimeEnabled"`
	MinimalRuntimeCacheTtlMs *int   `json:"minimalRuntimeCacheTtlMs"`
	ProxyProtocol            *bool  `json:"proxyProtocol"`
	MaxConnections           *int   `json:"maxConnections"`
	FastMode                 *bool  `json:"fastMode"`
	Me2dcFallback            *bool  `json:"me2dcFallback"`
	Me2dcFast                *bool  `json:"me2dcFast"`
	MiddleProxyNatIp         string `json:"middleProxyNatIp"`
	TgConnect                *int   `json:"tgConnect"`
	Network                  *struct {
		IPv4   *bool `json:"ipv4"`
		IPv6   *bool `json:"ipv6"`
		Prefer *int  `json:"prefer"`
	} `json:"network"`
	Timeouts *struct {
		ClientHandshake         *int `json:"clientHandshake"`
		ClientKeepalive         *int `json:"clientKeepalive"`
		ClientAck               *int `json:"clientAck"`
		ClientFirstByteIdleSecs *int `json:"clientFirstByteIdleSecs"`
		// RelayIdle* tune the middle-relay client-uplink idle policy (all seconds).
		RelayIdlePolicyV2Enabled                  *bool `json:"relayIdlePolicyV2Enabled"`
		RelayClientIdleSoftSecs                   *int  `json:"relayClientIdleSoftSecs"`
		RelayClientIdleHardSecs                   *int  `json:"relayClientIdleHardSecs"`
		RelayIdleGraceAfterDownstreamActivitySecs *int  `json:"relayIdleGraceAfterDownstreamActivitySecs"`
		// MeOne* tune single-endpoint DC fast-reconnect; note the ms unit on the timeout.
		MeOneRetry     *int `json:"meOneRetry"`
		MeOneTimeoutMs *int `json:"meOneTimeoutMs"`
	} `json:"timeouts"`
	Access *struct {
		IgnoreTimeSkew             *bool  `json:"ignoreTimeSkew"`
		UserMaxUniqueIpsGlobalEach *int   `json:"userMaxUniqueIpsGlobalEach"`
		UserMaxTcpConnsGlobalEach  *int   `json:"userMaxTcpConnsGlobalEach"`
		UserMaxUniqueIpsMode       string `json:"userMaxUniqueIpsMode"`
		UserMaxUniqueIpsWindowSecs *int   `json:"userMaxUniqueIpsWindowSecs"`
		// RateLimitUpBps/RateLimitDownBps apply the SAME cap to every user on this inbound
		// (written as [access.user_rate_limits] with one entry per user) — Telemt itself
		// supports genuinely per-user limits, but SharX has no per-client rate-limit storage
		// yet, so this is an inbound-wide throttle, not a per-client one.
		RateLimitUpBps   *uint64 `json:"rateLimitUpBps"`
		RateLimitDownBps *uint64 `json:"rateLimitDownBps"`
	} `json:"access"`
	Web *TelemtWebSettings `json:"web"`
}

// TelemtWebSettings configures Telemt's WEB transport (Telegram Desktop MTProxy carried over
// HTTPS/WebSocket). Unlike the original design, the TLS-terminating front is now SharX's own
// node/telemtweb.Manager — a supervised process, not an operator-managed external NGINX/HAProxy
// — so this struct only carries what SharX itself cannot infer: the public domain, and the
// decoy/secret-mode policy. The private bind address, trusted-proxy CIDR, and public relay IP
// are all resolved internally (see appendTelemtWebListenerAndSection and
// TelemtWebBackendAddrForInbound).
type TelemtWebSettings struct {
	Enabled *bool `json:"enabled"`
	// VhostHost is the public FQDN Telegram Desktop connects to (lowercase). SharX cannot
	// infer this — the operator must own the domain and point its DNS A/AAAA record at this
	// node/panel host before the inbound can be applied (see TelemtWebResolvePublicIP).
	VhostHost string `json:"vhostHost"`
	// FrontPort is the shared public HTTPS port telemtweb.Manager listens on for every WEB
	// vhost on this node/panel (SNI-routed). All WEB inbounds sharing a node/panel must agree
	// on the same port; defaults to 443 when unset.
	FrontPort *int `json:"frontPort"`
	// ExternalTerminator means TLS on public 443 is terminated by something else (nginx, or
	// xray Reality fallback -> nginx) that reverse-proxies to the private WEB listener
	// (127.0.0.1:BackendPort). SharX then does not start its own front, so nothing competes for
	// the port. public_addr and the listener are rendered exactly as in the built-in mode.
	ExternalTerminator *bool `json:"externalTerminator"`
	// BackendPort overrides the private loopback port Telemt's WEB listener binds to and the
	// front proxies to. Unset = telemtWebBackendPortBase + inbound.Id. Must be unique across
	// this node/panel's inbounds and must not collide with other local services.
	BackendPort *int `json:"backendPort"`
	// DecoyMode is "http_upstream" (reverse-proxy to a real site) or "static_directory"
	// (serve a static site) — Telemt's fallback for unauthenticated/invalid WEB traffic.
	DecoyMode string `json:"decoyMode"`
	// DecoyUpstream is an http:// origin on loopback/link-local/private IP (http_upstream mode).
	DecoyUpstream string `json:"decoyUpstream"`
	// DecoyDirectory + DecoyIndex serve a static site (static_directory mode).
	DecoyDirectory string `json:"decoyDirectory"`
	DecoyIndex     string `json:"decoyIndex"`
	// ProfileSecretMode is "plain" or "dd" (Telegram Desktop secret representation; "ee"
	// fake-TLS is not supported over WEB since TLS is handled by the front, not Telemt).
	ProfileSecretMode string `json:"profileSecretMode"`
}

// DefaultTelemtWebFrontPort is the shared public HTTPS port telemtweb.Manager listens on
// when an inbound doesn't specify TelemtWebSettings.FrontPort.
const DefaultTelemtWebFrontPort = 443

// TelemtWebPublicPort is the port Telemt requires in [[web.vhosts]].public_addr
// ("must be a concrete socket address on port 443"). It is independent of FrontPort: the front
// may listen elsewhere (e.g. behind an nginx stream / xray fallback that owns public 443),
// but public_addr is always :443.
const TelemtWebPublicPort = 443

// telemtWebBackendPortBase + inbound.Id gives each WEB-mode Telemt inbound its own private
// loopback port for telemtweb.Manager to reverse-proxy to. Kept well clear of the existing
// apiPort (9100+id) / metricsPort (apiPort+1000) ranges used elsewhere in this file.
const telemtWebBackendPortBase = 28100

// TelemtWebBackendAddrForInbound returns the private "127.0.0.1:port" address Telemt's own
// transport=web listener binds to for this inbound, and that telemtweb.Manager reverse-proxies
// to. Exported so the node/panel apply path can build the matching telemtweb.Vhost without
// re-deriving the port formula.
func TelemtWebBackendAddrForInbound(inboundId int) string {
	addr, _ := TelemtWebBackendAddr(inboundId, nil)
	return addr
}

// TelemtWebBackendAddr is TelemtWebBackendAddrForInbound honouring TelemtWebSettings.BackendPort.
// An out-of-range override is an error rather than silently falling back, so the operator sees
// that the port they typed was not applied.
func TelemtWebBackendAddr(inboundId int, web *TelemtWebSettings) (string, error) {
	if web != nil && web.BackendPort != nil && *web.BackendPort != 0 {
		p := *web.BackendPort
		if p < 1024 || p > 65535 {
			return "", fmt.Errorf("telemt web mode: backendPort %d out of range (1024-65535)", p)
		}
		return fmt.Sprintf("127.0.0.1:%d", p), nil
	}
	return defaultTelemtWebBackendAddr(inboundId), nil
}

func defaultTelemtWebBackendAddr(inboundId int) string {
	port := telemtWebBackendPortBase + inboundId
	if port > 65535 {
		port = 30000 + (inboundId % 35536)
	}
	return fmt.Sprintf("127.0.0.1:%d", port)
}

// telemtWebLookupIP is net.LookupIP by default; tests override it to avoid real DNS calls.
var telemtWebLookupIP = net.LookupIP

// TelemtWebResolvePublicIP resolves host's DNS A/AAAA record to the literal "ip:port" string
// Telemt's [[web.vhosts]].public_addr requires. Telemt only uses this for its inner relay
// destination tuple (clients never dial it directly — they connect to `host`, which the
// operator's DNS must already point at this node/panel's public IP), so a resolution failure
// means the domain isn't pointed here yet rather than a SharX-side bug.
func TelemtWebResolvePublicIP(host string, port int) (string, error) {
	ips, err := telemtWebLookupIP(host)
	if err != nil {
		return "", fmt.Errorf("DNS lookup failed (point %s's A/AAAA record at this host first): %w", host, err)
	}
	var v4, v6 net.IP
	for _, ip := range ips {
		if v4 == nil && ip.To4() != nil {
			v4 = ip
		} else if v6 == nil && ip.To4() == nil {
			v6 = ip
		}
	}
	chosen := v4
	if chosen == nil {
		chosen = v6
	}
	if chosen == nil {
		return "", fmt.Errorf("no A/AAAA record found for %s", host)
	}
	return net.JoinHostPort(chosen.String(), strconv.Itoa(port)), nil
}

var telemtBareKeyRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// telemtValidUsernameRe mirrors Telemt's own route validation (src/api/model/users.rs
// is_valid_username: ASCII alphanumeric plus '_' '-' '.', 1-64 chars). Telemt's Control
// API rejects any other username in the URL path with 400 before it even looks the user
// up, so a non-ASCII (e.g. Cyrillic) client name silently hides that client's online
// sessions even though the TOML config itself accepts any UTF-8 key.
var telemtValidUsernameRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)

// TelemtUsernameForClient returns the Telemt [access.users] key / Control API username for
// a client. Names that already satisfy Telemt's own username rules are used unchanged (so
// existing configs keep the same key); anything else falls back to a stable "u<clientId>"
// identifier. Telemt subscription links (tg://proxy?...) carry the secret, not the
// username, so this substitution never affects a client's connection string.
func TelemtUsernameForClient(clientId int, name string) string {
	name = strings.TrimSpace(name)
	if telemtValidUsernameRe.MatchString(name) {
		return name
	}
	return fmt.Sprintf("u%d", clientId)
}

// GenerateTelemtSecretHex returns 32 lowercase hex chars (16 bytes) for Telemt [access.users].
func GenerateTelemtSecretHex() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func parseTelemtSettings(settingsJSON string) telemtSettingsJSON {
	var root map[string]any
	_ = json.Unmarshal([]byte(strings.TrimSpace(settingsJSON)), &root)
	var raw telemtSettingsJSON
	if t, ok := root["telemt"].(map[string]any); ok {
		b, _ := json.Marshal(t)
		_ = json.Unmarshal(b, &raw)
	} else {
		_ = json.Unmarshal([]byte(strings.TrimSpace(settingsJSON)), &raw)
	}
	return raw
}

func telemtTomlUserKey(email string) string {
	email = strings.TrimSpace(email)
	if email == "" {
		return `""`
	}
	if telemtBareKeyRe.MatchString(email) {
		return email
	}
	return `"` + strings.ReplaceAll(strings.ReplaceAll(email, `\`, `\\`), `"`, `\"`) + `"`
}

// TelemtAccessUser is a row for [access.users] (Telemt user + mapping secret).
type TelemtAccessUser struct {
	// Username is the Telemt [access.users] key / Control API identifier — see
	// TelemtUsernameForClient. Not necessarily the client's display name.
	Username string
	Secret   string
	Enable   bool
	// Optional [access.user_data_quota] / [access.user_expirations] / [access.user_max_unique_ips].
	// Zero / empty values are omitted from generated TOML.
	DataQuotaBytes    uint64
	ExpirationRFC3339 string
	MaxUniqueIPs      int
	// SourceDenyCIDRs become [access.user_source_deny] (per-username CIDRs, Telemt SharX fork).
	SourceDenyCIDRs []string
	// Optional per-user ad tag → [access.user_ad_tags].
	AdTag string
}

// BuildTelemtToml builds a Telemt config.toml for one inbound.
// workDirAbs is the per-inbound directory on the node (for tls_front_dir); if empty, uses "tlsfront" relative.
func BuildTelemtToml(inbound *model.Inbound, users []TelemtAccessUser, publicHost string, publicPort int, workDirAbs string) (string, error) {
	if inbound == nil {
		return "", fmt.Errorf("inbound is nil")
	}
	cfg := parseTelemtSettings(inbound.Settings)
	useMiddle := true
	if cfg.UseMiddleProxy != nil {
		useMiddle = *cfg.UseMiddleProxy
	}
	logLevel := strings.TrimSpace(cfg.LogLevel)
	if logLevel == "" {
		logLevel = "normal"
	}
	classic, secure, tlsMode := false, false, true
	if cfg.Modes != nil {
		classic = cfg.Modes.Classic
		secure = cfg.Modes.Secure
		tlsMode = cfg.Modes.TLS
	}
	show := "*"
	if cfg.Links != nil && strings.TrimSpace(cfg.Links.Show) != "" {
		show = cfg.Links.Show
	}
	if strings.TrimSpace(publicHost) != "" {
		// node binding overrides JSON
		if cfg.Links == nil {
			cfg.Links = &struct {
				Show       string `json:"show"`
				PublicHost string `json:"publicHost"`
				PublicPort int    `json:"publicPort"`
			}{}
		}
		cfg.Links.PublicHost = strings.TrimSpace(publicHost)
		if publicPort > 0 {
			cfg.Links.PublicPort = publicPort
		}
	}
	tlsDomain := "petrovich.ru"
	mask := true
	tlsEmu := true
	tlsFront := "tlsfront"
	unknownSni := ""
	if cfg.Censorship != nil {
		td := strings.TrimSpace(cfg.Censorship.TLSDomain)
		if td == "" {
			td = strings.TrimSpace(cfg.Censorship.SNI)
		}
		if td != "" {
			tlsDomain = td
		}
		if cfg.Censorship.Mask != nil {
			mask = *cfg.Censorship.Mask
		}
		if cfg.Censorship.TLSEmulation != nil {
			tlsEmu = *cfg.Censorship.TLSEmulation
		}
		if strings.TrimSpace(cfg.Censorship.TLSFrontDir) != "" {
			tlsFront = strings.TrimSpace(cfg.Censorship.TLSFrontDir)
		}
		unknownSni = strings.TrimSpace(cfg.Censorship.UnknownSniAction)
	}
	if workDirAbs != "" {
		tlsFront = strings.TrimRight(workDirAbs, `/`) + "/tlsfront"
	}

	// Localhost-only control API: required for GET /v1/stats/users accounting on the node/panel.
	apiEnabled := true
	if cfg.APIEnabled != nil {
		apiEnabled = *cfg.APIEnabled
	}
	apiPort := 9091
	if inbound.Id > 0 {
		apiPort = 9100 + inbound.Id
		if apiPort > 65535 {
			apiPort = 20000 + (inbound.Id % 45536)
		}
	}
	apiListen := fmt.Sprintf("127.0.0.1:%d", apiPort)
	if strings.TrimSpace(cfg.APIListen) != "" {
		apiListen = strings.TrimSpace(cfg.APIListen)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "### Generated by SharX for inbound %s (id=%d)\n", inbound.Tag, inbound.Id)
	fmt.Fprintf(&b, "[general]\nuse_middle_proxy = %v\n", useMiddle)
	if tag := strings.TrimSpace(cfg.AdTag); tag != "" {
		fmt.Fprintf(&b, "ad_tag = %q\n", tag)
	}
	if cfg.FastMode != nil {
		fmt.Fprintf(&b, "fast_mode = %v\n", *cfg.FastMode)
	}
	if cfg.Me2dcFallback != nil {
		fmt.Fprintf(&b, "me2dc_fallback = %v\n", *cfg.Me2dcFallback)
	}
	if cfg.Me2dcFast != nil {
		fmt.Fprintf(&b, "me2dc_fast = %v\n", *cfg.Me2dcFast)
	}
	if natIP := strings.TrimSpace(cfg.MiddleProxyNatIp); natIP != "" {
		fmt.Fprintf(&b, "middle_proxy_nat_ip = %q\n", natIP)
	}
	if cfg.TgConnect != nil && *cfg.TgConnect > 0 {
		fmt.Fprintf(&b, "tg_connect = %d\n", *cfg.TgConnect)
	}
	fmt.Fprintf(&b, "log_level = %q\n\n", logLevel)
	fmt.Fprintf(&b, "[general.modes]\nclassic = %v\nsecure = %v\ntls = %v\n\n", classic, secure, tlsMode)
	fmt.Fprintf(&b, "[general.links]\nshow = %q\n", show)
	if cfg.Links != nil && strings.TrimSpace(cfg.Links.PublicHost) != "" {
		fmt.Fprintf(&b, "public_host = %q\n", cfg.Links.PublicHost)
		if cfg.Links.PublicPort > 0 {
			fmt.Fprintf(&b, "public_port = %d\n", cfg.Links.PublicPort)
		}
	}
	fmt.Fprintf(&b, "\n")
	if cfg.Network != nil && (cfg.Network.IPv4 != nil || cfg.Network.IPv6 != nil || cfg.Network.Prefer != nil) {
		fmt.Fprintf(&b, "[network]\n")
		if cfg.Network.IPv4 != nil {
			fmt.Fprintf(&b, "ipv4 = %v\n", *cfg.Network.IPv4)
		}
		if cfg.Network.IPv6 != nil {
			fmt.Fprintf(&b, "ipv6 = %v\n", *cfg.Network.IPv6)
		}
		if cfg.Network.Prefer != nil && (*cfg.Network.Prefer == 4 || *cfg.Network.Prefer == 6) {
			fmt.Fprintf(&b, "prefer = %d\n", *cfg.Network.Prefer)
		}
		fmt.Fprintf(&b, "\n")
	}
	fmt.Fprintf(&b, "[server]\nport = %d\n", inbound.Port)
	metricsPort := 0
	if cfg.MetricsPort != nil && *cfg.MetricsPort > 0 {
		metricsPort = *cfg.MetricsPort
	} else if apiPort > 0 {
		metricsPort = apiPort + 1000
	}
	if metricsPort > 0 {
		fmt.Fprintf(&b, "metrics_port = %d\n", metricsPort)
	}
	if ml := strings.TrimSpace(cfg.MetricsListen); ml != "" {
		fmt.Fprintf(&b, "metrics_listen = %q\n", ml)
	}
	if len(cfg.MetricsWhitelist) > 0 {
		parts := make([]string, 0, len(cfg.MetricsWhitelist))
		for _, c := range cfg.MetricsWhitelist {
			c = strings.TrimSpace(c)
			if c != "" {
				parts = append(parts, fmt.Sprintf("%q", c))
			}
		}
		if len(parts) > 0 {
			fmt.Fprintf(&b, "metrics_whitelist = [%s]\n", strings.Join(parts, ", "))
		}
	}
	if cfg.ProxyProtocol != nil && *cfg.ProxyProtocol {
		fmt.Fprintf(&b, "proxy_protocol = true\n")
	}
	if cfg.MaxConnections != nil && *cfg.MaxConnections > 0 {
		fmt.Fprintf(&b, "max_connections = %d\n", *cfg.MaxConnections)
	}
	fmt.Fprintf(&b, "\n")
	fmt.Fprintf(&b, "[server.api]\nenabled = %v\nlisten = %q\nwhitelist = [\"127.0.0.1/32\", \"::1/128\"]\n", apiEnabled, apiListen)
	if ah := strings.TrimSpace(cfg.APIAuthHeader); ah != "" {
		fmt.Fprintf(&b, "auth_header = %q\n", ah)
	}
	if cfg.MinimalRuntimeEnabled != nil {
		fmt.Fprintf(&b, "minimal_runtime_enabled = %v\n", *cfg.MinimalRuntimeEnabled)
	}
	if cfg.MinimalRuntimeCacheTtlMs != nil && *cfg.MinimalRuntimeCacheTtlMs >= 0 && *cfg.MinimalRuntimeCacheTtlMs <= 60000 {
		fmt.Fprintf(&b, "minimal_runtime_cache_ttl_ms = %d\n", *cfg.MinimalRuntimeCacheTtlMs)
	}
	fmt.Fprintf(&b, "\n")

	webEnabled := cfg.Web != nil && cfg.Web.Enabled != nil && *cfg.Web.Enabled
	if webEnabled {
		if err := appendTelemtWebListenerAndSection(&b, cfg.Web, inbound, users); err != nil {
			return "", err
		}
	} else {
		listenIP := strings.TrimSpace(inbound.Listen)
		if listenIP == "" {
			listenIP = "0.0.0.0"
		}
		fmt.Fprintf(&b, "[[server.listeners]]\nip = %q\n\n", listenIP)
	}

	fmt.Fprintf(&b, "[censorship]\ntls_domain = %q\nmask = %v\ntls_emulation = %v\ntls_front_dir = %q\n", tlsDomain, mask, tlsEmu, tlsFront)
	if cfg.Censorship != nil {
		if len(cfg.Censorship.TLSDomains) > 0 {
			parts := make([]string, 0, len(cfg.Censorship.TLSDomains))
			for _, d := range cfg.Censorship.TLSDomains {
				d = strings.TrimSpace(d)
				if d != "" {
					parts = append(parts, fmt.Sprintf("%q", d))
				}
			}
			if len(parts) > 0 {
				fmt.Fprintf(&b, "tls_domains = [%s]\n", strings.Join(parts, ", "))
			}
		}
		if mh := strings.TrimSpace(cfg.Censorship.MaskHost); mh != "" {
			fmt.Fprintf(&b, "mask_host = %q\n", mh)
		}
		if cfg.Censorship.MaskPort != nil && *cfg.Censorship.MaskPort > 0 {
			fmt.Fprintf(&b, "mask_port = %d\n", *cfg.Censorship.MaskPort)
		}
		if cfg.Censorship.MaskProxyProtocol != nil {
			mpp := *cfg.Censorship.MaskProxyProtocol
			if mpp >= 0 && mpp <= 2 {
				fmt.Fprintf(&b, "mask_proxy_protocol = %d\n", mpp)
			}
		}
	}
	if unknownSni != "" {
		fmt.Fprintf(&b, "unknown_sni_action = %q\n", unknownSni)
	}
	// client_handshake also bounds server_hello_delay_max_ms (must be < client_handshake*1000);
	// resolve the effective value (upstream default 30s) before validating the delay fields.
	clientHandshakeSecs := 30
	if cfg.Timeouts != nil && cfg.Timeouts.ClientHandshake != nil && *cfg.Timeouts.ClientHandshake > 0 {
		clientHandshakeSecs = *cfg.Timeouts.ClientHandshake
	}
	if cfg.Censorship != nil && cfg.Censorship.ServerHelloDelayMinMs != nil && cfg.Censorship.ServerHelloDelayMaxMs != nil {
		minMs, maxMs := *cfg.Censorship.ServerHelloDelayMinMs, *cfg.Censorship.ServerHelloDelayMaxMs
		if minMs >= 0 && maxMs >= minMs && maxMs < clientHandshakeSecs*1000 {
			fmt.Fprintf(&b, "server_hello_delay_min_ms = %d\n", minMs)
			fmt.Fprintf(&b, "server_hello_delay_max_ms = %d\n", maxMs)
		}
	}
	fmt.Fprintf(&b, "\n")
	if cfg.Timeouts != nil {
		var timeoutLines []string
		if cfg.Timeouts.ClientHandshake != nil && *cfg.Timeouts.ClientHandshake > 0 {
			timeoutLines = append(timeoutLines, fmt.Sprintf("client_handshake = %d\n", *cfg.Timeouts.ClientHandshake))
		}
		if cfg.Timeouts.ClientFirstByteIdleSecs != nil && *cfg.Timeouts.ClientFirstByteIdleSecs >= 0 {
			timeoutLines = append(timeoutLines, fmt.Sprintf("client_first_byte_idle_secs = %d\n", *cfg.Timeouts.ClientFirstByteIdleSecs))
		}
		if cfg.Timeouts.ClientKeepalive != nil && *cfg.Timeouts.ClientKeepalive > 0 {
			timeoutLines = append(timeoutLines, fmt.Sprintf("client_keepalive = %d\n", *cfg.Timeouts.ClientKeepalive))
		}
		if cfg.Timeouts.ClientAck != nil && *cfg.Timeouts.ClientAck > 0 {
			timeoutLines = append(timeoutLines, fmt.Sprintf("client_ack = %d\n", *cfg.Timeouts.ClientAck))
		}
		// relay_idle_policy_v2 fields are validated together upstream: soft <= hard, grace <= hard.
		if cfg.Timeouts.RelayIdlePolicyV2Enabled != nil {
			timeoutLines = append(timeoutLines, fmt.Sprintf("relay_idle_policy_v2_enabled = %v\n", *cfg.Timeouts.RelayIdlePolicyV2Enabled))
		}
		if cfg.Timeouts.RelayClientIdleSoftSecs != nil && cfg.Timeouts.RelayClientIdleHardSecs != nil {
			soft, hard := *cfg.Timeouts.RelayClientIdleSoftSecs, *cfg.Timeouts.RelayClientIdleHardSecs
			if soft > 0 && hard > 0 && soft <= hard {
				timeoutLines = append(timeoutLines, fmt.Sprintf("relay_client_idle_soft_secs = %d\n", soft))
				timeoutLines = append(timeoutLines, fmt.Sprintf("relay_client_idle_hard_secs = %d\n", hard))
				if cfg.Timeouts.RelayIdleGraceAfterDownstreamActivitySecs != nil {
					grace := *cfg.Timeouts.RelayIdleGraceAfterDownstreamActivitySecs
					if grace >= 0 && grace <= hard {
						timeoutLines = append(timeoutLines, fmt.Sprintf("relay_idle_grace_after_downstream_activity_secs = %d\n", grace))
					}
				}
			}
		}
		if cfg.Timeouts.MeOneRetry != nil && *cfg.Timeouts.MeOneRetry >= 0 {
			timeoutLines = append(timeoutLines, fmt.Sprintf("me_one_retry = %d\n", *cfg.Timeouts.MeOneRetry))
		}
		if cfg.Timeouts.MeOneTimeoutMs != nil && *cfg.Timeouts.MeOneTimeoutMs > 0 {
			timeoutLines = append(timeoutLines, fmt.Sprintf("me_one_timeout_ms = %d\n", *cfg.Timeouts.MeOneTimeoutMs))
		}
		if len(timeoutLines) > 0 {
			fmt.Fprintf(&b, "[timeouts]\n")
			for _, line := range timeoutLines {
				fmt.Fprint(&b, line)
			}
			fmt.Fprintf(&b, "\n")
		}
	}
	var accessScalars []string
	if cfg.Access != nil {
		if cfg.Access.IgnoreTimeSkew != nil && *cfg.Access.IgnoreTimeSkew {
			accessScalars = append(accessScalars, "ignore_time_skew = true\n")
		}
		if cfg.Access.UserMaxUniqueIpsGlobalEach != nil && *cfg.Access.UserMaxUniqueIpsGlobalEach >= 0 {
			accessScalars = append(accessScalars, fmt.Sprintf("user_max_unique_ips_global_each = %d\n", *cfg.Access.UserMaxUniqueIpsGlobalEach))
		}
		if cfg.Access.UserMaxTcpConnsGlobalEach != nil && *cfg.Access.UserMaxTcpConnsGlobalEach >= 0 {
			accessScalars = append(accessScalars, fmt.Sprintf("user_max_tcp_conns_global_each = %d\n", *cfg.Access.UserMaxTcpConnsGlobalEach))
		}
		if mode := strings.TrimSpace(cfg.Access.UserMaxUniqueIpsMode); mode == "active_window" || mode == "time_window" || mode == "combined" {
			accessScalars = append(accessScalars, fmt.Sprintf("user_max_unique_ips_mode = %q\n", mode))
		}
		if cfg.Access.UserMaxUniqueIpsWindowSecs != nil && *cfg.Access.UserMaxUniqueIpsWindowSecs > 0 {
			accessScalars = append(accessScalars, fmt.Sprintf("user_max_unique_ips_window_secs = %d\n", *cfg.Access.UserMaxUniqueIpsWindowSecs))
		}
	}
	if len(accessScalars) > 0 {
		fmt.Fprintf(&b, "[access]\n")
		for _, line := range accessScalars {
			fmt.Fprint(&b, line)
		}
		fmt.Fprintf(&b, "\n")
	}
	var written []TelemtAccessUser
	fmt.Fprintf(&b, "[access.users]\n")
	for _, u := range users {
		if !u.Enable || strings.TrimSpace(u.Username) == "" || len(strings.TrimSpace(u.Secret)) != 32 {
			continue
		}
		sec := strings.ToLower(strings.TrimSpace(u.Secret))
		fmt.Fprintf(&b, "%s = %q\n", telemtTomlUserKey(u.Username), sec)
		written = append(written, u)
	}

	var quotaLines, expLines, ipLines []string
	for _, u := range written {
		key := telemtTomlUserKey(u.Username)
		if u.DataQuotaBytes > 0 {
			quotaLines = append(quotaLines, fmt.Sprintf("%s = %d\n", key, u.DataQuotaBytes))
		}
		if u.ExpirationRFC3339 != "" {
			expLines = append(expLines, fmt.Sprintf("%s = %q\n", key, u.ExpirationRFC3339))
		}
		if u.MaxUniqueIPs > 0 {
			ipLines = append(ipLines, fmt.Sprintf("%s = %d\n", key, u.MaxUniqueIPs))
		}
	}
	if len(quotaLines) > 0 {
		fmt.Fprintf(&b, "\n[access.user_data_quota]\n")
		for _, line := range quotaLines {
			fmt.Fprint(&b, line)
		}
	}
	if len(expLines) > 0 {
		fmt.Fprintf(&b, "\n[access.user_expirations]\n")
		for _, line := range expLines {
			fmt.Fprint(&b, line)
		}
	}
	if len(ipLines) > 0 {
		fmt.Fprintf(&b, "\n[access.user_max_unique_ips]\n")
		for _, line := range ipLines {
			fmt.Fprint(&b, line)
		}
	}
	var denyLines []string
	for _, u := range written {
		if len(u.SourceDenyCIDRs) == 0 {
			continue
		}
		key := telemtTomlUserKey(u.Username)
		parts := make([]string, 0, len(u.SourceDenyCIDRs))
		for _, c := range u.SourceDenyCIDRs {
			c = strings.TrimSpace(c)
			if c != "" {
				parts = append(parts, fmt.Sprintf("%q", c))
			}
		}
		if len(parts) == 0 {
			continue
		}
		denyLines = append(denyLines, fmt.Sprintf("%s = [%s]\n", key, strings.Join(parts, ", ")))
	}
	if len(denyLines) > 0 {
		fmt.Fprintf(&b, "\n[access.user_source_deny]\n")
		for _, line := range denyLines {
			fmt.Fprint(&b, line)
		}
	}
	var adTagLines []string
	for _, u := range written {
		tag := strings.ToLower(strings.TrimSpace(u.AdTag))
		if len(tag) != 32 {
			continue
		}
		adTagLines = append(adTagLines, fmt.Sprintf("%s = %q\n", telemtTomlUserKey(u.Username), tag))
	}
	if len(adTagLines) > 0 {
		fmt.Fprintf(&b, "\n[access.user_ad_tags]\n")
		for _, line := range adTagLines {
			fmt.Fprint(&b, line)
		}
	}
	if cfg.Access != nil && cfg.Access.RateLimitUpBps != nil && cfg.Access.RateLimitDownBps != nil &&
		(*cfg.Access.RateLimitUpBps > 0 || *cfg.Access.RateLimitDownBps > 0) && len(written) > 0 {
		fmt.Fprintf(&b, "\n[access.user_rate_limits]\n")
		for _, u := range written {
			fmt.Fprintf(&b, "%s = { up_bps = %d, down_bps = %d }\n",
				telemtTomlUserKey(u.Username), *cfg.Access.RateLimitUpBps, *cfg.Access.RateLimitDownBps)
		}
	}
	return b.String(), nil
}

// ValidateTelemtInbound rejects an enabled Telemt inbound whose WEB mode has no public domain: its config and link cannot
// be built without one, so saving it would only move the error to the first config view.
func ValidateTelemtInbound(in *model.Inbound) error {
	if in == nil || !in.Enable || model.NormalizeProtocol(in.Protocol) != model.Telemt {
		return nil
	}
	cfg := parseTelemtSettings(in.Settings)
	if cfg.Web != nil && cfg.Web.Enabled != nil && *cfg.Web.Enabled && strings.TrimSpace(cfg.Web.VhostHost) == "" {
		return fmt.Errorf("telemt web mode: the public domain (vhostHost) is required")
	}
	return nil
}

// appendTelemtWebListenerAndSection renders the private WEB [[server.listeners]] entry plus
// the [web] / [[web.vhosts]] tree for Telemt's HTTPS/WebSocket transport. The listener binds to
// a private address (loopback by default); the operator's own NGINX/HAProxy must terminate TLS
// on the public vhost host/port and reverse-proxy to this private listener, setting
// X-Forwarded-For for the configured trusted CIDRs. See TelemtWebSettings doc comment.
func appendTelemtWebListenerAndSection(b *strings.Builder, web *TelemtWebSettings, inbound *model.Inbound, users []TelemtAccessUser) error {
	host := strings.ToLower(strings.TrimSpace(web.VhostHost))
	if host == "" {
		return fmt.Errorf("telemt web mode: vhostHost is required")
	}
	publicAddr, err := TelemtWebResolvePublicIP(host, TelemtWebPublicPort)
	if err != nil {
		return fmt.Errorf("telemt web mode: resolve vhostHost %q: %w", host, err)
	}
	// The front (node/telemtweb.Manager) and Telemt always run co-located on the same
	// host/container, so the bind and trust boundary are fixed internal values, not
	// operator-configurable — there is no external proxy to distrust anymore.
	backend, err := TelemtWebBackendAddr(inbound.Id, web)
	if err != nil {
		return err
	}
	bindIP, bindPortStr, err := net.SplitHostPort(backend)
	if err != nil {
		return fmt.Errorf("telemt web mode: invalid backend addr %q: %w", backend, err)
	}

	fmt.Fprintf(b, "[[server.listeners]]\n")
	fmt.Fprintf(b, "ip = %q\n", bindIP)
	fmt.Fprintf(b, "port = %s\n", bindPortStr)
	fmt.Fprintf(b, "transport = \"web\"\n")
	fmt.Fprintf(b, "proxy_protocol = false\n")
	fmt.Fprintf(b, "web_trusted_proxy_cidrs = [\"127.0.0.1/32\"]\n\n")

	fmt.Fprintf(b, "[web]\nenabled = true\n\n")

	fmt.Fprintf(b, "[[web.vhosts]]\n")
	fmt.Fprintf(b, "host = %q\n", host)
	fmt.Fprintf(b, "public_addr = %q\n\n", publicAddr)

	fmt.Fprintf(b, "[web.vhosts.decoy]\n")
	switch strings.TrimSpace(web.DecoyMode) {
	case "static_directory":
		fmt.Fprintf(b, "mode = \"static_directory\"\n")
		dir := strings.TrimSpace(web.DecoyDirectory)
		fmt.Fprintf(b, "directory = %q\n", dir)
		if idx := strings.TrimSpace(web.DecoyIndex); idx != "" {
			fmt.Fprintf(b, "index = %q\n", idx)
		}
	default:
		fmt.Fprintf(b, "mode = \"http_upstream\"\n")
		upstream := strings.TrimSpace(web.DecoyUpstream)
		if upstream == "" {
			upstream = "http://127.0.0.1:80"
		}
		fmt.Fprintf(b, "upstream = %q\n", upstream)
	}
	fmt.Fprintf(b, "\n")

	secretMode := strings.TrimSpace(web.ProfileSecretMode)
	if secretMode != "plain" && secretMode != "dd" {
		secretMode = "dd"
	}
	for _, u := range users {
		if !u.Enable || strings.TrimSpace(u.Username) == "" || len(strings.TrimSpace(u.Secret)) != 32 {
			continue
		}
		fmt.Fprintf(b, "[[web.vhosts.profiles]]\n")
		fmt.Fprintf(b, "user = %q\n", u.Username)
		fmt.Fprintf(b, "secret_mode = %q\n\n", secretMode)
	}
	return nil
}

// TelemtAccessUsersForInbound loads enabled clients with a Telemt secret for the inbound.
func TelemtAccessUsersForInbound(inboundId int) ([]TelemtAccessUser, error) {
	db := database.GetDB()
	var maps []model.ClientInboundMapping
	if err := db.Where("inbound_id = ?", inboundId).Find(&maps).Error; err != nil {
		return nil, err
	}
	seenID := make(map[int]struct{})
	clientIds := make([]int, 0, len(maps))
	for _, m := range maps {
		if _, ok := seenID[m.ClientId]; ok {
			continue
		}
		seenID[m.ClientId] = struct{}{}
		clientIds = append(clientIds, m.ClientId)
	}
	denyByClient := blockedTelemtDenyCIDRsByClientID(clientIds)

	out := make([]TelemtAccessUser, 0, len(maps))
	for _, m := range maps {
		secret := strings.TrimSpace(m.TelemtSecret)
		if secret == "" || len(secret) != 32 {
			continue
		}
		var c model.ClientEntity
		if err := db.First(&c, m.ClientId).Error; err != nil {
			continue
		}
		if !c.Enable {
			continue
		}
		em := strings.TrimSpace(c.Name)
		if em == "" {
			continue
		}
		u := TelemtAccessUser{Username: TelemtUsernameForClient(c.Id, em), Secret: secret, Enable: true}
		if c.TotalGB > 0 {
			u.DataQuotaBytes = uint64(math.Round(c.TotalGB * float64(1024*1024*1024)))
		}
		if c.ExpiryTime > 0 {
			u.ExpirationRFC3339 = time.UnixMilli(c.ExpiryTime).UTC().Format(time.RFC3339)
		}
		if c.IPLimitEnabled && c.MaxIPs > 0 {
			u.MaxUniqueIPs = c.MaxIPs
		} else if c.HWIDEnabled && c.MaxHWID > 0 {
			u.MaxUniqueIPs = c.MaxHWID
		}
		if d := denyByClient[c.Id]; len(d) > 0 {
			u.SourceDenyCIDRs = append([]string(nil), d...)
		}
		if tag := strings.TrimSpace(m.TelemtAdTag); tag != "" {
			u.AdTag = tag
		}
		out = append(out, u)
	}
	return out, nil
}

// telemtDenyCIDRFromStoredIP normalizes a panel session IP to a CIDR for Telemt [access.user_source_deny].
func telemtDenyCIDRFromStoredIP(stored string) string {
	n := NormalizeClientIP(stored)
	if n == "" {
		return ""
	}
	ip := net.ParseIP(n)
	if ip == nil {
		return ""
	}
	if ip4 := ip.To4(); ip4 != nil {
		return ip4.String() + "/32"
	}
	return ip.String() + "/128"
}

func blockedTelemtDenyCIDRsByClientID(clientIds []int) map[int][]string {
	if len(clientIds) == 0 {
		return nil
	}
	db := database.GetDB()
	var rows []model.ClientBlockedSessionIP
	if err := db.Where("client_id IN ?", clientIds).Find(&rows).Error; err != nil {
		return nil
	}
	uniq := make(map[int]map[string]struct{})
	for _, r := range rows {
		cidr := telemtDenyCIDRFromStoredIP(r.IP)
		if cidr == "" {
			continue
		}
		if uniq[r.ClientId] == nil {
			uniq[r.ClientId] = make(map[string]struct{})
		}
		uniq[r.ClientId][cidr] = struct{}{}
	}
	out := make(map[int][]string, len(uniq))
	for cid, set := range uniq {
		for c := range set {
			out[cid] = append(out[cid], c)
		}
	}
	return out
}

// BackfillTelemtSecretsForInbound sets telemt_secret on mappings that are missing it for a Telemt inbound.
func BackfillTelemtSecretsForInbound(inboundId int) error {
	db := database.GetDB()
	var ib model.Inbound
	if err := db.Select("id", "protocol").First(&ib, inboundId).Error; err != nil {
		return err
	}
	if model.NormalizeProtocol(ib.Protocol) != model.Telemt {
		return nil
	}
	var maps []model.ClientInboundMapping
	if err := db.Where("inbound_id = ?", inboundId).Find(&maps).Error; err != nil {
		return err
	}
	for _, m := range maps {
		if strings.TrimSpace(m.TelemtSecret) != "" {
			continue
		}
		sec, err := GenerateTelemtSecretHex()
		if err != nil {
			return err
		}
		if err := db.Model(&model.ClientInboundMapping{}).Where("id = ?", m.Id).Update("telemt_secret", sec).Error; err != nil {
			return err
		}
	}
	return nil
}

func BuildTelemtPayloadsForNode(node *model.Node, ibs []*model.Inbound) ([]TelemtNodePayload, error) {
	if node == nil {
		return []TelemtNodePayload{}, nil
	}
	// Return a non-nil empty slice (not nil) so JSON marshals to `[]` instead of `null`.
	// The worker treats `null`/missing as "do not change Telemt", but the caller's intent here
	// is "this node has no Telemt inbounds assigned → stop every Telemt sidecar".
	if len(ibs) == 0 {
		return []TelemtNodePayload{}, nil
	}
	ns := NodeService{}
	out := make([]TelemtNodePayload, 0)
	for _, ib := range ibs {
		if ib == nil || !ib.Enable {
			continue
		}
		if model.NormalizeProtocol(ib.Protocol) != model.Telemt {
			continue
		}
		users, err := TelemtAccessUsersForInbound(ib.Id)
		if err != nil {
			return nil, err
		}
		views, err := ns.GetInboundNodeBindingViews(ib.Id)
		if err != nil {
			return nil, err
		}
		var pubHost string
		var pubPort int
		for _, v := range views {
			if v.NodeId == node.Id {
				pubHost = strings.TrimSpace(v.PublishedAddress)
				pubPort = v.PublishedPort
				break
			}
		}
		workDir := fmt.Sprintf("/app/telemt/%s", ib.Tag)
		tomlStr, err := BuildTelemtToml(ib, users, pubHost, pubPort, workDir)
		if err != nil {
			// Do not let one inbound's config error (e.g. a WEB-mode vhost whose domain
			// doesn't resolve yet) block Xray/Telemt config push for every other inbound
			// on this node — skip just this one and keep going.
			logger.Warningf("telemt config for inbound %d (%s) on node %s: %v — skipping this inbound only", ib.Id, ib.Tag, node.Name, err)
			continue
		}
		out = append(out, TelemtNodePayload{InboundId: ib.Id, Tag: ib.Tag, Toml: tomlStr})
	}
	return out, nil
}

// BuildTelemtPayloadsStandalone builds Telemt TOML payloads for every enabled Telemt inbound
// when Xray runs on the panel host (!multiNode). Node assignment / published address are not used;
// links.publicHost / publicPort in inbound JSON control subscription links unless overridden in UI.
func BuildTelemtPayloadsStandalone() ([]TelemtNodePayload, error) {
	db := database.GetDB()
	var inbounds []model.Inbound
	if err := db.Where("enable = ?", true).Find(&inbounds).Error; err != nil {
		return nil, err
	}
	base := filepath.Join(config.GetDataFolderPath(), "telemt")
	out := make([]TelemtNodePayload, 0)
	for i := range inbounds {
		ib := &inbounds[i]
		if model.NormalizeProtocol(ib.Protocol) != model.Telemt {
			continue
		}
		users, err := TelemtAccessUsersForInbound(ib.Id)
		if err != nil {
			return nil, err
		}
		workDir := filepath.Join(base, ib.Tag)
		tomlStr, err := BuildTelemtToml(ib, users, "", 0, workDir)
		if err != nil {
			// See BuildTelemtPayloadsForNode: isolate one inbound's config error instead of
			// blocking every other standalone Telemt inbound on this panel host.
			logger.Warningf("telemt config for inbound %d (%s): %v — skipping this inbound only", ib.Id, ib.Tag, err)
			continue
		}
		out = append(out, TelemtNodePayload{InboundId: ib.Id, Tag: ib.Tag, Toml: tomlStr})
	}
	return out, nil
}

// telemtWebVhostForInbound returns the telemtweb.Vhost for ib if it's an enabled Telemt
// inbound with WEB mode on, or (zero-value, false) otherwise (including on parse/validation
// failure — callers should not block config apply on one misconfigured WEB vhost, though a
// missing/unresolvable domain here means that inbound's WEB front silently won't route,
// which is surfaced separately when BuildTelemtToml runs for that inbound's own TOML).
func telemtWebVhostForInbound(ib *model.Inbound) (telemtweb.Vhost, bool) {
	if ib == nil || !ib.Enable || model.NormalizeProtocol(ib.Protocol) != model.Telemt {
		return telemtweb.Vhost{}, false
	}
	cfg := parseTelemtSettings(ib.Settings)
	if cfg.Web == nil || cfg.Web.Enabled == nil || !*cfg.Web.Enabled {
		return telemtweb.Vhost{}, false
	}
	if cfg.Web.ExternalTerminator != nil && *cfg.Web.ExternalTerminator {
		return telemtweb.Vhost{}, false
	}
	domain := strings.ToLower(strings.TrimSpace(cfg.Web.VhostHost))
	if domain == "" {
		return telemtweb.Vhost{}, false
	}
	frontPort := DefaultTelemtWebFrontPort
	if cfg.Web.FrontPort != nil && *cfg.Web.FrontPort > 0 {
		frontPort = *cfg.Web.FrontPort
	}
	backend, err := TelemtWebBackendAddr(ib.Id, cfg.Web)
	if err != nil {
		return telemtweb.Vhost{}, false
	}
	return telemtweb.Vhost{
		Domain:    domain,
		Backend:   backend,
		FrontPort: frontPort,
	}, true
}

// BuildTelemtWebVhostsForNode collects telemtweb.Vhost entries for every enabled, WEB-mode
// Telemt inbound assigned to node, for pushing to that worker's telemtweb.Manager.
func BuildTelemtWebVhostsForNode(node *model.Node, ibs []*model.Inbound) []telemtweb.Vhost {
	if node == nil || len(ibs) == 0 {
		return []telemtweb.Vhost{}
	}
	out := make([]telemtweb.Vhost, 0)
	for _, ib := range ibs {
		if v, ok := telemtWebVhostForInbound(ib); ok {
			out = append(out, v)
		}
	}
	return out
}

// BuildTelemtWebVhostsStandalone collects telemtweb.Vhost entries for every enabled, WEB-mode
// Telemt inbound when Xray runs on the panel host (!multiNode).
func BuildTelemtWebVhostsStandalone() ([]telemtweb.Vhost, error) {
	db := database.GetDB()
	var inbounds []model.Inbound
	if err := db.Where("enable = ?", true).Find(&inbounds).Error; err != nil {
		return nil, err
	}
	out := make([]telemtweb.Vhost, 0)
	for i := range inbounds {
		if v, ok := telemtWebVhostForInbound(&inbounds[i]); ok {
			out = append(out, v)
		}
	}
	return out, nil
}

// PreviewTelemtToml returns the Telemt config.toml that would be deployed for this inbound (wizard preview).
// When inbound.Id > 0, [access.users] is filled from the database; for a new inbound the section is empty until clients are assigned.
func PreviewTelemtToml(inbound *model.Inbound) (string, error) {
	if inbound == nil {
		return "", fmt.Errorf("inbound is nil")
	}
	if model.NormalizeProtocol(inbound.Protocol) != model.Telemt {
		return "", fmt.Errorf("not a telemt inbound")
	}
	tag := strings.TrimSpace(inbound.Tag)
	if tag == "" {
		tag = "inbound-preview"
	}
	var users []TelemtAccessUser
	if inbound.Id > 0 {
		u, err := TelemtAccessUsersForInbound(inbound.Id)
		if err != nil {
			return "", err
		}
		users = u
	}
	workDir := filepath.Join(config.GetDataFolderPath(), "telemt", tag)
	return BuildTelemtToml(inbound, users, "", 0, workDir)
}
