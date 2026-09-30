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
	me.DCs = append(me.DCs, struct {
		DC                 int      `json:"dc"`
		Endpoints          []string `json:"endpoints"`
		AvailableEndpoints int      `json:"available_endpoints"`
		AvailablePct       float64  `json:"available_pct"`
		RequiredWriters    int      `json:"required_writers"`
		AliveWriters       int      `json:"alive_writers"`
		CoveragePct        float64  `json:"coverage_pct"`
		RttMs              *float64 `json:"rtt_ms"`
		Load               int      `json:"load"`
	}{DC: 2, Endpoints: []string{"a:1", "b:1"}, AvailableEndpoints: 1, AvailablePct: 50, RequiredWriters: 2, AliveWriters: 2, CoveragePct: 100, Load: 7})
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
