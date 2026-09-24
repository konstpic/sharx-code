package service

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSharedInboundContentVlessReality(t *testing.T) {
	settings := `{"clients":[{"id":"aaa","email":"x"}],"decryption":"mlkem768x25519plus.native.600s.SECRETKEYDATA","fallbacks":[]}`
	stream := `{"network":"tcp","security":"reality","externalProxy":[{"dest":"my.host"}],"realitySettings":{"target":"example.com:443","serverNames":["example.com"],"privateKey":"PRIV","publicKey":"PUB","shortIds":["ab12"],"fingerprint":"chrome"}}`
	doc, warns, err := SharedInboundContent("vless", 443, settings, stream, `{"enabled":true}`, "never")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(doc)
	out := string(b)
	for _, leak := range []string{"aaa", "SECRETKEYDATA", "PRIV", "PUB", "ab12", "my.host"} {
		if strings.Contains(out, leak) {
			t.Errorf("leaked %q in %s", leak, out)
		}
	}
	if !strings.Contains(out, `"serverNames":["example.com"]`) || !strings.Contains(out, `"fingerprint":"chrome"`) {
		t.Errorf("useful fields lost: %s", out)
	}
	if len(warns) < 4 {
		t.Errorf("expected warnings for removed values, got %v", warns)
	}
}

func TestSharedInboundContentRejectsSidecarProtocols(t *testing.T) {
	for _, p := range []string{"wireguard", "amneziawg", "telemt", "unknown"} {
		if _, _, err := SharedInboundContent(p, 1, "{}", "{}", "{}", ""); err == nil {
			t.Errorf("%s should not be shareable", p)
		}
	}
}

func TestSharedInboundContentTLSAndShadowsocks(t *testing.T) {
	doc, _, err := SharedInboundContent("shadowsocks", 8388,
		`{"method":"2022-blake3-aes-128-gcm","password":"PW","clients":[{"password":"C"}],"network":"tcp,udp"}`,
		`{"security":"tls","tlsSettings":{"serverName":"my.domain","certificates":[{"certificateFile":"/etc/x.crt","keyFile":"/etc/x.key"}],"alpn":["h2"]}}`, `{}`, "")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(doc)
	out := string(b)
	for _, leak := range []string{"PW", "my.domain", "/etc/x"} {
		if strings.Contains(out, leak) {
			t.Errorf("leaked %q: %s", leak, out)
		}
	}
	if !strings.Contains(out, `"alpn":["h2"]`) || !strings.Contains(out, "2022-blake3-aes-128-gcm") {
		t.Errorf("useful fields lost: %s", out)
	}
}

func TestSanitizeXrayTemplateDropsCredentialOutbounds(t *testing.T) {
	raw := `{"log":{"loglevel":"warning"},"inbounds":[{"tag":"api","protocol":"dokodemo-door"}],
	 "outbounds":[{"tag":"direct","protocol":"freedom"},{"tag":"warp","protocol":"wireguard","settings":{"secretKey":"K"}},{"tag":"up","protocol":"vless","settings":{"vnext":[{"users":[{"id":"u"}]}]}},{"tag":"blocked","protocol":"blackhole"}],
	 "routing":{"rules":[]}}`
	m, warns, err := SanitizeXrayTemplate(raw)
	if err != nil {
		t.Fatal(err)
	}
	outs := m["outbounds"].([]any)
	if len(outs) != 2 {
		t.Fatalf("want 2 outbounds kept, got %d", len(outs))
	}
	b, _ := json.Marshal(m)
	if strings.Contains(string(b), `"secretKey"`) || strings.Contains(string(b), `"u"`) {
		t.Errorf("credentials leaked: %s", b)
	}
	if len(warns) != 2 {
		t.Errorf("want 2 warnings, got %v", warns)
	}
	if _, ok := m["routing"]; !ok {
		t.Error("routing lost")
	}
}
