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

	// The fields below are optional extras straight from Telemt (absent on older nodes).
	AvailablePct *float64 `json:"availablePct,omitempty"`
	// Floor* is the ME writer floor policy for this DC (/v1/stats/dcs floor_min/target/max).
	FloorMin    *int `json:"floorMin,omitempty"`
	FloorTarget *int `json:"floorTarget,omitempty"`
	FloorMax    *int `json:"floorMax,omitempty"`
	FloorCapped bool `json:"floorCapped,omitempty"`
	// EndpointList is the ME endpoint list with active writers per endpoint.
	EndpointList []DCEndpoint `json:"endpointList,omitempty"`
	// UpstreamRttMs is the best per-DC upstream connect latency EMA (kept separately from RttMs).
	UpstreamRttMs *float64 `json:"upstreamRttMs,omitempty"`
	// UpstreamReachable / UpstreamUnreachable count healthy upstreams that can / cannot reach the DC.
	UpstreamReachable   int `json:"upstreamReachable,omitempty"`
	UpstreamUnreachable int `json:"upstreamUnreachable,omitempty"`
	// SlowConnectFails sums failed upstream connects that took longer than 1000 ms.
	SlowConnectFails uint64 `json:"slowConnectFails,omitempty"`
	// RefillInflight is the number of ME endpoint refills currently in flight for this DC.
	RefillInflight int `json:"refillInflight,omitempty"`
}

// DCEndpoint is one Middle-End endpoint of a DC.
type DCEndpoint struct {
	Endpoint      string `json:"endpoint"`
	ActiveWriters int    `json:"activeWriters"`
}

// UpstreamSummary is the aggregate health of the instance's upstream routes.
type UpstreamSummary struct {
	Configured int `json:"configured"`
	Healthy    int `json:"healthy"`
	Unhealthy  int `json:"unhealthy"`
	// Optional extras from /v1/runtime/upstream_quality.
	Direct      int `json:"direct,omitempty"`
	Socks4      int `json:"socks4,omitempty"`
	Socks5      int `json:"socks5,omitempty"`
	Shadowsocks int `json:"shadowsocks,omitempty"`
	// Connect counters since Telemt start.
	ConnectAttempts uint64 `json:"connectAttempts,omitempty"`
	ConnectSuccess  uint64 `json:"connectSuccess,omitempty"`
	ConnectFail     uint64 `json:"connectFail,omitempty"`
	// Items are the individual upstream routes (credentials are never exposed by Telemt).
	Items []UpstreamItem `json:"items,omitempty"`
}

// UpstreamItem is the runtime status of one upstream route.
type UpstreamItem struct {
	ID               int      `json:"id"`
	RouteKind        string   `json:"routeKind"`
	Address          string   `json:"address,omitempty"`
	Healthy          bool     `json:"healthy"`
	Fails            int      `json:"fails"`
	LastCheckAgeSecs uint64   `json:"lastCheckAgeSecs"`
	LatencyMs        *float64 `json:"latencyMs,omitempty"`
	Weight           int      `json:"weight,omitempty"`
}

// WriterSummary aggregates the ME writer pool (/v1/runtime/me_pool_state).
type WriterSummary struct {
	Total            int `json:"total"`
	AliveNonDraining int `json:"aliveNonDraining"`
	Draining         int `json:"draining"`
	Degraded         int `json:"degraded"`
	Healthy          int `json:"healthy"`
	Warm             int `json:"warm"`
	Active           int `json:"active"`
}

// PoolSummary describes ME pool generations and hardswap state.
type PoolSummary struct {
	ActiveGeneration    uint64 `json:"activeGeneration"`
	WarmGeneration      uint64 `json:"warmGeneration"`
	DrainingGenerations int    `json:"drainingGenerations"`
	HardswapEnabled     bool   `json:"hardswapEnabled"`
	HardswapPending     bool   `json:"hardswapPending"`
	RefillInflight      int    `json:"refillInflight"`
}

