package service

import (
	"encoding/json"
	"strings"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/xray"
)

func tlsSettingsHasServerCerts(ts map[string]any) bool {
	if ts == nil {
		return false
	}
	certs, ok := ts["certificates"].([]any)
	if !ok || len(certs) == 0 {
		return false
	}
	c0, ok := certs[0].(map[string]any)
	if !ok {
		return false
	}
	cf, _ := c0["certificateFile"].(string)
	kf, _ := c0["keyFile"].(string)
	if strings.TrimSpace(cf) != "" && strings.TrimSpace(kf) != "" {
		return true
	}
	certArr, caOk := c0["certificate"].([]any)
	keyArr, kaOk := c0["key"].([]any)
	return caOk && kaOk && len(certArr) > 0 && len(keyArr) > 0
}

// patchHysteriaStreamTLS ensures Hysteria / Hysteria2 inbounds use TLS with a server certificate.
// Xray's hysteria listener calls quic.Listen and requires a non-nil TLS config (security "none" fails).
func patchHysteriaStreamTLS(stream map[string]any, defaultCertFile, defaultKeyFile string) {
	netw, _ := stream["network"].(string)
	if netw != "hysteria" {
		return
	}
	sec, _ := stream["security"].(string)
	if sec == "reality" {
		return
	}
	ts, tsOK := stream["tlsSettings"].(map[string]any)
	hasCerts := tsOK && tlsSettingsHasServerCerts(ts)
	if sec == "tls" && hasCerts {
		ensureHysteriaDefaultALPN(stream)
		return
	}
	cf := strings.TrimSpace(defaultCertFile)
	kf := strings.TrimSpace(defaultKeyFile)
	if cf == "" || kf == "" {
		if sec != "tls" || !hasCerts {
			logger.Debug("Hysteria inbound needs TLS with certificates; set stream TLS + cert/key or panel web certificate paths (webCertFile / webKeyFile).")
		}
		return
	}
	stream["security"] = "tls"
	if !tsOK || ts == nil {
		ts = map[string]any{}
		stream["tlsSettings"] = ts
	}
	if !tlsSettingsHasServerCerts(ts) {
		ts["certificates"] = []any{
			map[string]any{
				"certificateFile": cf,
				"keyFile":         kf,
			},
		}
	}
	ensureHysteriaDefaultALPN(stream)
}

// patchHysteriaFinalmask normalizes the finalmask block for a Hysteria inbound
// and drops entries the kernel would reject (safety net for configs stored
// before validation existed). Valid masks of any supported type are preserved.
func patchHysteriaFinalmask(stream map[string]any, protocol string) {
	if _, ok := stream["finalmask"]; !ok {
		return
	}
	normalized := NormalizeFinalmask(stream, true)
	pruned, dropped := dropInvalidFinalmaskElements(normalized, protocol)
	if dropped > 0 {
		logger.Warningf("Hysteria inbound: dropped %d invalid finalmask entr(ies).", dropped)
	}
	if fm, ok := pruned["finalmask"]; ok {
		stream["finalmask"] = fm
	} else {
		delete(stream, "finalmask")
	}
}

func ensureHysteriaDefaultALPN(stream map[string]any) {
	ts, ok := stream["tlsSettings"].(map[string]any)
	if !ok || ts == nil {
		return
	}
	if _, has := ts["alpn"]; has {
		return
	}
	ts["alpn"] = []any{"h3"}
}

// extractAcceptProxyProtocol reads the panel-stored acceptProxyProtocol from streamSettings JSON.
// The field can live at the top level of streamSettings (added by the panel for all transports)
// or inside tcpSettings (legacy location). The top-level key is stripped from the returned JSON
// so Xray never sees an unexpected field in streamSettings.
func extractAcceptProxyProtocol(streamJSON string) (accept bool, cleanedJSON string) {
	if strings.TrimSpace(streamJSON) == "" {
		return false, streamJSON
	}
	var stream map[string]any
	if err := json.Unmarshal([]byte(streamJSON), &stream); err != nil {
		return false, streamJSON
	}
	// Top-level key (all transports).
	if v, ok := stream["acceptProxyProtocol"]; ok {
		if b, isBool := v.(bool); isBool {
			accept = b
		}
		delete(stream, "acceptProxyProtocol")
	}
	// Legacy: tcpSettings.acceptProxyProtocol (TCP transport only).
	if !accept {
		if tcp, ok := stream["tcpSettings"].(map[string]any); ok {
			if b, ok := tcp["acceptProxyProtocol"].(bool); ok && b {
				accept = true
			}
		}
	}
	if out, err := json.Marshal(stream); err == nil {
		cleanedJSON = string(out)
	} else {
		cleanedJSON = streamJSON
	}
	return accept, cleanedJSON
}

// BuildInboundXrayConfig returns the Xray inbound config, applying Hysteria TLS fixes in memory only.
// acceptProxyProtocol is extracted from the panel stream-settings JSON and set at the inbound level.
func BuildInboundXrayConfig(inbound *model.Inbound, defaultCertFile, defaultKeyFile string) *xray.InboundConfig {
	if inbound == nil {
		return nil
	}
	ib := *inbound
	if model.NormalizeProtocol(ib.Protocol) == model.WireGuard && ib.Settings != "" {
		ib.Settings = SanitizeWireGuardSettingsJSONForXray(ib.Settings)
	}

	// Extract panel-only acceptProxyProtocol field before handing stream settings to Xray.
	acceptProxy, cleanedStream := extractAcceptProxyProtocol(ib.StreamSettings)
	ib.StreamSettings = cleanedStream

	if model.IsHysteria(ib.Protocol) && len(ib.StreamSettings) > 0 {
		var stream map[string]any
		if err := json.Unmarshal([]byte(ib.StreamSettings), &stream); err == nil {
			patchHysteriaStreamTLS(stream, defaultCertFile, defaultKeyFile)
			patchHysteriaFinalmask(stream, string(model.NormalizeProtocol(ib.Protocol)))
			if out, err := json.MarshalIndent(stream, "", "  "); err == nil {
				ib.StreamSettings = string(out)
			}
		}
	}

	cfg := ib.GenXrayInboundConfig()
	if cfg != nil && acceptProxy {
		cfg.AcceptProxyProtocol = true
	}
	return cfg
}
