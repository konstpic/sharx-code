package telemt

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func f(v float64) *float64 { return &v }

func TestClassifyDC(t *testing.T) {
	cases := []struct {
		avail, eps, req, alive int
		cov, pct               float64
		want                   string
	}{
		{2, 2, 2, 2, 100, 100, DCStateUp},
		{1, 2, 2, 2, 100, 50, DCStateUp},
		{1, 4, 2, 2, 100, 25, DCStateDegraded},
		{2, 2, 2, 1, 50, 100, DCStateDegraded},
		{0, 2, 2, 0, 0, 0, DCStateDown},
		{2, 2, 2, 0, 0, 100, DCStateDown},
	}
	for i, c := range cases {
		if got := classifyDC(c.avail, c.eps, c.req, c.alive, c.cov, c.pct); got != c.want {
			t.Errorf("case %d: got %s want %s", i, got, c.want)
		}
	}
}

func TestBuildDCRowsMergesMEAndUpstream(t *testing.T) {
	me := &dcStatusResp{MiddleProxyEnabled: true}
	me.DCs = append(me.DCs, dcStatusRow{DC: 2, Endpoints: []string{"a:1", "b:1"}, AvailableEndpoints: 1, AvailablePct: 50, RequiredWriters: 2, AliveWriters: 2, CoveragePct: 100, Load: 7})
	up := &upstreamQualityResp{Enabled: true}
	if err := json.Unmarshal([]byte(`{"enabled":true,"summary":{"configured_total":1,"healthy_total":1,"unhealthy_total":0},
		"upstreams":[{"healthy":true,"dc":[{"dc":2,"latency_ema_ms":41.5,"ip_preference":"prefer_v4"},{"dc":4,"latency_ema_ms":90,"ip_preference":"both_work"},{"dc":5,"ip_preference":"unavailable"}]}]}`), up); err != nil {
		t.Fatal(err)
	}
	rows, sum := buildDCRows(me, up)
	if sum == nil || sum.Healthy != 1 {
		t.Fatalf("summary: %+v", sum)
	}
	by := map[int]DCRow{}
	for _, r := range rows {
		by[r.DC] = r
	}
	if by[2].State != DCStateUp || by[2].Load != 7 || by[2].RttMs == nil || *by[2].RttMs != 41.5 || by[2].IPPreference != "prefer_v4" {
		t.Errorf("dc2: %+v", by[2])
	}
	if by[4].State != DCStateUp || by[4].Source != "upstream" {
		t.Errorf("dc4: %+v", by[4])
	}
	if by[5].State != DCStateDown {
		t.Errorf("dc5 must be down (unreachable via every upstream): %+v", by[5])
	}
	if rows[0].DC != 2 || rows[len(rows)-1].DC != 5 {
		t.Errorf("rows must be sorted by DC: %+v", rows)
	}
}

func TestFetchTelemtEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "tok" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":{"middle_proxy_enabled":true,"dcs":[]}}`))
	}))
	defer srv.Close()
	var out dcStatusResp
	if err := fetchTelemtEnvelope(srv.URL, "tok", "/v1/stats/dcs", &out); err != nil || !out.MiddleProxyEnabled {
		t.Fatalf("%v %+v", err, out)
	}
	if err := fetchTelemtEnvelope(srv.URL, "bad", "/v1/stats/dcs", &out); err == nil {
		t.Fatal("expected auth failure")
	}
}

