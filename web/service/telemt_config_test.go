package service

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/pelletier/go-toml/v2"
)

func TestTelemtUsernameForClient(t *testing.T) {
	cases := []struct {
		name     string
		clientId int
		input    string
		want     string
	}{
		{"ascii name kept as-is", 7, "alice", "alice"},
		{"ascii with dot dash underscore kept as-is", 7, "alice.smith-99_x", "alice.smith-99_x"},
		{"cyrillic falls back to stable id", 42, "Иван", "u42"},
		{"empty falls back to stable id", 5, "", "u5"},
		{"whitespace-only falls back to stable id", 5, "   ", "u5"},
		{"trims before validating", 7, "  alice  ", "alice"},
		{"space inside name falls back to stable id", 9, "alice smith", "u9"},
		{"too long falls back to stable id", 3, strings.Repeat("a", 65), "u3"},
		{"exactly 64 chars kept as-is", 3, strings.Repeat("a", 64), strings.Repeat("a", 64)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := TelemtUsernameForClient(c.clientId, c.input)
			if got != c.want {
				t.Fatalf("TelemtUsernameForClient(%d, %q) = %q, want %q", c.clientId, c.input, got, c.want)
			}
		})
	}
}

func testTelemtInbound(t *testing.T, settingsJSON string) *model.Inbound {
	t.Helper()
	return &model.Inbound{Id: 1, Tag: "telemt-test", Port: 8443, Listen: "0.0.0.0", Protocol: model.Telemt, Settings: settingsJSON}
}

func TestBuildTelemtToml_QuickWinFields(t *testing.T) {
	settings := `{"telemt":{
		"apiAuthHeader": "Bearer secrettoken",
		"maxConnections": 5000,
		"censorship": {
			"tlsDomains": ["a.example.com", "b.example.com"],
			"maskProxyProtocol": 1,
			"serverHelloDelayMinMs": 10,
			"serverHelloDelayMaxMs": 200
		},
		"timeouts": {
			"clientHandshake": 30,
			"relayIdlePolicyV2Enabled": true,
			"relayClientIdleSoftSecs": 120,
			"relayClientIdleHardSecs": 360,
			"relayIdleGraceAfterDownstreamActivitySecs": 30,
			"meOneRetry": 12,
			"meOneTimeoutMs": 1200
		},
		"access": {
			"userMaxUniqueIpsMode": "combined",
			"userMaxUniqueIpsWindowSecs": 45,
			"rateLimitUpBps": 1000000,
			"rateLimitDownBps": 5000000
		}
	}}`
	inbound := testTelemtInbound(t, settings)
	users := []TelemtAccessUser{{Username: "alice", Secret: strings.Repeat("a", 32), Enable: true}}
	toml, err := BuildTelemtToml(inbound, users, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}

	for _, want := range []string{
		`auth_header = "Bearer secrettoken"`,
		"max_connections = 5000",
		`tls_domains = ["a.example.com", "b.example.com"]`,
		"mask_proxy_protocol = 1",
		"server_hello_delay_min_ms = 10",
		"server_hello_delay_max_ms = 200",
		"relay_idle_policy_v2_enabled = true",
		"relay_client_idle_soft_secs = 120",
		"relay_client_idle_hard_secs = 360",
		"relay_idle_grace_after_downstream_activity_secs = 30",
		"me_one_retry = 12",
		"me_one_timeout_ms = 1200",
		`user_max_unique_ips_mode = "combined"`,
		"user_max_unique_ips_window_secs = 45",
		"[access.user_rate_limits]",
		"alice = { up_bps = 1000000, down_bps = 5000000 }",
	} {
		if !strings.Contains(toml, want) {
			t.Errorf("expected TOML to contain %q, got:\n%s", want, toml)
		}
	}
}

