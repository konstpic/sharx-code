package telemt

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	toml "github.com/pelletier/go-toml/v2"

	"github.com/konstpic/sharx-code/v2/logger"
)

// DC availability states shown to operators.
const (
	DCStateUp       = "up"
	DCStateDegraded = "degraded"
	DCStateDown     = "down"
	DCStateUnknown  = "unknown"
)

// DCRow is the health of one Telegram datacenter as seen by one Telemt instance. It merges
// Telemt's Middle-End view (/v1/stats/dcs: endpoints, writers, coverage, load) with the upstream
// view (/v1/runtime/upstream_quality: latency and IPv4/IPv6 reachability), so it is meaningful
// both with and without the Middle-End proxy.
type DCRow struct {
	DC    int    `json:"dc"`
	State string `json:"state"`
	// RttMs is the ME RTT when known, else the best upstream connect latency.
	RttMs              *float64 `json:"rttMs,omitempty"`
	Endpoints          int      `json:"endpoints"`
	AvailableEndpoints int      `json:"availableEndpoints"`
	AliveWriters       int      `json:"aliveWriters"`
	RequiredWriters    int      `json:"requiredWriters"`
	CoveragePct        float64  `json:"coveragePct"`
	Load               int      `json:"load"`
	// IPPreference is unknown | prefer_v4 | prefer_v6 | both_work | unavailable.
	IPPreference string `json:"ipPreference,omitempty"`
	// Source records where the state came from: "me" or "upstream".
	Source string `json:"source"`
}

// UpstreamSummary is the aggregate health of the instance's upstream routes.
type UpstreamSummary struct {
	Configured int `json:"configured"`
	Healthy    int `json:"healthy"`
	Unhealthy  int `json:"unhealthy"`
}

// InstanceDCStatus is the DC picture for one Telemt process (one inbound).
type InstanceDCStatus struct {
	InboundId int    `json:"inboundId"`
	Tag       string `json:"tag"`
	// Available is false when the instance could not be queried (API disabled or unreachable);
	// Reason then says why (api_disabled | unreachable | feature_disabled).
	Available bool             `json:"available"`
	Reason    string           `json:"reason,omitempty"`
	MEEnabled bool             `json:"meEnabled"`
	Upstreams *UpstreamSummary `json:"upstreams,omitempty"`
	DCs       []DCRow          `json:"dcs"`
	UpdatedAt int64            `json:"updatedAt"`
}

type dcStatusResp struct {
	MiddleProxyEnabled bool   `json:"middle_proxy_enabled"`
	Reason             string `json:"reason"`
	DCs                []struct {
		DC                 int      `json:"dc"`
		Endpoints          []string `json:"endpoints"`
		AvailableEndpoints int      `json:"available_endpoints"`
		AvailablePct       float64  `json:"available_pct"`
		RequiredWriters    int      `json:"required_writers"`
		AliveWriters       int      `json:"alive_writers"`
		CoveragePct        float64  `json:"coverage_pct"`
		RttMs              *float64 `json:"rtt_ms"`
		Load               int      `json:"load"`
	} `json:"dcs"`
}

type upstreamQualityResp struct {
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason"`
	Summary *struct {
		ConfiguredTotal int `json:"configured_total"`
		HealthyTotal    int `json:"healthy_total"`
		UnhealthyTotal  int `json:"unhealthy_total"`
	} `json:"summary"`
	Upstreams []struct {
		Healthy bool `json:"healthy"`
		DC      []struct {
			DC           int      `json:"dc"`
			LatencyEmaMs *float64 `json:"latency_ema_ms"`
			IPPreference string   `json:"ip_preference"`
		} `json:"dc"`
	} `json:"upstreams"`
}

// dcStatusCacheTTL keeps a polling dashboard from hammering every Telemt API.
const dcStatusCacheTTL = 5 * time.Second

type dcStatusCache struct {
	mu   sync.Mutex
	at   time.Time
	data []InstanceDCStatus
}

var dcCaches sync.Map // *Manager -> *dcStatusCache

