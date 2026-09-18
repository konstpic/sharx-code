package sub

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/xray"
)

const placeholderVlessUUID = "00000000-0000-0000-0000-000000000000"

func trafficFromClientEntity(c *model.ClientEntity) xray.ClientTraffic {
	if c == nil {
		return xray.ClientTraffic{}
	}
	trafficLimit := int64(c.TotalGB * 1024 * 1024 * 1024)
	return xray.ClientTraffic{
		Email:      c.Name,
		Up:         c.Up,
		Down:       c.Down,
		Total:      trafficLimit,
		ExpiryTime: c.ExpiryTime,
		LastOnline: c.LastOnline,
	}
}

// subscriptionPlaceholderLines encodes each non-empty line as a dummy vless URI;
// clients typically show the URI fragment as the node title.
func subscriptionPlaceholderLines(remarks []string) []string {
	out := make([]string, 0, len(remarks))
	for _, r := range remarks {
		r = strings.TrimSpace(r)
		if r == "" {
			continue
		}
		u := &url.URL{
			Scheme:   "vless",
			Host:     "0.0.0.0:1",
			RawQuery: "encryption=none&security=none&type=tcp&headerType=none",
		}
		u.User = url.User(placeholderVlessUUID)
		u.Fragment = r
		out = append(out, u.String())
	}
	return out
}

func isHWIDLimitStyleError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, service.ErrHWIDAdminBlocked) {
		return true
	}
	return strings.Contains(err.Error(), "HWID limit exceeded")
}

// hwidHeaderMissing reports whether a subscription request must be rejected because the client
// has HWID enforcement but sent no usable device id. A blank or whitespace-only header counts as missing.
func hwidHeaderMissing(hwidMode string, clientHWIDEnabled bool, hwid string) bool {
	return hwidMode == "client_header" && clientHWIDEnabled && strings.TrimSpace(hwid) == ""
}

// hwidBlockedRemarks picks the admin-configured remark lines for an HWID rejection.
func hwidBlockedRemarks(err error, r service.SharxSubpageCustomRemarks) []string {
	switch {
	case errors.Is(err, service.ErrHWIDMissing):
		return r.HWIDNotSupported
	case isHWIDLimitStyleError(err):
		return r.HWIDMaxDevicesExceeded
	}
	return nil
}

// hwidBlockedError wraps an HWID rejection for the non-placeholder (HTTP error) path.
func hwidBlockedError(err error) error {
	if errors.Is(err, service.ErrHWIDMissing) {
		return err
	}
	return fmt.Errorf("HWID limit exceeded: %w", err)
}

// appGateRemarks returns the admin-configured notice lines for an app-gate rejection.
func appGateRemarks(reason AppGateReason, r service.SharxSubpageCustomRemarks) []string {
	switch reason {
	case AppGateReasonBlockedApp:
		return r.BlockedApp
	case AppGateReasonUnknownApp:
		return r.UnknownApp
	}
	return nil
}

// jsonSubscriptionNoticeBody returns a minimal JSON document with blackhole
// outbounds tagged by remark lines (for /json/ subscription when links are blocked).
func jsonSubscriptionNoticeBody(remarks []string) string {
	var outbounds []map[string]any
	for _, r := range remarks {
		r = strings.TrimSpace(r)
		if r == "" {
			continue
		}
		outbounds = append(outbounds, map[string]any{
			"tag":      r,
			"protocol": "blackhole",
			"settings": map[string]any{},
		})
	}
	if len(outbounds) == 0 {
		return "{}"
	}
	root := map[string]any{
		"remarks":   "Subscription",
		"log":       map[string]any{"loglevel": "warning"},
		"outbounds": outbounds,
	}
	b, _ := json.MarshalIndent(root, "", "  ")
	return string(b)
}
