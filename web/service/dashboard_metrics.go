package service

import (
	"encoding/json"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
)

// Dashboard metric snapshots: one compact payload with per-node and per-balancer numbers for the custom
// dashboard panels (GET /panel/api/server/dashboardMetrics). Everything is read from data the panel already holds
// (nodes/balancers tables, the in-memory worker resource history, the balancer live status, the traffic timeline
// buckets) in a fixed number of grouped queries, never one query per entity and never a network call to a node or
// agent. A value that is not known right now (offline node, agent not reporting) is null, not zero.

const (
	dashboardMetricsTTL     = 8 * time.Second
	dashboardRateWindowSecs = 300
	nodeStaleAfterSecs      = 120
)

// DashboardNodeMetrics is one worker node.
type DashboardNodeMetrics struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Enable    bool   `json:"enable"`
	Status    string `json:"status"` // online | offline | unknown
	Online    bool   `json:"online"`
	XrayState string `json:"xrayState"`
	Telemt    string `json:"telemtState"`
	AmneziaWg string `json:"amneziawgState"`

	XrayVersion   string `json:"xrayVersion,omitempty"`
	TelemtVersion string `json:"telemtVersion,omitempty"`
	WorkerVersion string `json:"workerVersion,omitempty"`

	LatencyMs    *float64 `json:"latencyMs"`    // panel -> node health check round trip
	LastCheckAge *float64 `json:"lastCheckAge"` // seconds since the last health check
	Cpu          *float64 `json:"cpu"`          // %
	Mem          *float64 `json:"mem"`          // %
	Disk         *float64 `json:"disk"`         // %
	MemUsed      *float64 `json:"memUsed"`
	MemTotal     *float64 `json:"memTotal"`
	NetBps       *float64 `json:"netBps"` // rx+tx bytes/s on the node's interfaces

	TrafficUp       int64    `json:"trafficUp"`
	TrafficDown     int64    `json:"trafficDown"`
	TrafficAllTime  int64    `json:"trafficAllTime"`
	TrafficLimit    int64    `json:"trafficLimit"`    // bytes, 0 = unlimited
	TrafficLimitPct *float64 `json:"trafficLimitPct"` // (up+down)/limit, nil without a limit
	UpRate          *float64 `json:"upRate"`          // bytes/s averaged over the last 5 minutes
	DownRate        *float64 `json:"downRate"`        // bytes/s averaged over the last 5 minutes
	BandwidthMbps   int      `json:"bandwidthMbps"`   // admin-declared uplink
	LinkLoadPct     *float64 `json:"linkLoadPct"`     // netBps against bandwidthMbps
	Inbounds        int      `json:"inbounds"`        // inbounds assigned to the node
	Clients         int      `json:"clients"`         // distinct clients that ever carried traffic on the node
	OnlineClients   int      `json:"onlineClients"`   // clients online on the node right now
}

// DashboardBalancerMetrics is one balancer.
type DashboardBalancerMetrics struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Enable  bool   `json:"enable"`
	Status  string `json:"status"`
	Online  bool   `json:"online"`
	Engine  string `json:"engine"`
	Running *bool  `json:"running"`

	AgentVersion  string `json:"agentVersion,omitempty"`
	EngineVersion string `json:"engineVersion,omitempty"`
	ConfigDrift   bool   `json:"configDrift"` // desired config differs from the applied one
	HasError      bool   `json:"hasError"`    // agent or apply error reported

	LatencyMs     *float64 `json:"latencyMs"`
	LastCheckAge  *float64 `json:"lastCheckAge"`
	LastApplyAge  *float64 `json:"lastApplyAge"`
	Pools         int      `json:"pools"`          // pools reported by the agent
	PoolsListen   int      `json:"poolsListening"` // pools whose listener is up
	Members       int      `json:"members"`
	MembersUp     int      `json:"membersUp"`
	MembersDown   int      `json:"membersDown"`
	Healthy       *float64 `json:"healthyPct"`
	Sessions      *float64 `json:"sessions"`    // established client connections
	ConnsTotal    *float64 `json:"connections"` // connections served since the agent started
	ConnErrors    *float64 `json:"connectionErrors"`
	Timeouts      *float64 `json:"timeouts"`
	Failovers     *float64 `json:"failovers"`
	BytesIn       *float64 `json:"bytesIn"`
	BytesOut      *float64 `json:"bytesOut"`
	RxRate        *float64 `json:"rxRate"` // bytes/s from clients
	TxRate        *float64 `json:"txRate"` // bytes/s to clients
	RttAvg        *float64 `json:"rttAvg"`
	RttMax        *float64 `json:"rttMax"`
	ConntrackUsed *float64 `json:"conntrackPct"`
}

