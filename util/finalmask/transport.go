package finalmask

import (
	"fmt"
	"strings"

	"github.com/konstpic/sharx-code/v2/logger"
)

// This file encodes which side of the tunnel (tcp[] / udp[]) a transport can be
// wrapped on.
//
// Facts about the kernel this file relies on (Xray-core 26.10.10/26.10.31,
// confirmed by live probes against the node binary and by the sources):
//   - finalmask is applied by the transport itself: tcp/ws/httpupgrade/grpc
//     call FinalMask.DialTCP, kcp calls DialUDP, masque uses both;
//   - xhttp (splithttp) picks the path from the ALPN: decideHTTPVersion returns
//     "3" only when len(NextProtocol)==1 && NextProtocol[0]=="h3"; that path
//     calls FinalMask.DialUDP. With any other ALPN it is H1/H2 over TCP and
//     uses DialTCP. ALPN tokens are compared verbatim (case-sensitive), so
//     "H3" stays on the TCP path. A tcp mask on the h3 path is accepted by the
//     kernel but silently does nothing, so the panel rejects it instead of
//     shipping a mask the operator believes in;
//   - wireguard wraps both listener and dialer (proxy/wireguard/server.go,
//     client.go: FinalMask.ListenPacket / DialUDP) => UDP side;
//   - quic/h2/h3/http are removed transports
//     (infra/conf/transport_internet.go: PrintRemovedFeatureError) => no masks;
//   - xdrive dials through FinalMask.DialTCP only (TCP side); masque starts the
//     h2 listener when ALPN contains "h2" and the h3 listener when it contains
//     "h3" or when there is no "h2" at all (transport/internet/masque/hub.go);
//   - udphop implements WrapPacketConnServer as "udphop: client only", so it
//     must never reach a node config. It stays in the client share link.
//
// Live probe results this matrix is pinned to (Xray 26.10.31):
//   - kcp + udp salamander: starts; xhttp+h3 + udp salamander: starts;
//   - xhttp+h3 + tcp fragment: starts, mask not applied (no-op);
//   - kcp + tcp fragment / tcp + udp salamander: start, no-op;
//   - xhttp+h3 + udphop: fails with "udphop: client only";
//   - network "quic": config rejected as a removed feature.
//
// The function is intentionally total: unknown/empty networks fall back to the
// plain TCP behaviour instead of rejecting a config the panel itself created.

// clientOnlyMasks lists finalmask types that exist on the client side only and
// must not be written into an Xray (node) config. Extend this map when the
// kernel grows more client-only masks.
var clientOnlyMasks = map[string]struct{}{
	"udphop": {},
}

// removedTransports are transport names rejected by the kernel config parser.
var removedTransports = map[string]struct{}{
	"quic": {},
	"h2":   {},
	"h3":   {},
	"http": {},
}

// normalizeNetwork maps the panel/3x-ui transport aliases onto kernel names.
func normalizeNetwork(network string) string {
	switch n := strings.ToLower(strings.TrimSpace(network)); n {
	case "raw":
		return "tcp"
	case "mkcp":
		return "kcp"
	case "splithttp":
		return "xhttp"
	case "websocket":
		return "ws"
	default:
		return n
	}
}

// StreamNetwork returns the normalized transport name stored in
// streamSettings.network ("" when unset). raw->tcp, mkcp->kcp,
// splithttp->xhttp, websocket->ws; h2/h3/http stay as-is and are treated as
// removed transports.
func StreamNetwork(stream map[string]any) string {
	if stream == nil {
		return ""
	}
	n, _ := stream["network"].(string)
	return normalizeNetwork(n)
}

