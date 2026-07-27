package sub

import (
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/web/service"
)

func TestAmneziaWgConfBlockFromPanelInfo_withObfuscation(t *testing.T) {
	panelText := "" +
		"AmneziaWG (UDP) — notes\n\n" +
		"Client DNS: 1.1.1.1\n" +
		"Server public key: abc\n\n" +
		"[Interface]\n" +
		"PrivateKey = clientPriv=\n" +
		"Address = 10.8.0.2/32\n" +
		"DNS = 1.1.1.1\n" +
		"MTU = 1420\n" +
		"Jc = 4\n" +
		"H1 = 1\n\n" +
		"[Peer]\n" +
		"PublicKey = serverPub=\n" +
		"Endpoint = 203.0.113.1:51820\n" +
		"AllowedIPs = 0.0.0.0/0, ::/0\n"

	got := wireguardConfBlockFromPanelInfo(panelText)
	if got == "" {
		t.Fatal("expected conf block")
	}
	if !strings.Contains(got, "Jc = 4") {
		t.Fatalf("AWG obfuscation must stay in conf block: %q", got)
	}
	if strings.Contains(got, "Client DNS:") {
		t.Fatalf("conf block must not include panel hint lines: %q", got)
	}
}

func TestAppendWgQuickClientConf_matchesWireGuardAndAWGShape(t *testing.T) {
	settings := map[string]any{
		"clientDns": []any{"1.1.1.1"},
		"peers": []any{
			map[string]any{
				"email":       "u@example.com",
				"privateKey":  "clientPriv=",
				"allowedIPs":  []any{"10.8.0.2"},
				"preSharedKey": "psk=",
				"keepAlive":   25,
			},
		},
	}
	var b strings.Builder
	appendWgQuickClientConf(&b, settings, "u@example.com", "203.0.113.1:51820", "serverPub=", nil)
	base := b.String()

	var awg strings.Builder
	appendWgQuickClientConf(&awg, settings, "u@example.com", "203.0.113.1:51820", "serverPub=", &wgQuickClientConfOpts{
		writeInterfaceExtras: func(b *strings.Builder, settings map[string]any) {
			service.AppendAmneziaWGObfuscationToConf(b, service.AmneziaWGObfuscation{Jc: 3, H1: "1"})
		},
	})
	awgConf := awg.String()

	for _, want := range []string{
		"PrivateKey = clientPriv=",
		"Address = 10.8.0.2/32",
		"DNS = 1.1.1.1",
		"PublicKey = serverPub=",
		"Endpoint = 203.0.113.1:51820",
		"PresharedKey = psk=",
		"PersistentKeepalive = 25",
		"AllowedIPs = 0.0.0.0/0, ::/0",
	} {
		if !strings.Contains(base, want) {
			t.Fatalf("base conf missing %q: %s", want, base)
		}
		if !strings.Contains(awgConf, want) {
			t.Fatalf("awg conf missing %q: %s", want, awgConf)
		}
	}
	if !strings.Contains(awgConf, "Jc = 3") {
		t.Fatalf("awg conf should include obfuscation: %s", awgConf)
	}
}