// Stat is one aggregate over a set of values: count of known values, sum, avg, min, max.
type Stat struct {
	N   int      `json:"n"`
	Sum float64  `json:"sum"`
	Avg *float64 `json:"avg"`
	Min *float64 `json:"min"`
	Max *float64 `json:"max"`
}

// DashboardNodesAggregate / DashboardBalancersAggregate are the "all nodes" / "all balancers" metrics.
type DashboardNodesAggregate struct {
	Total          int   `json:"total"`
	Enabled        int   `json:"enabled"`
	Online         int   `json:"online"`
	Offline        int   `json:"offline"`
	Stale          int   `json:"stale"`     // health check older than two minutes
	OverLimit      int   `json:"overLimit"` // traffic limit reached
	Cpu            Stat  `json:"cpu"`
	Mem            Stat  `json:"mem"`
	Disk           Stat  `json:"disk"`
	Latency        Stat  `json:"latency"`
	NetBps         Stat  `json:"netBps"`
	UpRate         Stat  `json:"upRate"`
	DownRate       Stat  `json:"downRate"`
	TrafficUp      int64 `json:"trafficUp"`
	TrafficDown    int64 `json:"trafficDown"`
	TrafficAllTime int64 `json:"trafficAllTime"`
	Inbounds       int   `json:"inbounds"`
	Clients        int   `json:"clients"`
	OnlineClients  int   `json:"onlineClients"`
}

type DashboardBalancersAggregate struct {
	Total          int      `json:"total"`
	Enabled        int      `json:"enabled"`
	Online         int      `json:"online"`
	Offline        int      `json:"offline"`
	WithError      int      `json:"withError"`
	Drift          int      `json:"drift"`
	Pools          int      `json:"pools"`
	PoolsListening int      `json:"poolsListening"`
	Members        int      `json:"members"`
	MembersUp      int      `json:"membersUp"`
	MembersDown    int      `json:"membersDown"`
	HealthyPct     *float64 `json:"healthyPct"`
	Sessions       float64  `json:"sessions"`
	Connections    float64  `json:"connections"`
	ConnErrors     float64  `json:"connectionErrors"`
	Timeouts       float64  `json:"timeouts"`
	Failovers      float64  `json:"failovers"`
	BytesIn        float64  `json:"bytesIn"`
	BytesOut       float64  `json:"bytesOut"`
	RxRate         float64  `json:"rxRate"`
	TxRate         float64  `json:"txRate"`
	Latency        Stat     `json:"latency"`
	Rtt            Stat     `json:"rtt"`
	Conntrack      Stat     `json:"conntrack"`
}

// DashboardPanelMetrics are panel-wide counters (clients, inbounds, traffic, audit).
type DashboardPanelMetrics struct {
	Clients         int64    `json:"clients"`
	ClientsEnabled  int64    `json:"clientsEnabled"`
	ClientsExpired  int64    `json:"clientsExpired"` // status other than active
	Inbounds        int64    `json:"inbounds"`
	InboundsEnabled int64    `json:"inboundsEnabled"`
	Hosts           int64    `json:"hosts"`
	Bundles         int64    `json:"bundles"`
	TrafficUp       int64    `json:"trafficUp"`
	TrafficDown     int64    `json:"trafficDown"`
	UpRate          *float64 `json:"upRate"`
	DownRate        *float64 `json:"downRate"`
	Audit24h        *int64   `json:"audit24h,omitempty"`
	AuditFailed24h  *int64   `json:"auditFailed24h,omitempty"`
}

