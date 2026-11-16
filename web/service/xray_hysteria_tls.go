package service

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/finalmask"
	"github.com/konstpic/sharx-code/v2/util/hysteria"
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

// patchFinalmask prepares the finalmask block for the Xray (node / local core)
// config: the block is normalized, entries the kernel would reject are dropped
// (safety net for configs stored before validation existed) and the server view
// removes client-only masks (udphop answers "udphop: client only" on listen).
// The database row and the subscription keep the full mask set.
func patchFinalmask(stream map[string]any, protocol string, inboundID int, tag string) {
	if _, ok := stream["finalmask"]; !ok {
		return
	}
	normalized := NormalizeFinalmask(stream, true)
	beforeFM, _ := normalized["finalmask"].(map[string]any)
	pruned, dropped := dropInvalidFinalmaskElements(normalized, protocol)
	if dropped > 0 {
		afterFM, _ := pruned["finalmask"].(map[string]any)
		logger.Warningf("finalmask: inbound %d (%s): dropped finalmask entries for protocol %s: %s",
			inboundID, tag, protocol, strings.Join(droppedMaskTypes(beforeFM, afterFM), ", "))
	}
	fm, _ := pruned["finalmask"].(map[string]any)
	if fm == nil {
		delete(stream, "finalmask")
		return
	}
	// Legacy rows (saved before the REALITY gate existed) may still carry a
	// tcp[] mask next to security=reality. Such a config makes the kernel panic
	// on the first handshake (XTLS/Xray-core#6453), so drop the tcp side and
	// tell the operator which mask types were thrown away.
	security, _ := pruned["security"].(string)
	if err := finalmask.ValidateRealityCombination(security, fm); err != nil {
		before := map[string]any{"tcp": fm["tcp"]}
		delete(fm, "tcp")
		logger.Warningf("finalmask: inbound %d (%s): dropped tcp masks for REALITY (XTLS/Xray-core#6453): %s",
			inboundID, tag, strings.Join(droppedMaskTypes(before, fm), ", "))
		if !finalmask.HasContent(fm) {
			delete(stream, "finalmask")
			return
		}
	}
	serverFM := finalmask.ServerView(fm)
	if !finalmask.HasContent(serverFM) {
		delete(stream, "finalmask")
		return
	}
	stream["finalmask"] = serverFM
}

// droppedMaskTypes lists the finalmask types present in before but missing in
// after (DropInvalidElements output), sorted and deduplicated, for the warning
// log. It keeps the operator able to see which masks were thrown away.
func droppedMaskTypes(before, after map[string]any) []string {
	counts := func(fm map[string]any) map[string]int {
		out := map[string]int{}
		for _, transport := range []string{"tcp", "udp"} {
			arr, ok := fm[transport].([]any)
			if !ok {
				continue
			}
			for _, item := range arr {
				el, ok := item.(map[string]any)
				if !ok {
					continue
				}
				typ, _ := el["type"].(string)
				typ = strings.ToLower(strings.TrimSpace(typ))
				if typ != "" {
					out[typ]++
				}
			}
		}
		return out
	}
	beforeCounts, afterCounts := counts(before), counts(after)
	var types []string
	for typ, n := range beforeCounts {
		if left := n - afterCounts[typ]; left > 0 {
			types = append(types, typ)
		}
	}
	sort.Strings(types)
	if len(types) == 0 {
		return []string{"unknown"}
	}
	return types
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

	if len(ib.StreamSettings) > 0 {
		var stream map[string]any
		if err := json.Unmarshal([]byte(ib.StreamSettings), &stream); err == nil {
			// Panel-only key: the hysteria2 multi-port range is consumed by the
			// panel (share link) and the node NAT rules, never by Xray.
			delete(stream, hysteria.MultiPortKey)
			if model.IsHysteria(ib.Protocol) {
				patchHysteriaStreamTLS(stream, defaultCertFile, defaultKeyFile)
			}
			patchFinalmask(stream, string(model.NormalizeProtocol(ib.Protocol)), ib.Id, ib.Tag)
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
