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
	for _, ib := range ibs {
		if ib == nil || !ib.Enable || ib.StreamSettings == "" {
			continue
		}
		var stream map[string]any
		if err := json.Unmarshal([]byte(ib.StreamSettings), &stream); err != nil || stream == nil {
			continue
		}
		intents = append(intents, finalmask.UDPHopNatIntentsForStream(
			string(model.NormalizeProtocol(ib.Protocol)), stream, ib.Port)...)
	}
	intents = finalmask.SortAndDedupIntents(intents)
	if intents == nil {
		intents = []finalmask.UDPHopNatIntent{}
	}
	if len(intents) > 0 {
		logger.Debugf("udphopNat: %d intent(s) for node inbounds", len(intents))
	}
	return intents
}
