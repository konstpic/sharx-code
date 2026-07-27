package sub

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestNormalizeSubscriptionServerDescription(t *testing.T) {
	if got := NormalizeSubscriptionServerDescription("  High-Speed  "); got != "High-Speed" {
		t.Fatalf("trim = %q", got)
	}
	long := strings.Repeat("a", 31)
	if got := NormalizeSubscriptionServerDescription(long); utf8Len(got) != 30 {
		t.Fatalf("len = %d", utf8Len(got))
	}
}

func utf8Len(s string) int {
	return len([]rune(s))
}

func TestFormatShareLinkFragment(t *testing.T) {
	got := FormatShareLinkFragment("DE-Frankfurt", "High-Speed")
	if !strings.HasPrefix(got, "DE-Frankfurt?serverDescription=") {
		t.Fatalf("unexpected fragment: %q", got)
	}
	const payload = "High-Speed"
	wantB64 := base64.StdEncoding.EncodeToString([]byte(payload))
	if !strings.HasSuffix(got, wantB64) {
		t.Fatalf("suffix = %q, want %q", got, wantB64)
	}
	if FormatShareLinkFragment("Server", "") != "Server" {
		t.Fatal("empty description must omit query")
	}
}

func TestSubscriptionServerDescriptionFromPanelInfo(t *testing.T) {
	panel := "Inbound: DE\nServer description: Ultra fast\n[Interface]\n"
	if got := subscriptionServerDescriptionFromPanelInfo(panel); got != "Ultra fast" {
		t.Fatalf("got %q", got)
	}
}