// DashboardMetricsSnapshot is the endpoint payload.
type DashboardMetricsSnapshot struct {
	At        int64                        `json:"at"` // unix ms
	Nodes     []DashboardNodeMetrics       `json:"nodes"`
	Balancers []DashboardBalancerMetrics   `json:"balancers"`
	NodesAgg  *DashboardNodesAggregate     `json:"nodesAgg,omitempty"`
	BalAgg    *DashboardBalancersAggregate `json:"balancersAgg,omitempty"`
	Panel     *DashboardPanelMetrics       `json:"panel,omitempty"`
}

func fptr(v float64) *float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	return &v
}

func clampPct(v float64) float64 { return math.Max(0, math.Min(100, v)) }

// NewStat aggregates the non-nil values.
func NewStat(vals []*float64) Stat {
	var s Stat
	for _, p := range vals {
		if p == nil {
			continue
		}
		v := *p
		if s.N == 0 {
			mn, mx := v, v
			s.Min, s.Max = &mn, &mx
		} else {
			if v < *s.Min {
				m := v
				s.Min = &m
			}
			if v > *s.Max {
				m := v
				s.Max = &m
			}
		}
		s.N++
		s.Sum += v
	}
	if s.N > 0 {
		a := s.Sum / float64(s.N)
		s.Avg = &a
	}
	return s
}

// AggregateNodes sums and averages the per-node metrics. Disabled nodes count in Total but are left out of every
// resource statistic; offline nodes keep their traffic totals but contribute no live values (those are nil).
func AggregateNodes(nodes []DashboardNodeMetrics) DashboardNodesAggregate {
	var a DashboardNodesAggregate
	var cpu, mem, disk, lat, net, up, down []*float64
	for _, n := range nodes {
		a.Total++
		a.TrafficUp += n.TrafficUp
		a.TrafficDown += n.TrafficDown
		a.TrafficAllTime += n.TrafficAllTime
		a.Inbounds += n.Inbounds
		a.Clients += n.Clients
		if !n.Enable {
			continue
		}
		a.Enabled++
		if n.Online {
			a.Online++
		} else {
			a.Offline++
		}
		if n.LastCheckAge != nil && *n.LastCheckAge > nodeStaleAfterSecs {
			a.Stale++
		}
		if n.TrafficLimitPct != nil && *n.TrafficLimitPct >= 100 {
			a.OverLimit++
		}
		a.OnlineClients += n.OnlineClients
		cpu, mem, disk = append(cpu, n.Cpu), append(mem, n.Mem), append(disk, n.Disk)
		lat, net = append(lat, n.LatencyMs), append(net, n.NetBps)
		up, down = append(up, n.UpRate), append(down, n.DownRate)
	}
	a.Cpu, a.Mem, a.Disk, a.Latency, a.NetBps = NewStat(cpu), NewStat(mem), NewStat(disk), NewStat(lat), NewStat(net)
	a.UpRate, a.DownRate = NewStat(up), NewStat(down)
	return a
}