// StreamALPN returns the ALPN list from tlsSettings as a comma separated
// string, or "" when the inbound does not use TLS
// (streamSettings.security != "tls"): without TLS there is no ALPN negotiation
// and the xhttp QUIC path cannot be selected. Token case is preserved: the
// kernel compares ALPN values verbatim (NextProtocol[0] == "h3"), so "H3" is
// not the QUIC path. Only surrounding whitespace is trimmed.
func StreamALPN(stream map[string]any) string {
	if stream == nil {
		return ""
	}
	sec, _ := stream["security"].(string)
	if strings.ToLower(strings.TrimSpace(sec)) != "tls" {
		return ""
	}
	ts, ok := stream["tlsSettings"].(map[string]any)
	if !ok || ts == nil {
		return ""
	}
	switch v := ts["alpn"].(type) {
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s := strings.TrimSpace(strValue(item)); s != "" {
				out = append(out, s)
			}
		}
		return strings.Join(out, ",")
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s := strings.TrimSpace(item); s != "" {
				out = append(out, s)
			}
		}
		return strings.Join(out, ",")
	case string:
		return strings.TrimSpace(v)
	default:
		return ""
	}
}

// alpnIsH3 mirrors the kernel rule (splithttp/dialer.go decideHTTPVersion): the
// QUIC path is used only when ALPN is exactly ["h3"]. The comparison is
// case-sensitive, like the kernel's NextProtocol[0] == "h3"; ["h3","h2"] and
// ["H3"] both stay on the TCP path.
func alpnIsH3(alpn string) bool {
	parts := strings.Split(strings.TrimSpace(alpn), ",")
	return len(parts) == 1 && strings.TrimSpace(parts[0]) == "h3"
}

// alpnContains reports whether the comma separated ALPN list holds token
// verbatim (case-sensitive, as the kernel uses slices.Contains/==).
func alpnContains(alpn, token string) bool {
	for _, part := range strings.Split(alpn, ",") {
		if strings.TrimSpace(part) == token {
			return true
		}
	}
	return false
}

// SidesFor returns which finalmask sides (tcp[] / udp[]) the given protocol and
// transport can carry. alpn is expected to come from StreamALPN (already gated
// on security=="tls") and is matched case-sensitively, like the kernel. The
// matrix:
//
//	protocol wireguard                -> (false, true)   (kernel wraps UDP only)
//	protocol hysteria|hysteria2       -> (false, true)   (network ignored)
//	protocol amneziawg|telemt         -> (false, false)
//	tcp|ws|httpupgrade|grpc           -> (true,  false)
//	xhttp                             -> ALPN == ["h3"] -> (false, true); else (true, false)
//	kcp|hysteria (network)            -> (false, true)
//	quic|h2|h3|http                   -> (false, false) (removed transports)
//	masque                            -> tcp only with ALPN "h2"; udp with "h3" or without "h2"
//	xdrive                            -> (true,  false)
//	empty/unknown                     -> (true,  false)
func SidesFor(protocol, network, alpn string) (tcpOK, udpOK bool) {
	switch strings.ToLower(strings.TrimSpace(protocol)) {
	case "wireguard":
		return false, true
	case "hysteria", "hysteria2":
		return false, true
	case "amneziawg", "telemt":
		return false, false
	}
	netw := normalizeNetwork(network)
	switch netw {
	case "xhttp":
		if alpnIsH3(alpn) {
			return false, true
		}
		return true, false
	case "tcp", "ws", "httpupgrade", "grpc":
		return true, false
	case "kcp", "hysteria":
		return false, true
	case "masque":
		// masque/hub.go: h2 listener when ALPN contains "h2"; h3 listener when it
		// contains "h3" or when there is no h2 at all.
		tcpOK = alpnContains(alpn, "h2")
		udpOK = alpnContains(alpn, "h3") || !tcpOK
		return tcpOK, udpOK
	case "xdrive":
		return true, false
	default:
		if _, removed := removedTransports[netw]; removed {
			return false, false
		}
		return true, false
	}
}