// MEQuality carries key ME lifecycle / route-drop counters (/v1/runtime/me_quality).
type MEQuality struct {
	ReconnectAttempts uint64 `json:"reconnectAttempts"`
	ReconnectSuccess  uint64 `json:"reconnectSuccess"`
	KdfDrift          uint64 `json:"kdfDrift"`
	ReaderEOF         uint64 `json:"readerEof"`
	IdleClosedByPeer  uint64 `json:"idleClosedByPeer"`
	DropNoConn        uint64 `json:"dropNoConn"`
	DropChannelClosed uint64 `json:"dropChannelClosed"`
	DropQueueFull     uint64 `json:"dropQueueFull"`
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

	// Optional extras (additive, absent on older nodes or when Telemt does not report them).
	// Detail is a short technical error string for unavailable instances.
	Detail string `json:"detail,omitempty"`
	// SnapshotAt is Telemt's own generated_at_epoch_secs of the /v1/stats/dcs snapshot.
	SnapshotAt int64          `json:"snapshotAt,omitempty"`
	Writers    *WriterSummary `json:"writers,omitempty"`
	Pool       *PoolSummary   `json:"pool,omitempty"`
	MEQuality  *MEQuality     `json:"meQuality,omitempty"`
}

type dcStatusRow struct {
	DC              int      `json:"dc"`
	Endpoints       []string `json:"endpoints"`
	EndpointWriters []struct {
		Endpoint      string `json:"endpoint"`
		ActiveWriters int    `json:"active_writers"`
	} `json:"endpoint_writers"`
	AvailableEndpoints int      `json:"available_endpoints"`
	AvailablePct       float64  `json:"available_pct"`
	RequiredWriters    int      `json:"required_writers"`
	FloorMin           *int     `json:"floor_min"`
	FloorTarget        *int     `json:"floor_target"`
	FloorMax           *int     `json:"floor_max"`
	FloorCapped        bool     `json:"floor_capped"`
	AliveWriters       int      `json:"alive_writers"`
	CoveragePct        float64  `json:"coverage_pct"`
	RttMs              *float64 `json:"rtt_ms"`
	Load               int      `json:"load"`
}

type dcStatusResp struct {
	MiddleProxyEnabled bool          `json:"middle_proxy_enabled"`
	Reason             string        `json:"reason"`
	GeneratedAt        int64         `json:"generated_at_epoch_secs"`
	DCs                []dcStatusRow `json:"dcs"`
}

type upstreamQualityResp struct {
	Enabled  bool   `json:"enabled"`
	Reason   string `json:"reason"`
	Counters *struct {
		Attempt uint64 `json:"connect_attempt_total"`
		Success uint64 `json:"connect_success_total"`
		Fail    uint64 `json:"connect_fail_total"`
	} `json:"counters"`
	Summary *struct {
		ConfiguredTotal  int `json:"configured_total"`
		HealthyTotal     int `json:"healthy_total"`
		UnhealthyTotal   int `json:"unhealthy_total"`
		DirectTotal      int `json:"direct_total"`
		Socks4Total      int `json:"socks4_total"`
		Socks5Total      int `json:"socks5_total"`
		ShadowsocksTotal int `json:"shadowsocks_total"`
	} `json:"summary"`
	Upstreams []struct {
		ID               int      `json:"upstream_id"`
		RouteKind        string   `json:"route_kind"`
		Address          string   `json:"address"`
		Weight           int      `json:"weight"`
		Healthy          bool     `json:"healthy"`
		Fails            int      `json:"fails"`
		LastCheckAgeSecs uint64   `json:"last_check_age_secs"`
		EffectiveLatency *float64 `json:"effective_latency_ms"`
		DC               []struct {
			DC           int      `json:"dc"`
			LatencyEmaMs *float64 `json:"latency_ema_ms"`
			IPPreference string   `json:"ip_preference"`
			SlowFails    uint64   `json:"connect_duration_fail_bucket_gt_1000ms"`
		} `json:"dc"`
	} `json:"upstreams"`
}

