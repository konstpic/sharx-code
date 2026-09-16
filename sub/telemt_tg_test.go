package sub

import (
	"encoding/hex"
	"strings"
	"testing"
)

func TestTelemtTgProxySecretForLink_hexNotBase64(t *testing.T) {
	raw, err := hex.DecodeString("00000000000000000000000000000001")
	if err != nil || len(raw) != 16 {
		t.Fatal(err)
	}
	got := telemtTgProxySecretForLink(raw, true, false, "")
	if !strings.HasPrefix(got, "ee") {
		t.Fatalf("fake-tls secret should start with ee, got %q", got)
	}
	if len(got) != 34 {
		t.Fatalf("expected 34 hex chars (ee + 16 bytes), got %d: %q", len(got), got)
	}
	if strings.ContainsAny(got, "+/") {
		t.Fatalf("secret must be hex, not base64: %q", got)
	}
}

func TestTelemtTgProxySecretForLink_tlsAppendsDomainHex(t *testing.T) {
	raw, _ := hex.DecodeString("d6298c54233a04b3eb1b5663f7599c8d")
	domain := "llgin.vk.com"
	got := telemtTgProxySecretForLink(raw, true, false, domain)
	want := "eed6298c54233a04b3eb1b5663f7599c8d" + strings.ToLower(hex.EncodeToString([]byte(domain)))
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestTelemtTgProxySecretForLink_securePrefix(t *testing.T) {
	raw, _ := hex.DecodeString("ffffffffffffffffffffffffffffffff")
	got := telemtTgProxySecretForLink(raw, false, true, "")
	if !strings.HasPrefix(got, "dd") || len(got) != 34 {
		t.Fatalf("secure: %q", got)
	}
}

func TestTelemtTgProxySecretForLink_classic32(t *testing.T) {
	raw, _ := hex.DecodeString("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	got := telemtTgProxySecretForLink(raw, false, false, "")
	if got != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("classic: %q", got)
	}
}

func TestTelemtWebProxyLink(t *testing.T) {
	raw, _ := hex.DecodeString("00112233445566778899aabbccddeeff")
	const prefix = "tg://webproxy?server=proxy.example.com&secret="
	for _, tc := range []struct {
		name, settings, want string
		enabled              bool
	}{
		{"dd with stale FakeTLS settings", `{"telemt":{"modes":{"tls":true},"web":{"enabled":true,"vhostHost":"proxy.example.com","profileSecretMode":"dd"}}}`, prefix + "dd00112233445566778899aabbccddeeff", true},
		{"plain ignores secure TCP mode", `{"telemt":{"modes":{"secure":true},"web":{"enabled":true,"vhostHost":"proxy.example.com","profileSecretMode":"plain"}}}`, prefix + "00112233445566778899aabbccddeeff", true},
		{"default mode and canonical host", `{"telemt":{"web":{"enabled":true,"vhostHost":" Proxy.Example.COM "}}}`, prefix + "dd00112233445566778899aabbccddeeff", true},
		{"explicit HTTPS port", `{"telemt":{"web":{"enabled":true,"vhostHost":"proxy.example.com","frontPort":443,"profileSecretMode":" plain "}}}`, prefix + "00112233445566778899aabbccddeeff", true},
		{"invalid mode matches generator default", `{"telemt":{"web":{"enabled":true,"vhostHost":"proxy.example.com","profileSecretMode":"ee"}}}`, prefix + "dd00112233445566778899aabbccddeeff", true},
		{"missing host does not emit TCP fallback", `{"telemt":{"web":{"enabled":true}}}`, "", true},
		{"nonstandard front cannot be represented", `{"telemt":{"web":{"enabled":true,"vhostHost":"proxy.example.com","frontPort":8443}}}`, "", true},
		{"disabled preserves TCP path", `{"telemt":{"web":{"enabled":false,"vhostHost":"proxy.example.com"}}}`, "", false},
		{"legacy preserves TCP path", `{"telemt":{"modes":{"tls":true}}}`, "", false},
		{"malformed settings", `{`, "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, enabled := telemtWebProxyLink(tc.settings, raw)
			if got != tc.want || enabled != tc.enabled {
				t.Fatalf("got (%q, %v), want (%q, %v)", got, enabled, tc.want, tc.enabled)
			}
		})
	}
	link, enabled := telemtWebProxyLink(`{"telemt":{"web":{"enabled":true,"vhostHost":"proxy.example.com"}}}`, nil)
	if link != "" || !enabled {
		t.Fatalf("invalid secret should not produce a link: (%q, %v)", link, enabled)
	}
}

func TestIsTelemtProxyLink(t *testing.T) {
	for _, tc := range []struct {
		link string
		want bool
	}{
		{"tg://proxy?server=example.com&port=443&secret=dd00", true},
		{"tg://webproxy?server=example.com&secret=dd00", true},
		{"TG://WEBPROXY?server=example.com&secret=dd00", true},
		{"vless://uuid@example.com:443", false},
		{"https://example.com/", false},
		{"tg://proxy-other?server=example.com", false},
		{"", false},
	} {
		if got := isTelemtProxyLink(tc.link); got != tc.want {
			t.Errorf("isTelemtProxyLink(%q) = %v, want %v", tc.link, got, tc.want)
		}
	}
}
