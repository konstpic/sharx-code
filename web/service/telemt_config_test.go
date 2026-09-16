package service

import (
	"fmt"
	"net"
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

func TestBuildTelemtToml_WebModeCustomFrontPort(t *testing.T) {
	stubTelemtWebDNS(t, "proxy.example.com", net.ParseIP("203.0.113.10"))
	settings := `{"telemt":{"web": {"enabled": true, "vhostHost": "proxy.example.com", "frontPort": 8443}}}`
	inbound := testTelemtInbound(t, settings)
	toml, err := BuildTelemtToml(inbound, nil, "", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(toml, `public_addr = "203.0.113.10:8443"`) {
		t.Errorf("expected public_addr to use the custom frontPort, got:\n%s", toml)
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