// mePoolStateResp is the "data" payload of /v1/runtime/me_pool_state (it nests its own data block).
type mePoolStateResp struct {
	Enabled bool `json:"enabled"`
	Data    *struct {
		Generations struct {
			Active   uint64   `json:"active_generation"`
			Warm     uint64   `json:"warm_generation"`
			Draining []uint64 `json:"draining_generations"`
		} `json:"generations"`
		Hardswap struct {
			Enabled bool `json:"enabled"`
			Pending bool `json:"pending"`
		} `json:"hardswap"`
		Writers struct {
			Total            int `json:"total"`
			AliveNonDraining int `json:"alive_non_draining"`
			Draining         int `json:"draining"`
			Degraded         int `json:"degraded"`
			Contour          struct {
				Warm   int `json:"warm"`
				Active int `json:"active"`
			} `json:"contour"`
			Health struct {
				Healthy int `json:"healthy"`
			} `json:"health"`
		} `json:"writers"`
		Refill struct {
			InflightTotal int `json:"inflight_endpoints_total"`
			ByDC          []struct {
				DC       int `json:"dc"`
				Inflight int `json:"inflight"`
			} `json:"by_dc"`
		} `json:"refill"`
	} `json:"data"`
}

// meQualityResp is the "data" payload of /v1/runtime/me_quality.
type meQualityResp struct {
	Enabled bool `json:"enabled"`
	Data    *struct {
		Counters struct {
			IdleClose uint64 `json:"idle_close_by_peer_total"`
			ReaderEOF uint64 `json:"reader_eof_total"`
			KdfDrift  uint64 `json:"kdf_drift_total"`
			ReAttempt uint64 `json:"reconnect_attempt_total"`
			ReSuccess uint64 `json:"reconnect_success_total"`
		} `json:"counters"`
		RouteDrops struct {
			NoConn        uint64 `json:"no_conn_total"`
			ChannelClosed uint64 `json:"channel_closed_total"`
			QueueFull     uint64 `json:"queue_full_total"`
		} `json:"route_drops"`
	} `json:"data"`
}

// dcStatusCacheTTL keeps a polling dashboard from hammering every Telemt API.
const dcStatusCacheTTL = 5 * time.Second

type dcStatusCache struct {
	mu   sync.Mutex
	at   time.Time
	data []InstanceDCStatus
}

var dcCaches sync.Map // *Manager -> *dcStatusCache

// shortErr trims an error to a single short line for display (no URLs with credentials are ever in it).
func shortErr(err error) string {
	if err == nil {
		return ""
	}
	m := strings.Join(strings.Fields(err.Error()), " ")
	if len(m) > 200 {
		m = m[:200] + "…"
	}
	return m
}

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

// endpointList merges the DC's endpoint list with the per-endpoint active writer counts.
func endpointList(d dcStatusRow) []DCEndpoint {
	if len(d.Endpoints) == 0 {
		return nil
	}
	w := map[string]int{}
	for _, e := range d.EndpointWriters {
		w[e.Endpoint] = e.ActiveWriters
	}
	out := make([]DCEndpoint, 0, len(d.Endpoints))
	for _, e := range d.Endpoints {
		out = append(out, DCEndpoint{Endpoint: e, ActiveWriters: w[e]})
	}
	return out
}

