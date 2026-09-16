package service

import (
	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
)

// SyncTelemtAfterClientSessionBlocksChanged reapplies Telemt TOML so [access.user_source_deny]
// reflects client_blocked_session_ips (requires Telemt build with user_source_deny support).
func SyncTelemtAfterClientSessionBlocksChanged(clientId int) {
	if clientId <= 0 {
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Warningf("SyncTelemtAfterClientSessionBlocksChanged panic: %v", r)
			}
		}()
		ss := SettingService{}
		multi, _ := ss.GetMultiNodeMode()
		xs := XrayService{}
		if !multi {
			TryApplyLocalTelemtStandalone(&xs)
			return
		}
		cs := ClientService{}
		inboundIds, err := cs.GetInboundIdsForClient(clientId)
		if err != nil || len(inboundIds) == 0 {
			return
		}
		db := database.GetDB()
		ns := NodeService{}
		doneNode := make(map[int]struct{})
		for _, iid := range inboundIds {
			var ib model.Inbound
			if err := db.Select("id", "protocol").First(&ib, iid).Error; err != nil {
				continue
			}
			if model.NormalizeProtocol(ib.Protocol) != model.Telemt {
				continue
			}
			nodes, err := ns.GetNodesForInbound(iid)
			if err != nil {
				continue
			}
			for _, node := range nodes {
				if node == nil || !node.Enable {
					continue
				}
				if _, ok := doneNode[node.Id]; ok {
					continue
				}
				doneNode[node.Id] = struct{}{}
				ibs, err := xs.InboundsForWorkerNode(node)
				if err != nil {
					continue
				}
				cfgJSON, coreH, err := xs.BuildWorkerXrayConfigForNodeWithMeta(node)
				if err != nil {
					logger.Warningf("telemt session sync: build xray for node %s: %v", node.Name, err)
					continue
				}
				telm, awg, webv, err := BuildWorkerSidecarPayloadsForNode(node, ibs)
				if err != nil {
					logger.Warningf("telemt session sync: build sidecars for node %s: %v", node.Name, err)
					continue
				}
				meta := NewApplyWorkerConfigMeta(cfgJSON, coreH)
				if err := ns.ApplyConfigToNode(node, cfgJSON, &telm, &awg, &webv, meta); err != nil {
					logger.Warningf("telemt session sync: apply node %s: %v", node.Name, err)
				}
			}
		}
	}()
}
