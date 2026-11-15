package sub

import (
	"strings"
	"testing"

	service "github.com/konstpic/sharx-code/v2/web/service"
)

func TestHappBodyMetaComment(t *testing.T) {
	tests := []struct {
		key, val, want string
	}{
		{"Hide-Settings", "1", "#hide-settings: 1\n"},
		{"providerid", "uuid-1", "#providerid uuid-1\n"},
		{"", "1", ""},
		{"Hide-Settings", "", ""},
	}
	for _, tc := range tests {
		got := happBodyMetaComment(tc.key, tc.val)
		if got != tc.want {
			t.Fatalf("happBodyMetaComment(%q, %q) = %q, want %q", tc.key, tc.val, got, tc.want)
		}
	}
}

func TestPrependSubscriptionBodyMetaComments(t *testing.T) {
	body := "vless://example\n"
	cfg := &service.SharxSubpageConfigV2{
		ResponseRules: &service.SharxSubpageResponseRules{
			ProfileTitle:         "My VPN",
			ProfileTitleDelivery: service.ResponseHeaderDeliveryBody,
			ExtraHeaders: []service.SharxSubpageResponseHeader{
				{Key: "Hide-Settings", Value: "1", Delivery: service.ResponseHeaderDeliveryBody},
			},
		},
	}

	got := prependSubscriptionBodyMetaComments(body, UAHapp, cfg, "", "")
	if !strings.Contains(got, "#hide-settings: 1\n") {
		t.Fatalf("missing hide-settings comment: %q", got)
	}
	if !strings.Contains(got, "#profile-title: My VPN\n") {
		t.Fatalf("missing profile-title comment: %q", got)
	}
	if !strings.HasSuffix(strings.TrimSpace(got), "vless://example") {
		t.Fatalf("missing subscription link: %q", got)
	}

	unchanged := prependSubscriptionBodyMetaComments(body, UAV2RayTun, cfg, "", "")
	if unchanged != body {
		t.Fatalf("non-Happ client should not get body comments: %q", unchanged)
	}
}

func TestPrependSubscriptionBodyMetaCommentsExpandsProfileWebPageSubID(t *testing.T) {
	body := "vless://example\n"
	cfg := &service.SharxSubpageConfigV2{
		ResponseRules: &service.SharxSubpageResponseRules{
			ProfileWebPageURL:         "https://ex.com/panel/sub/?id={subid}",
			ProfileWebPageURLDelivery: service.ResponseHeaderDeliveryBody,
		},
	}

	got := prependSubscriptionBodyMetaComments(body, UAHapp, cfg, "", "abc123")
	if !strings.Contains(got, "#profile-web-page-url: https://ex.com/panel/sub/?id=abc123\n") {
		t.Fatalf("profile-web-page-url comment was not expanded: %q", got)
	}
	if strings.Contains(got, "{subid}") {
		t.Fatalf("placeholder left unexpanded: %q", got)
	}
}
