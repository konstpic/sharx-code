package service

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func fp(v float64) *float64 { return &v }

func TestNewStat(t *testing.T) {
	s := NewStat([]*float64{fp(10), nil, fp(30), fp(20)})
	if s.N != 3 || s.Sum != 60 || *s.Avg != 20 || *s.Min != 10 || *s.Max != 30 {
		t.Fatalf("stat: %+v", s)
	}
	if e := NewStat(nil); e.N != 0 || e.Avg != nil || e.Max != nil {
		t.Fatalf("empty stat must have nil avg/min/max: %+v", e)
	}
}

func TestAggregateNodesSkipsDisabledAndOffline(t *testing.T) {
	nodes := []DashboardNodeMetrics{
		{ID: 1, Enable: true, Online: true, Cpu: fp(20), Mem: fp(40), TrafficUp: 5, TrafficDown: 7, OnlineClients: 3, UpRate: fp(100), LastCheckAge: fp(5)},
		{ID: 2, Enable: true, Online: true, Cpu: fp(60), Mem: fp(80), TrafficUp: 1, TrafficDown: 1, OnlineClients: 2, UpRate: fp(50), TrafficLimitPct: fp(120)},
		{ID: 3, Enable: true, Online: false, TrafficUp: 10, LastCheckAge: fp(500)}, // offline: no live values
		{ID: 4, Enable: false, Online: false, Cpu: fp(99), TrafficUp: 100},         // disabled: left out of stats
	}
	a := AggregateNodes(nodes)
	if a.Total != 4 || a.Enabled != 3 || a.Online != 2 || a.Offline != 1 || a.Stale != 1 || a.OverLimit != 1 {
		t.Fatalf("counts: %+v", a)
	}
	if *a.Cpu.Avg != 40 || *a.Cpu.Max != 60 || a.Cpu.N != 2 {
		t.Fatalf("cpu: %+v", a.Cpu)
	}
	if a.TrafficUp != 116 || a.TrafficDown != 8 || a.OnlineClients != 5 || a.UpRate.Sum != 150 {
		t.Fatalf("sums: %+v", a)
	}
	if e := AggregateNodes(nil); e.Total != 0 || e.Cpu.Avg != nil {
		t.Fatalf("empty: %+v", e)
	}
}

func TestBuildNodeMetricsOfflineHasNoLiveValues(t *testing.T) {
	now := time.Unix(10_000, 0)
	n := &model.Node{Id: 7, Name: "n", Enable: true, Status: "offline", ResponseTime: 30, LastCheck: 9_990, Up: 1 << 30, Down: 0, TrafficLimitGB: 4}
	m := buildNodeMetrics(n, now, &workerResourceSample{T: 9_999, Cpu: 50}, fp(1000), 2, 3, 1, 300, 600, true)
	if m.Online || m.Cpu != nil || m.NetBps != nil || m.LatencyMs != nil {
		t.Fatalf("offline node must not expose live values: %+v", m)
	}
	if *m.LastCheckAge != 10 || *m.TrafficLimitPct != 25 || *m.UpRate != 1 || *m.DownRate != 2 {
		t.Fatalf("derived: %+v", m)
	}
	n.Status = "online"
	n.BandwidthMbps = 8 // 1 MB/s link
	m = buildNodeMetrics(n, now, &workerResourceSample{T: 9_999, Cpu: 50, Mem: 10, Disk: 20}, fp(500_000), 0, 0, 0, 0, 0, false)
	if m.Cpu == nil || *m.Cpu != 50 || *m.LinkLoadPct != 50 || m.UpRate != nil || *m.LatencyMs != 30 {
		t.Fatalf("online: %+v", m)
	}
	// a stale sample is treated as unknown
	m = buildNodeMetrics(n, now, &workerResourceSample{T: 1, Cpu: 50}, nil, 0, 0, 0, 0, 0, false)
	if m.Cpu != nil {
		t.Fatalf("stale sample must be null: %+v", m)
	}
}

