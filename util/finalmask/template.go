package finalmask

import (
	"encoding/json"
	"errors"
	"strings"
)

// This file implements the "default masks" slot of the JSON subscription: a
// finalmask object stored in the panel settings and used as a fallback for
// every outbound that does not define a mask of its own.
//
// The merge runs on the client side of the tunnel (the JSON subscription is a
// client config), so it keeps client-only masks such as udphop: ServerView is
// deliberately NOT applied here.
//
// Policy: only client-transparent masks may be filled from the slot (see
// templateSlotMasks). Payload-transforming masks must match on the server, and
// the slot is applied exactly to inbounds whose server side has no mask, so
// shipping those types from the slot would produce a silently dead
// subscription (probe: kcp server without masks + client udp salamander accepts
// the SOCKS connection and returns nothing until timeout).

// templateSlotMasks lists the finalmask types the subscription slot may fill,
// per side. They are transparent for the peer:
//   - tcp fragment: the kernel only splits writes into TCP segments, the byte
//     stream (and therefore the TLS/REALITY handshake) is unchanged;
//   - udp udphop: client-only (the kernel refuses to wrap the server side), the
//     peer sees plain UDP from varying source ports.
//
// Everything else (salamander, sudoku, xmc, header-custom, noise, realm, …)
// changes bytes on the wire and needs the same mask on the server side, which
// the slot cannot guarantee, so it is dropped from the slot.
var templateSlotMasks = map[string]map[string]struct{}{
	"tcp": {"fragment": {}},
	"udp": {"udphop": {}},
}

// TemplateSlotView returns the part of the slot object that may be applied to a
// client stream, plus the names of the dropped entries for the operator log.
// quicParams are kept only on the xhttp QUIC path (StreamUsesQUIC): there they
// tune the local QUIC stack and a probe against a server without quicParams
// served traffic normally, while on hysteria/hysteria2 they are symmetric
// connection knobs the operator must set on the inbound itself.
func TemplateSlotView(template, stream map[string]any) (map[string]any, []string) {
	if !HasContent(template) {
		return nil, nil
	}
	var out map[string]any
	var dropped []string
	ensure := func() map[string]any {
		if out == nil {
			out = map[string]any{}
		}
		return out
	}
	for _, side := range []string{"tcp", "udp"} {
		arr, ok := template[side].([]any)
		if !ok || len(arr) == 0 {
			continue
		}
		kept := make([]any, 0, len(arr))
		for _, item := range arr {
			el, ok := item.(map[string]any)
			if !ok {
				dropped = append(dropped, "unknown")
				continue
			}
			typ := strings.ToLower(strings.TrimSpace(strValue(el["type"])))
			if _, ok := templateSlotMasks[side][typ]; !ok {
				dropped = append(dropped, typ)
				continue
			}
			if cp, ok := deepCopyValue(el); ok {
				kept = append(kept, cp)
			}
		}
		if len(kept) > 0 {
			ensure()[side] = kept
		}
	}
	if qp, ok := template["quicParams"].(map[string]any); ok && len(qp) > 0 {
		if StreamUsesQUIC(stream) {
			if cp, ok := deepCopyMap(qp); ok {
				ensure()["quicParams"] = cp
			}
		} else {
			dropped = append(dropped, "quicParams")
		}
	}
	if !HasContent(out) {
		return nil, dropped
	}
	return out, dropped
}

