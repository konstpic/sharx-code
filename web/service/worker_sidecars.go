package service

import (
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/node/telemtweb"
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
