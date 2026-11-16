package service

import (
	"encoding/json"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/node/telemtweb"
	"github.com/konstpic/sharx-code/v2/util/finalmask"
)

// BuildWorkerSidecarPayloadsForNode builds Telemt, AmneziaWG, and Telemt-WEB-vhost payloads
// for worker apply-config. All slices are non-nil (empty means stop all sidecars/vhosts of
// that type on the worker).
func BuildWorkerSidecarPayloadsForNode(node *model.Node, ibs []*model.Inbound) ([]TelemtNodePayload, []AmneziaWGNodePayload, []telemtweb.Vhost, error) {
	telm, err := BuildTelemtPayloadsForNode(node, ibs)
	if err != nil {
		return nil, nil, nil, err
	}
	if telm == nil {
		telm = []TelemtNodePayload{}
	}
	awg, err := BuildAmneziaWgPayloadsForNode(node, ibs)
	if err != nil {
		return nil, nil, nil, err
	}
	if awg == nil {
		awg = []AmneziaWGNodePayload{}
	}
	webVhosts := BuildTelemtWebVhostsForNode(node, ibs)
	return telm, awg, webVhosts, nil
}

// BuildUDPHopNatIntentsForNode collects the desired udphop NAT rules of a
// worker node from its enabled inbounds (see finalmask.UDPHopNatIntentsForStream).
// The result is always non-nil so apply-config ships `[]` when nothing is
// wanted: the node agent treats that as "remove the stale rules" instead of
// "leave untouched".
//
// The intents are derived from the raw database rows, NOT from the built Xray
// config: ServerView strips the client-only udphop mask from the node config,
// but the port-hopping REDIRECT rules still have to exist on the host for the
// client's remote-mode hops to reach the inbound port.
func BuildUDPHopNatIntentsForNode(ibs []*model.Inbound) []finalmask.UDPHopNatIntent {
	var intents []finalmask.UDPHopNatIntent
	var listeners []udpNatListener
	for _, ib := range ibs {
		if ib == nil || !ib.Enable {
			continue
		}
		var stream map[string]any
		malformed := false
		if ib.StreamSettings != "" {
			malformed = json.Unmarshal([]byte(ib.StreamSettings), &stream) != nil
		}
		if malformed {
			logger.Debugf("udphopNat: inbound %d (%s): malformed streamSettings, skipped", ib.Id, ib.Tag)
		}
		protocol := string(model.NormalizeProtocol(ib.Protocol))
		if !malformed {
			intents = append(intents, finalmask.UDPHopNatIntentsForStream(protocol, stream, ib.Port)...)
		}
		// The udphop REDIRECT sits in nat PREROUTING for UDP: any enabled UDP
		// listener on this node is a potential victim of a range that covers
		// its port, so conflicts are resolved before shipping the list.
		// Protocol-owned listeners (including AmneziaWG, which cannot carry
		// finalmask) exist without streamSettings. A malformed row may also
		// still have an active listener from the last successful config.
		if _, udpOK := finalmask.SidesFor(protocol, finalmask.StreamNetwork(stream), finalmask.StreamALPN(stream)); udpOK || protocol == "amneziawg" || malformed {
			listeners = append(listeners, udpNatListener{port: ib.Port, tag: ib.Tag})
		}
	}
	intents = finalmask.SortAndDedupIntents(intents)
	intents = pruneConflictingNatIntents(intents, listeners)
	if intents == nil {
		intents = []finalmask.UDPHopNatIntent{}
	}
	if len(intents) > 0 {
		logger.Debugf("udphopNat: %d intent(s) for node inbounds", len(intents))
	}
	return intents
}

// udpNatListener is one enabled UDP listener of the node (an inbound port that
// a REDIRECT range could capture).
type udpNatListener struct {
	port int
	tag  string
}

// pruneConflictingNatIntents drops intents the node cannot honour safely:
//
//  1. a range that covers the UDP port of another inbound on the same node
//     (the REDIRECT in nat PREROUTING would steal that inbound's traffic);
//  2. a range that overlaps another range redirecting to a different port
//     (the first rule in the chain wins, the other hopping silently dies).
//
// The operator sees an error in the panel log; the surviving rule set is
// always self-consistent so a misconfigured range cannot take down another
// inbound. The preferred place to catch both cases is the inbound save
// (ValidateHysteriaMultiPortOnNodes / AssignInboundToNodesWithBindings);
// this function is the last-resort safety net for rows that bypassed it.
func pruneConflictingNatIntents(intents []finalmask.UDPHopNatIntent, listeners []udpNatListener) []finalmask.UDPHopNatIntent {
	if len(intents) == 0 {
		return intents
	}
	out := make([]finalmask.UDPHopNatIntent, 0, len(intents))
	for _, in := range intents {
		conflict := false
		for _, l := range listeners {
			if l.port == in.ToPort {
				continue // the inbound's own listener
			}
			if l.port >= in.FromPortMin && l.port <= in.FromPortMax {
				logger.Errorf("udphopNat: dropping %s: it covers UDP port %d of inbound %q on the same node; "+
					"the REDIRECT would steal that inbound's traffic — make the range disjoint",
					in.String(), l.port, l.tag)
				conflict = true
				break
			}
		}
		if conflict {
			continue
		}
		for _, kept := range out {
			if kept.ToPort == in.ToPort {
				continue
			}
			if in.FromPortMin == kept.FromPortMin && in.FromPortMax == kept.FromPortMax {
				// Identical ranges on different listeners are a pre-existing,
				// operator-visible duplicate: keep the legacy behaviour and warn.
				logger.Warningf("udphopNat: ranges %s and %s are identical but redirect to different ports (%d vs %d); "+
					"the first rule wins and the other inbound's hopping is dropped — make the ranges disjoint",
					in.String(), kept.String(), in.ToPort, kept.ToPort)
				continue
			}
			if in.FromPortMin <= kept.FromPortMax && kept.FromPortMin <= in.FromPortMax {
				logger.Errorf("udphopNat: dropping %s: it partially overlaps %s on the same node; "+
					"the first REDIRECT rule wins — make the ranges disjoint",
					in.String(), kept.String())
				conflict = true
				break
			}
		}
		if !conflict {
			out = append(out, in)
		}
	}
	if len(out) == 0 {
		// Keep the always-list contract (non-nil slice => `[]` removes stale rules).
		return intents[:0]
	}
	return out
}
