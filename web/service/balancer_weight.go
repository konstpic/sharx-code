package service

import (
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"gorm.io/gorm"
)

// Auto-weight balancing: a pool with weightMode "load" or "ping" has its members' weights
// recomputed periodically instead of the admin setting them by hand.
//
//   - "load": weight follows the node's reported uplink throughput (hostNetBps from GET
//     /api/v1/status, panel-polled into ServerService's net-load cache) against the node's
//     admin-set BandwidthMbps. Higher load -> lower weight. A node with BandwidthMbps unset (0),
//     or no recent sample, falls back to a neutral weight of 1 rather than being excluded, so an
//     unmonitored node still gets some traffic instead of none.
//   - "ping": weight follows the TCP-connect latency the balancer agent itself measured to the
//     node (RTTMs on the live AgentStatus, see BalancerService.LiveStatus). Lower latency -> higher
//     weight. A member the agent reports down, or never reported, falls back to weight 1.
//
// Recomputed weights are written to balancer_pool_members and, for a balancer that had at least
// one weight change, pushed to the agent via BalancerService.Apply.

const (
	autoWeightMin = 1
	autoWeightMax = 100
	// weightFallback is used when a member's load/ping cannot be determined right now.
	weightFallback = 1
)

var (
	weightRecomputeMu   sync.Mutex
	lastWeightRecompute time.Time
)

// RecomputeAutoWeightsIfDue runs RecomputeAutoWeights at most once per the admin-configured
// interval (settings key balancerWeightIntervalSecs, default 30s). Intended to be polled from a
// short cron tick (see web/web.go) so a changed interval takes effect without a restart.
func (s *BalancerService) RecomputeAutoWeightsIfDue() {
	interval, _ := (&SettingService{}).GetBalancerWeightIntervalSecs()
	weightRecomputeMu.Lock()
	due := time.Since(lastWeightRecompute) >= time.Duration(interval)*time.Second
	if due {
		lastWeightRecompute = time.Now()
	}
	weightRecomputeMu.Unlock()
	if !due {
		return
	}
	s.RecomputeAutoWeights()
}

// RecomputeAutoWeights recomputes and stores member weights for every enabled pool whose
// weightMode is "load" or "ping", then pushes updated balancers to their agents.
func (s *BalancerService) RecomputeAutoWeights() {
	db := database.GetDB()
	var pools []model.BalancerPool
	if err := db.Where("enable = ? AND weight_mode IN ?", true, []string{"load", "ping"}).Find(&pools).Error; err != nil {
		logger.Warningf("balancer auto-weight: list pools: %v", err)
		return
	}
	if len(pools) == 0 {
		return
	}
	nodeSvc := &NodeService{}
	serverSvc := &ServerService{}
	changedBalancers := map[int]bool{}
	for i := range pools {
		p := &pools[i]
		var ib model.Inbound
		if err := db.Select("id, remark, protocol, port, stream_settings").First(&ib, p.InboundId).Error; err != nil {
			continue
		}
		p.InboundRemark, p.InboundProtocol, p.InboundPort = ib.Remark, string(ib.Protocol), ib.Port
		p.Transport = PoolTransport(ib.Protocol, ib.StreamSettings)
		members, err := s.effectiveMembers(p, nodeSvc)
		if err != nil || len(members) == 0 {
			continue
		}
		var liveStatus *AgentStatus
		if p.WeightMode == "ping" {
			liveStatus = s.LiveStatus(p.BalancerId)
		}
		for _, m := range members {
			if !m.Enable || m.NodeStatus == "disabled" {
				continue
			}
			var weight int
			switch p.WeightMode {
			case "load":
				weight = loadWeight(serverSvc, nodeSvc, m.NodeId)
			case "ping":
				weight = pingWeight(liveStatus, p.Id, m)
			default:
				continue
			}
			if upsertPoolMemberWeight(db, p.Id, m.NodeId, weight) {
				changedBalancers[p.BalancerId] = true
			}
		}
	}
	for balancerId := range changedBalancers {
		if err := s.Apply(balancerId); err != nil {
			logger.Warningf("balancer auto-weight: apply balancer %d: %v", balancerId, err)
		}
	}
}

// loadWeight turns a node's current throughput vs its admin-set bandwidth into a weight: less
// headroom means a lower weight. Falls back to weightFallback when the bandwidth isn't configured
// or no recent sample exists, so the node keeps getting some traffic rather than none.
func loadWeight(serverSvc *ServerService, nodeSvc *NodeService, nodeId int) int {
	n, err := nodeSvc.GetNode(nodeId)
	if err != nil || n == nil || n.BandwidthMbps <= 0 {
		return weightFallback
	}
	bps, ok := serverSvc.LatestNodeNetBps(nodeId)
	if !ok {
		return weightFallback
	}
	capacityBps := float64(n.BandwidthMbps) * 1_000_000 / 8
	if capacityBps <= 0 {
		return weightFallback
	}
	loadPct := bps / capacityBps * 100
	weight := int(100 - loadPct + 0.5)
	return clampWeight(weight)
}

// pingWeight turns the balancer-to-node TCP connect latency the agent last reported into a
// weight: lower latency means a higher weight. Falls back to weightFallback when the agent hasn't
// reported this member yet, reports it down, or never measured a latency for it.
func pingWeight(live *AgentStatus, poolId int, m model.BalancerPoolMember) int {
	if live == nil {
		return weightFallback
	}
	host := balancerHostOnly(m.AddressOverride)
	if host == "" {
		host = balancerHostOnly(m.NodeAddr)
	}
	port := m.PortOverride
	for _, ps := range live.Pools {
		if ps.ID != poolId {
			continue
		}
		for _, ms := range ps.Members {
			if ms.Host != host || (port != 0 && ms.Port != port) {
				continue
			}
			if ms.Up == nil || !*ms.Up || ms.RTTMs == nil || *ms.RTTMs <= 0 {
				return weightFallback
			}
			return clampWeight(int(1000 / *ms.RTTMs))
		}
	}
	return weightFallback
}

func clampWeight(w int) int {
	if w < autoWeightMin {
		return autoWeightMin
	}
	if w > autoWeightMax {
		return autoWeightMax
	}
	return w
}

// upsertPoolMemberWeight writes a member's weight, creating its override row if the pool relies on
// auto_members and this node has no row yet. Returns whether the stored weight actually changed.
func upsertPoolMemberWeight(db *gorm.DB, poolId, nodeId, weight int) bool {
	var row model.BalancerPoolMember
	err := db.Where("pool_id = ? AND node_id = ?", poolId, nodeId).First(&row).Error
	if err != nil {
		row = model.BalancerPoolMember{PoolId: poolId, NodeId: nodeId, Weight: weight, Enable: true}
		if err := db.Create(&row).Error; err != nil {
			logger.Warningf("balancer auto-weight: create member row (pool %d, node %d): %v", poolId, nodeId, err)
			return false
		}
		return true
	}
	if row.Weight == weight {
		return false
	}
	if err := db.Model(&model.BalancerPoolMember{}).Where("id = ?", row.Id).Update("weight", weight).Error; err != nil {
		logger.Warningf("balancer auto-weight: update member row %d: %v", row.Id, err)
		return false
	}
	return true
}
