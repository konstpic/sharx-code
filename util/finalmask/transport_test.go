package finalmask

import (
	"strings"
	"testing"
)

func TestSidesForMatrix(t *testing.T) {
	cases := []struct {
		name     string
		protocol string
		network  string
		alpn     string
		tcpOK    bool
		udpOK    bool
	}{
		{"tcp", "vless", "tcp", "", true, false},
		{"raw alias", "vless", "raw", "", true, false},
		{"ws", "vless", "websocket", "", true, false},
		{"httpupgrade", "vless", "httpupgrade", "", true, false},
		{"grpc", "vless", "grpc", "", true, false},
		{"xhttp without alpn", "vless", "xhttp", "", true, false},
		{"xhttp splithttp alias", "vless", "splithttp", "", true, false},
		{"xhttp h2 alpn", "vless", "xhttp", "h2,http/1.1", true, false},
		{"xhttp exactly h3", "vless", "xhttp", "h3", false, true},
		{"xhttp h3 plus h2 negotiates h2 over tcp", "vless", "xhttp", "h3,h2", true, false},
		{"xhttp uppercase H3 is not the quic path", "vless", "xhttp", "H3", true, false},
		{"kcp", "vless", "kcp", "", false, true},
		{"mkcp alias", "vless", "mkcp", "", false, true},
		{"hysteria network", "vless", "hysteria", "", false, true},
		{"quic removed", "vless", "quic", "", false, false},
		{"h2 removed", "vless", "h2", "", false, false},
		{"h3 removed", "vless", "h3", "", false, false},
		{"http removed", "vless", "http", "", false, false},
		{"wireguard wraps udp", "wireguard", "tcp", "", false, true},
		{"amneziawg", "amneziawg", "tcp", "", false, false},
		{"telemt", "telemt", "", "", false, false},
		{"hysteria protocol ignores network", "hysteria", "tcp", "", false, true},
		{"hysteria2 protocol", "hysteria2", "hysteria", "h3", false, true},
		{"masque h2 uses tcp", "vless", "masque", "h2", true, false},
		{"masque h3 uses udp", "vless", "masque", "h3", false, true},
		{"masque h2+h3 uses both", "vless", "masque", "h2,h3", true, true},
		{"masque without alpn uses udp (h3 = !h2)", "vless", "masque", "", false, true},
		{"masque uppercase H2 is not h2", "vless", "masque", "H2", false, true},
		{"xdrive tcp only", "vless", "xdrive", "", true, false},
		{"empty network defaults to tcp", "vless", "", "", true, false},
		{"unknown network defaults to tcp", "vless", "nosuchtransport", "", true, false},
		{"protocol is case/space insensitive", "  VLESS ", " TCP ", "", true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tcpOK, udpOK := SidesFor(tc.protocol, tc.network, tc.alpn)
			if tcpOK != tc.tcpOK || udpOK != tc.udpOK {
				t.Fatalf("SidesFor(%q, %q, %q) = (%v, %v), want (%v, %v)",
					tc.protocol, tc.network, tc.alpn, tcpOK, udpOK, tc.tcpOK, tc.udpOK)
			}
		})
	}
}

func TestStreamNetworkNormalizesAliases(t *testing.T) {
	for in, want := range map[string]string{
		"raw":       "tcp",
		"mkcp":      "kcp",
		"splithttp": "xhttp",
		"websocket": "ws",
		"KCP":       "kcp",
		"http":      "http",
		"":          "",
	} {
		if got := StreamNetwork(map[string]any{"network": in}); got != want {
			t.Fatalf("StreamNetwork(%q) = %q, want %q", in, got, want)
		}
	}
	if got := StreamNetwork(nil); got != "" {
		t.Fatalf("StreamNetwork(nil) = %q, want empty", got)
	}
}