func TestDCExtrasParsedAndPoolApplied(t *testing.T) {
	var me dcStatusResp
	if err := json.Unmarshal([]byte(`{"middle_proxy_enabled":true,"generated_at_epoch_secs":1700000000,"dcs":[
		{"dc":-2,"endpoints":["1.1.1.1:8888","2.2.2.2:8888"],"endpoint_writers":[{"endpoint":"1.1.1.1:8888","active_writers":2}],
		 "available_endpoints":2,"available_pct":100,"required_writers":2,"floor_min":1,"floor_target":2,"floor_max":4,"floor_capped":true,
		 "alive_writers":2,"coverage_pct":100,"rtt_ms":33.5,"load":4}]}`), &me); err != nil {
		t.Fatal(err)
	}
	var up upstreamQualityResp
	if err := json.Unmarshal([]byte(`{"enabled":true,"counters":{"connect_attempt_total":10,"connect_success_total":8,"connect_fail_total":2},
		"summary":{"configured_total":2,"healthy_total":1,"unhealthy_total":1,"socks5_total":1,"direct_total":1},
		"upstreams":[{"upstream_id":0,"route_kind":"direct","address":"direct","weight":1,"healthy":true,"fails":0,"last_check_age_secs":3,"effective_latency_ms":20,
		  "dc":[{"dc":-2,"latency_ema_ms":25,"ip_preference":"prefer_v6","connect_duration_fail_bucket_gt_1000ms":3}]}]}`), &up); err != nil {
		t.Fatal(err)
	}
	rows, sum := buildDCRows(&me, &up)
	if len(rows) != 1 {
		t.Fatalf("rows: %+v", rows)
	}
	r := rows[0]
	if r.FloorTarget == nil || *r.FloorTarget != 2 || !r.FloorCapped || len(r.EndpointList) != 2 || r.EndpointList[0].ActiveWriters != 2 || r.EndpointList[1].ActiveWriters != 0 {
		t.Errorf("me extras: %+v", r)
	}
	if r.UpstreamRttMs == nil || *r.UpstreamRttMs != 25 || r.SlowConnectFails != 3 || r.UpstreamReachable != 1 || *r.RttMs != 33.5 {
		t.Errorf("upstream extras: %+v", r)
	}
	if sum == nil || sum.ConnectFail != 2 || sum.Socks5 != 1 || len(sum.Items) != 1 || sum.Items[0].LastCheckAgeSecs != 3 {
		t.Errorf("summary: %+v", sum)
	}

	var pool mePoolStateResp
	if err := json.Unmarshal([]byte(`{"enabled":true,"data":{"generations":{"active_generation":5,"warm_generation":6,"draining_generations":[3,4]},
		"hardswap":{"enabled":true,"pending":true},"writers":{"total":9,"alive_non_draining":7,"draining":2,"degraded":1,"contour":{"warm":1,"active":6},"health":{"healthy":6}},
		"refill":{"inflight_endpoints_total":2,"by_dc":[{"dc":-2,"family":"V4","inflight":1},{"dc":-2,"family":"V6","inflight":1}]}}}`), &pool); err != nil {
		t.Fatal(err)
	}
	var q meQualityResp
	_ = json.Unmarshal([]byte(`{"enabled":true,"data":{"counters":{"reconnect_attempt_total":4,"reconnect_success_total":3},"route_drops":{"queue_full_total":9}}}`), &q)
	st := InstanceDCStatus{DCs: rows}
	applyPoolDetails(&st, &pool, &q)
	if st.Writers == nil || st.Writers.Total != 9 || st.Writers.Healthy != 6 || st.Pool == nil || !st.Pool.HardswapPending || st.Pool.DrainingGenerations != 2 {
		t.Errorf("pool: %+v %+v", st.Writers, st.Pool)
	}
	if st.DCs[0].RefillInflight != 2 || st.MEQuality == nil || st.MEQuality.ReconnectAttempts != 4 || st.MEQuality.DropQueueFull != 9 {
		t.Errorf("refill/quality: %+v %+v", st.DCs[0], st.MEQuality)
	}
	// disabled / failed extras are simply omitted
	st2 := InstanceDCStatus{}
	applyPoolDetails(&st2, nil, &meQualityResp{})
	if st2.Writers != nil || st2.Pool != nil || st2.MEQuality != nil {
		t.Errorf("expected no extras: %+v", st2)
	}
}
