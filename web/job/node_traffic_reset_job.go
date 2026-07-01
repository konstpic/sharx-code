package job

import (
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/service"
)

// NodeTrafficResetJob resets node traffic counters on configured calendar days.
type NodeTrafficResetJob struct {
	nodeService service.NodeService
}

// NewNodeTrafficResetJob creates a daily job for node traffic reset by day-of-month.
func NewNodeTrafficResetJob() *NodeTrafficResetJob {
	return &NodeTrafficResetJob{}
}

// Run resets traffic for nodes whose traffic_reset_day matches today's day of month.
func (j *NodeTrafficResetJob) Run() {
	day := time.Now().Day()
	if day < 1 || day > 31 {
		return
	}
	nodes, err := j.nodeService.GetNodesByTrafficResetDay(day)
	if err != nil {
		logger.Warning("Failed to get nodes for traffic reset day:", err)
		return
	}
	if len(nodes) == 0 {
		return
	}
	resetCount := 0
	for _, node := range nodes {
		if node == nil || node.Id <= 0 {
			continue
		}
		if err := j.nodeService.ResetNodeTraffic(node.Id); err != nil {
			logger.Warningf("Failed to reset traffic for node %d (%s): %v", node.Id, node.Name, err)
			continue
		}
		resetCount++
	}
	if resetCount > 0 {
		logger.Infof("Node traffic reset: day=%d, nodes reset=%d", day, resetCount)
	}
}
