package web

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func clientIPVia(t *testing.T, remote, xff string) string {
	t.Helper()
	gin.SetMode(gin.TestMode)
	e := gin.New()
	if err := e.SetTrustedProxies(trustedProxyCIDRs()); err != nil {
		t.Fatal(err)
	}
	var got string
	e.GET("/", func(c *gin.Context) { got = c.ClientIP() })
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = remote
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	e.ServeHTTP(httptest.NewRecorder(), req)
	return got
}

func TestForwardedHeaderIgnoredFromPublicClient(t *testing.T) {
	if ip := clientIPVia(t, "203.0.113.9:5555", "1.2.3.4"); ip != "203.0.113.9" {
		t.Fatalf("spoofed XFF must be ignored, got %s", ip)
	}
}

func TestForwardedHeaderHonouredFromLocalProxy(t *testing.T) {
	if ip := clientIPVia(t, "127.0.0.1:5555", "198.51.100.7"); ip != "198.51.100.7" {
		t.Fatalf("XFF from a local proxy must be honoured, got %s", ip)
	}
}