// fetchTelemtEnvelope GETs a Telemt control-API path and returns the "data" payload.
func fetchTelemtEnvelope(baseURL, authHeader, path string, out any) error {
	u := strings.TrimRight(baseURL, "/") + path
	ctx, cancel := contextWithTimeout(4 * time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: HTTP %d", u, resp.StatusCode)
	}
	var env struct {
		OK   bool            `json:"ok"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return fmt.Errorf("decode envelope: %w", err)
	}
	if !env.OK {
		return fmt.Errorf("telemt api error: %s", strings.TrimSpace(string(body)))
	}
	return json.Unmarshal(env.Data, out)
}

// classifyDC turns ME writer/endpoint coverage into up / degraded / down. Some spare endpoints
// being unreachable is normal (writers still cover the DC); only losing most of them, or part
// of the required writers, counts as degraded.
func classifyDC(availableEndpoints, endpoints, requiredWriters, aliveWriters int, coveragePct, availablePct float64) string {
	if endpoints > 0 && availableEndpoints == 0 {
		return DCStateDown
	}
	if requiredWriters > 0 && aliveWriters == 0 {
		return DCStateDown
	}
	if (requiredWriters > 0 && coveragePct < 100) || (endpoints > 0 && availablePct < 50) {
		return DCStateDegraded
	}
	return DCStateUp
}

// buildDCRows merges the ME snapshot and the upstream snapshot into per-DC rows.
func buildDCRows(me *dcStatusResp, up *upstreamQualityResp) ([]DCRow, *UpstreamSummary) {
	rows := map[int]*DCRow{}
	get := func(dc int) *DCRow {
		r := rows[dc]
		if r == nil {
			r = &DCRow{DC: dc, State: DCStateUnknown}
			rows[dc] = r
		}
		return r
	}
	if me != nil && me.MiddleProxyEnabled {
		for _, d := range me.DCs {
			r := get(d.DC)
			r.Source = "me"
			r.Endpoints = len(d.Endpoints)
			r.AvailableEndpoints = d.AvailableEndpoints
			r.AliveWriters = d.AliveWriters
			r.RequiredWriters = d.RequiredWriters
			r.CoveragePct = d.CoveragePct
			r.Load = d.Load
			r.RttMs = d.RttMs
			r.State = classifyDC(d.AvailableEndpoints, len(d.Endpoints), d.RequiredWriters, d.AliveWriters, d.CoveragePct, d.AvailablePct)
		}
	}
	var sum *UpstreamSummary
	if up != nil && up.Enabled {
		if up.Summary != nil {
			sum = &UpstreamSummary{Configured: up.Summary.ConfiguredTotal, Healthy: up.Summary.HealthyTotal, Unhealthy: up.Summary.UnhealthyTotal}
		}
		// Per DC: best (lowest) latency over healthy upstreams; unavailable only if every
		// healthy upstream says the DC is unreachable.
		type agg struct {
			best     *float64
			pref     string
			reach    int
			unreach  int
			anyPrefs bool
		}
		per := map[int]*agg{}
		for _, u := range up.Upstreams {
			if !u.Healthy {
				continue
			}
			for _, d := range u.DC {
				a := per[d.DC]
				if a == nil {
					a = &agg{}
					per[d.DC] = a
				}
				if d.IPPreference == "unavailable" {
					a.unreach++
				} else {
					a.reach++
					if d.IPPreference != "" && d.IPPreference != "unknown" && !a.anyPrefs {
						a.pref, a.anyPrefs = d.IPPreference, true
					}
				}
				if d.LatencyEmaMs != nil && (a.best == nil || *d.LatencyEmaMs < *a.best) {
					v := *d.LatencyEmaMs
					a.best = &v
				}
			}
		}
		for dc, a := range per {
			r := get(dc)
			if r.Source == "" {
				r.Source = "upstream"
			}
			r.IPPreference = a.pref
			if r.RttMs == nil {
				r.RttMs = a.best
			}
			switch {
			case a.reach == 0 && a.unreach > 0:
				r.State = DCStateDown
			case r.State == DCStateUnknown && a.reach > 0 && (a.pref != "" || a.best != nil):
				r.State = DCStateUp
			}
		}
	}
	out := make([]DCRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DC < out[j].DC })
	return out, sum
}

// CollectDCStatus queries every running Telemt instance's local control API for Telegram DC
// availability. Results are cached for a few seconds.
func (m *Manager) CollectDCStatus() []InstanceDCStatus {
	if m == nil {
		return nil
	}
	cv, _ := dcCaches.LoadOrStore(m, &dcStatusCache{})
	cache := cv.(*dcStatusCache)
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if time.Since(cache.at) < dcStatusCacheTTL && cache.data != nil {
		return cache.data
	}

	m.mu.Lock()
	tags := make([]string, 0, len(m.running))
	for t := range m.running {
		if strings.TrimSpace(t) != "" {
			tags = append(tags, t)
		}
	}
	m.mu.Unlock()
	sort.Strings(tags)
	ids := map[string]int{}
	if pl, ok := m.ReplaySnapshotForRestart(); ok {
		for _, p := range pl {
			ids[p.Tag] = p.InboundId
		}
	}

	res := make([]InstanceDCStatus, len(tags))
	var wg sync.WaitGroup
	for i, tag := range tags {
		wg.Add(1)
		go func(i int, tag string) {
			defer wg.Done()
			st := InstanceDCStatus{InboundId: ids[tag], Tag: tag, DCs: []DCRow{}, UpdatedAt: time.Now().Unix()}
			b, err := os.ReadFile(filepath.Join(m.stateDirForTag(tag), "config.toml"))
			if err != nil {
				st.Reason = "unreachable"
				res[i] = st
				return
			}
			var doc telemtTomlRoot
			if err := toml.Unmarshal(b, &doc); err != nil {
				logger.Debugf("telemt dc status: %s: parse config: %v", tag, err)
				st.Reason = "unreachable"
				res[i] = st
				return
			}
			if !doc.Server.API.Enabled {
				st.Reason = "api_disabled"
				res[i] = st
				return
			}
			base := "http://" + strings.TrimSpace(doc.Server.API.Listen)
			var me dcStatusResp
			var up upstreamQualityResp
			var meErr, upErr error
			var inner sync.WaitGroup
			inner.Add(2)
			go func() {
				defer inner.Done()
				meErr = fetchTelemtEnvelope(base, doc.Server.API.AuthHeader, "/v1/stats/dcs", &me)
			}()
			go func() {
				defer inner.Done()
				upErr = fetchTelemtEnvelope(base, doc.Server.API.AuthHeader, "/v1/runtime/upstream_quality", &up)
			}()
			inner.Wait()
			if meErr != nil && upErr != nil {
				st.Reason = "unreachable"
				res[i] = st
				return
			}
			var mePtr *dcStatusResp
			var upPtr *upstreamQualityResp
			if meErr == nil {
				mePtr = &me
				st.MEEnabled = me.MiddleProxyEnabled
			}
			if upErr == nil {
				upPtr = &up
			}
			st.DCs, st.Upstreams = buildDCRows(mePtr, upPtr)
			st.Available = len(st.DCs) > 0
			if !st.Available {
				st.Reason = "feature_disabled"
				if me.Reason != "" {
					st.Reason = me.Reason
				}
			}
			res[i] = st
		}(i, tag)
	}
	wg.Wait()
	cache.at = time.Now()
	cache.data = res
	return res
}