// SlotUnappliedTypes lists the slot mask types that are never applied from the
// "default masks" slot regardless of the inbound transport (payload-transforming
// types and unknown entries). Used at settings-save time to warn the operator
// that such types must be configured on the inbound instead.
func SlotUnappliedTypes(fm map[string]any) []string {
	if fm == nil {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	for _, side := range []string{"tcp", "udp"} {
		arr, ok := fm[side].([]any)
		if !ok {
			continue
		}
		for _, item := range arr {
			el, ok := item.(map[string]any)
			typ := "unknown"
			if ok {
				if t := strings.ToLower(strings.TrimSpace(strValue(el["type"]))); t != "" {
					typ = t
				}
			}
			if _, ok := templateSlotMasks[side][typ]; ok {
				continue
			}
			if _, dup := seen[typ]; dup {
				continue
			}
			seen[typ] = struct{}{}
			out = append(out, typ)
		}
	}
	return out
}

// MergeTemplate overlays the subscription template masks under the inbound's
// own finalmask. Rules:
//   - tcp[] and udp[]: the inbound wins per side. A non-empty inbound side is
//     copied verbatim (the template side is ignored); an empty or absent
//     inbound side is filled from the template;
//   - quicParams: deep merge by key, inbound keys take precedence;
//   - any other key is kept from the inbound (the template only supplies the
//     three documented slots).
//
// A nil or content-free template returns the inbound finalmask untouched, so a
// subscription without the slot stays byte-for-byte identical. A nil inbound
// finalmask is replaced by the template. The inputs are never mutated.
func MergeTemplate(inbound, template map[string]any) map[string]any {
	if !HasContent(template) {
		return inbound
	}
	base, ok := deepCopyMap(inbound)
	if !ok || base == nil {
		base = map[string]any{}
	}
	for _, side := range []string{"tcp", "udp"} {
		if listLen(base[side]) > 0 {
			continue
		}
		tplArr, ok := template[side].([]any)
		if !ok || len(tplArr) == 0 {
			continue
		}
		if cp, ok := deepCopyValue(tplArr); ok {
			base[side] = cp
		}
	}
	if tplQP, ok := template["quicParams"].(map[string]any); ok && len(tplQP) > 0 {
		merged := map[string]any{}
		if cp, ok := deepCopyMap(tplQP); ok {
			merged = cp
		}
		if inboundQP, ok := base["quicParams"].(map[string]any); ok {
			for k, v := range inboundQP {
				merged[k] = v
			}
		}
		base["quicParams"] = merged
	}
	if !HasContent(base) {
		return nil
	}
	return base
}

// WithoutForbiddenSides drops the mask sides the given protocol/transport of
// stream cannot carry (the rules of ValidateTransportCompatibility), returning
// the filtered object plus the dropped side names for the operator warning.
// A quicParams-only object is returned unchanged. The input is not mutated.
func WithoutForbiddenSides(protocol string, stream map[string]any, fm map[string]any) (map[string]any, []string) {
	if !HasContent(fm) {
		return fm, nil
	}
	issues := ValidateTransportCompatibility(protocol, stream, fm)
	if len(issues) == 0 {
		return fm, nil
	}
	out, ok := deepCopyMap(fm)
	if !ok {
		// Fail safe: a mask set that cannot be copied cannot be checked either,
		// so drop it instead of shipping a side the subscription cannot carry.
		// "*" tells the caller the whole finalmask went away.
		return nil, []string{"*"}
	}
	var dropped []string
	for _, is := range issues {
		if is.Severity != SeverityError {
			continue
		}
		switch is.Code {
		case "transport_tcp_forbidden":
			if _, has := out["tcp"]; has {
				delete(out, "tcp")
				dropped = append(dropped, "tcp")
			}
		case "transport_udp_forbidden":
			if _, has := out["udp"]; has {
				delete(out, "udp")
				dropped = append(dropped, "udp")
			}
		case "transport_unsupported":
			for _, side := range []string{"tcp", "udp"} {
				if _, has := out[side]; has {
					delete(out, side)
					dropped = append(dropped, side)
				}
			}
		}
	}
	if len(dropped) == 0 {
		return fm, nil
	}
	if !HasContent(out) {
		return nil, dropped
	}
	return out, dropped
}

// deepCopyValue copies an arbitrary JSON value through a marshal round-trip,
// like deepCopyMap does for objects.
func deepCopyValue(v any) (any, bool) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, false
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, false
	}
	return out, true
}

// ParseObject decodes the JSON object stored in the "default masks" settings
// slot. An empty string yields (nil, nil); a valid non-object JSON value is an
// error (the slot must hold an object).
func ParseObject(raw string) (map[string]any, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil, nil
	}
	var value any
	if err := json.Unmarshal([]byte(s), &value); err != nil {
		return nil, err
	}
	fm, ok := value.(map[string]any)
	if !ok || fm == nil {
		return nil, errors.New("finalmask must be a JSON object")
	}
	return fm, nil
}
