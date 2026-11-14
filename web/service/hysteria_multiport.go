package service

import (
	"encoding/json"
	"strings"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/common"
	"github.com/konstpic/sharx-code/v2/util/hysteria"
)

// IsHysteriaVersion2 reports whether the inbound speaks hysteria2 (version 2).
// Version 1 is selected by settings.version == 1 (same rule the share-link
// builder uses); every other hysteria/hysteria2 inbound is treated as v2.
func IsHysteriaVersion2(inbound *model.Inbound) bool {
	if inbound == nil {
		return false
	}
	if proto := model.NormalizeProtocol(inbound.Protocol); proto != model.Hysteria && proto != model.Hysteria2 {
		return false
	}
	var settings map[string]any
	json.Unmarshal([]byte(inbound.Settings), &settings)
	version, _ := settings["version"].(float64)
	return int(version) != 1
}

// streamSettingsMap unmarshals a streamSettings JSON blob. A malformed blob is
// reported as nil so the pre-existing validation paths surface it.
func streamSettingsMap(raw string) map[string]any {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var stream map[string]any
	if err := json.Unmarshal([]byte(raw), &stream); err != nil {
		return nil
	}
	return stream
}

func encodeStreamSettings(stream map[string]any) (string, bool) {
	if stream == nil {
		return "", false
	}
	body, err := json.MarshalIndent(stream, "", "  ")
	if err != nil {
		return "", false
	}
	return string(body), true
}

// ApplyHysteriaMultiPortOnSave validates and normalizes the panel-only
// streamSettings.hysteriaMultiPort range of a Hysteria2 inbound in place.
//
// The range never reaches Xray: it is stripped in BuildInboundXrayConfig and
// translated into host NAT rules (finalmask.UDPHopNatIntent). Keeping it in
// streamSettings means the regular full-object inbound write round-trips it
// without a database migration.
func ApplyHysteriaMultiPortOnSave(inbound *model.Inbound) error {
	if inbound == nil {
		return nil
	}
	stream := streamSettingsMap(inbound.StreamSettings)
	if stream == nil {
		return nil
	}
	raw, has := stream[hysteria.MultiPortKey]
	if !has {
		return nil
	}
	value, _ := raw.(string)

	// A range left over from a protocol switch (or set on v1) is removed
	// silently: only hysteria2 understands port hopping, and leaving it would
	// advertise a range the node has no rules for.
	if !IsHysteriaVersion2(inbound) {
		delete(stream, hysteria.MultiPortKey)
		if body, ok := encodeStreamSettings(stream); ok {
			inbound.StreamSettings = body
		}
		return nil
	}

	rangePort, present, err := hysteria.ValidateMultiPort(value, inbound.Port)
	if err != nil {
		return common.NewError("invalid hysteria2 multi-port:", err.Error())
	}
	if present && value == rangePort.String() {
		return nil // already normalized: do not re-render the JSON blob on every save
	}
	if !present {
		delete(stream, hysteria.MultiPortKey)
	} else {
		stream[hysteria.MultiPortKey] = rangePort.String()
	}
	if body, ok := encodeStreamSettings(stream); ok && body != inbound.StreamSettings {
		inbound.StreamSettings = body
		if present {
			logger.Debugf("hysteria2 multi-port normalized for inbound %q: %s", inbound.Tag, rangePort.String())
		}
	}
	return nil
}
