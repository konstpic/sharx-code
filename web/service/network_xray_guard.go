package service

import (
	"encoding/json"
	"fmt"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/json_util"
	"github.com/konstpic/sharx-code/v2/xray"
)

// SharX Network traffic is denied access to private/link-local ranges (SSRF guard:
// scanning RFC1918 networks and cloud metadata endpoints such as 169.254.169.254).
// The guard reuses the template's "blocked" (blackhole) outbound.
func applyNetworkRoutingGuards(cfg *xray.Config, networkInboundTags []string) error {
	if cfg == nil || len(networkInboundTags) == 0 {
		return nil
	}
	rule := map[string]any{
		"type":        "field",
		"inboundTag":  networkInboundTags,
		"ip":          []string{"geoip:private"},
		"outboundTag": "blocked",
	}
	var routing map[string]any
	if len(cfg.RouterConfig) > 0 {
		if err := json.Unmarshal(cfg.RouterConfig, &routing); err != nil {
			return fmt.Errorf("routing json: %w", err)
		}
	} else {
		routing = map[string]any{"domainStrategy": "AsIs"}
	}
	existing, _ := routing["rules"].([]any)
	if existing == nil {
		existing = []any{}
	}
	for _, r := range existing {
		m, ok := r.(map[string]any)
		if !ok {
			continue
		}
		if tag, ok := m["outboundTag"].(string); ok && tag == "blocked" {
			if tags, ok2 := m["inboundTag"].([]any); ok2 {
				match := false
				for _, t := range tags {
					for _, want := range networkInboundTags {
						if t == want {
							match = true
							break
						}
					}
				}
				if match {
					return nil // guard already present
				}
			}
		}
	}
	routing["rules"] = append([]any{rule}, existing...)
	out, err := json.Marshal(routing)
	if err != nil {
		return err
	}
	cfg.RouterConfig = json_util.RawMessage(out)
	logger.Debugf("Applied SharX Network private-range guard for inbounds %v", networkInboundTags)
	return nil
}

func networkInboundTags(inbounds []*model.Inbound) []string {
	tags := make([]string, 0, len(inbounds))
	for _, ib := range inbounds {
		if ib.SnNetwork && ib.Enable {
			tags = append(tags, ib.Tag)
		}
	}
	return tags
}
