package job

import (
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/web/service"
)

// SharX Network jobs. Every job is a no-op unless the panel is an enabled network
// participant, and panics are recovered inside NetworkService so existing panel
// jobs are never affected.

type NetworkSyncJob struct{}

func NewNetworkSyncJob() *NetworkSyncJob { return &NetworkSyncJob{} }

func (j *NetworkSyncJob) Run() {
	ns := service.NetworkService{}
	ns.Sync()
	ns.ProcessProvisionQueue()
	ns.RenewCertificateIfNeeded()
}

type NetworkUsageJob struct {
	mu       sync.Mutex
	lastRun  time.Time
}

func NewNetworkUsageJob() *NetworkUsageJob { return &NetworkUsageJob{} }

func (j *NetworkUsageJob) Run() {
	j.mu.Lock()
	if !j.lastRun.IsZero() && time.Since(j.lastRun) < 45*time.Second {
		j.mu.Unlock()
		return
	}
	j.lastRun = time.Now()
	j.mu.Unlock()
	(service.NetworkService{}).CollectUsage()
}
