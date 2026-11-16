// Package hysteria holds dependency-free helpers for the Hysteria fields the
// panel manages on top of Xray: the client-side "multi-port" (port hopping)
// range and the host-level NAT rules that make it reach the single inbound
// listener.
package hysteria

import (
	"fmt"
	"strconv"
	"strings"
)

const (
	// MultiPortKey is the panel-only streamSettings key carrying the hysteria2
	// client port-hopping range (e.g. "39640-39649"). It is never shipped to
	// Xray: the server listens on the single inbound port and the node
	// redirects every port of the range onto it (see finalmask.UDPHopNatIntent).
	MultiPortKey = "hysteriaMultiPort"
	// MaxMultiPortRange is the largest accepted range, inclusive
	// (min..max may cover at most this many ports).
	MaxMultiPortRange = 1000
)

// MultiPort is a validated client port-hopping range (1..65535, min < max).
type MultiPort struct {
	Min int
	Max int
}

// Valid reports whether the range is well formed and non-trivial.
func (r MultiPort) Valid() bool {
	return validPort(r.Min) && validPort(r.Max) && r.Min < r.Max
}

// Count returns the number of ports the range covers.
func (r MultiPort) Count() int {
	if !r.Valid() {
		return 0
	}
	return r.Max - r.Min + 1
}

// Contains reports whether port falls into the range.
func (r MultiPort) Contains(port int) bool {
	return r.Valid() && port >= r.Min && port <= r.Max
}

// String renders the range in the Hysteria multi-port authority syntax
// ("min-max"), the same shape the share link carries.
func (r MultiPort) String() string {
	return fmt.Sprintf("%d-%d", r.Min, r.Max)
}

func validPort(p int) bool { return p >= 1 && p <= 65535 }

// ParseMultiPort parses the panel value "min-max". An empty/whitespace value is
// reported as absent (ok=false), not as an error: the range is optional.
func ParseMultiPort(raw string) (MultiPort, bool) {
	tok := strings.TrimSpace(raw)
	if tok == "" {
		return MultiPort{}, false
	}
	parts := strings.SplitN(tok, "-", 2)
	if len(parts) != 2 {
		return MultiPort{}, false
	}
	min, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil {
		return MultiPort{}, false
	}
	max, err := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil {
		return MultiPort{}, false
	}
	r := MultiPort{Min: min, Max: max}
	if !r.Valid() {
		return MultiPort{}, false
	}
	return r, true
}

// MultiPortFromStream reads the panel key from a raw streamSettings map.
func MultiPortFromStream(stream map[string]any) (MultiPort, bool) {
	if stream == nil {
		return MultiPort{}, false
	}
	raw, ok := stream[MultiPortKey]
	if !ok {
		return MultiPort{}, false
	}
	s, _ := raw.(string)
	return ParseMultiPort(s)
}

// UsableForListener reports whether the range may be used for an inbound that
// listens on listenerPort: it must respect the panel limits (at most
// MaxMultiPortRange ports) and must not swallow the listener itself. Consumers
// (NAT intents, share links) use it so a value that bypassed the save-time
// validation (manual SQL, imported streamSettings) cannot create a huge
// REDIRECT rule or a link the node can never serve.
func UsableForListener(r MultiPort, listenerPort int) bool {
	if !r.Valid() || r.Count() > MaxMultiPortRange {
		return false
	}
	return !(validPort(listenerPort) && r.Contains(listenerPort))
}

// Intersects reports whether two valid ranges share at least one port.
func (r MultiPort) Intersects(other MultiPort) bool {
	return r.Valid() && other.Valid() && r.Min <= other.Max && other.Min <= r.Max
}

// ValidateMultiPort checks the panel constraints for one inbound and returns
// the normalized range. An empty value is valid and yields ok=false.
func ValidateMultiPort(raw string, listenerPort int) (MultiPort, bool, error) {
	if strings.TrimSpace(raw) == "" {
		return MultiPort{}, false, nil
	}
	r, ok := ParseMultiPort(raw)
	if !ok {
		return MultiPort{}, false, fmt.Errorf("must be a range \"min-max\" with 1 <= min < max <= 65535, e.g. 39640-39649")
	}
	if r.Count() > MaxMultiPortRange {
		return MultiPort{}, false, fmt.Errorf("range %s covers %d ports; at most %d are allowed", r.String(), r.Count(), MaxMultiPortRange)
	}
	if validPort(listenerPort) && r.Contains(listenerPort) {
		return MultiPort{}, false, fmt.Errorf("range %s must not include the listener port %d", r.String(), listenerPort)
	}
	return r, true, nil
}

// IsMultiPort reports whether the protocol is one whose links carry the
// Hysteria multi-port authority. Version gating (v1 vs v2) is the caller's job:
// the panel only stores the key for version 2.
func IsMultiPort(protocol string) bool {
	switch strings.ToLower(strings.TrimSpace(protocol)) {
	case "hysteria", "hysteria2":
		return true
	default:
		return false
	}
}
