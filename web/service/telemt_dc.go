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

	// Optional extras (additive). LatencyMs is how long collecting this source took, FetchedAt the
	// unix time of the last successful collection, Stale marks last-known data shown because
	// the live fetch failed (Error then says why).
	LatencyMs int64 `json:"latencyMs,omitempty"`
	FetchedAt int64 `json:"fetchedAt,omitempty"`
	Stale     bool  `json:"stale,omitempty"`
}

const (
	// telemtDCNodeTimeout bounds one worker-node fetch so a slow node cannot stall the widget.
	telemtDCNodeTimeout = 8 * time.Second
	// telemtDCCacheTTL collapses concurrent dashboards / polls into one fan-out to the nodes.
	telemtDCCacheTTL = 4 * time.Second
	// telemtDCStaleMax is how long last-known node data may be served when a node stops answering.
	telemtDCStaleMax = 10 * time.Minute
)

var telemtDCState struct {
	mu   sync.Mutex // held for the whole fan-out so concurrent callers share one collection
	at   time.Time
	data []TelemtDCSource
}

var telemtDCLast struct {
	mu sync.Mutex
	ok map[int]TelemtDCSource // last successful source per node id
}

// applyStale keeps the last known instances of a node whose live fetch failed, flagged Stale,
// so one flaky node does not blank the whole widget. prev may be a zero value (no history).
func applyStale(fresh TelemtDCSource, prev TelemtDCSource, hasPrev bool, now time.Time) TelemtDCSource {
	if fresh.Error == "" || !hasPrev || len(prev.Instances) == 0 {
		return fresh
	}
	if now.Sub(time.Unix(prev.FetchedAt, 0)) > telemtDCStaleMax {
		return fresh
	}
	fresh.Instances = prev.Instances
	fresh.FetchedAt = prev.FetchedAt
	fresh.Stale = true
	return fresh
}

// FetchTelemtDCStatusFromNode calls GET /api/v1/telemt-dc-status on a worker node.
func (s *NodeService) FetchTelemtDCStatusFromNode(node *model.Node) ([]telemt.InstanceDCStatus, error) {
	u := fmt.Sprintf("%s/api/v1/telemt-dc-status", nodeRequestBaseURL(node))
	ctx, cancel := context.WithTimeout(context.Background(), telemtDCNodeTimeout)
	defer cancel()
	client, err := s.createHTTPClient(node, telemtDCNodeTimeout)
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
	telemtDCState.mu.Lock()
	defer telemtDCState.mu.Unlock()
	if telemtDCState.data != nil && time.Since(telemtDCState.at) < telemtDCCacheTTL {
		return telemtDCState.data, nil
	}
	out, err := collectTelemtDCStatusUncached()
	if err == nil {
		telemtDCState.at, telemtDCState.data = time.Now(), out
	}
	return out, err
}

func collectTelemtDCStatusUncached() ([]TelemtDCSource, error) {
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
		return []TelemtDCSource{{Kind: "panel", Name: "panel", Instances: enrich(inst), FetchedAt: time.Now().Unix()}}, nil
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
			t0 := time.Now()
			inst, err := ns.FetchTelemtDCStatusFromNode(n)
			src.LatencyMs = time.Since(t0).Milliseconds()
			if err != nil {
				logger.Debugf("telemt dc status: node %s: %v", n.Name, err)
				src.Error = err.Error()
				telemtDCLast.mu.Lock()
				prev, ok := telemtDCLast.ok[n.Id]
				telemtDCLast.mu.Unlock()
				*src = applyStale(*src, prev, ok, time.Now())
			} else {
				src.Instances = enrich(inst)
				src.FetchedAt = time.Now().Unix()
				telemtDCLast.mu.Lock()
				if telemtDCLast.ok == nil {
					telemtDCLast.ok = map[int]TelemtDCSource{}
				}
				telemtDCLast.ok[n.Id] = *src
				telemtDCLast.mu.Unlock()
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
