package sub

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/web/service"
)

func TestHWIDHeaderMissing(t *testing.T) {
	cases := []struct {
		name    string
		mode    string
		enabled bool
		hwid    string
		want    bool
	}{
		{"enforced, header absent", "client_header", true, "", true},
		{"enforced, whitespace-only header", "client_header", true, "   ", true},
		{"enforced, header present", "client_header", true, "abc123", false},
		{"client without HWID enforcement", "client_header", false, "", false},
		{"hwid mode off", "off", true, "", false},
		{"legacy mode", "legacy_fingerprint", true, "", false},
	}
	for _, tc := range cases {
		if got := hwidHeaderMissing(tc.mode, tc.enabled, tc.hwid); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func TestHWIDBlockedRemarks_distinguishesMissingFromLimit(t *testing.T) {
	r := service.DefaultSharxCustomRemarks()

	missing := hwidBlockedRemarks(service.ErrHWIDMissing, r)
	if len(missing) == 0 || missing[0] != r.HWIDNotSupported[0] {
		t.Fatalf("missing HWID should use HWIDNotSupported remarks, got %v", missing)
	}
	limit := hwidBlockedRemarks(fmt.Errorf("HWID limit exceeded: %w", errors.New("x")), r)
	if len(limit) == 0 || limit[0] != r.HWIDMaxDevicesExceeded[0] {
		t.Fatalf("limit error should use HWIDMaxDevicesExceeded remarks, got %v", limit)
	}
	if got := hwidBlockedRemarks(errors.New("db down"), r); got != nil {
		t.Fatalf("unrelated error must not map to a remark, got %v", got)
	}
}

func TestHWIDBlockedError_missingIsForbiddenAndNotReworded(t *testing.T) {
	err := hwidBlockedError(service.ErrHWIDMissing)
	if !errors.Is(err, service.ErrHWIDMissing) {
		t.Fatalf("missing HWID error must stay identifiable, got %v", err)
	}
	if status, _ := subscriptionFailureStatus(err, false); status != http.StatusForbidden {
		t.Fatalf("missing HWID must be 403 when remarks are off, got %d", status)
	}
	limitErr := hwidBlockedError(errors.New("boom"))
	if status, _ := subscriptionFailureStatus(limitErr, false); status != http.StatusForbidden {
		t.Fatalf("limit error must remain 403, got %d", status)
	}
}

func TestAppGateRemarks_blockedAndUnknownAreDistinct(t *testing.T) {
	r := service.DefaultSharxCustomRemarks()
	blocked := appGateRemarks(AppGateReasonBlockedApp, r)
	unknown := appGateRemarks(AppGateReasonUnknownApp, r)
	if len(blocked) == 0 || len(unknown) == 0 {
		t.Fatalf("defaults must be non-empty: blocked=%v unknown=%v", blocked, unknown)
	}
	if blocked[0] == unknown[0] {
		t.Fatalf("blocked and unknown notices must differ")
	}
	if got := appGateRemarks(AppGateReasonNone, r); got != nil {
		t.Fatalf("no reason must yield no notice, got %v", got)
	}
}

func TestAppGateNotice_adminTextIsUsedAndRendersAsPlaceholders(t *testing.T) {
	custom := &service.SharxSubpageCustomRemarks{
		BlockedApp: []string{"Использование данного приложения запрещено. Используйте Hiddify."},
	}
	merged := service.MergeCustomRemarksWithDefaults(custom)
	lines := subscriptionPlaceholderLines(appGateRemarks(AppGateReasonBlockedApp, merged))
	if len(lines) != 1 || !strings.HasPrefix(lines[0], "vless://") {
		t.Fatalf("expected one vless placeholder line, got %v", lines)
	}
	if !strings.Contains(lines[0], "#") {
		t.Fatalf("admin text must be carried in the URI fragment: %s", lines[0])
	}
	body := jsonSubscriptionNoticeBody(appGateRemarks(AppGateReasonBlockedApp, merged))
	if !strings.Contains(body, "Hiddify") {
		t.Fatalf("JSON notice must carry the admin text, got %s", body)
	}
}

func TestMergeCustomRemarks_emptyOverrideFallsBackToDefaults(t *testing.T) {
	merged := service.MergeCustomRemarksWithDefaults(&service.SharxSubpageCustomRemarks{})
	d := service.DefaultSharxCustomRemarks()
	if len(merged.BlockedApp) == 0 || merged.BlockedApp[0] != d.BlockedApp[0] {
		t.Fatalf("empty BlockedApp must fall back to default, got %v", merged.BlockedApp)
	}
	if len(merged.UnknownApp) == 0 {
		t.Fatalf("empty UnknownApp must fall back to default")
	}
}
