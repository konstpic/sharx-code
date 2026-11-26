// Package job provides background job implementations for the SharX panel.
package job

import (
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/websocket"
)

const minClientTrafficMatrixWSInterval = 1 * time.Second

var (
	clientMatrixWSMu     sync.Mutex
	lastClientMatrixWSAt = map[int]time.Time{}
)

// CollectNodeStatsJob collects traffic and online clients statistics from all nodes.
type CollectNodeStatsJob struct {
	nodeService     service.NodeService
	runMu           sync.Mutex
	statsThrottleMu sync.Mutex
	lastStatsRunAt  time.Time
}

// NewCollectNodeStatsJob creates a new CollectNodeStatsJob instance.
func NewCollectNodeStatsJob() *CollectNodeStatsJob {
	return &CollectNodeStatsJob{
		nodeService: service.NodeService{},
	}
}

// Run executes the job to collect statistics from all nodes.
func (j *CollectNodeStatsJob) Run() {
	settingService := service.SettingService{}
	intervalSec, err := settingService.GetNodeStatsCollectionIntervalSec()
	if err != nil || intervalSec < 1 {
		intervalSec = 3
	}
	minD := time.Duration(intervalSec) * time.Second
	j.statsThrottleMu.Lock()
	if !j.lastStatsRunAt.IsZero() && time.Since(j.lastStatsRunAt) < minD {
		j.statsThrottleMu.Unlock()
		return
	}
	j.statsThrottleMu.Unlock()

	if !j.runMu.TryLock() {
		logger.Debug("CollectNodeStatsJob: skip tick, previous run still in progress")
		return
	}
	defer j.runMu.Unlock()

	defer func() {
		j.statsThrottleMu.Lock()
		j.lastStatsRunAt = time.Now()
		j.statsThrottleMu.Unlock()
	}()

	logger.Debug("Starting node stats collection job")

	if err := j.nodeService.CollectNodeStats(); err != nil {
		logger.Errorf("Failed to collect node stats: %v", err)
		return
	}

	// Broadcast updated nodes list via WebSocket for real-time updates
	// Enrich nodes with inbounds and profiles (same as in NodeController)
	nodes, err := j.nodeService.GetAllNodes()
	if err == nil && nodes != nil {
		// Enrich nodes with assigned inbounds and profiles information
		// Use the same structure as NodeController.broadcastNodesUpdate()
		type NodeWithInbounds struct {
			*model.Node
			Inbounds    []*model.Inbound               `json:"inbounds,omitempty"`
			Profiles    []*model.XrayCoreConfigProfile `json:"profiles,omitempty"`
			XrayVersion string                         `json:"xrayVersion,omitempty"`
		}

		profileService := service.XrayCoreConfigProfileService{}
		result := make([]NodeWithInbounds, 0, len(nodes))
		for _, node := range nodes {
			inbounds, _ := j.nodeService.GetInboundsForNode(node.Id)
			profiles, _ := profileService.GetProfilesForNode(node.Id)
			result = append(result, NodeWithInbounds{
				Node:        node,
				Inbounds:    inbounds,
				Profiles:    profiles,
				XrayVersion: node.XrayVersion,
			})
		}
		websocket.BroadcastNodes(result)
	} else if err != nil {
		logger.Warningf("Failed to get nodes for WebSocket broadcast: %v", err)
	}

	// Per-user client×node traffic matrix for statistics UI (only if someone is connected; ~1s per user; heavy in multi-node).
	if h := websocket.GetHub(); h != nil {
		now := time.Now()
		var snapshot *service.ClientTrafficSnapshot
		for _, uid := range h.ConnectedUserIds() {
			clientMatrixWSMu.Lock()
			if t, ok := lastClientMatrixWSAt[uid]; ok && now.Sub(t) < minClientTrafficMatrixWSInterval {
				clientMatrixWSMu.Unlock()
				continue
			}
			lastClientMatrixWSAt[uid] = time.Now()
			clientMatrixWSMu.Unlock()

			if snapshot == nil {
				var err error
				snapshot, err = j.nodeService.ClientTrafficSnapshot()
				if err != nil {
					logger.Debugf("client traffic snapshot: %v", err)
					break
				}
			}
			mat, mErr := snapshot.ForUser(uid)
			if mErr != nil || mat == nil {
				if mErr != nil {
					logger.Debugf("client traffic matrix for WS (user %d): %v", uid, mErr)
				}
				continue
			}
			websocket.BroadcastClientTrafficPerNode(uid, mat)
		}
	}

	logger.Debug("Node stats collection job completed successfully")
}
