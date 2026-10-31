// Package protocol contains the authenticated store protocol and deterministic
// routing shared by the panel controller and the host agent.
package protocol

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

const Prefix = "/sharx-mesh/"

type Node struct {
	Underlay string `json:"underlay"`
	Overlay  string `json:"overlay"`
	Pubkey   string `json:"pubkey"`
	Priority int    `json:"prio"`
}

var Name = regexp.MustCompile(`^[nb][1-9][0-9]{0,6}$`)

func Octet(ip string) int {
	p := net.ParseIP(ip).To4()
	if p == nil {
		return 0
	}
	return int(p[3])
}
func Overlay(ip string) bool {
	p := net.ParseIP(ip).To4()
	return p != nil && p[0] == 10 && p[1] == 203 && p[2] == 0 && p[3] > 0 && p[3] <= 200
}
func Validate(nodes map[string]Node) error {
	if len(nodes) < 1 || len(nodes) > 200 {
		return errors.New("invalid mesh membership")
	}
	seen := map[string]bool{}
	for n, d := range nodes {
		ip := net.ParseIP(d.Underlay)
		key, e := base64.StdEncoding.DecodeString(d.Pubkey)
		if !Name.MatchString(n) || !Overlay(d.Overlay) || seen[d.Overlay] || ip == nil || ip.To4() == nil || ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() || e != nil || len(key) != 32 {
			return errors.New("invalid mesh node")
		}
		seen[d.Overlay] = true
	}
	return nil
}

type Link struct {
	OK   bool    `json:"ok"`
	RTT  float64 `json:"rtt"`
	Loss float64 `json:"loss"`
}
type Observation struct {
	TS    int64           `json:"ts"`
	Links map[string]Link `json:"links"`
	IP    string          `json:"ip,omitempty"`
	Load  float64         `json:"load"`
}
type Graph map[string]map[string]Link

func finite(v, def, max float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return def
	}
	return math.Min(max, math.Max(0, v))
}
func Edge(g Graph, a, b string) bool { return g[a][b].OK && g[b][a].OK }
func cost(g Graph, a, b string) float64 {
	return math.Max(finite(g[a][b].RTT, 100, 60000), finite(g[b][a].RTT, 100, 60000)) + 1000*math.Max(finite(g[a][b].Loss, 0, 1), finite(g[b][a].Loss, 0, 1))
}

// NextHops allows only a single healthy transit hop. Both transit edges must be
// bidirectionally healthy, preventing recursive transit loops on a common graph.
func NextHops(nodes map[string]Node, g Graph, me string, current map[string]string, loads map[string]float64) map[string]string {
	names := make([]string, 0, len(nodes))
	for n := range nodes {
		names = append(names, n)
	}
	sort.Strings(names)
	out := map[string]string{}
	for _, d := range names {
		if d == me {
			continue
		}
		out[d] = ""
		if Edge(g, me, d) {
			continue
		}
		best := ""
		costs := map[string]float64{}
		for _, t := range names {
			if t == me || t == d || !Edge(g, me, t) || !Edge(g, t, d) {
				continue
			}
			c := cost(g, me, t) + cost(g, t, d) + 100*finite(loads[t], 0, 4)
			costs[t] = c
			if best == "" || nodes[t].Priority < nodes[best].Priority || (nodes[t].Priority == nodes[best].Priority && int(c/25) < int(costs[best]/25)) {
				best = t
			}
		}
		prev := current[d]
		if pc, ok := costs[prev]; ok && best != "" && nodes[prev].Priority == nodes[best].Priority && pc-costs[best] < math.Max(25, pc*.25) {
			best = prev
		}
		out[d] = best
	}
	return out
}

type Tracker struct {
	OK          bool
	initialized bool
	good, bad   int
	samples     []bool
	rtt         float64
}

func (t *Tracker) Update(rtt float64, ok bool) Link {
	if !t.initialized {
		t.OK = true
		t.initialized = true
	}
	if ok {
		t.good++
		t.bad = 0
		if t.good >= 3 {
			t.OK = true
		}
		if t.rtt == 0 {
			t.rtt = rtt
		} else {
			t.rtt = .7*t.rtt + .3*rtt
		}
	} else {
		t.bad++
		t.good = 0
		if t.bad >= 3 {
			t.OK = false
		}
	}
	t.samples = append(t.samples, ok)
	if len(t.samples) > 12 {
		t.samples = t.samples[1:]
	}
	good := 0
	for _, b := range t.samples {
		if b {
			good++
		}
	}
	return Link{t.OK, t.rtt, 1 - float64(good)/float64(len(t.samples))}
}

