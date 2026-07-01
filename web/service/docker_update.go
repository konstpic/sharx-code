package service

import (
	"context"
	"fmt"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
)

// DockerUpdatePlanNode is a worker row shown in the panel update progress UI.
type DockerUpdatePlanNode struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Enable bool   `json:"enable"`
}

// DockerUpdatePlan describes which targets participate in a Docker sidecar update.
type DockerUpdatePlan struct {
	MultiNode bool                   `json:"multiNode"`
	Nodes     []DockerUpdatePlanNode `json:"nodes"`
}

// DockerUpdateNodeResult is the outcome of triggering a single worker's Docker updater.
type DockerUpdateNodeResult struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	OK      bool   `json:"ok"`
	Skipped bool   `json:"skipped,omitempty"`
	Error   string `json:"error,omitempty"`
}

// GetDockerUpdatePlan returns panel/worker targets for the update progress UI.
func GetDockerUpdatePlan() (DockerUpdatePlan, error) {
	settingSvc := SettingService{}
	multi, err := settingSvc.GetMultiNodeMode()
	if err != nil {
		multi = false
	}
	plan := DockerUpdatePlan{MultiNode: multi, Nodes: nil}
	if !multi {
		return plan, nil
	}
	nodeSvc := NodeService{}
	nodes, err := nodeSvc.GetAllNodes()
	if err != nil {
		return plan, err
	}
	for _, node := range nodes {
		if node == nil {
			continue
		}
		plan.Nodes = append(plan.Nodes, DockerUpdatePlanNode{
			ID:     node.Id,
			Name:   node.Name,
			Enable: node.Enable,
		})
	}
	return plan, nil
}

// PrepWorkersForDockerUpdate pushes Xray config before worker containers restart.
func PrepWorkersForDockerUpdate() error {
	settingSvc := SettingService{}
	multi, err := settingSvc.GetMultiNodeMode()
	if err != nil || !multi {
		return nil
	}
	xraySvc := NewXrayService()
	return xraySvc.ApplyWorkerXrayConfigToAllMultiWorkerNodes()
}

// TriggerWorkersDockerUpdate asks every enabled worker to pull/recreate via its Docker sidecar.
func TriggerWorkersDockerUpdate(ctx context.Context) []DockerUpdateNodeResult {
	settingSvc := SettingService{}
	multi, err := settingSvc.GetMultiNodeMode()
	if err != nil || !multi {
		return nil
	}
	nodeSvc := NodeService{}
	nodes, err := nodeSvc.GetAllNodes()
	if err != nil {
		return []DockerUpdateNodeResult{{
			ID:    0,
			Name:  "workers",
			OK:    false,
			Error: fmt.Sprintf("list nodes: %v", err),
		}}
	}
	out := make([]DockerUpdateNodeResult, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}
		if !node.Enable {
			out = append(out, DockerUpdateNodeResult{
				ID:      node.Id,
				Name:    node.Name,
				OK:      true,
				Skipped: true,
			})
			continue
		}
		res := DockerUpdateNodeResult{ID: node.Id, Name: node.Name}
		if err := nodeSvc.TriggerDockerUpdaterOnNode(ctx, node); err != nil {
			logger.Warningf("[Node: %s] docker-updater trigger: %v", node.Name, err)
			res.Error = err.Error()
		} else {
			res.OK = true
		}
		out = append(out, res)
	}
	return out
}

// FinishWorkersForDockerUpdate pushes Xray config after workers have restarted.
func FinishWorkersForDockerUpdate() error {
	settingSvc := SettingService{}
	multi, err := settingSvc.GetMultiNodeMode()
	if err != nil || !multi {
		return nil
	}
	xraySvc := NewXrayService()
	return xraySvc.ApplyWorkerXrayConfigToAllMultiWorkerNodes()
}

// TriggerPanelDockerUpdate recreates the panel container via the configured Docker sidecar.
func TriggerPanelDockerUpdate(ctx context.Context) error {
	return TriggerDockerUpdater(ctx)
}

// OrchestratePanelDockerUpdate updates worker nodes first, pushes Xray config, then triggers the
// panel's own Docker sidecar (Watchtower). The panel container must be recreated last — otherwise
// the HTTP handler dies before remote workers receive config.
func OrchestratePanelDockerUpdate(ctx context.Context) ([]string, error) {
	plan, err := GetDockerUpdatePlan()
	if err != nil {
		return nil, err
	}

	var nodeErrs []string
	if plan.MultiNode {
		if err := PrepWorkersForDockerUpdate(); err != nil {
			logger.Warningf("Docker update: pre-update config push: %v", err)
		}

		for _, res := range TriggerWorkersDockerUpdate(ctx) {
			if res.Skipped {
				continue
			}
			if !res.OK {
				nodeErrs = append(nodeErrs, fmt.Sprintf("%s: %s", res.Name, res.Error))
			}
		}

		select {
		case <-ctx.Done():
			return nodeErrs, ctx.Err()
		case <-time.After(5 * time.Second):
		}

		nodeSvc := NodeService{}
		if err := nodeSvc.WaitForEnabledNodesOnline(ctx, 3*time.Second); err != nil {
			logger.Warningf("Docker update: waiting for workers online: %v", err)
		}

		if err := FinishWorkersForDockerUpdate(); err != nil {
			logger.Warningf("Docker update: post-update config push: %v", err)
		}
	}

	if err := TriggerPanelDockerUpdate(ctx); err != nil {
		return nodeErrs, err
	}
	return nodeErrs, nil
}