// applyPoolDetails folds the optional me_pool_state / me_quality snapshots into the instance.
// Either argument may be nil (older Telemt, feature disabled): the extras are then omitted.
func applyPoolDetails(st *InstanceDCStatus, pool *mePoolStateResp, q *meQualityResp) {
	if pool != nil && pool.Enabled && pool.Data != nil {
		d := pool.Data
		st.Writers = &WriterSummary{Total: d.Writers.Total, AliveNonDraining: d.Writers.AliveNonDraining, Draining: d.Writers.Draining,
			Degraded: d.Writers.Degraded, Healthy: d.Writers.Health.Healthy, Warm: d.Writers.Contour.Warm, Active: d.Writers.Contour.Active}
		st.Pool = &PoolSummary{ActiveGeneration: d.Generations.Active, WarmGeneration: d.Generations.Warm,
			DrainingGenerations: len(d.Generations.Draining), HardswapEnabled: d.Hardswap.Enabled, HardswapPending: d.Hardswap.Pending,
			RefillInflight: d.Refill.InflightTotal}
		infl := map[int]int{}
		for _, r := range d.Refill.ByDC {
			infl[r.DC] += r.Inflight
		}
		for i := range st.DCs {
			st.DCs[i].RefillInflight = infl[st.DCs[i].DC]
		}
	}
	if q != nil && q.Enabled && q.Data != nil {
		c, r := q.Data.Counters, q.Data.RouteDrops
		st.MEQuality = &MEQuality{ReconnectAttempts: c.ReAttempt, ReconnectSuccess: c.ReSuccess, KdfDrift: c.KdfDrift, ReaderEOF: c.ReaderEOF,
			IdleClosedByPeer: c.IdleClose, DropNoConn: r.NoConn, DropChannelClosed: r.ChannelClosed, DropQueueFull: r.QueueFull}
	}
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
			ap := d.AvailablePct
			r.AvailablePct = &ap
			r.FloorMin, r.FloorTarget, r.FloorMax, r.FloorCapped = d.FloorMin, d.FloorTarget, d.FloorMax, d.FloorCapped
			r.EndpointList = endpointList(d)
			r.State = classifyDC(d.AvailableEndpoints, len(d.Endpoints), d.RequiredWriters, d.AliveWriters, d.CoveragePct, d.AvailablePct)
		}
	}
	var sum *UpstreamSummary
	if up != nil && up.Enabled {
		if up.Summary != nil {
			sum = &UpstreamSummary{
				Configured: up.Summary.ConfiguredTotal, Healthy: up.Summary.HealthyTotal, Unhealthy: up.Summary.UnhealthyTotal,
				Direct: up.Summary.DirectTotal, Socks4: up.Summary.Socks4Total, Socks5: up.Summary.Socks5Total, Shadowsocks: up.Summary.ShadowsocksTotal,
			}
			if up.Counters != nil {
				sum.ConnectAttempts, sum.ConnectSuccess, sum.ConnectFail = up.Counters.Attempt, up.Counters.Success, up.Counters.Fail
			}
			for _, u := range up.Upstreams {
				sum.Items = append(sum.Items, UpstreamItem{ID: u.ID, RouteKind: u.RouteKind, Address: u.Address, Healthy: u.Healthy,
					Fails: u.Fails, LastCheckAgeSecs: u.LastCheckAgeSecs, LatencyMs: u.EffectiveLatency, Weight: u.Weight})
			}
		}
		// Per DC: best (lowest) latency over healthy upstreams; unavailable only if every
		// healthy upstream says the DC is unreachable.
		type agg struct {
			best     *float64
			slow     uint64
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
				a.slow += d.SlowFails
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
			r.UpstreamRttMs = a.best
			r.UpstreamReachable, r.UpstreamUnreachable, r.SlowConnectFails = a.reach, a.unreach, a.slow
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
				lg.Debugf("telemt dc status: %s: parse config: %v", tag, err)
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
			var poolR mePoolStateResp
			var qualR meQualityResp
			var meErr, upErr, poolErr, qualErr error
			var inner sync.WaitGroup
			inner.Add(4)
			go func() {
				defer inner.Done()
				poolErr = fetchTelemtEnvelope(base, doc.Server.API.AuthHeader, "/v1/runtime/me_pool_state", &poolR)
			}()
			go func() {
				defer inner.Done()
				qualErr = fetchTelemtEnvelope(base, doc.Server.API.AuthHeader, "/v1/runtime/me_quality", &qualR)
			}()
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
				st.Detail = shortErr(meErr)
				res[i] = st
				return
			}
			var mePtr *dcStatusResp
			var upPtr *upstreamQualityResp
			if meErr == nil {
				mePtr = &me
				st.MEEnabled = me.MiddleProxyEnabled
				st.SnapshotAt = me.GeneratedAt
			}
			if upErr == nil {
				upPtr = &up
			}
			st.DCs, st.Upstreams = buildDCRows(mePtr, upPtr)
			var poolPtr *mePoolStateResp
			var qualPtr *meQualityResp
			if poolErr == nil {
				poolPtr = &poolR
			}
			if qualErr == nil {
				qualPtr = &qualR
			}
			applyPoolDetails(&st, poolPtr, qualPtr)
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