// isRemovedTransport reports whether network is a transport the kernel rejects
// at config load (quic/h2/h3/http).
func isRemovedTransport(network string) (string, bool) {
	netw := normalizeNetwork(network)
	_, removed := removedTransports[netw]
	return netw, removed
}

// allowedSidesText renders the human readable allowed-sides note for messages.
func allowedSidesText(tcpOK, udpOK bool) string {
	switch {
	case tcpOK && udpOK:
		return "TCP and UDP"
	case tcpOK:
		return "TCP only"
	case udpOK:
		return "UDP only"
	default:
		return "none"
	}
}

func listLen(v any) int {
	if arr, ok := v.([]any); ok {
		return len(arr)
	}
	return 0
}

// CodeRealityTCPForbidden is the issue code of the REALITY × TCP-mask
// combination (see ValidateRealityCombination).
const CodeRealityTCPForbidden = "reality_tcp_forbidden"

// RealityCombinationError reports a finalmask/security combination the kernel
// cannot serve. Code is machine readable and matches the i18n key suffix
// (finalmask.error.<code>).
type RealityCombinationError struct {
	Code    string
	Message string
}

func (e *RealityCombinationError) Error() string { return e.Message }

// ValidateRealityCombination rejects TCP-side masks on a REALITY stream.
//
// Facts this rule is pinned to (see XTLS/Xray-core#6453):
//   - the REALITY handshake asserts that the accepted connection implements
//     CloseWriteConn: github.com/xtls/reality `raw.(CloseWriteConn)` runs on the
//     connection handed to reality.Server (the interface and the assertion live
//     in the reality module's tls.go, which the pinned core pulls in through
//     `github.com/xtls/reality v0.0.0-20260908062103`; the 26.10.31 probe binary
//     uses a newer reality build with the same assertion);
//   - live probe, Xray 26.10.31 (sha256 cc4b84d3…, binary /tmp/xray-261031):
//     network=tcp + security=reality + tcp[] fragment passes `xray -test`, then
//     the first incoming connection logs
//     "panic: interface conversion: *fragment.fragmentConn is not
//     reality.CloseWriteConn: missing method CloseWrite" and the whole process
//     exits (remotely triggerable DoS, reproduced with matched and unmatched
//     client configs);
//   - the same tcp[] fragment on the client (outbound) side against a mask-free
//     REALITY inbound serves traffic normally (curl 200, no panic), and a
//     udp[]-only or quicParams-only finalmask on a REALITY inbound also serves
//     traffic normally (the TCP transport never wraps those layers).
//
// Hence only tcp[] is rejected: udp[] and quicParams remain allowed.
func ValidateRealityCombination(security string, fm map[string]any) error {
	if fm == nil || !strings.EqualFold(strings.TrimSpace(security), "reality") {
		return nil
	}
	arr, ok := fm["tcp"].([]any)
	if !ok || len(arr) == 0 {
		return nil
	}
	return &RealityCombinationError{
		Code: CodeRealityTCPForbidden,
		Message: fmt.Sprintf("TCP masks (%s) are not compatible with REALITY: the kernel wraps the accepted "+
			"TLS connection and the process crashes on the first handshake (XTLS/Xray-core#6453); "+
			"remove tcp[] or switch security to tls/none", strings.Join(maskTypeNames(arr), ", ")),
	}
}

// maskTypeNames lists the finalmask types of an array in order, lowercased,
// for operator-facing messages.
func maskTypeNames(arr []any) []string {
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		el, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if typ := strings.ToLower(strings.TrimSpace(strValue(el["type"]))); typ != "" {
			out = append(out, typ)
		}
	}
	if len(out) == 0 {
		return []string{"unknown"}
	}
	return out
}

// StreamUsesQUIC reports whether the streamSettings select the QUIC transport
// path of xhttp (network xhttp with ALPN exactly ["h3"], see alpnIsH3). On that
// path finalmask and quicParams are applied by the UDP/QUIC dialer, which is
// why the JSON-subscription defaults may ship quicParams there.
func StreamUsesQUIC(stream map[string]any) bool {
	return StreamNetwork(stream) == "xhttp" && alpnIsH3(StreamALPN(stream))
}