func TestBuildTelemtToml_ServerHelloDelayRejectedWhenNotLessThanHandshake(t *testing.T) {
	// max_ms (30000) is not < client_handshake_secs*1000 (30*1000=30000) -> must be omitted.
	settings := `{"telemt":{
		"timeouts": {"clientHandshake": 30},
		"censorship": {"serverHelloDelayMinMs": 0, "serverHelloDelayMaxMs": 30000}
	}}`
	inbound := testTelemtInbound(t, settings)
	toml, err := BuildTelemtToml(inbound, nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(toml, "server_hello_delay_max_ms") {
		t.Errorf("expected server_hello_delay_max_ms to be omitted when not < client_handshake*1000, got:\n%s", toml)
	}
}

func TestBuildTelemtToml_RelayIdleOmittedWhenSoftGreaterThanHard(t *testing.T) {
	settings := `{"telemt":{"timeouts": {"relayClientIdleSoftSecs": 400, "relayClientIdleHardSecs": 360}}}`
	inbound := testTelemtInbound(t, settings)
	toml, err := BuildTelemtToml(inbound, nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(toml, "relay_client_idle_soft_secs") || strings.Contains(toml, "relay_client_idle_hard_secs") {
		t.Errorf("expected relay idle fields to be omitted when soft > hard, got:\n%s", toml)
	}
}

func TestBuildTelemtToml_DirectModeListenerUnchangedWhenWebDisabled(t *testing.T) {
	inbound := testTelemtInbound(t, `{"telemt":{}}`)
	toml, err := BuildTelemtToml(inbound, nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(toml, `[[server.listeners]]`+"\n"+`ip = "0.0.0.0"`) {
		t.Errorf("expected direct-mode listener to bind inbound.Listen, got:\n%s", toml)
	}
	if strings.Contains(toml, `transport = "web"`) || strings.Contains(toml, "[web]") {
		t.Errorf("did not expect web transport/section when web mode is disabled, got:\n%s", toml)
	}
}

// stubTelemtWebDNS replaces the package-level DNS lookup with a fixed answer for the
// duration of the test, so TestBuildTelemtToml_WebMode* never makes a real network call.
func stubTelemtWebDNS(t *testing.T, host string, ips ...net.IP) {
	t.Helper()
	orig := telemtWebLookupIP
	telemtWebLookupIP = func(h string) ([]net.IP, error) {
		if h == host {
			return ips, nil
		}
		return nil, &net.DNSError{Err: "no such host", Name: h, IsNotFound: true}
	}
	t.Cleanup(func() { telemtWebLookupIP = orig })
}

func TestBuildTelemtToml_WebMode(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10"))
	settings := `{"telemt":{
		"web": {
			"enabled": true,
			"vhostHost": "proxy.example.com",
			"decoyMode": "http_upstream",
			"decoyUpstream": "http://127.0.0.1:8080",
			"profileSecretMode": "dd"
		}
	}}`
	inbound := testTelemtInbound(t, settings)
	users := []TelemtAccessUser{
		{Username: "alice", Secret: strings.Repeat("a", 32), Enable: true},
		{Username: "u9", Secret: strings.Repeat("b", 32), Enable: true},
		{Username: "disabled-user", Secret: strings.Repeat("c", 32), Enable: false},
	}
	toml, err := BuildTelemtToml(inbound, users, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}

	wantBackend := TelemtWebBackendAddrForInbound(inbound.Id)
	wantBindIP, wantBindPort, _ := net.SplitHostPort(wantBackend)
	for _, want := range []string{
		fmt.Sprintf(`ip = %q`, wantBindIP),
		fmt.Sprintf("port = %s", wantBindPort),
		`transport = "web"`,
		"proxy_protocol = false",
		`web_trusted_proxy_cidrs = ["127.0.0.1/32"]`,
		"[web]\nenabled = true",
		"[[web.vhosts]]",
		`host = "proxy.example.com"`,
		`public_addr = "203.0.113.10:443"`,
		"[web.vhosts.decoy]",
		`upstream = "http://127.0.0.1:8080"`,
		"[[web.vhosts.profiles]]",
		`user = "alice"`,
		`secret_mode = "dd"`,
		`user = "u9"`,
	} {
		if !strings.Contains(toml, want) {
			t.Errorf("expected web-mode TOML to contain %q, got:\n%s", want, toml)
		}
	}
	if strings.Contains(toml, `user = "disabled-user"`) {
		t.Errorf("did not expect a profile for a disabled user, got:\n%s", toml)
	}
}

func TestBuildTelemtToml_WebModePublicAddrAlwaysPort443(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10"))
	settings := `{"telemt":{"web": {"enabled": true, "vhostHost": "proxy.example.com", "frontPort": 8443}}}`
	inbound := testTelemtInbound(t, settings)
	toml, err := BuildTelemtToml(inbound, nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	// Telemt rejects any public_addr port other than 443, so a custom front (bind) port
	// must not leak into it.
	if !strings.Contains(toml, `public_addr = "203.0.113.10:443"`) {
		t.Errorf("expected public_addr on port 443 regardless of frontPort, got:\n%s", toml)
	}
	inbound.Enable = true
	v, ok := telemtWebVhostForInbound(inbound)
	if !ok || v.FrontPort != 8443 {
		t.Errorf("front should still bind the custom port, got %+v ok=%v", v, ok)
	}
}

func TestBuildTelemtToml_WebModeCustomBackendPort(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10"))
	settings := `{"telemt":{"web": {"enabled": true, "vhostHost": "proxy.example.com", "backendPort": 9002}}}`
	inbound := testTelemtInbound(t, settings)
	toml, err := BuildTelemtToml(inbound, nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(toml, "ip = \"127.0.0.1\"\nport = 9002\n") {
		t.Errorf("expected listener on the custom backend port, got:\n%s", toml)
	}
	inbound.Enable = true
	v, ok := telemtWebVhostForInbound(inbound)
	if !ok || v.Backend != "127.0.0.1:9002" {
		t.Errorf("front must proxy to the same backend port, got %+v ok=%v", v, ok)
	}
}

func TestBuildTelemtToml_WebModeExternalTerminatorNoFront(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10"))
	settings := `{"telemt":{"web": {"enabled": true, "vhostHost": "proxy.example.com", "externalTerminator": true, "backendPort": 28110}}}`
	inbound := testTelemtInbound(t, settings)
	inbound.Enable = true
	toml, err := BuildTelemtToml(inbound, nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`public_addr = "203.0.113.10:443"`, "ip = \"127.0.0.1\"\nport = 28110\n", `transport = "web"`} {
		if !strings.Contains(toml, want) {
			t.Errorf("missing %q in:\n%s", want, toml)
		}
	}
	// The built-in front must not be started, otherwise it would fight the external
	// terminator (xray/nginx) for port 443.
	if v, ok := telemtWebVhostForInbound(inbound); ok {
		t.Errorf("external terminator must not register a front vhost, got %+v", v)
	}
}

func TestBuildTelemtToml_WebModeBackendPortOutOfRange(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10"))
	settings := `{"telemt":{"web": {"enabled": true, "vhostHost": "proxy.example.com", "backendPort": 80}}}`
	inbound := testTelemtInbound(t, settings)
	if _, err := BuildTelemtToml(inbound, nil, "", 0, ""); err == nil {
		t.Fatal("expected an error for a privileged/invalid backendPort")
	}
}

func TestBuildTelemtToml_WebModeRequiresVhostHost(t *testing.T) {
	settings := `{"telemt":{"web": {"enabled": true}}}`
	inbound := testTelemtInbound(t, settings)
	if _, err := BuildTelemtToml(inbound, nil, "", 0, ""); err == nil {
		t.Fatal("expected an error when web mode is enabled without vhostHost")
	}
}

func TestBuildTelemtToml_WebModeUnresolvableHostErrors(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10")) // stub only answers this host
	settings := `{"telemt":{"web": {"enabled": true, "vhostHost": "not-pointed-here.example.com"}}}`
	inbound := testTelemtInbound(t, settings)
	if _, err := BuildTelemtToml(inbound, nil, "", 0, ""); err == nil {
		t.Fatal("expected an error when vhostHost does not resolve")
	}
}

func TestBuildTelemtToml_WebModeStaticDirectoryDecoy(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10"))
	settings := `{"telemt":{
		"web": {
			"enabled": true,
			"vhostHost": "proxy.example.com",
			"decoyMode": "static_directory",
			"decoyDirectory": "/var/www/decoy",
			"decoyIndex": "index.html"
		}
	}}`
	inbound := testTelemtInbound(t, settings)
	toml, err := BuildTelemtToml(inbound, nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`directory = "/var/www/decoy"`, `index = "index.html"`} {
		if !strings.Contains(toml, want) {
			t.Errorf("expected %q in TOML, got:\n%s", want, toml)
		}
	}
}

func TestTelemtWebBackendAddrForInbound_UniquePerInbound(t *testing.T) {
	a := TelemtWebBackendAddrForInbound(1)
	b := TelemtWebBackendAddrForInbound(2)
	if a == b {
		t.Fatalf("expected distinct backend addresses, got %q for both", a)
	}
	if !strings.HasPrefix(a, "127.0.0.1:") || !strings.HasPrefix(b, "127.0.0.1:") {
		t.Fatalf("expected loopback backend addresses, got %q and %q", a, b)
	}
}

// Decode the generated document so a mode in the wrong TOML table cannot satisfy
// this regression check. Telemt's tagged WebDecoyConfig requires decoy.mode.
func TestBuildTelemtToml_WebDecoyDiscriminator(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10"))
	for _, tc := range []struct{ name, settings, mode, directory, upstream string }{
		{"static", `"decoyMode":"static_directory","decoyDirectory":"/var/www/decoy","decoyIndex":"index.html"`, "static_directory", "/var/www/decoy", ""},
		{"upstream", `"decoyMode":"http_upstream","decoyUpstream":"http://127.0.0.1:8080"`, "http_upstream", "", "http://127.0.0.1:8080"},
		{"default", `"decoyMode":""`, "http_upstream", "", "http://127.0.0.1:80"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settings := `{"telemt":{"web":{"enabled":true,"vhostHost":"proxy.example.com",` + tc.settings + `}}}`
			generated, err := BuildTelemtToml(testTelemtInbound(t, settings), nil, "", 0, "")
			if err != nil {
				t.Fatal(err)
			}
			var parsed struct {
				Web struct {
					Vhosts []struct {
						Decoy struct{ Mode, Directory, Upstream, Index string }
					}
				}
			}
			if err := toml.Unmarshal([]byte(generated), &parsed); err != nil {
				t.Fatalf("invalid TOML: %v", err)
			}
			if len(parsed.Web.Vhosts) != 1 {
				t.Fatalf("expected one vhost, got %d", len(parsed.Web.Vhosts))
			}
			decoy := parsed.Web.Vhosts[0].Decoy
			if decoy.Mode != tc.mode || decoy.Directory != tc.directory || decoy.Upstream != tc.upstream {
				t.Fatalf("decoy = %+v; want mode=%q directory=%q upstream=%q", decoy, tc.mode, tc.directory, tc.upstream)
			}
			if tc.mode == "static_directory" && decoy.Index != "index.html" {
				t.Fatalf("static index = %q", decoy.Index)
			}
		})
	}
}

func TestBuildTelemtToml_WebRetryJitterAndDecoyTimeout(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10"))
	settings := `{"telemt":{"web":{
		"enabled": true,
		"vhostHost": "proxy.example.com",
		"retryJitterEnabled": true,
		"retryJitterMinMs": 10,
		"retryJitterMaxMs": 500,
		"retryJitterDistribution": "triangular",
		"retryJitterPeakMs": 250,
		"decoyResolveSecs": 7
	}}}`
	generated, err := BuildTelemtToml(testTelemtInbound(t, settings), nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"[web.retry_jitter]\nenabled = true\n",
		"min_ms = 10\n",
		"max_ms = 500\n",
		`distribution = "triangular"` + "\n",
		"peak_ms = 250\n",
		"[web.timeouts]\ndecoy_resolve_secs = 7\n",
	} {
		if !strings.Contains(generated, want) {
			t.Errorf("expected %q in TOML, got:\n%s", want, generated)
		}
	}
	// Placement matters: subtables of [web] must precede the [[web.vhosts]] array of tables.
	webIdx := strings.Index(generated, "[web]\n")
	jitterIdx := strings.Index(generated, "[web.retry_jitter]")
	timeoutsIdx := strings.Index(generated, "[web.timeouts]")
	vhostIdx := strings.Index(generated, "[[web.vhosts]]")
	if !(webIdx < jitterIdx && jitterIdx < timeoutsIdx && timeoutsIdx < vhostIdx) {
		t.Errorf("unexpected section order (web=%d jitter=%d timeouts=%d vhosts=%d):\n%s",
			webIdx, jitterIdx, timeoutsIdx, vhostIdx, generated)
	}

	var parsed struct {
		Web struct {
			RetryJitter struct {
				Enabled      bool   `toml:"enabled"`
				MinMs        int    `toml:"min_ms"`
				MaxMs        int    `toml:"max_ms"`
				Distribution string `toml:"distribution"`
				PeakMs       int    `toml:"peak_ms"`
			} `toml:"retry_jitter"`
			Timeouts struct {
				DecoyResolveSecs int `toml:"decoy_resolve_secs"`
			} `toml:"timeouts"`
			Vhosts []map[string]any `toml:"vhosts"`
		} `toml:"web"`
	}
	if err := toml.Unmarshal([]byte(generated), &parsed); err != nil {
		t.Fatalf("invalid TOML: %v\n%s", err, generated)
	}
	j := parsed.Web.RetryJitter
	if !j.Enabled || j.MinMs != 10 || j.MaxMs != 500 || j.Distribution != "triangular" || j.PeakMs != 250 {
		t.Errorf("retry_jitter parsed wrong: %+v", j)
	}
	if parsed.Web.Timeouts.DecoyResolveSecs != 7 {
		t.Errorf("decoy_resolve_secs parsed wrong: %d", parsed.Web.Timeouts.DecoyResolveSecs)
	}
}

func TestBuildTelemtToml_WebRetryJitterUniformOmitsPeak(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10"))
	settings := `{"telemt":{"web":{"enabled":true,"vhostHost":"proxy.example.com",
		"retryJitterEnabled":true,"retryJitterDistribution":"uniform"}}}`
	generated, err := BuildTelemtToml(testTelemtInbound(t, settings), nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(generated, "[web.retry_jitter]\nenabled = true\n") {
		t.Errorf("expected retry_jitter block:\n%s", generated)
	}
	if strings.Contains(generated, "peak_ms") {
		t.Errorf("peak_ms must not be written for uniform distribution:\n%s", generated)
	}
	if strings.Contains(generated, "min_ms") || strings.Contains(generated, "max_ms") {
		t.Errorf("unset bounds must not be written:\n%s", generated)
	}
}

func TestBuildTelemtToml_WebRetryJitterValidation(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10"))
	base := func(extra string) string {
		return `{"telemt":{"web":{"enabled":true,"vhostHost":"proxy.example.com",` + extra + `}}}`
	}
	cases := []struct{ name, extra, errPart string }{
		{"peak with uniform", `"retryJitterEnabled":true,"retryJitterPeakMs":100`, "retryJitterPeakMs"},
		{"min above max", `"retryJitterEnabled":true,"retryJitterMinMs":600,"retryJitterMaxMs":500`, "must not exceed"},
		{"max out of range", `"retryJitterEnabled":true,"retryJitterMaxMs":30001`, "out of range"},
		{"bad distribution", `"retryJitterEnabled":true,"retryJitterDistribution":"normal"`, "must be"},
		{"values with enabled off", `"retryJitterMinMs":10`, "retryJitterEnabled=true"},
		{"decoy out of range", `"retryJitterEnabled":false,"decoyResolveSecs":3601`, "decoyResolveSecs"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := BuildTelemtToml(testTelemtInbound(t, base(c.extra)), nil, "", 0, ""); err == nil || !strings.Contains(err.Error(), c.errPart) {
				t.Fatalf("want error containing %q, got %v", c.errPart, err)
			}
		})
	}
}

func TestBuildTelemtToml_WildcardHost(t *testing.T) {
	settings := func(external bool) string {
		return `{"telemt":{"web":{"enabled":true,"vhostHost":"*.example.com","externalTerminator":` +
			strconv.FormatBool(external) + `},"links":{"publicHost":"client.example.com"}}}`
	}
	if _, err := BuildTelemtToml(testTelemtInbound(t, settings(false)), nil, "", 0, ""); err == nil ||
		!strings.Contains(err.Error(), "external TLS terminator") {
		t.Fatalf("wildcard host without external terminator must be rejected, got %v", err)
	}

	// Only the apex resolves: the renderer must look up "example.com", not "*.example.com".
	stubTelemtWebDNS(t, "example.com", net.ParseIP("203.0.113.10"))
	generated, err := BuildTelemtToml(testTelemtInbound(t, settings(true)), nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"[web]\nenabled = true\nallow_wildcard_hosts = true\n",
		`host = "*.example.com"`,
		`public_addr = "203.0.113.10:443"`,
		"[web.limits]\nmemory_envelope_bytes = 2147483648\n",
	} {
		if !strings.Contains(generated, want) {
			t.Errorf("expected %q in TOML, got:\n%s", want, generated)
		}
	}
	limitsIdx := strings.Index(generated, "[web.limits]")
	vhostsIdx := strings.Index(generated, "[[web.vhosts]]")
	if !(limitsIdx >= 0 && limitsIdx < vhostsIdx) {
		t.Errorf("expected [web.limits] before [[web.vhosts]] (limits=%d vhosts=%d):\n%s", limitsIdx, vhostsIdx, generated)
	}
}

func TestTelemtWildcardRequiresConcretePublicHost(t *testing.T) {
	settings := func(links string) string {
		return `{"telemt":{` + links + `"web":{"enabled":true,"vhostHost":"*.example.com","externalTerminator":true}}}`
	}
	stubTelemtWebDNS(t, "example.com", net.ParseIP("203.0.113.10"))

	// Client links cannot publish "*.example.com", so a concrete publicHost is mandatory.
	if _, err := BuildTelemtToml(testTelemtInbound(t, settings("")), nil, "", 0, ""); err == nil ||
		!strings.Contains(err.Error(), "requires links.publicHost with a concrete subdomain") {
		t.Fatalf("wildcard host without links.publicHost must be rejected, got %v", err)
	}
	// A wildcard in publicHost itself is never valid, even for an exact vhost.
	if err := validateTelemtWildcardPublicHost("proxy.example.com", "*.example.com"); err == nil ||
		!strings.Contains(err.Error(), "must not be a wildcard") {
		t.Fatalf("wildcard publicHost must be rejected, got %v", err)
	}
	if err := validateTelemtWildcardPublicHost("*.example.com", ""); err == nil ||
		!strings.Contains(err.Error(), "requires links.publicHost") {
		t.Fatalf("wildcard host with an empty publicHost must be rejected, got %v", err)
	}
	if err := validateTelemtWildcardPublicHost("*.example.com", "203.0.113.10"); err == nil {
		t.Fatal("an IP literal is not a concrete public hostname")
	}
	// The suffix selector never matches the apex or another domain.
	if err := validateTelemtWildcardPublicHost("*.example.com", "example.com"); err == nil ||
		!strings.Contains(err.Error(), "strict subdomain") {
		t.Fatalf("the apex must be rejected as publicHost, got %v", err)
	}
	if err := validateTelemtWildcardPublicHost("*.example.com", "client.other.com"); err == nil ||
		!strings.Contains(err.Error(), "strict subdomain") {
		t.Fatalf("a foreign domain must be rejected as publicHost, got %v", err)
	}
	if err := validateTelemtWildcardPublicHost("*.example.com", "Client.Example.Com"); err != nil {
		t.Fatalf("uppercase concrete subdomain must be accepted, got %v", err)
	}

	generated, err := BuildTelemtToml(testTelemtInbound(t, settings(`"links":{"publicHost":"client.example.com"},`)), nil, "", 0, "")
	if err != nil {
		t.Fatalf("wildcard host with a concrete publicHost must build, got %v", err)
	}
	if !strings.Contains(generated, `host = "*.example.com"`) || !strings.Contains(generated, "allow_wildcard_hosts = true") {
		t.Errorf("wildcard config not rendered:\n%s", generated)
	}
	// Uppercase spelling is normalized by validation and still builds.
	if _, err := BuildTelemtToml(testTelemtInbound(t, settings(`"links":{"publicHost":"Client.Example.Com"},`)), nil, "", 0, ""); err != nil {
		t.Fatalf("uppercase concrete publicHost must build, got %v", err)
	}
}

func TestBuildTelemtToml_WildcardKeepsPersistedPublicHostOverNodeBinding(t *testing.T) {
	stubTelemtWebDNS(t, "example.com", net.ParseIP("203.0.113.10"))
	settings := `{"telemt":{"links":{"publicHost":"client.example.com"},` +
		`"web":{"enabled":true,"vhostHost":"*.example.com","externalTerminator":true}}}`
	// A node's published address may be a raw IP; it must not clobber links.publicHost for a
	// wildcard vhost (that would fail validation and silently drop the inbound from the push).
	generated, err := BuildTelemtToml(testTelemtInbound(t, settings), nil, "203.0.113.99", 443, "")
	if err != nil {
		t.Fatalf("wildcard build must keep the persisted publicHost, got %v", err)
	}
	if !strings.Contains(generated, `public_host = "client.example.com"`) {
		t.Errorf("expected the persisted publicHost in [general.links], got:\n%s", generated)
	}
	if strings.Contains(generated, `public_host = "203.0.113.99"`) {
		t.Errorf("node binding IP must not replace the wildcard publicHost:\n%s", generated)
	}
}

func TestValidateTelemtWildcardHostShape(t *testing.T) {
	mk := func(host string) *TelemtWebSettings {
		ext := true
		return &TelemtWebSettings{VhostHost: host, ExternalTerminator: &ext}
	}
	if err := validateTelemtWildcardHost(mk("*")); err == nil || !strings.Contains(err.Error(), "catch-all wildcard") {
		t.Fatalf("catch-all \"*\" must be rejected, got %v", err)
	}
	for _, host := range []string{"*.", "*.bad_suffix", "*.example..com"} {
		if err := validateTelemtWildcardHost(mk(host)); err == nil || !strings.Contains(err.Error(), "no valid DNS suffix") {
			t.Errorf("%q: expected invalid-suffix error, got %v", host, err)
		}
	}
	if err := validateTelemtWildcardHost(mk("*.example.com")); err != nil {
		t.Errorf("valid wildcard host rejected: %v", err)
	}
}

func TestTelemtQuotaUserLookupFailsClosed(t *testing.T) {
	orig := telemtQuotaUserCount
	t.Cleanup(func() { telemtQuotaUserCount = orig })
	in := &model.Inbound{Id: 7, Protocol: model.Telemt}

	telemtQuotaUserCount = func(*model.Inbound) (int64, error) { return 0, errors.New("db down") }
	if !telemtInboundHasQuotaUsers(in) {
		t.Error("lookup error must keep the quota version gate (return true)")
	}
	telemtQuotaUserCount = func(*model.Inbound) (int64, error) { return 1, nil }
	if !telemtInboundHasQuotaUsers(in) {
		t.Error("one quota user must report true")
	}
	telemtQuotaUserCount = func(*model.Inbound) (int64, error) { return 0, nil }
	if telemtInboundHasQuotaUsers(in) {
		t.Error("no quota users must report false")
	}
}

func TestBuildTelemtToml_NonWildcardOmitsAllowWildcardHosts(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10"))
	settings := `{"telemt":{"web":{"enabled":true,"vhostHost":"proxy.example.com","externalTerminator":true}}}`
	generated, err := BuildTelemtToml(testTelemtInbound(t, settings), nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(generated, "allow_wildcard_hosts") {
		t.Errorf("allow_wildcard_hosts must stay at its default for an exact host:\n%s", generated)
	}
	if strings.Contains(generated, "[web.limits]") || strings.Contains(generated, "memory_envelope_bytes") {
		t.Errorf("non-wildcard WEB must not get a [web.limits] block:\n%s", generated)
	}
}

func TestBuildTelemtToml_WildcardMemoryEnvelope(t *testing.T) {
	stubTelemtWebDNS(t, "example.com", net.ParseIP("203.0.113.10"))
	settings := func(params string) string {
		return `{"telemt":{"links":{"publicHost":"client.example.com"},"web":{"enabled":true,` +
			`"vhostHost":"*.example.com","externalTerminator":true}` + params + `}}`
	}

	// Operator value below the wildcard minimum must be rejected (save/build).
	small := settings(`, "params":{"web.limits.memory_envelope_bytes":1000000}`)
	if _, err := BuildTelemtToml(testTelemtInbound(t, small), nil, "", 0, ""); err == nil ||
		!strings.Contains(err.Error(), "wildcard hosts require web.limits.memory_envelope_bytes >= 2147483648") ||
		!strings.Contains(err.Error(), "currently 1000000") {
		t.Fatalf("small memory envelope must be rejected, got %v", err)
	}
	if err := validateTelemtWildcardMemoryEnvelope(parseTelemtSettings(small).Web, parseTelemtSettings(small).Params); err == nil {
		t.Fatal("save validation must reject the small memory envelope too")
	}

	// A valid operator value wins and is not duplicated by the generated 2 GiB default.
	big := settings(`, "params":{"web.limits.memory_envelope_bytes":3221225472}`)
	generated, err := BuildTelemtToml(testTelemtInbound(t, big), nil, "", 0, "")
	if err != nil {
		t.Fatalf("valid operator envelope must build, got %v", err)
	}
	if n := strings.Count(generated, "memory_envelope_bytes"); n != 1 {
		t.Errorf("expected exactly one memory_envelope_bytes, got %d:\n%s", n, generated)
	}
	if !strings.Contains(generated, "memory_envelope_bytes = 3221225472") {
		t.Errorf("operator value lost:\n%s", generated)
	}
	if strings.Contains(generated, "2147483648") {
		t.Errorf("generated default must not be added when the operator set a value:\n%s", generated)
	}
}

func TestValidateTelemtInboundRequiresWebProfiles(t *testing.T) {
	orig := telemtWebProfileUserCount
	t.Cleanup(func() { telemtWebProfileUserCount = orig })

	settings := `{"telemt":{"web":{"enabled":true,"vhostHost":"proxy.example.com"}}}`
	in := &model.Inbound{Id: 5, Enable: true, Protocol: model.Telemt, Settings: settings}

	telemtWebProfileUserCount = func(int) (int64, error) { return 0, nil }
	if err := ValidateTelemtInbound(in); err == nil ||
		!strings.Contains(err.Error(), "at least one client is required") {
		t.Fatalf("WEB inbound without profiles must be rejected on save, got %v", err)
	}

	telemtWebProfileUserCount = func(int) (int64, error) { return 1, nil }
	if err := ValidateTelemtInbound(in); err != nil {
		t.Fatalf("WEB inbound with a client must save, got %v", err)
	}

	// A brand-new inbound (Id 0) has no mappings yet; creation must stay possible.
	brandNew := *in
	brandNew.Id = 0
	if err := ValidateTelemtInbound(&brandNew); err != nil {
		t.Fatalf("new WEB inbound must be creatable before clients are attached, got %v", err)
	}
}

func TestBuildTelemtToml_UserQuotaPeriodsOnlyForQuotaUsers(t *testing.T) {
	settings := `{"telemt":{"access":{"userQuotaPeriod":"monthly"}}}`
	users := []TelemtAccessUser{
		{Username: "alice", Secret: strings.Repeat("a", 32), Enable: true, DataQuotaBytes: 1024},
		{Username: "bob", Secret: strings.Repeat("b", 32), Enable: true},
	}
	generated, err := BuildTelemtToml(testTelemtInbound(t, settings), users, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"[access.user_data_quota]\nalice = 1024\n", "[access.user_quota_periods]\nalice = \"monthly\"\n"} {
		if !strings.Contains(generated, want) {
			t.Errorf("expected %q in TOML, got:\n%s", want, generated)
		}
	}
	if strings.Contains(generated, `bob = "monthly"`) {
		t.Errorf("period must only be written for users with a data quota:\n%s", generated)
	}

	// No quota users -> no periods table at all (not an error).
	generated, err = BuildTelemtToml(testTelemtInbound(t, settings),
		[]TelemtAccessUser{{Username: "bob", Secret: strings.Repeat("b", 32), Enable: true}}, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(generated, "[access.user_quota_periods]") {
		t.Errorf("did not expect a periods table without quota users:\n%s", generated)
	}

	// Invalid enum is rejected.
	if _, err := BuildTelemtToml(testTelemtInbound(t, `{"telemt":{"access":{"userQuotaPeriod":"yearly"}}}`), users, "", 0, ""); err == nil {
		t.Error("invalid quota period must be rejected")
	}
}

func TestTelemtStructuredVersionGate(t *testing.T) {
	settings := `{"telemt":{
		"web":{"enabled":true,"vhostHost":"proxy.example.com","externalTerminator":true,
			"retryJitterEnabled":true,"decoyResolveSecs":5},
		"access":{"userQuotaPeriod":"weekly"}
	}}`
	cfg := parseTelemtSettings(settings)
	need := telemtStructuredNeed(cfg)
	for _, id := range []string{"web.retry_jitter", "web.timeouts.decoy_resolve_secs", "access.user_quota_periods"} {
		if _, ok := need[id]; !ok {
			t.Errorf("structured need lacks %s: %v", id, need)
		}
	}
	bad := map[string]string{}
	for id, since := range need {
		if telemtVersionLess("3.5.7", since) {
			bad[id] = since
		}
	}
	err := formatTelemtVersionGateError("node-1", "3.5.7", bad)
	if err == nil || !strings.Contains(err.Error(), "node-1") || !strings.Contains(err.Error(), "3.5.7") ||
		!strings.Contains(err.Error(), "web.retry_jitter") || !strings.Contains(err.Error(), "Telemt >= 3.5.16") {
		t.Fatalf("unexpected version gate error: %v", err)
	}

	// 3.5.15 supports everything except the 3.5.16 jitter.
	bad = map[string]string{}
	for id, since := range need {
		if telemtVersionLess("3.5.15", since) {
			bad[id] = since
		}
	}
	err = formatTelemtVersionGateError("node-2", "3.5.15", bad)
	if err == nil || !strings.Contains(err.Error(), "web.retry_jitter") || strings.Contains(err.Error(), "decoy_resolve_secs") {
		t.Fatalf("unexpected 3.5.15 gate error: %v", err)
	}

	// Wildcard hosts themselves need 3.5.15.
	wild := parseTelemtSettings(`{"telemt":{"web":{"enabled":true,"vhostHost":"*.example.com","externalTerminator":true}}}`)
	if _, ok := telemtStructuredNeed(wild)["web.vhosts.host (wildcard)"]; !ok {
		t.Errorf("wildcard host must be version-gated: %v", telemtStructuredNeed(wild))
	}
	// WEB fields do not count when WEB mode is off.
	off := parseTelemtSettings(`{"telemt":{"web":{"enabled":false,"vhostHost":"proxy.example.com","retryJitterEnabled":true,"decoyResolveSecs":5}}}`)
	if n := telemtStructuredNeed(off); len(n) != 0 {
		t.Errorf("web fields must be ignored while WEB is off: %v", n)
	}
}

func TestTelemtStructuredVersionGateQuotaNeedsWrittenQuotaUsers(t *testing.T) {
	// A configured period with no user that has a data quota writes no [access.user_quota_periods]
	// table, so it must not gate an older Telemt (no DB / no quota users here).
	settings := `{"telemt":{"access":{"userQuotaPeriod":"weekly"}}}`
	cfg := parseTelemtSettings(settings)
	if _, ok := telemtStructuredNeed(cfg)["access.user_quota_periods"]; !ok {
		t.Fatal("period must be part of the structured need")
	}
	in := &model.Inbound{Id: 1, Protocol: model.Telemt, Settings: settings}
	if telemtInboundHasQuotaUsers(in) {
		t.Skip("unexpected quota users in the test database")
	}
	if err := validateTelemtStructuredVersions(in, cfg); err != nil {
		t.Fatalf("quota period without quota users must not be version-gated, got %v", err)
	}
}

func TestStripUnsupportedTelemtStructuredFields(t *testing.T) {
	settings := `{"clients":[],"telemt":{
		"web":{"enabled":true,"vhostHost":"proxy.example.com",
			"retryJitterEnabled":true,"retryJitterMinMs":5,"retryJitterMaxMs":200,"retryJitterDistribution":"uniform","decoyResolveSecs":9},
		"access":{"userQuotaPeriod":"daily"}
	}}`

	got, dropped := stripUnsupportedTelemtParams(settings, "3.5.14")
	if strings.Join(dropped, ",") != "access.user_quota_periods,web.retry_jitter,web.timeouts.decoy_resolve_secs" {
		t.Fatalf("dropped=%v", dropped)
	}
	cfg := parseTelemtSettings(got)
	if cfg.Web == nil || cfg.Web.RetryJitterEnabled != nil || cfg.Web.RetryJitterDistribution != "" ||
		cfg.Web.DecoyResolveSecs != nil || cfg.Access == nil || cfg.Access.UserQuotaPeriod != "" {
		t.Errorf("fields not stripped: %+v", cfg)
	}
	if !strings.Contains(got, `"clients"`) || !strings.Contains(got, `"vhostHost":"proxy.example.com"`) {
		t.Errorf("unrelated settings lost: %s", got)
	}

	// 3.5.15 knows decoy_resolve_secs and quota periods, not the 3.5.16 jitter.
	got, dropped = stripUnsupportedTelemtParams(settings, "3.5.15")
	if strings.Join(dropped, ",") != "web.retry_jitter" {
		t.Fatalf("dropped=%v", dropped)
	}
	cfg = parseTelemtSettings(got)
	if cfg.Web.RetryJitterEnabled != nil || cfg.Web.DecoyResolveSecs == nil || *cfg.Web.DecoyResolveSecs != 9 ||
		cfg.Access == nil || cfg.Access.UserQuotaPeriod != "daily" {
		t.Errorf("3.5.15 strip touched supported fields: %+v", cfg)
	}

	if same, dropped := stripUnsupportedTelemtParams(settings, "3.5.16"); same != settings || dropped != nil {
		t.Errorf("3.5.16 supports every field; nothing may change")
	}
	if same, dropped := stripUnsupportedTelemtParams(settings, ""); same != settings || dropped != nil {
		t.Errorf("unknown versions must not strip")
	}

	// An explicit retryJitterEnabled=false renders nothing, so an old node must keep it untouched
	// (no warning and no settings rewrite).
	for _, ver := range []string{"3.5.14", "3.5.15", "3.5.16"} {
		disabledOnly := `{"telemt":{"web":{"enabled":true,"vhostHost":"proxy.example.com","retryJitterEnabled":false}}}`
		if same, dropped := stripUnsupportedTelemtParams(disabledOnly, ver); same != disabledOnly || dropped != nil {
			t.Errorf("%s: disabled-only jitter must not be stripped, got %q %v", ver, same, dropped)
		}
	}
}