// AggregateBalancers does the same for balancers.
func AggregateBalancers(bs []DashboardBalancerMetrics) DashboardBalancersAggregate {
	var a DashboardBalancersAggregate
	var lat, rtt, ct []*float64
	add := func(dst *float64, p *float64) {
		if p != nil {
			*dst += *p
		}
	}
	for _, b := range bs {
		a.Total++
		if !b.Enable {
			continue
		}
		a.Enabled++
		if b.Online {
			a.Online++
		} else {
			a.Offline++
		}
		if b.HasError {
			a.WithError++
		}
		if b.ConfigDrift {
			a.Drift++
		}
		a.Pools += b.Pools
		a.PoolsListening += b.PoolsListen
		a.Members += b.Members
		a.MembersUp += b.MembersUp
		a.MembersDown += b.MembersDown
		add(&a.Sessions, b.Sessions)
		add(&a.Connections, b.ConnsTotal)
		add(&a.ConnErrors, b.ConnErrors)
		add(&a.Timeouts, b.Timeouts)
		add(&a.Failovers, b.Failovers)
		add(&a.BytesIn, b.BytesIn)
		add(&a.BytesOut, b.BytesOut)
		add(&a.RxRate, b.RxRate)
		add(&a.TxRate, b.TxRate)
		lat, rtt, ct = append(lat, b.LatencyMs), append(rtt, b.RttAvg), append(ct, b.ConntrackUsed)
	}
	if a.Members > 0 {
		a.HealthyPct = fptr(float64(a.MembersUp) / float64(a.Members) * 100)
	}
	a.Latency, a.Rtt, a.Conntrack = NewStat(lat), NewStat(rtt), NewStat(ct)
	return a
}

// ---------- node collection ----------

func ageSeconds(ts int64, now time.Time) *float64 {
	if ts <= 0 {
		return nil
	}
	return fptr(math.Max(0, float64(now.Unix()-ts)))
}

// buildNodeMetrics assembles one node from the DB row plus the already-gathered in-memory and grouped data.
func buildNodeMetrics(n *model.Node, now time.Time, last *workerResourceSample, netBps *float64,
	inbounds, clients, online int, upBytes, downBytes int64, hasRate bool) DashboardNodeMetrics {
	m := DashboardNodeMetrics{
		ID: n.Id, Name: n.Name, Enable: n.Enable, Status: n.Status, Online: n.Enable && n.Status == "online",
		XrayState: n.XrayState, Telemt: n.TelemtState, AmneziaWg: n.AmneziaWgState,
		XrayVersion: n.XrayVersion, TelemtVersion: n.TelemtVersion, WorkerVersion: n.WorkerVersion,
		TrafficUp: n.Up, TrafficDown: n.Down, TrafficAllTime: n.AllTime, BandwidthMbps: n.BandwidthMbps,
		Inbounds: inbounds, Clients: clients, OnlineClients: online,
		LastCheckAge: ageSeconds(n.LastCheck, now),
	}
	if m.Status == "" {
		m.Status = "unknown"
	}
	if n.TrafficLimitGB > 0 {
		m.TrafficLimit = int64(n.TrafficLimitGB * 1024 * 1024 * 1024)
		m.TrafficLimitPct = fptr(float64(n.Up+n.Down) / float64(m.TrafficLimit) * 100)
	}
	// live host values only while the node answers and the sample is fresh
	if m.Online {
		if n.ResponseTime > 0 {
			m.LatencyMs = fptr(float64(n.ResponseTime))
		}
		if last != nil && now.Unix()-last.T <= nodeStaleAfterSecs {
			m.Cpu, m.Mem, m.Disk = fptr(last.Cpu), fptr(last.Mem), fptr(last.Disk)
		}
		m.NetBps = netBps
		if netBps != nil && n.BandwidthMbps > 0 {
			m.LinkLoadPct = fptr(clampPct(*netBps * 8 / (float64(n.BandwidthMbps) * 1e6) * 100))
		}
	}
	if hasRate {
		m.UpRate = fptr(float64(upBytes) / dashboardRateWindowSecs)
		m.DownRate = fptr(float64(downBytes) / dashboardRateWindowSecs)
	}
	return m
}

// ---------- balancer collection ----------

type balancerRateState struct {
	rx, tx   int64
	at       time.Time
	rxRate   float64
	txRate   float64
	hasRates bool
}

var (
	balancerRateMu sync.Mutex
	balancerRates  = map[int]*balancerRateState{}
)

