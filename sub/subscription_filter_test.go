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
	if got[0] != links[0] || got[2] != links[2] {
		t.Fatalf("xray links must stay unchanged: %v", got)
	}
	if strings.Contains(got[1], "AmneziaWG (UDP)") {
		t.Fatalf("panel boilerplate must be stripped: %q", got[1])
	}
	if !strings.Contains(got[1], "# DE-Frankfurt") {
		t.Fatalf("expected inbound remark comment: %q", got[1])
	}
	if !strings.Contains(got[1], "Jc = 4") {
		t.Fatalf("AWG obfuscation must remain in conf: %q", got[1])
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
