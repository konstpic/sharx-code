package service

import (
	"sort"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
)

// NodeIDsForInboundIDs returns unique enabled worker node IDs assigned to any of the given inbounds.
func (s *XrayService) NodeIDsForInboundIDs(inboundIDs []int) ([]int, error) {
	if len(inboundIDs) == 0 {
		return nil, nil
	}
	if s.nodeService == (NodeService{}) {
		s.nodeService = NodeService{}
	}
	var lists [][]int
	for _, inboundID := range inboundIDs {
		if inboundID <= 0 {
			continue
		}
		nodes, err := s.nodeService.GetNodesForInbound(inboundID)
		if err != nil {
			return nil, err
		}
		if len(nodes) == 0 {
			continue
		}
		ids := make([]int, 0, len(nodes))
		for _, n := range nodes {
			if n != nil && n.Enable {
				ids = append(ids, n.Id)
			}
		}
		lists = append(lists, ids)
	}
	return MergeUniquePositiveInts(lists...), nil
}

// RestartOrSyncWorkersForInboundsAsync syncs worker Xray for specific inbounds in multi-node mode,
// or restarts local Xray in single-node mode. Falls back to full worker sync when no inbound IDs given.
func (s *XrayService) RestartOrSyncWorkersForInboundsAsync(inboundIDs []int) {
	inboundIDs = MergeUniquePositiveInts(inboundIDs)
	if len(inboundIDs) > 0 {
		s.SyncWorkerXrayForInboundsAsync(inboundIDs)
		return
	}
	s.RestartXrayAsync(false)
}

func (s *XrayService) ApplyWorkerConfigToNodeIDsAsync(nodeIDs []int) {
	go func() {
		if err := s.ApplyWorkerConfigToNodeIDs(nodeIDs); err != nil {
			logger.Warningf("ApplyWorkerConfigToNodeIDsAsync: %v", err)
		}
	}()
}

// SyncWorkerXrayForInboundsAsync pushes worker Xray config only to nodes hosting the given inbounds.
// In single-node mode falls back to RestartXray.
func (s *XrayService) SyncWorkerXrayForInboundsAsync(inboundIDs []int) {
	go func() {
		if err := s.syncWorkerXrayForInbounds(inboundIDs); err != nil {
			logger.Warningf("SyncWorkerXrayForInbounds: %v", err)
		}
	}()
}

func (s *XrayService) syncWorkerXrayForInbounds(inboundIDs []int) error {
	if s.settingService == (SettingService{}) {
		s.settingService = SettingService{}
	}
	multiMode, err := s.settingService.GetMultiNodeMode()
	if err != nil {
		multiMode = false
	}
	if !multiMode {
		return s.RestartXray(false)
	}
	nodeIDs, err := s.NodeIDsForInboundIDs(inboundIDs)
	if err != nil {
		return err
	}
	if len(nodeIDs) == 0 {
		return nil
	}
	return s.applyWorkerConfigToNodeIDsMulti(nodeIDs)
}

func sortInboundsForWorkerConfig(inbounds []*model.Inbound) {
	sort.Slice(inbounds, func(i, j int) bool {
		if inbounds[i] == nil {
			return false
		}
		if inbounds[j] == nil {
			return true
		}
		if inbounds[i].Tag != inbounds[j].Tag {
			return inbounds[i].Tag < inbounds[j].Tag
		}
		return inbounds[i].Id < inbounds[j].Id
	})
}