// advanceBalancerRate turns the agent's cumulative byte counters into rates between two snapshots. The live status
// is refreshed less often than the snapshot, so an unchanged counter keeps the last rate for a while before it falls to 0.
func advanceBalancerRate(id int, rx, tx int64, now time.Time) (rxRate, txRate *float64) {
	balancerRateMu.Lock()
	defer balancerRateMu.Unlock()
	st := balancerRates[id]
	if st == nil {
		balancerRates[id] = &balancerRateState{rx: rx, tx: tx, at: now}
		return nil, nil
	}
	changed := rx != st.rx || tx != st.tx
	dt := now.Sub(st.at).Seconds()
	switch {
	case rx < st.rx || tx < st.tx: // agent restarted: counters reset
		*st = balancerRateState{rx: rx, tx: tx, at: now}
		return nil, nil
	case changed && dt >= 1:
		st.rxRate, st.txRate, st.hasRates = float64(rx-st.rx)/dt, float64(tx-st.tx)/dt, true
		st.rx, st.tx, st.at = rx, tx, now
	case !changed && dt > 45:
		st.rxRate, st.txRate, st.hasRates = 0, 0, true
		st.at = now
	}
	if !st.hasRates {
		return nil, nil
	}
	return fptr(st.rxRate), fptr(st.txRate)
}

type balancerDiagNumbers struct {
	ConnsTotal int64 `json:"connectionsTotal"`
	ConnErrors int64 `json:"connectionErrorsTotal"`
	Timeouts   int64 `json:"timeoutsTotal"`
	BytesRx    int64 `json:"bytesRx"`
	BytesTx    int64 `json:"bytesTx"`
	Failovers  int64 `json:"failoversTotal"`
	Conntrack  *struct {
		Count int64 `json:"count"`
		Max   int64 `json:"max"`
	} `json:"conntrack"`
}

func buildBalancerMetrics(b *model.Balancer, st *AgentStatus, now time.Time) DashboardBalancerMetrics {
	m := DashboardBalancerMetrics{
		ID: b.Id, Name: b.Name, Enable: b.Enable, Status: b.Status, Online: b.Enable && b.Status == "online",
		Engine: b.Engine, AgentVersion: b.AgentVersion, EngineVersion: b.EngineVersion,
		ConfigDrift:  b.ConfigHash != "" && b.AppliedHash != "" && b.ConfigHash != b.AppliedHash,
		HasError:     strings.TrimSpace(b.LastError) != "" || b.Status == "error",
		LastCheckAge: ageSeconds(b.LastCheck, now), LastApplyAge: ageSeconds(b.LastAppliedAt, now),
	}
	if m.Status == "" {
		m.Status = "unknown"
	}
	if m.Online && b.ResponseTime > 0 {
		m.LatencyMs = fptr(float64(b.ResponseTime))
	}
	if st == nil || !m.Online {
		return m
	}
	run := st.Running
	m.Running = &run
	if st.LastError != "" {
		m.HasError = true
	}
	var rttSum float64
	var rttN int
	var rttMax int64
	var sessions int
	for _, p := range st.Pools {
		m.Pools++
		if p.Listening != nil && *p.Listening {
			m.PoolsListen++
		}
		for _, mem := range p.Members {
			m.Members++
			if mem.Up != nil && *mem.Up {
				m.MembersUp++
			} else if mem.Up != nil {
				m.MembersDown++
			}
			sessions += mem.Sessions
			if mem.RTTMs != nil {
				rttSum += float64(*mem.RTTMs)
				rttN++
				if *mem.RTTMs > rttMax {
					rttMax = *mem.RTTMs
				}
			}
		}
	}
	m.Sessions = fptr(float64(sessions))
	if m.Members > 0 {
		m.Healthy = fptr(float64(m.MembersUp) / float64(m.Members) * 100)
	}
	if rttN > 0 {
		m.RttAvg, m.RttMax = fptr(rttSum/float64(rttN)), fptr(float64(rttMax))
	}
	if len(st.Diag) > 0 {
		var d balancerDiagNumbers
		if json.Unmarshal(st.Diag, &d) == nil {
			m.ConnsTotal, m.ConnErrors, m.Timeouts = fptr(float64(d.ConnsTotal)), fptr(float64(d.ConnErrors)), fptr(float64(d.Timeouts))
			m.Failovers, m.BytesIn, m.BytesOut = fptr(float64(d.Failovers)), fptr(float64(d.BytesRx)), fptr(float64(d.BytesTx))
			m.RxRate, m.TxRate = advanceBalancerRate(b.Id, d.BytesRx, d.BytesTx, now)
			if d.Conntrack != nil && d.Conntrack.Max > 0 {
				m.ConntrackUsed = fptr(float64(d.Conntrack.Count) / float64(d.Conntrack.Max) * 100)
			}
		}
	}
	return m
}

