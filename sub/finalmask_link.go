package sub

import (
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/util/finalmask"
)

// This file emits the streamSettings.finalmask block into client share links as
// the compact `fm=<json>` parameter (Xray-core / 3x-ui compatible).
//
// The finalmask belongs to the client side of the tunnel: server-only masks
// (filter) are stripped, legacy fragment ranges are expanded, udphop ordering
// is enforced and only whitelisted masks are emitted.

// marshalFinalMask renders the client-side finalmask JSON for a share link.
// It returns false when nothing to emit remains.
func marshalFinalMask(fm map[string]any) (string, bool) {
	return finalmask.Marshal(fm)
}

// finalMaskSupportedForLink reports whether the protocol carries fm= in share
// links. Hysteria2 intentionally does not (3x-ui PR #6048: fm breaks mihomo);
// its obfuscation stays in obfs/obfs-password.
func finalMaskSupportedForLink(protocol model.Protocol) bool {
	switch model.NormalizeProtocol(protocol) {
	case model.VLESS, model.VMESS, model.Trojan, model.Shadowsocks:
		return true
	}
	return false
}

// applyFinalMaskParams puts the `fm` query parameter into params when the
// inbound streamSettings carry a non-empty finalmask and the protocol emits fm.
func applyFinalMaskParams(stream map[string]any, protocol model.Protocol, params map[string]string) {
	if params == nil || stream == nil || !finalMaskSupportedForLink(protocol) {
		return
	}
	fm, ok := stream["finalmask"].(map[string]any)
	if !ok || !hasFinalMaskContent(fm) {
		return
	}
	if s, ok := marshalFinalMask(fm); ok {
		params["fm"] = s
	}
}

// applyFinalMaskObj puts the `fm` key into a VMess base64 share object.
func applyFinalMaskObj(stream map[string]any, protocol model.Protocol, obj map[string]any) {
	if obj == nil || stream == nil || !finalMaskSupportedForLink(protocol) {
		return
	}
	fm, ok := stream["finalmask"].(map[string]any)
	if !ok || !hasFinalMaskContent(fm) {
		return
	}
	if s, ok := marshalFinalMask(fm); ok {
		obj["fm"] = s
	}
}

// withLegacyFragmentRanges duplicates the last lengths[]/delays[] entry into the
// legacy length/delay fields (3x-ui behaviour). Input is not mutated.
func withLegacyFragmentRanges(fm map[string]any) map[string]any {
	return finalmask.LegacyFragmentRanges(fm)
}

// normalizeUDPHop keeps a single socket-replacing mask and moves it to the end
// of udp[] (otherwise the kernel reports "incorrect index").
func normalizeUDPHop(fm map[string]any) map[string]any {
	return finalmask.NormalizeUDPHop(fm)
}

// sanitizeQuicParams truncates numeric quicParams to integers and drops
// non-positive / empty values.
func sanitizeQuicParams(fm map[string]any) map[string]any {
	return finalmask.SanitizeQuicParams(fm)
}

// dropServerOnly removes masks that only exist on the server side (filter).
func dropServerOnly(fm map[string]any) map[string]any {
	return finalmask.DropServerOnly(fm)
}

// hasFinalMaskContent reports whether a finalmask block carries usable content.
func hasFinalMaskContent(fm map[string]any) bool {
	return finalmask.HasContent(fm)
}
