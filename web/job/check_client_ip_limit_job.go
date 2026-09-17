package job

import (
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/service"
)

// IPLimitJobTickSchedule wakes the IP limit job often; actual cadence uses panel settings (throttling inside Run).
const IPLimitJobTickSchedule = "@every 1s"

// CheckClientIPLimitJob enforces per-client concurrent unique IP limits.
type CheckClientIPLimitJob struct {
	clientService  service.ClientService
	sessionService service.ClientSessionService
	blockService   service.ClientSessionBlockService
	runMu          sync.Mutex
	lastRun        int64
}

func NewCheckClientIPLimitJob() *CheckClientIPLimitJob {
	return &CheckClientIPLimitJob{
		clientService:  service.ClientService{},
		sessionService: service.ClientSessionService{},
		blockService:   service.ClientSessionBlockService{},
	}
}

func (j *CheckClientIPLimitJob) Run() {
	if !j.runMu.TryLock() {
		return
	}
	defer j.runMu.Unlock()

	settingService := service.SettingService{}
	enabled, err := settingService.GetIPLimitGlobalEnable()
	if err != nil || !enabled {
		return
	}

	intervalSec, err := settingService.GetIPLimitCheckIntervalSec()
	if err != nil {
		intervalSec = 30
	}
	now := time.Now().Unix()
	if j.lastRun > 0 && now-j.lastRun < int64(intervalSec) {
		return
	}
	j.lastRun = now

	if n, err := j.blockService.ExpireDueSessionIPBlocks(); err != nil {
		logger.Debugf("CheckClientIPLimitJob: expire session blocks: %v", err)
	} else if n > 0 {
		logger.Debugf("CheckClientIPLimitJob: expired %d session IP block(s)", n)
	}

	banSec, _ := settingService.GetIPLimitBanDurationSec()
	enforcement, _ := settingService.GetIPLimitEnforcement()
	excessPolicy, _ := settingService.GetIPLimitExcessPolicy()
	recencyWindowSec, _ := settingService.GetIPLimitRecencyWindowSec()

	var expiresAt int64
	if banSec > 0 {
		expiresAt = now + int64(banSec)
	}

	doDrop := enforcement == service.IPLimitEnforcementDrop || enforcement == service.IPLimitEnforcementDropAndBlock
	doBlock := enforcement == service.IPLimitEnforcementBlock || enforcement == service.IPLimitEnforcementDropAndBlock

	db := database.GetDB()
	var clients []model.ClientEntity
	if err := db.Where("ip_limit_enabled = ? AND max_ips > 0 AND enable = ?", true, true).Find(&clients).Error; err != nil {
		logger.Debugf("CheckClientIPLimitJob: list clients: %v", err)
		return
	}

	for i := range clients {
		c := &clients[i]
		resp, err := j.sessionService.GetOnlineSessionsForClient(c.UserId, c.Id)
		if err != nil || resp == nil {
			continue
		}
		ips := rankedSessionIPsFromResults(resp.Results, excessPolicy, now, int64(recencyWindowSec))
		if len(ips) <= c.MaxIPs {
			continue
		}
		excess := ips[c.MaxIPs:]
		if len(excess) == 0 {
			continue
		}
		excessIPs := make([]string, 0, len(excess))
		for _, row := range excess {
			excessIPs = append(excessIPs, row.IP)
		}
		logger.Warningf("CheckClientIPLimitJob: client %s exceeded IP limit (%d>%d), targeting %d IP(s) (%s)",
			c.Name, len(ips), c.MaxIPs, len(excessIPs), excessPolicy)
		if doDrop {
			if err := j.sessionService.DropSessionsByIPsForClient(c.UserId, c.Id, excessIPs); err != nil {
				logger.Warningf("CheckClientIPLimitJob: drop sessions for %s: %v", c.Name, err)
			}
		}
		if doBlock {
			for _, ip := range excessIPs {
				if err := j.blockService.BlockSessionIPInternal(c.Id, ip, expiresAt); err != nil {
					logger.Warningf("CheckClientIPLimitJob: block session IP %s for %s: %v", ip, c.Name, err)
				}
			}
		}
	}
}

type rankedSessionIP struct {
	IP       string
	LastSeen int64
}

// rankedSessionIPsFromResults returns unique online IPs sorted for excess selection.
// newest: ascending LastSeen — keep oldest connections, drop newest excess.
// oldest: descending LastSeen — keep newest connections, drop oldest excess.
//
// Xray's user-online IP map (GetStatsOnlineIpList with reset=false) has no TTL: an IP an that
// client used weeks ago and never returned to still sits in the map with its original LastSeen,
// forever, until Xray restarts or something explicitly resets that stat. Without filtering by
// recency, a client whose carrier rotates IPs (mobile CGNAT) accumulates one "online IP" per
// rotation and eventually exceeds max_ips even though only one IP is genuinely active right now.
// recencyWindowSec <= 0 disables the filter (all reported IPs count, matching old behavior).
func rankedSessionIPsFromResults(results []service.ClientSessionNodeResult, excessPolicy string, nowUnix int64, recencyWindowSec int64) []rankedSessionIP {
	type ipEntry struct {
		ip       string
		lastSeen int64
	}
	byIP := make(map[string]ipEntry)
	for _, block := range results {
		for _, s := range block.Sessions {
			ip := strings.TrimSpace(s.IP)
			if ip == "" {
				continue
			}
			if recencyWindowSec > 0 && s.LastSeen > 0 && nowUnix-s.LastSeen > recencyWindowSec {
				continue
			}
			k := strings.ToLower(ip)
			if e, ok := byIP[k]; !ok || s.LastSeen > e.lastSeen {
				byIP[k] = ipEntry{ip: ip, lastSeen: s.LastSeen}
			}
		}
	}
	out := make([]rankedSessionIP, 0, len(byIP))
	for _, e := range byIP {
		out = append(out, rankedSessionIP{IP: e.ip, LastSeen: e.lastSeen})
	}
	if strings.ToLower(strings.TrimSpace(excessPolicy)) == service.IPLimitExcessPolicyOldest {
		sort.Slice(out, func(i, j int) bool {
			if out[i].LastSeen == out[j].LastSeen {
				return out[i].IP < out[j].IP
			}
			return out[i].LastSeen > out[j].LastSeen
		})
		return out
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LastSeen == out[j].LastSeen {
			return out[i].IP < out[j].IP
		}
		return out[i].LastSeen < out[j].LastSeen
	})
	return out
}