func TestStreamALPN(t *testing.T) {
	// ALPN is only meaningful with TLS: without it h3 cannot be negotiated.
	noTLS := map[string]any{"tlsSettings": map[string]any{"alpn": []any{"h3"}}}
	if got := StreamALPN(noTLS); got != "" {
		t.Fatalf("security none must yield empty ALPN, got %q", got)
	}
	reality := map[string]any{"security": "reality", "realitySettings": map[string]any{"alpn": []string{"h2"}}}
	if got := StreamALPN(reality); got != "" {
		t.Fatalf("reality must yield empty ALPN, got %q", got)
	}
	stream := map[string]any{"security": "tls", "tlsSettings": map[string]any{"alpn": []any{"H2", "h3"}}}
	if got := StreamALPN(stream); got != "H2,h3" {
		t.Fatalf("tlsSettings alpn = %q, want H2,h3 (case preserved)", got)
	}
	stream = map[string]any{"security": "tls", "tlsSettings": map[string]any{"alpn": "h3"}}
	if got := StreamALPN(stream); got != "h3" {
		t.Fatalf("string alpn = %q, want h3", got)
	}
	stream = map[string]any{"security": "tls", "tlsSettings": map[string]any{"alpn": []any{" h3 "}}}
	if got := StreamALPN(stream); got != "h3" {
		t.Fatalf("surrounding spaces must be trimmed, got %q", got)
	}
	stream = map[string]any{"security": "tls", "tlsSettings": map[string]any{"alpn": []any{1, nil}}}
	if got := StreamALPN(stream); got != "" {
		t.Fatalf("non-string alpn = %q, want empty", got)
	}
}

