package service

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestIsPublicIP(t *testing.T) {
	for ip, want := range map[string]bool{
		"127.0.0.1": false, "::1": false, "10.1.2.3": false, "192.168.0.5": false, "172.16.0.1": false,
		"169.254.169.254": false, "100.64.0.1": false, "0.0.0.0": false, "224.0.0.1": false, "fe80::1": false,
		"8.8.8.8": true, "1.1.1.1": true, "2606:4700:4700::1111": true,
	} {
		if got := isPublicIP(net.ParseIP(ip)); got != want {
			t.Errorf("%s: got %v want %v", ip, got, want)
		}
	}
}

func TestSafeDownloadClientBlocksLoopbackAndRedirects(t *testing.T) {
	hit := false
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { hit = true }))
	defer internal.Close()

	c := newSafeDownloadClient(5 * time.Second)
	if _, err := c.Get(internal.URL); err == nil {
		t.Fatal("loopback target must be refused")
	}
	if hit {
		t.Fatal("request reached the internal server")
	}
	t.Setenv("XUI_ALLOW_PRIVATE_DOWNLOADS", "true")
	resp, err := c.Get(internal.URL)
	if err != nil {
		t.Fatalf("override should allow: %v", err)
	}
	resp.Body.Close()
}
