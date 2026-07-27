package sub

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func testGinContext(ua, accept string) *gin.Context {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest("GET", "/sub/test", nil)
	if ua != "" {
		req.Header.Set("User-Agent", ua)
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	c.Request = req
	return c
}

func TestDispatchByUA_ThroneBeforeClashMeta(t *testing.T) {
	c := testGinContext("Throne/1.6.6 (Prefer ClashMeta Format)", "")
	client, format := DispatchByUA(c)
	if client != UAThrone {
		t.Fatalf("client = %v, want UAThrone", client)
	}
	if format != FormatBase64 {
		t.Fatalf("format = %q, want %q", format, FormatBase64)
	}
}

func TestFilterSubscriptionLinksForClient_ThroneDropsWireGuard(t *testing.T) {
	links := []string{
		"vless://uuid@host:443?security=tls",
		"AmneziaWG (UDP) — use the .conf block below\n[Interface]\nPrivateKey = x\n[Peer]\nPublicKey = y",
		"vmess://base64",
	}
	got := filterSubscriptionLinksForClient(links, UAThrone)
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2: %v", len(got), got)
	}
	if got[0] != links[0] || got[1] != links[2] {
		t.Fatalf("unexpected filter result: %v", got)
	}
}

func TestFilterSubscriptionLinksForClient_INCYNormalizesWireGuard(t *testing.T) {
	panel := "" +
		"AmneziaWG (UDP) — use the .conf block below\n\n" +
		"Inbound: DE-Frankfurt\n" +
		"Server description: Ultra fast\n" +
		"Endpoint: 203.0.113.1:51820\n\n" +
		"[Interface]\n" +
		"PrivateKey = clientPriv=\n" +
		"Address = 10.8.0.2/32\n" +
		"Jc = 4\n\n" +
		"[Peer]\n" +
		"PublicKey = serverPub=\n" +
		"Endpoint = 203.0.113.1:51820\n" +
		"AllowedIPs = 0.0.0.0/0, ::/0\n"
	links := []string{
		"vless://uuid@host:443?security=tls",
		panel,
		"vmess://base64",
	}
	got := filterSubscriptionLinksForClient(links, UAINCY)
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3: %v", len(got), got)
	}
	var awgLink string
	for _, entry := range got {
		switch {
		case entry == links[0], entry == links[2]:
			continue
		case strings.HasPrefix(entry, "amneziawg://"):
			awgLink = entry
		default:
			t.Fatalf("unexpected entry: %q in %v", entry, got)
		}
	}
	if awgLink == "" {
		t.Fatalf("expected amneziawg share link in %v", got)
	}
	if !strings.Contains(awgLink, "#DE-Frankfurt?serverDescription=") {
		t.Fatalf("expected serverDescription in fragment: %q", awgLink)
	}
}

func TestFilterSubscriptionLinksForClient_INCYWireGuardShareLink(t *testing.T) {
	panel := "" +
		"WireGuard (UDP) — panel text\n\n" +
		"Inbound: NL-Amsterdam\n\n" +
		"[Interface]\n" +
		"PrivateKey = clientPriv=\n" +
		"Address = 10.9.0.2/32\n\n" +
		"[Peer]\n" +
		"PublicKey = serverPub=\n" +
		"Endpoint = 203.0.113.2:51820\n"
	got := filterSubscriptionLinksForClient([]string{panel}, UAINCY)
	if len(got) != 1 {
		t.Fatalf("len = %d", len(got))
	}
	if !strings.HasPrefix(got[0], "wireguard://") {
		t.Fatalf("expected wireguard share link, got %q", got[0])
	}
	if !strings.Contains(got[0], "publickey=serverPub") {
		t.Fatalf("missing server public key: %q", got[0])
	}
}

func TestRewriteHysteriaLinkForINCY_stripsPin(t *testing.T) {
	in := "hysteria2://token@host:443?alpn=h3&pinSHA256=deadbeef&sni=m1.vk.com#Hy2"
	got := rewriteHysteriaLinkForINCY(in)
	if strings.Contains(got, "pinSHA256") {
		t.Fatalf("pinSHA256 must be removed: %q", got)
	}
	if !strings.Contains(got, "insecure=1") {
		t.Fatalf("expected insecure=1: %q", got)
	}
	if !strings.Contains(got, "sni=m1.vk.com") {
		t.Fatalf("other params must remain: %q", got)
	}
}

func TestFilterSubscriptionLinksForClient_INCYRewritesHy2Pin(t *testing.T) {
	links := []string{
		"amneziawg://abc#AWG",
		"hysteria2://token@host:443?pinSHA256=abc&alpn=h3#Hy2",
	}
	got := filterSubscriptionLinksForClient(links, UAINCY)
	if len(got) != 2 {
		t.Fatalf("len = %d", len(got))
	}
	hy2 := got[0]
	if strings.HasPrefix(got[1], "hysteria2://") {
		hy2 = got[1]
	}
	if strings.Contains(hy2, "pinSHA256") || !strings.Contains(hy2, "insecure=1") {
		t.Fatalf("INCY hy2 rewrite failed: %q", hy2)
	}
	// Other clients keep the pin.
	other := filterSubscriptionLinksForClient(links, UAV2RayNG)
	if !strings.Contains(strings.Join(other, "\n"), "pinSHA256=abc") {
		t.Fatalf("non-INCY clients must keep pin: %v", other)
	}
}

func TestSubscriptionEntrySeparator_INCYUsesBlankLine(t *testing.T) {
	if subscriptionEntrySeparator(UAINCY) != "\n\n" {
		t.Fatalf("incy separator = %q", subscriptionEntrySeparator(UAINCY))
	}
	if subscriptionEntrySeparator(UAHapp) != "\n" {
		t.Fatalf("happ separator = %q", subscriptionEntrySeparator(UAHapp))
	}
}

func TestOrderSubscriptionLinksForClient_INCYPutsWireGuardLast(t *testing.T) {
	awg := "[Interface]\nPrivateKey = x\n\n[Peer]\nPublicKey = y\n"
	links := []string{awg, "hysteria2://token@host:443", "vless://uuid@host:443"}
	got := orderSubscriptionLinksForClient(links, UAINCY)
	if len(got) != 3 {
		t.Fatalf("len = %d", len(got))
	}
	if got[2] != awg {
		t.Fatalf("AWG must be last: %v", got)
	}
	if got[0] != links[1] || got[1] != links[2] {
		t.Fatalf("URI entries first: %v", got)
	}
}

func TestTrimWireguardConfBlock_stopsAtURI(t *testing.T) {
	in := "[Interface]\nPrivateKey = x\n\n[Peer]\nPublicKey = y\n\nhysteria2://auth@host:443?alpn=h3\n"
	got := trimWireguardConfBlock(in)
	if strings.Contains(got, "hysteria2://") {
		t.Fatalf("URI must not remain in conf block: %q", got)
	}
	if !strings.Contains(got, "[Peer]") {
		t.Fatalf("peer section must remain: %q", got)
	}
}