// ---------- snapshot ----------

type groupedPair struct{ Up, Down int64 }

var (
	dashboardMetricsMu    sync.Mutex
	dashboardMetricsCache *DashboardMetricsSnapshot
)

// GetDashboardMetrics returns the cached snapshot (rebuilt at most every few seconds, shared by every viewer).
// Callers must redact sections the viewer may not see (nodes / balancers / audit) before sending it.
func (s *ServerService) GetDashboardMetrics() *DashboardMetricsSnapshot {
	dashboardMetricsMu.Lock()
	defer dashboardMetricsMu.Unlock()
	if c := dashboardMetricsCache; c != nil && time.Since(time.UnixMilli(c.At)) < dashboardMetricsTTL {
		return c
	}
	snap := s.buildDashboardMetrics(time.Now())
	dashboardMetricsCache = snap
	return snap
}

func (s *ServerService) latestWorkerSample(id int) *workerResourceSample {
	s.mu.Lock()
	defer s.mu.Unlock()
	h := s.workerHistory[id]
	if len(h) == 0 {
		return nil
	}
	v := h[len(h)-1]
	return &v
}

// invertOnlineNodes counts, per node, the clients the live presence map says are online there.
func invertOnlineNodes(m map[string][]int) map[int]int {
	out := map[int]int{}
	for _, ids := range m {
		seen := map[int]struct{}{}
		for _, id := range ids {
			if _, dup := seen[id]; !dup {
				seen[id] = struct{}{}
				out[id]++
			}
		}
	}
	return out
}