func TestBuildBalancerMetricsAndAggregate(t *testing.T) {
	var st AgentStatus
	raw := `{"engine":"haproxy","running":true,"pools":[{"id":1,"port":443,"proto":"tcp","listening":true,"members":[
	 {"host":"a","port":1,"up":true,"sessions":4,"rttMs":20},{"host":"b","port":1,"up":false,"sessions":0}]},
	 {"id":2,"port":80,"proto":"tcp","listening":false,"members":[{"host":"c","port":1,"up":true,"sessions":1,"rttMs":40}]}],
	 "diag":{"connectionsTotal":100,"connectionErrorsTotal":3,"timeoutsTotal":2,"bytesRx":1000,"bytesTx":2000,"failoversTotal":1,"conntrack":{"count":50,"max":200}}}`
	if err := json.Unmarshal([]byte(raw), &st); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(20_000, 0)
	b := &model.Balancer{Id: 901, Name: "lb", Enable: true, Status: "online", ResponseTime: 12, LastCheck: 19_990, ConfigHash: "a", AppliedHash: "b"}
	m := buildBalancerMetrics(b, &st, now)
	if m.Pools != 2 || m.PoolsListen != 1 || m.Members != 3 || m.MembersUp != 2 || m.MembersDown != 1 || *m.Sessions != 5 {
		t.Fatalf("pools: %+v", m)
	}
	if *m.Healthy < 66.6 || *m.Healthy > 66.7 || *m.RttAvg != 30 || *m.RttMax != 40 || *m.ConntrackUsed != 25 || !m.ConfigDrift {
		t.Fatalf("derived: %+v", m)
	}
	if m.RxRate != nil {
		t.Fatalf("first sample has no rate")
	}
	st2 := st
	st2.Diag = json.RawMessage(`{"bytesRx":3000,"bytesTx":2000}`)
	m2 := buildBalancerMetrics(b, &st2, now.Add(10*time.Second))
	if m2.RxRate == nil || *m2.RxRate != 200 || *m2.TxRate != 0 {
		t.Fatalf("rate: %+v", m2.RxRate)
	}
	// counters going backwards (agent restart) reset instead of producing a negative rate
	st3 := st
	st3.Diag = json.RawMessage(`{"bytesRx":10,"bytesTx":10}`)
	if m3 := buildBalancerMetrics(b, &st3, now.Add(20*time.Second)); m3.RxRate != nil {
		t.Fatalf("restart must clear the rate")
	}

	off := buildBalancerMetrics(&model.Balancer{Id: 902, Enable: true, Status: "offline"}, nil, now)
	a := AggregateBalancers([]DashboardBalancerMetrics{m2, off})
	if a.Total != 2 || a.Online != 1 || a.Offline != 1 || a.Members != 3 || a.MembersUp != 2 || a.HealthyPct == nil || a.RxRate != 200 {
		t.Fatalf("aggregate: %+v", a)
	}
	if off.Sessions != nil || off.Pools != 0 {
		t.Fatalf("offline balancer exposes no live data: %+v", off)
	}
}

func TestInvertOnlineNodesAndRedaction(t *testing.T) {
	got := invertOnlineNodes(map[string][]int{"a": {1, 2, 2}, "b": {2}})
	if got[1] != 1 || got[2] != 2 {
		t.Fatalf("invert: %v", got)
	}
	one := int64(1)
	snap := &DashboardMetricsSnapshot{Nodes: []DashboardNodeMetrics{{ID: 1}}, Balancers: []DashboardBalancerMetrics{{ID: 1}},
		NodesAgg: &DashboardNodesAggregate{}, BalAgg: &DashboardBalancersAggregate{}, Panel: &DashboardPanelMetrics{Audit24h: &one}}
	r := snap.Redacted(false, false, false)
	if len(r.Nodes) != 0 || len(r.Balancers) != 0 || r.NodesAgg != nil || r.BalAgg != nil || r.Panel.Audit24h != nil {
		t.Fatalf("redaction: %+v", r)
	}
	if len(snap.Nodes) != 1 || snap.Panel.Audit24h == nil {
		t.Fatal("redaction must not mutate the cached snapshot")
	}
}
