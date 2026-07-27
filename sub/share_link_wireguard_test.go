package sub

import (
	"encoding/base64"
	"net/url"
	"strings"
	"testing"
)

func TestAmneziawgShareLinkFromConf(t *testing.T) {
	conf := "[Interface]\nPrivateKey = abc=\nJc = 4\n\n[Peer]\nPublicKey = xyz=\nEndpoint = 203.0.113.1:51820\nAllowedIPs = 0.0.0.0/0\n"
	got := amneziawgShareLinkFromConf(conf, "DE-Frankfurt", "High-Speed")
	if !strings.HasPrefix(got, "amneziawg://") {
		t.Fatalf("unexpected link: %q", got)
	}
	u, err := url.Parse(got)
	if err != nil {
		t.Fatal(err)
	}
	if u.Fragment != "DE-Frankfurt?serverDescription=SGlnaC1TcGVlZA==" {
		t.Fatalf("fragment = %q", u.Fragment)
	}
	payload := strings.TrimPrefix(got, "amneziawg://")
	payload, _, _ = strings.Cut(payload, "#")
	decoded, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != strings.TrimSpace(conf) {
		t.Fatalf("decoded conf mismatch:\n%s", decoded)
	}
}

func TestWireguardShareLinkFromConf(t *testing.T) {
	conf := "[Interface]\nPrivateKey = clientPriv=\nAddress = 10.8.0.2/32\nMTU = 1420\n\n[Peer]\nPublicKey = serverPub=\nEndpoint = 203.0.113.1:51820\nAllowedIPs = 0.0.0.0/0\n"
	got := wireguardShareLinkFromConf(conf, "WG-DE", "")
	if !strings.HasPrefix(got, "wireguard://") {
		t.Fatalf("unexpected link: %q", got)
	}
	u, err := url.Parse(got)
	if err != nil {
		t.Fatal(err)
	}
	if u.User.Username() != "clientPriv=" {
		t.Fatalf("user = %q", u.User.Username())
	}
	q := u.Query()
	if q.Get("publickey") != "serverPub=" {
		t.Fatalf("publickey = %q", q.Get("publickey"))
	}
	if q.Get("address") != "10.8.0.2/32" {
		t.Fatalf("address = %q", q.Get("address"))
	}
	if q.Get("mtu") != "1420" {
		t.Fatalf("mtu = %q", q.Get("mtu"))
	}
	if u.Fragment != "WG-DE" {
		t.Fatalf("fragment = %q", u.Fragment)
	}
}

func TestWireGuardShareLinkFromPanelInfo_amnezia(t *testing.T) {
	panel := "" +
		"AmneziaWG (UDP) — use the .conf block below\n\n" +
		"Inbound: DE-Frankfurt\n" +
		"Endpoint: 203.0.113.1:51820\n\n" +
		"[Interface]\n" +
		"PrivateKey = clientPriv=\n" +
		"Jc = 4\n\n" +
		"[Peer]\n" +
		"PublicKey = serverPub=\n" +
		"Endpoint = 203.0.113.1:51820\n"
	got := wireGuardShareLinkFromPanelInfo(panel)
	if !strings.HasPrefix(got, "amneziawg://") {
		t.Fatalf("expected amneziawg link, got %q", got)
	}
	if !strings.HasSuffix(got, "#DE-Frankfurt") {
		t.Fatalf("expected remark fragment, got %q", got)
	}
}

func TestBuildCredentialShareURL_encodesSpecialAuth(t *testing.T) {
	u := buildCredentialShareURL("hysteria2", "|5oEEv-J1oDzM4uk", "example.com", 443)
	s := u.String()
	if !strings.HasPrefix(s, "hysteria2://") {
		t.Fatalf("unexpected url: %s", s)
	}
	parsed, err := url.Parse(s)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.User.Username() != "|5oEEv-J1oDzM4uk" {
		t.Fatalf("auth = %q", parsed.User.Username())
	}
	if parsed.Hostname() != "example.com" || parsed.Port() != "443" {
		t.Fatalf("host = %q", parsed.Host)
	}
}

func TestIsAmneziaWGConf(t *testing.T) {
	if !isAmneziaWGConf("[Interface]\nPrivateKey = x\nJc = 4\n") {
		t.Fatal("expected AWG conf")
	}
	if isAmneziaWGConf("[Interface]\nPrivateKey = x\n") {
		t.Fatal("expected plain WG conf")
	}
}
