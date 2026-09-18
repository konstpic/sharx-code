package service

import (
	"fmt"
	"sync"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
)

// SyncWorkerSidecarsAsync applies Telemt / AmneziaWG sidecars without restarting or re-pushing Xray.
// Optional nodeIDs limits the push (multi-node); when empty, all workers that normally receive config are updated.
func (s *XrayService) SyncWorkerSidecarsAsync(nodeIDs ...int) {
	ids := append([]int(nil), nodeIDs...)
	go func() {
		if err := s.syncWorkerSidecars(ids); err != nil {
			logger.Warningf("sync worker sidecars: %v", err)
		}
	}()
}

func (s *XrayService) syncWorkerSidecars(nodeIDs []int) error {
	multiMode, err := s.settingService.GetMultiNodeMode()
	if err != nil {
		multiMode = false
	}
	if !multiMode {
		TryApplyLocalTelemtStandalone(s)
		TryApplyLocalAmneziaWgStandalone(s)
		return nil
	}
	if len(nodeIDs) == 0 {
		nodeIDs, err = s.multiWorkerNodeIDsNeedingPush()
		if err != nil {
			return err
		}
	}
	return s.applySidecarsToNodeIDsMulti(nodeIDs)
}

func (s *XrayService) applySidecarsToNodeIDsMulti(nodeIDs []int) error {
	nodeIDs = MergeUniquePositiveInts(nodeIDs)
	if len(nodeIDs) == 0 {
		return nil
	}

	var nodes []*model.Node
	for _, nid := range nodeIDs {
		node, err := s.nodeService.GetNode(nid)
		if err != nil {
			logger.Warningf("applySidecarsToNodeIDsMulti: skip node %d: %v", nid, err)
			continue
		}
		if !node.Enable {
			continue
		}
		nodes = append(nodes, node)
	}

	attempted := len(nodes)
	if attempted == 0 {
		return nil
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	var errors []error

	for _, node := range nodes {
		n := node
		wg.Add(1)
		go func() {
			defer wg.Done()
			ibs, _ := s.InboundsForWorkerNode(n)
			telm, awg, webv, terr := BuildWorkerSidecarPayloadsForNode(n, ibs)
			if terr != nil {
				logger.Warningf("[Node: %s] Sidecar payload build: %v", n.Name, terr)
			}
			tPtr, aPtr, wPtr := &telm, &awg, &webv
			if err := s.nodeService.ApplySidecarsToNode(n, tPtr, aPtr, wPtr); err != nil {
				logger.Errorf("[Node: %s] Failed to apply sidecars: %v", n.Name, err)
				mu.Lock()
				errors = append(errors, fmt.Errorf("node %s: %w", n.Name, err))
				mu.Unlock()
			} else {
				logger.Infof("[Node: %s] Sidecars synced (Xray untouched)", n.Name)
			}
		}()
	}

	wg.Wait()

	if len(errors) > 0 {
		logger.Warningf("Failed to apply sidecars to %d node(s) out of %d", len(errors), attempted)
		for _, err := range errors {
			logger.Warningf("  - %v", err)
		}
		if len(errors) == attempted {
			return fmt.Errorf("failed to apply sidecars to all targeted nodes: %d errors", len(errors))
		}
	}
	return nil
}