func TestAlpnIsH3RequiresExactlyOneProtocol(t *testing.T) {
	for in, want := range map[string]bool{
		"h3":       true,
		"h3,h2":    false,
		"h2,h3":    false,
		"h3,h3":    false,
		"h2":       false,
		"":         false,
		"http/1.1": false,
	} {
		if got := alpnIsH3(in); got != want {
			t.Fatalf("alpnIsH3(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestAlpnContainsIsCaseSensitive(t *testing.T) {
	if !alpnContains("h2,h3", "h2") || !alpnContains("h2,h3", "h3") {
		t.Fatal("exact tokens must match")
	}
	if !alpnContains("h2, h3", "h3") {
		t.Fatal("surrounding spaces must be trimmed")
	}
	if alpnContains("H2", "h2") || alpnContains("H3", "h3") {
		t.Fatal("ALPN comparison must stay case-sensitive")
	}
}

func TestServerViewFailsSafeOnCopyError(t *testing.T) {
	// A value that cannot be JSON-marshaled aborts the deep copy; udphop must
	// not leak into the node config in that case.
	fm := map[string]any{
		"udp": []any{map[string]any{"type": "udphop"}, map[string]any{"type": "salamander"}},
		"bad": make(chan int),
	}
	view := ServerView(fm)
	if view == nil {
		t.Fatal("ServerView must not return nil on a copy failure")
	}
	if len(view) != 0 {
		t.Fatalf("copy failure must fail safe with an empty map, got %v", view)
	}
}

func hasCode(issues []Issue, code string) bool {
	for _, is := range issues {
		if is.Code == code {
			return true
		}
	}
	return false
}

func TestValidateTransportCompatibility(t *testing.T) {
	tcpFragment := map[string]any{"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{"length": "100-200"}}}}
	udpSalamander := map[string]any{"udp": []any{map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}}}}
	udpNoise := map[string]any{"udp": []any{map[string]any{"type": "noise", "settings": map[string]any{}}}}
	headerCustom := map[string]any{"tcp": []any{map[string]any{"type": "header-custom", "settings": map[string]any{
		"clients": []any{[]any{map[string]any{"type": "hex", "packet": "0d0a0d0a"}}},
		"servers": []any{[]any{map[string]any{"type": "hex", "packet": "0d0a"}}},
	}}}}
	tlsH3 := map[string]any{"network": "xhttp", "security": "tls", "tlsSettings": map[string]any{"alpn": []any{"h3"}}}
	tlsH3H2 := map[string]any{"network": "xhttp", "security": "tls", "tlsSettings": map[string]any{"alpn": []any{"h3", "h2"}}}

	cases := []struct {
		name     string
		protocol string
		stream   map[string]any
		fm       map[string]any
		wantCode string // "" means no error issues expected
	}{
		{"tcp fragment on tcp", "vless", map[string]any{"network": "tcp"}, tcpFragment, ""},
		{"header-custom on tcp still valid (inbound 32 regression)", "vless",
			map[string]any{"network": "tcp", "security": "tls", "tlsSettings": map[string]any{"alpn": []any{"h2", "http/1.1"}}},
			headerCustom, ""},
		{"tcp fragment on kcp", "vless", map[string]any{"network": "kcp"}, tcpFragment, "transport_tcp_forbidden"},
		{"udp salamander on tcp", "vless", map[string]any{"network": "tcp"}, udpSalamander, "transport_udp_forbidden"},
		{"udp noise on ws", "vless", map[string]any{"network": "ws"}, udpNoise, "transport_udp_forbidden"},
		{"udp salamander on kcp", "vless", map[string]any{"network": "kcp"}, udpSalamander, ""},
		{"udp noise on hysteria network", "vless", map[string]any{"network": "hysteria"}, udpNoise, ""},
		{"udp salamander on hysteria2 protocol", "hysteria2", map[string]any{"network": "hysteria"}, udpSalamander, ""},
		{"tcp fragment on hysteria2", "hysteria2", map[string]any{"network": "hysteria"}, tcpFragment, "transport_tcp_forbidden"},
		{"udp salamander on wireguard", "wireguard", map[string]any{"network": "tcp"}, udpSalamander, ""},
		{"tcp fragment on wireguard", "wireguard", map[string]any{"network": "tcp"}, tcpFragment, "transport_tcp_forbidden"},
		{"xhttp h3 allows udp masks", "vless", tlsH3, udpSalamander, ""},
		{"xhttp h3 forbids tcp masks", "vless", tlsH3, tcpFragment, "transport_tcp_forbidden"},
		{"xhttp h3 + h2 negotiates tcp", "vless", tlsH3H2, tcpFragment, ""},
		{"xhttp h3 quicParams only", "vless", tlsH3,
			map[string]any{"quicParams": map[string]any{"maxIdleTimeout": 30}}, ""},
		{"xhttp uppercase H3 keeps tcp masks", "vless",
			map[string]any{"network": "xhttp", "security": "tls", "tlsSettings": map[string]any{"alpn": []any{"H3"}}},
			tcpFragment, ""},
		{"xhttp uppercase H3 forbids udp masks", "vless",
			map[string]any{"network": "xhttp", "security": "tls", "tlsSettings": map[string]any{"alpn": []any{"H3"}}},
			udpSalamander, "transport_udp_forbidden"},
		{"xhttp h3 alpn without tls is not the quic path", "vless",
			map[string]any{"network": "xhttp", "tlsSettings": map[string]any{"alpn": []any{"h3"}}},
			udpSalamander, "transport_udp_forbidden"},
		{"quic transport removed", "vless", map[string]any{"network": "quic"}, tcpFragment, "transport_unsupported"},
		{"http transport removed", "vless", map[string]any{"network": "http"}, udpNoise, "transport_unsupported"},
		{"quic with quicParams only is not a transport issue", "vless", map[string]any{"network": "quic"},
			map[string]any{"quicParams": map[string]any{"maxIdleTimeout": 30}}, ""},
		{"amneziawg protocol", "amneziawg", map[string]any{"network": "tcp"}, tcpFragment, "transport_tcp_forbidden"},
		{"telemt protocol", "telemt", map[string]any{"network": "tcp"}, udpNoise, "transport_udp_forbidden"},
		{"masque h2 allows tcp masks", "vless",
			map[string]any{"network": "masque", "security": "tls", "tlsSettings": map[string]any{"alpn": []any{"h2"}}},
			tcpFragment, ""},
		{"masque without alpn forbids tcp masks", "vless",
			map[string]any{"network": "masque"}, tcpFragment, "transport_tcp_forbidden"},
		{"masque without alpn allows udp masks", "vless",
			map[string]any{"network": "masque"}, udpSalamander, ""},
		{"masque uppercase H2 is not the tcp side", "vless",
			map[string]any{"network": "masque", "security": "tls", "tlsSettings": map[string]any{"alpn": []any{"H2"}}},
			tcpFragment, "transport_tcp_forbidden"},
		{"xdrive forbids udp", "vless", map[string]any{"network": "xdrive"}, udpSalamander, "transport_udp_forbidden"},
		{"empty finalmask", "vless", map[string]any{"network": "kcp"}, map[string]any{}, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			issues := ValidateTransportCompatibility(tc.protocol, tc.stream, tc.fm)
			if tc.wantCode == "" {
				if len(issues) != 0 {
					t.Fatalf("unexpected issues: %v", issues)
				}
				return
			}
			if !hasCode(issues, tc.wantCode) {
				t.Fatalf("want issue %q, got %v", tc.wantCode, issues)
			}
			for _, is := range issues {
				if is.Severity != SeverityError {
					t.Fatalf("transport incompatibility must be an error, got %v", is)
				}
			}
		})
	}
}

func TestValidateTransportCompatibilityMessagesMentionTransport(t *testing.T) {
	fm := map[string]any{"udp": []any{map[string]any{"type": "noise", "settings": map[string]any{}}}}
	issues := ValidateTransportCompatibility("vless", map[string]any{"network": "tcp"}, fm)
	if len(issues) == 0 {
		t.Fatal("expected an issue")
	}
	msg := issues[0].Message
	if strings.ContainsAny(msg, "абвгдеёжзийклмнопрстуфхцчшщъыьэюя") {
		t.Fatalf("message must be English: %q", msg)
	}
	for _, want := range []string{"tcp", "TCP only"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("message %q must mention %q", msg, want)
		}
	}
}