func (s *ServerService) buildDashboardMetrics(now time.Time) *DashboardMetricsSnapshot {
	snap := &DashboardMetricsSnapshot{At: now.UnixMilli(), Nodes: []DashboardNodeMetrics{}, Balancers: []DashboardBalancerMetrics{}}
	db := database.GetDB()
	since := now.UnixMilli() - dashboardRateWindowSecs*1000
	since = since / trafficHistoryMinute * trafficHistoryMinute

	// node rows + three grouped queries (inbounds, clients, traffic rate)
	nodes, _ := (&NodeService{}).GetAllNodes()
	inbounds, clients := map[int]int{}, map[int]int{}
	rates := map[int]groupedPair{}
	if len(nodes) > 0 {
		var rows []struct{ NodeId, N int }
		if db.Model(&model.InboundNodeMapping{}).Select("node_id, COUNT(*) AS n").Group("node_id").Scan(&rows).Error == nil {
			for _, r := range rows {
				inbounds[r.NodeId] = r.N
			}
		}
		rows = rows[:0]
		if db.Model(&model.ClientNodeTraffic{}).Select("node_id, COUNT(DISTINCT client_id) AS n").Group("node_id").Scan(&rows).Error == nil {
			for _, r := range rows {
				clients[r.NodeId] = r.N
			}
		}
	}
	var rateRows []struct {
		NodeID   int
		Up, Down int64
	}
	rateOK := db.Model(&model.TrafficHistoryBucket{}).Select("node_id, SUM(up) AS up, SUM(down) AS down").
		Where("kind = ? AND resolution = ? AND bucket >= ?", "client", 60, since).Group("node_id").Scan(&rateRows).Error == nil
	panelRate := groupedPair{}
	for _, r := range rateRows {
		if r.NodeID == -1 {
			panelRate = groupedPair{r.Up, r.Down}
		} else if r.NodeID > 0 {
			rates[r.NodeID] = groupedPair{r.Up, r.Down}
		}
	}
	onlineByNode := invertOnlineNodes(snapshotPanelOnlineNodes())
	for _, n := range nodes {
		var net *float64
		if bps, ok := s.LatestNodeNetBps(n.Id); ok {
			net = fptr(bps)
		}
		r := rates[n.Id]
		snap.Nodes = append(snap.Nodes, buildNodeMetrics(n, now, s.latestWorkerSample(n.Id), net,
			inbounds[n.Id], clients[n.Id], onlineByNode[n.Id], r.Up, r.Down, rateOK))
	}
	agg := AggregateNodes(snap.Nodes)
	snap.NodesAgg = &agg

	// balancers: DB rows + in-memory live status
	if bals, err := (&BalancerService{}).List(); err == nil {
		for _, b := range bals {
			snap.Balancers = append(snap.Balancers, buildBalancerMetrics(b, (&BalancerService{}).LiveStatus(b.Id), now))
		}
	}
	bagg := AggregateBalancers(snap.Balancers)
	snap.BalAgg = &bagg

	// panel-wide counters (one query per table)
	p := &DashboardPanelMetrics{}
	var c struct{ Total, Enabled, Expired int64 }
	if db.Model(&model.ClientEntity{}).Select("COUNT(*) AS total, COALESCE(SUM(CASE WHEN enable THEN 1 ELSE 0 END),0) AS enabled, "+
		"COALESCE(SUM(CASE WHEN status <> 'active' THEN 1 ELSE 0 END),0) AS expired").Scan(&c).Error == nil {
		p.Clients, p.ClientsEnabled, p.ClientsExpired = c.Total, c.Enabled, c.Expired
	}
	var i struct{ Total, Enabled, Up, Down int64 }
	if db.Model(&model.Inbound{}).Select("COUNT(*) AS total, COALESCE(SUM(CASE WHEN enable THEN 1 ELSE 0 END),0) AS enabled, "+
		"COALESCE(SUM(up),0) AS up, COALESCE(SUM(down),0) AS down").Scan(&i).Error == nil {
		p.Inbounds, p.InboundsEnabled, p.TrafficUp, p.TrafficDown = i.Total, i.Enabled, i.Up, i.Down
	}
	db.Model(&model.Host{}).Count(&p.Hosts)
	db.Model(&model.Bundle{}).Count(&p.Bundles)
	if rateOK {
		p.UpRate, p.DownRate = fptr(float64(panelRate.Up)/dashboardRateWindowSecs), fptr(float64(panelRate.Down)/dashboardRateWindowSecs)
	}
	var a struct{ Total, Failed int64 }
	if db.Model(&model.AuditLog{}).Select("COUNT(*) AS total, COALESCE(SUM(CASE WHEN result <> 'ok' THEN 1 ELSE 0 END),0) AS failed").
		Where("ts >= ?", now.Add(-24*time.Hour).UnixMilli()).Scan(&a).Error == nil {
		p.Audit24h, p.AuditFailed24h = &a.Total, &a.Failed
	}
	snap.Panel = p
	return snap
}

// Redacted returns a copy without the sections the viewer has no permission for.
func (d *DashboardMetricsSnapshot) Redacted(nodes, balancers, audit bool) *DashboardMetricsSnapshot {
	out := *d
	if !nodes {
		out.Nodes, out.NodesAgg = []DashboardNodeMetrics{}, nil
	}
	if !balancers {
		out.Balancers, out.BalAgg = []DashboardBalancerMetrics{}, nil
	}
	if !audit && d.Panel != nil {
		pm := *d.Panel
		pm.Audit24h, pm.AuditFailed24h = nil, nil
		out.Panel = &pm
	}
	return &out
}

func snapshotPanelOnlineNodes() map[string][]int {
	panelOnlineNodesMu.RLock()
	defer panelOnlineNodesMu.RUnlock()
	return panelOnlineNodes
}
