package sub

import (
	"net/http/httptest"
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

func TestFilterSubscriptionLinksForClient_OtherClientsUnchanged(t *testing.T) {
	links := []string{"wg-block\n[Interface]\n[Peer]"}
	got := filterSubscriptionLinksForClient(links, UANekobox)
	if len(got) != 1 {
		t.Fatalf("nekobox should keep wg block, got %v", got)
	}
}
