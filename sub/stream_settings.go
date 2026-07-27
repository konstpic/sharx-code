package sub

import (
	"encoding/json"

	"github.com/konstpic/sharx-code/v2/xray"
)

// parseInboundStreamSettings unmarshals inbound stream JSON and normalizes TLS fields for subscriptions.
func parseInboundStreamSettings(raw string) map[string]any {
	var stream map[string]any
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &stream)
	}
	return xray.NormalizeSubscriptionStreamSettings(stream)
}
