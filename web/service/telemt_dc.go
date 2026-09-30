package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/node/telemt"
)

// TelemtDCInstance is one Telemt inbound's Telegram-DC picture, enriched with the inbound label.
type TelemtDCInstance struct {
	telemt.InstanceDCStatus
	Remark string `json:"remark"`
	Port   int    `json:"port"`
}

// TelemtDCSource groups instances by where they run (the panel host itself or a worker node).
type TelemtDCSource struct {
	Kind      string             `json:"kind"` // "panel" | "node"
	NodeId    int                `json:"nodeId"`
	Name      string             `json:"name"`
	Error     string             `json:"error,omitempty"`
	Instances []TelemtDCInstance `json:"instances"`
}

// FetchTelemtDCStatusFromNode calls GET /api/v1/telemt-dc-status on a worker node.
func (s *NodeService) FetchTelemtDCStatusFromNode(node *model.Node) ([]telemt.InstanceDCStatus, error) {
	u := fmt.Sprintf("%s/api/v1/telemt-dc-status", nodeRequestBaseURL(node))
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	client, err := s.createHTTPClient(node, 12*time.Second)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	if err := s.setNodeAuthHeader(node, req); err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("node agent is too old (update the node to see DC status)")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("node returned %d", resp.StatusCode)
	}
	var out struct {
		Instances []telemt.InstanceDCStatus `json:"instances"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("decode telemt-dc-status: %w", err)
	}
	return out.Instances, nil
}

// CollectTelemtDCStatus gathers Telegram DC availability from the panel-local Telemt processes
// (standalone mode) and from every enabled worker node (multi-node mode).
func CollectTelemtDCStatus() ([]TelemtDCSource, error) {
	ss := SettingService{}
	multi, _ := ss.GetMultiNodeMode()

	labels := map[int]TelemtDCInstance{}
	var ibs []model.Inbound
	if err := database.GetDB().Select("id", "remark", "port", "protocol").Find(&ibs).Error; err == nil {
		for _, ib := range ibs {
			if model.NormalizeProtocol(ib.Protocol) == model.Telemt {
				labels[ib.Id] = TelemtDCInstance{Remark: ib.Remark, Port: ib.Port}
			}
		}
	}
	enrich := func(in []telemt.InstanceDCStatus) []TelemtDCInstance {
		out := make([]TelemtDCInstance, 0, len(in))
		for _, i := range in {
			l := labels[i.InboundId]
			l.InstanceDCStatus = i
			if l.Remark == "" {
				l.Remark = i.Tag
			}
			out = append(out, l)
		}
		sort.Slice(out, func(a, b int) bool { return out[a].Remark < out[b].Remark })
		return out
	}

	if !multi {
		inst := getPanelTelemt().CollectDCStatus()
		if len(inst) == 0 {
			return []TelemtDCSource{}, nil
		}
		return []TelemtDCSource{{Kind: "panel", Name: "panel", Instances: enrich(inst)}}, nil
	}

	ns := NodeService{}
	nodes, err := ns.GetAllNodes()
	if err != nil {
		return nil, err
	}
	res := make([]*TelemtDCSource, len(nodes))
	var wg sync.WaitGroup
	for i, n := range nodes {
		if n == nil || !n.Enable {
			continue
		}
		wg.Add(1)
		go func(i int, n *model.Node) {
			defer wg.Done()
			src := &TelemtDCSource{Kind: "node", NodeId: n.Id, Name: n.Name, Instances: []TelemtDCInstance{}}
			inst, err := ns.FetchTelemtDCStatusFromNode(n)
			if err != nil {
				logger.Debugf("telemt dc status: node %s: %v", n.Name, err)
				src.Error = err.Error()
			} else {
				src.Instances = enrich(inst)
			}
			// Nodes without Telemt (and reachable) are not interesting; unreachable ones are
			// only reported if they are known to host a Telemt inbound — keep the error row.
			if err == nil && len(src.Instances) == 0 {
				return
			}
			res[i] = src
		}(i, n)
	}
	wg.Wait()
	out := make([]TelemtDCSource, 0, len(res))
	for _, r := range res {
		if r != nil {
			out = append(out, *r)
		}
	}
	return out, nil
}