type Store struct {
	Endpoints []string
	Client    *http.Client
}

func B64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }
func (s *Store) RPC(ctx context.Context, path string, body any, out any) error {
	b, e := json.Marshal(body)
	if e != nil {
		return e
	}
	var last error = errors.New("etcd has no configured members")
	for _, ep := range s.Endpoints {
		if !strings.HasPrefix(ep, "https://") {
			return errors.New("etcd requires mTLS HTTPS")
		}
		q, e := http.NewRequestWithContext(ctx, "POST", ep+"/v3"+path, bytes.NewReader(b))
		if e != nil {
			return e
		}
		q.Header.Set("Content-Type", "application/json")
		r, e := s.Client.Do(q)
		if e != nil {
			last = errors.New("etcd TLS/connection failed")
			continue
		}
		v, e := io.ReadAll(io.LimitReader(r.Body, 4<<20))
		r.Body.Close()
		if e != nil {
			last = e
			continue
		}
		if r.StatusCode >= 300 {
			var msg struct {
				Error string `json:"error"`
			}
			json.Unmarshal(v, &msg)
			last = fmt.Errorf("etcd HTTP %d: %.200s", r.StatusCode, msg.Error)
			continue
		}
		if out == nil {
			return nil
		}
		dec := json.NewDecoder(bytes.NewReader(v))
		dec.UseNumber()
		if e = dec.Decode(out); e == nil {
			return nil
		}
		last = e
	}
	return last
}
func (s *Store) Put(ctx context.Context, key string, value any, ttl int) error {
	b, e := json.Marshal(value)
	if e != nil {
		return e
	}
	body := map[string]any{"key": B64(key), "value": B64(string(b))}
	if ttl > 0 {
		var lease struct {
			ID string `json:"ID"`
		}
		if e = s.RPC(ctx, "/lease/grant", map[string]any{"TTL": ttl}, &lease); e != nil {
			return e
		}
		if lease.ID == "" || lease.ID == "0" {
			return errors.New("invalid etcd lease")
		}
		body["lease"] = lease.ID
	}
	return s.RPC(ctx, "/kv/put", body, nil)
}
func (s *Store) Delete(ctx context.Context, key string) error {
	return s.RPC(ctx, "/kv/deleterange", map[string]any{"key": B64(key)}, nil)
}
func (s *Store) Prefix(ctx context.Context, p string) (map[string]json.RawMessage, error) {
	var r struct {
		KVs []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		} `json:"kvs"`
	}
	end := p[:len(p)-1] + string(p[len(p)-1]+1)
	e := s.RPC(ctx, "/kv/range", map[string]any{"key": B64(p), "range_end": B64(end)}, &r)
	if e != nil {
		return nil, e
	}
	out := map[string]json.RawMessage{}
	for _, kv := range r.KVs {
		k, e := base64.StdEncoding.DecodeString(kv.Key)
		if e != nil {
			return nil, e
		}
		v, e := base64.StdEncoding.DecodeString(kv.Value)
		if e != nil || !json.Valid(v) {
			return nil, errors.New("invalid etcd value")
		}
		out[string(k)] = v
	}
	return out, nil
}
func Timeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, 15*time.Second)
}

// Get reads one JSON value without a prefix scan or floating-point ID conversion.
func (s *Store) Get(ctx context.Context, key string, out any) (bool, error) {
	var r struct {
		KVs []struct {
			Value string `json:"value"`
		} `json:"kvs"`
	}
	if e := s.RPC(ctx, "/kv/range", map[string]string{"key": B64(key)}, &r); e != nil {
		return false, e
	}
	if len(r.KVs) == 0 {
		return false, nil
	}
	b, e := base64.StdEncoding.DecodeString(r.KVs[0].Value)
	if e != nil {
		return false, e
	}
	return true, json.Unmarshal(b, out)
}