// ValidateTransportCompatibility checks that the finalmask sides match the
// transport of streamSettings for protocol. Only severity=error issues are
// produced: a mask the kernel would silently ignore is rejected at save time.
// A quicParams-only finalmask is never a transport problem: quicParams tune the
// QUIC stack (xhttp h3 / hysteria) and are valid wherever finalmask itself is.
func ValidateTransportCompatibility(protocol string, stream map[string]any, fm map[string]any) []Issue {
	if !HasContent(fm) {
		return nil
	}
	network := StreamNetwork(stream)
	alpn := StreamALPN(stream)
	tcpOK, udpOK := SidesFor(protocol, network, alpn)
	tcpMasks := listLen(fm["tcp"])
	udpMasks := listLen(fm["udp"])

	// Removed transports cannot carry masks at all. quicParams alone is fine
	// (they are ignored by a transport the kernel refuses anyway), so this only
	// triggers when an actual tcp[]/udp[] mask is present.
	if tcpMasks > 0 || udpMasks > 0 {
		if netw, removed := isRemovedTransport(network); removed {
			return []Issue{issue("transport_unsupported", "streamSettings.finalmask", SeverityError,
				"transport %q is not available in the current Xray kernel (removed feature), protocol %q; "+
					"remove the tcp[]/udp[] masks or switch to a supported transport", netw, protocol)}
		}
	}

	var issues []Issue
	if tcpMasks > 0 && !tcpOK {
		msg := fmt.Sprintf("tcp masks are not supported for protocol %q on transport %q (allowed finalmask sides: %s)",
			protocol, network, allowedSidesText(tcpOK, udpOK))
		if network == "xhttp" && alpnIsH3(alpn) {
			msg = fmt.Sprintf("tcp masks are not applied on the QUIC transport (xhttp with ALPN h3), protocol %q: "+
				"this path uses the UDP mask side, so use udp masks instead", protocol)
		}
		issues = append(issues, issue("transport_tcp_forbidden", "streamSettings.finalmask.tcp", SeverityError, "%s", msg))
	}
	if udpMasks > 0 && !udpOK {
		issues = append(issues, issue("transport_udp_forbidden", "streamSettings.finalmask.udp", SeverityError,
			"udp masks are not supported for protocol %q on transport %q (allowed finalmask sides: %s)",
			protocol, network, allowedSidesText(tcpOK, udpOK)))
	}
	return issues
}

// ServerView returns the server-side representation of a finalmask object: a
// deep copy where client-only masks (see clientOnlyMasks, currently udphop) are
// removed from udp[]. quicParams, tcp[] and any other keys are kept verbatim.
// The result is empty (and the caller must delete the key) when nothing remains.
// On a copy failure it fails safe: an empty map plus a warning, so a mask set
// the panel could not copy (and therefore could not sanitize) never reaches the
// node config — shipping udphop there makes the kernel refuse the inbound.
func ServerView(fm map[string]any) map[string]any {
	if fm == nil {
		return nil
	}
	cp, ok := deepCopyMap(fm)
	if !ok {
		logger.Warning("finalmask: server view cannot copy the finalmask block; omitting it from the node config")
		return map[string]any{}
	}
	if arr, ok := cp["udp"].([]any); ok {
		kept := make([]any, 0, len(arr))
		for _, item := range arr {
			el, ok := item.(map[string]any)
			if ok {
				if _, clientOnly := clientOnlyMasks[typeOf(el)]; clientOnly {
					continue
				}
			}
			kept = append(kept, item)
		}
		if len(kept) == 0 {
			delete(cp, "udp")
		} else {
			cp["udp"] = kept
		}
	}
	if !HasContent(cp) {
		return map[string]any{}
	}
	return cp
}