func TestValidateTransportXHTTPH3TCPMessage(t *testing.T) {
	fm := map[string]any{"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{"length": "10-20"}}}}
	stream := map[string]any{"network": "xhttp", "security": "tls", "tlsSettings": map[string]any{"alpn": []any{"h3"}}}
	issues := ValidateTransportCompatibility("vless", stream, fm)
	if len(issues) != 1 || issues[0].Code != "transport_tcp_forbidden" {
		t.Fatalf("want one transport_tcp_forbidden, got %v", issues)
	}
	msg := issues[0].Message
	if !strings.Contains(msg, "ALPN h3") || !strings.Contains(msg, "udp masks") {
		t.Fatalf("message must explain the QUIC path and point at udp masks: %q", msg)
	}
	if strings.Contains(msg, "DialTCP") {
		t.Fatalf("message must not claim the dialer uses DialTCP: %q", msg)
	}
}

func TestServerViewDropsClientOnlyMasks(t *testing.T) {
	original := map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{"length": "10-20"}}},
		"udp": []any{
			map[string]any{"type": "salamander", "settings": map[string]any{"password": "strongpsk"}},
			map[string]any{"type": "noise", "settings": map[string]any{"reset": 3}},
			map[string]any{"type": "UDPHOP", "settings": map[string]any{"ports": "20000-30000"}},
		},
		"quicParams": map[string]any{"maxIdleTimeout": 30},
	}
	view := ServerView(original)
	udp, ok := view["udp"].([]any)
	if !ok {
		t.Fatalf("udp array must survive: %v", view)
	}
	if len(udp) != 2 {
		t.Fatalf("udphop must be dropped, got %v", udp)
	}
	for _, item := range udp {
		if typeOf(item.(map[string]any)) == "udphop" {
			t.Fatalf("udphop must not be in the server view: %v", udp)
		}
	}
	if _, has := view["tcp"]; !has {
		t.Fatal("tcp masks must be preserved in the server view")
	}
	if _, has := view["quicParams"]; !has {
		t.Fatal("quicParams must be preserved in the server view")
	}
	// The input map is never mutated.
	if len(original["udp"].([]any)) != 3 {
		t.Fatalf("ServerView mutated its input: %v", original["udp"])
	}
}

func TestServerViewEmptyResult(t *testing.T) {
	view := ServerView(map[string]any{"udp": []any{
		map[string]any{"type": "udphop", "settings": map[string]any{"ports": "20000-30000"}},
	}})
	if HasContent(view) || len(view) != 0 {
		t.Fatalf("udphop-only server view must be empty, got %v", view)
	}
	if view := ServerView(nil); view != nil {
		t.Fatalf("ServerView(nil) = %v, want nil", view)
	}
}
