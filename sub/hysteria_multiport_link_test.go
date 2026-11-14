package sub

import (
	"net/url"
	"strings"
	"testing"
)

func TestHysteriaLinkAuthorityPort(t *testing.T) {
	rangeStream := map[string]interface{}{"hysteriaMultiPort": "39640-39649"}
	tests := []struct {
		name     string
		version  int
		stream   map[string]interface{}
		port     int
		wantPort string
	}{
		{"v2 with range", 2, rangeStream, 443, "39640-39649"},
		{"v2 without range", 2, map[string]interface{}{}, 443, "443"},
		{"v2 invalid range falls back", 2, map[string]interface{}{"hysteriaMultiPort": "443"}, 443, "443"},
		{"v1 drops the range", 1, rangeStream, 443, "443"},
		{"v2 custom port", 2, map[string]interface{}{}, 8443, "8443"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := hysteriaLinkAuthorityPort(tt.version, tt.stream, tt.port); got != tt.wantPort {
				t.Fatalf("authority port = %q, want %q", got, tt.wantPort)
			}
		})
	}
}

func TestBuildCredentialShareURLAuthorityMultiPort(t *testing.T) {
	u := buildCredentialShareURLAuthority("hysteria2", "secret", "node.example.com", "39640-39649")
	q := url.Values{}
	q.Set("sni", "node.example.com")
	q.Set("obfs", "salamander")
	q.Set("obfs-password", "pw")
	u.RawQuery = q.Encode()
	u.Fragment = "range"
	got := u.String()

	want := "hysteria2://secret@node.example.com:39640-39649?obfs=salamander&obfs-password=pw&sni=node.example.com#range"
	if got != want {
		t.Fatalf("link = %q, want %q", got, want)
	}
	// Empty range behaviour must stay byte-identical to the previous link.
	plain := buildCredentialShareURL("hysteria2", "secret", "node.example.com", 443)
	if plain.String() != "hysteria2://secret@node.example.com:443" {
		t.Fatalf("plain link changed: %q", plain.String())
	}
}

func TestCollapseHysteriaMultiPortLink(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{
			in:   "hysteria2://secret@node.example.com:39640-39649/?obfs=salamander&obfs-password=pw#range",
			want: "hysteria2://secret@node.example.com:39640/?obfs=salamander&obfs-password=pw#range",
		},
		{
			in:   "hysteria2://secret@node.example.com:443/?sni=x#name",
			want: "hysteria2://secret@node.example.com:443/?sni=x#name",
		},
		{
			in:   "hysteria2://secret@[2001:db8::1]:39640-39649/",
			want: "hysteria2://secret@[2001:db8::1]:39640/",
		},
	}
	for _, tt := range tests {
		if got := collapseHysteriaMultiPortLink(tt.in); got != tt.want {
			t.Fatalf("collapse(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

// INCY strips pinSHA256 and falls back to insecure=1; the multi-port authority
// must survive that rewrite (it is not a valid net/url port).
func TestRewriteHysteriaLinkForINCYMultiPort(t *testing.T) {
	in := "hysteria2://secret@node.example.com:39640-39649/?pinSHA256=deadbeef&sni=node.example.com#range"
	got := rewriteHysteriaLinkForINCY(in)
	if strings.Contains(got, "pinSHA256") {
		t.Fatalf("pinSHA256 must be stripped for INCY: %q", got)
	}
	if !strings.Contains(got, ":39640-39649") {
		t.Fatalf("multi-port authority lost: %q", got)
	}
	if !strings.Contains(got, "insecure=1") {
		t.Fatalf("insecure=1 fallback missing: %q", got)
	}
	if !strings.Contains(got, "sni=node.example.com") {
		t.Fatalf("sni lost: %q", got)
	}
}

// Clash/YAML has a single port per proxy: the range collapses to its first
// member instead of dropping the whole profile.
func TestParseClashHysteria2MultiPort(t *testing.T) {
	link := "hysteria2://secret@node.example.com:39640-39649/?sni=node.example.com&obfs=salamander&obfs-password=pw#range"
	p := parseClashHysteria2(link)
	if p == nil {
		t.Fatal("profile must not be dropped for a multi-port link")
	}
	if p["server"] != "node.example.com" {
		t.Fatalf("server = %v", p["server"])
	}
	if p["port"] != 39640 {
		t.Fatalf("port = %v, want 39640", p["port"])
	}
	if p["password"] != "secret" {
		t.Fatalf("password = %v", p["password"])
	}
	if p["obfs"] != "salamander" || p["obfs-password"] != "pw" {
		t.Fatalf("obfs lost: %v", p)
	}
}

func TestHysteriaLinkAuthorityPortPolicy(t *testing.T) {
	// A range that swallows the listener or exceeds the panel limit must fall
	// back to the plain port: the node never installs such a rule.
	for _, tc := range []struct {
		name   string
		stream map[string]interface{}
		port   int
	}{
		{"range contains listener", map[string]interface{}{"hysteriaMultiPort": "400-500"}, 443},
		{"range over limit", map[string]interface{}{"hysteriaMultiPort": "1000-3000"}, 443},
	} {
		if got := hysteriaLinkAuthorityPort(2, tc.stream, tc.port); got != "443" {
			t.Fatalf("%s: authority port = %q, want 443", tc.name, got)
		}
	}
}
