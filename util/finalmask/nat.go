package finalmask

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// This file derives host-level NAT intents from the udphop mask. The kernel
// client with mode intervalremote/perconnremote sends from random ports of the
// remoteIPs list and expects them to reach the inbound port, so the node needs
// one REDIRECT rule per remote port range:
//
//	iptables -t nat -A PREROUTING -p udp --dport <min>:<max> -j REDIRECT --to-ports <inbound port>
//
// The panel ships the desired rule list to the node with apply-config and the
// node agent reconciles its own chain (node/udphopnat).
//
// Firewall note: because the REDIRECT sits in nat PREROUTING, a packet sent to
// any remotePorts value reaches the INPUT filter already rewritten to the
// inbound port. Operators therefore only have to open the INBOUND port
// ("ufw allow <inbound port>/udp"); opening the remotePorts range is neither
// required nor useful, and a closed range does not block the hopping client.

// UDPHopNatIntent is one desired REDIRECT rule: UDP datagrams addressed to
// FromPortMin..FromPortMax are redirected to ToPort (the inbound listen port).
// All values are validated ports (1..65535, min <= max), which is what makes
// them safe to interpolate into iptables argv.
type UDPHopNatIntent struct {
	FromPortMin int `json:"fromPortMin"`
	FromPortMax int `json:"fromPortMax"`
	ToPort      int `json:"toPort"`
}

// Valid reports whether the intent holds a well-formed port range and target.
func (i UDPHopNatIntent) Valid() bool {
	return validPort(i.FromPortMin) && validPort(i.FromPortMax) &&
		i.FromPortMin <= i.FromPortMax && validPort(i.ToPort)
}

func validPort(p int) bool { return p >= 1 && p <= 65535 }

// UDPHopRemoteModes reports whether a udphop mode list (comma separated, as
// stored on the mask) selects a remote mode (intervalremote/perconnremote).
// Only remote modes read remoteIPs/remotePorts in the kernel and therefore
// only they need NAT rules on the node; intervallocal rewrites just the
// client's outgoing port.
func UDPHopRemoteModes(mode string) bool {
	for _, m := range strings.Split(mode, ",") {
		switch strings.ToLower(strings.TrimSpace(m)) {
		case "intervalremote", "perconnremote":
			return true
		}
	}
	return false
}

// udphopPortTokens expands the stored remotePorts value to "port" /
// "min-max" tokens. The kernel parses remotePorts as a PortList (a number or a
// comma separated string of ranges); arrays of numbers/strings are accepted as
// a legacy shape the panel itself once wrote.
func udphopPortTokens(v any) []string {
	var out []string
	add := func(s string) {
		for _, part := range strings.Split(s, ",") {
			if part = strings.TrimSpace(part); part != "" {
				out = append(out, part)
			}
		}
	}
	switch t := v.(type) {
	case string:
		add(t)
	case float64:
		if t == float64(int(t)) {
			add(strconv.Itoa(int(t)))
		}
	case int:
		add(strconv.Itoa(t))
	case int64:
		add(strconv.Itoa(int(t)))
	case []any:
		for _, item := range t {
			switch it := item.(type) {
			case string:
				add(it)
			case float64:
				if it == float64(int(it)) {
					add(strconv.Itoa(int(it)))
				}
			}
		}
	}
	return out
}

// parsePortToken parses one "port" or "min-max" token into a range.
func parsePortToken(tok string) (min, max int, ok bool) {
	parts := strings.SplitN(strings.TrimSpace(tok), "-", 2)
	if len(parts) == 0 || parts[0] == "" {
		return 0, 0, false
	}
	min, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil || !validPort(min) {
		return 0, 0, false
	}
	max = min
	if len(parts) == 2 {
		max, err = strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil || !validPort(max) {
			return 0, 0, false
		}
	}
	return min, max, min <= max
}

// UDPHopNatIntentsForStream computes the NAT intents of one inbound from its
// stored streamSettings map (the raw database row, not the server view: the
// udphop mask is stripped from the Xray config by ServerView because the
// kernel is client-only there, but the intents must still be derived from it).
// Inbounds whose transport has no UDP side (SidesFor) carry no server-visible
// hopping, so they produce no intents. The result is sorted by
// (FromPortMin, FromPortMax, ToPort) and free of duplicates.
func UDPHopNatIntentsForStream(protocol string, stream map[string]any, inboundPort int) []UDPHopNatIntent {
	if !validPort(inboundPort) || stream == nil {
		return nil
	}
	fm, ok := stream["finalmask"].(map[string]any)
	if !ok || fm == nil {
		return nil
	}
	arr, ok := fm["udp"].([]any)
	if !ok {
		return nil
	}
	_, udpOK := SidesFor(protocol, StreamNetwork(stream), StreamALPN(stream))
	if !udpOK {
		return nil
	}
	var intents []UDPHopNatIntent
	for _, item := range arr {
		el, ok := item.(map[string]any)
		if !ok || typeOf(el) != "udphop" {
			continue
		}
		st := settingsOf(el)
		mode := strings.TrimSpace(strValue(firstNonNil(st["mode"], el["mode"])))
		if !UDPHopRemoteModes(mode) {
			continue
		}
		for _, tok := range udphopPortTokens(firstNonNil(st["remotePorts"], el["remotePorts"])) {
			min, max, ok := parsePortToken(tok)
			if !ok {
				continue
			}
			intents = append(intents, UDPHopNatIntent{FromPortMin: min, FromPortMax: max, ToPort: inboundPort})
		}
	}
	return SortAndDedupIntents(intents)
}

// SortAndDedupIntents sorts the slice by (min, max, toPort) and drops duplicates.
func SortAndDedupIntents(in []UDPHopNatIntent) []UDPHopNatIntent {
	if len(in) == 0 {
		return nil
	}
	sort.Slice(in, func(i, j int) bool {
		if in[i].FromPortMin != in[j].FromPortMin {
			return in[i].FromPortMin < in[j].FromPortMin
		}
		if in[i].FromPortMax != in[j].FromPortMax {
			return in[i].FromPortMax < in[j].FromPortMax
		}
		return in[i].ToPort < in[j].ToPort
	})
	out := in[:1]
	for _, cur := range in[1:] {
		last := out[len(out)-1]
		if cur == last {
			continue
		}
		out = append(out, cur)
	}
	return out
}

// String renders an intent for logs (operator-facing, never used for argv).
func (i UDPHopNatIntent) String() string {
	if i.FromPortMin == i.FromPortMax {
		return fmt.Sprintf("udp %d -> %d", i.FromPortMin, i.ToPort)
	}
	return fmt.Sprintf("udp %d-%d -> %d", i.FromPortMin, i.FromPortMax, i.ToPort)
}
