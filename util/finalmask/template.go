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
		return nil, []string{"all"}
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
