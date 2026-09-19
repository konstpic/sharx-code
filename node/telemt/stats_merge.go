package telemt

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pelletier/go-toml/v2"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/xray"
)

// promFallbackWarned remembers instances already reported as falling back to the JSON API.
var promFallbackWarned sync.Map

const (
	telemtOctetsSnapshotFile = "sharx_telemt_octets.json"
	telemtPromSnapshotFile   = "sharx_telemt_prom.json"
)

type telemtTomlRoot struct {
	Server struct {
		MetricsPort   int    `toml:"metrics_port"`
		MetricsListen string `toml:"metrics_listen"`
		API           struct {
			Enabled    bool   `toml:"enabled"`
			Listen     string `toml:"listen"`
			AuthHeader string `toml:"auth_header"`
		} `toml:"api"`
	} `toml:"server"`
}

type octetsSnapshot struct {
	Users map[string]uint64 `json:"users"`
}

type promUserOctets struct {
	FromClient uint64 `json:"fromClient"`
	ToClient   uint64 `json:"toClient"`
}

type promOctetsSnapshot struct {
	Users map[string]promUserOctets `json:"users"`
}

// MergeTelemtIntoNodeStats polls each running Telemt instance (localhost API) and merges
// per-user octet deltas into traffic / clientTraffic. Snapshots are persisted under the
// instance state dir to derive deltas from cumulative Telemt counters.
func (m *Manager) MergeTelemtIntoNodeStats(traffic *[]*xray.Traffic, clientTraffic *[]*xray.ClientTraffic, onlineClients *[]string) {
	if m == nil || clientTraffic == nil {
		return
	}
	m.mu.Lock()
	tags := make([]string, 0, len(m.running))
	for t := range m.running {
		if strings.TrimSpace(t) != "" {
			tags = append(tags, t)
		}
	}
	m.mu.Unlock()
	if len(tags) == 0 {
		return
	}

	var onlineMu sync.Mutex
	onlineAdded := map[string]struct{}{}
	if onlineClients != nil {
		for _, e := range *onlineClients {
			k := strings.ToLower(strings.TrimSpace(e))
			if k != "" {
				onlineAdded[k] = struct{}{}
			}
		}
	}
	addOnline := func(email string) {
		if onlineClients == nil {
			return
		}
		email = strings.TrimSpace(email)
		if email == "" {
			return
		}
		k := strings.ToLower(email)
		onlineMu.Lock()
		defer onlineMu.Unlock()
		if _, ok := onlineAdded[k]; ok {
			return
		}
		onlineAdded[k] = struct{}{}
		*onlineClients = append(*onlineClients, email)
	}

	clientIdx := map[string]int{}
	if clientTraffic != nil {
		for i, ct := range *clientTraffic {
			if ct == nil {
				continue
			}
			em := strings.ToLower(strings.TrimSpace(ct.Email))
			if em != "" {
				clientIdx[em] = i
			}
		}
	}

	for _, tag := range tags {
		root := m.stateDirForTag(tag)
		cfgPath := filepath.Join(root, "config.toml")
		b, err := os.ReadFile(cfgPath)
		if err != nil {
			continue
		}
		var doc telemtTomlRoot
		if err := toml.Unmarshal(b, &doc); err != nil {
			logger.Debugf("telemt stats: %s: parse config: %v", tag, err)
			continue
		}
		if !doc.Server.API.Enabled {
			continue
		}
		listen := strings.TrimSpace(doc.Server.API.Listen)
		if listen == "" {
			continue
		}
		host, port, err := net.SplitHostPort(listen)
		if err != nil {
			logger.Debugf("telemt stats: %s: invalid api listen %q", tag, listen)
			continue
		}
		baseURL := "http://" + net.JoinHostPort(host, port)
		authHeader := strings.TrimSpace(doc.Server.API.AuthHeader)

		if merged := m.mergeTelemtPrometheusCounters(tag, doc, clientTraffic, &clientIdx, traffic, addOnline); merged {
			continue
		}

		users, err := fetchTelemtUsersJSON(baseURL, authHeader)
		if err != nil {
			logger.Debugf("telemt stats: %s: %v", tag, err)
			continue
		}

		snapPath := filepath.Join(root, telemtOctetsSnapshotFile)
		prev := loadOctetsSnapshot(snapPath)
		if prev.Users == nil {
			prev.Users = make(map[string]uint64)
		}

		var tagTotal int64
		next := octetsSnapshot{Users: make(map[string]uint64, len(users))}

		for _, u := range users {
			user := strings.TrimSpace(u.Username)
			if user == "" {
				continue
			}
			cur := u.TotalOctets
			next.Users[user] = cur

			old, hadOld := prev.Users[user]
			var delta uint64
			if !hadOld {
				delta = 0
			} else if cur >= old {
				delta = cur - old
			} else {
				// Counter reset (Telemt restart) — attribute current total as this tick.
				delta = cur
			}
			if u.CurrentConnections > 0 {
				addOnline(user)
			}
			if delta == 0 {
				continue
			}
			d := int64(delta)
			if d < 0 {
				continue
			}
			tagTotal += d

			// Xray-oriented traffic: Up ≈ download toward the user (server → client). MTProto
			// total_octets is bidirectional; we fold it into Up so AddClientTraffic maps it to client Down.
			if clientTraffic != nil {
				k := strings.ToLower(user)
				if i, ok := clientIdx[k]; ok {
					(*clientTraffic)[i].Up += d
				} else {
					clientIdx[k] = len(*clientTraffic)
					*clientTraffic = append(*clientTraffic, &xray.ClientTraffic{
						Email: user,
						Up:    d,
						Down:  0,
					})
				}
			}
		}

		// Persist users still in Telemt; drop removed users from snapshot.
		if err := saveOctetsSnapshot(snapPath, next); err != nil {
			logger.Debugf("telemt stats: %s: save snapshot: %v", tag, err)
		}

		if tagTotal > 0 && traffic != nil {
			*traffic = append(*traffic, &xray.Traffic{
				IsInbound:  true,
				IsOutbound: false,
				Tag:        tag,
				Up:         tagTotal,
				Down:       0,
			})
		}
	}
}

type telemtUserRow struct {
	Username           string `json:"username"`
	TotalOctets        uint64 `json:"total_octets"`
	CurrentConnections uint64 `json:"current_connections"`
}

func fetchTelemtUsersJSON(baseURL, authHeader string) ([]telemtUserRow, error) {
	u := strings.TrimRight(baseURL, "/") + "/v1/stats/users"
	ctx, cancel := contextWithTimeout(8 * time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: %s", u, strings.TrimSpace(string(body)))
	}
	var env struct {
		OK   bool            `json:"ok"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("decode envelope: %w", err)
	}
	if !env.OK {
		return nil, fmt.Errorf("telemt api error body: %s", strings.TrimSpace(string(body)))
	}
	var rows []telemtUserRow
	if err := json.Unmarshal(env.Data, &rows); err != nil {
		return nil, fmt.Errorf("decode users: %w", err)
	}
	return rows, nil
}

func contextWithTimeout(d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), d)
}

func loadOctetsSnapshot(path string) octetsSnapshot {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return octetsSnapshot{}
	}
	var s octetsSnapshot
	if json.Unmarshal(b, &s) != nil {
		return octetsSnapshot{}
	}
	return s
}

func (m *Manager) mergeTelemtPrometheusCounters(
	tag string,
	doc telemtTomlRoot,
	clientTraffic *[]*xray.ClientTraffic,
	clientIdx *map[string]int,
	traffic *[]*xray.Traffic,
	addOnline func(string),
) bool {
	metricsURL := telemtMetricsURL(doc)
	if metricsURL == "" {
		return false
	}
	cur, err := fetchTelemtPrometheusUserOctets(metricsURL)
	if err != nil || len(cur) == 0 {
		logger.Debugf("telemt stats: %s: prometheus: %v", tag, err)
		// Falling back to the JSON API loses the up/down split (Telemt only reports a bidirectional
		// total there), which shows up as "received = 0". Say so once instead of failing silently.
		if _, warned := promFallbackWarned.LoadOrStore(tag, struct{}{}); !warned {
			logger.Warningf("telemt stats: %s: no per-user octets in Prometheus metrics at %s (err=%v); using the JSON API total, which has no up/down split — check the Telemt metric names after a Telemt upgrade", tag, metricsURL, err)
		}
		return false
	}
	promFallbackWarned.Delete(tag)

	root := m.stateDirForTag(tag)
	snapPath := filepath.Join(root, telemtPromSnapshotFile)
	prev := loadPromOctetsSnapshot(snapPath)
	if prev.Users == nil {
		prev.Users = make(map[string]promUserOctets)
	}
	next := promOctetsSnapshot{Users: make(map[string]promUserOctets, len(cur))}

	var tagUp, tagDown int64
	for user, now := range cur {
		user = strings.TrimSpace(user)
		if user == "" {
			continue
		}
		next.Users[user] = now
		old, had := prev.Users[user]
		dFrom := deltaCounter(now.FromClient, old.FromClient, had)
		dTo := deltaCounter(now.ToClient, old.ToClient, had)
		if dFrom == 0 && dTo == 0 {
			continue
		}
		// Positive delta = user transferred traffic this tick → online.
		// Mirrors legacy JSON path (u.CurrentConnections>0) and onlineFromTraffic in node/xray/manager.go.
		if addOnline != nil {
			addOnline(user)
		}
		tagUp += int64(dTo)
		tagDown += int64(dFrom)
		if clientTraffic != nil {
			k := strings.ToLower(user)
			if i, ok := (*clientIdx)[k]; ok {
				(*clientTraffic)[i].Up += int64(dTo)
				(*clientTraffic)[i].Down += int64(dFrom)
			} else {
				(*clientIdx)[k] = len(*clientTraffic)
				*clientTraffic = append(*clientTraffic, &xray.ClientTraffic{
					Email: user,
					Up:    int64(dTo),
					Down:  int64(dFrom),
				})
			}
		}
	}
	if err := savePromOctetsSnapshot(snapPath, next); err != nil {
		logger.Debugf("telemt stats: %s: save prom snapshot: %v", tag, err)
	}
	// Single inbound traffic entry with the REAL tag so panel CollectNodeStats can map
	// it to inboundId via tagToInboundId. Splitting Down into a synthetic tag+"_up"
	// caused `Total Received` for telemt inbounds to stay at 0 in the Inbounds page.
	if (tagUp > 0 || tagDown > 0) && traffic != nil {
		*traffic = append(*traffic, &xray.Traffic{
			IsInbound:  true,
			IsOutbound: false,
			Tag:        tag,
			Up:         tagUp,
			Down:       tagDown,
		})
	}
	return true
}

func telemtMetricsURL(doc telemtTomlRoot) string {
	if listen := strings.TrimSpace(doc.Server.MetricsListen); listen != "" {
		if !strings.HasPrefix(listen, "http") {
			return "http://" + listen + "/metrics"
		}
		return strings.TrimRight(listen, "/") + "/metrics"
	}
	if doc.Server.MetricsPort > 0 {
		return fmt.Sprintf("http://127.0.0.1:%d/metrics", doc.Server.MetricsPort)
	}
	return ""
}

func fetchTelemtPrometheusUserOctets(metricsURL string) (map[string]promUserOctets, error) {
	ctx, cancel := contextWithTimeout(8 * time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, metricsURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GET %s: %s", metricsURL, strings.TrimSpace(string(body)))
	}
	return parsePromUserOctets(resp.Body)
}

// promUserOctetsKind classifies a Prometheus sample line as a per-user client→server ("from") or
// server→client ("to") octets counter. Telemt 3.5+ exposes these as *_total counters, older builds
// without the suffix — accept both so an upgrade does not silently break traffic accounting.
func promUserOctetsKind(line string) string {
	end := strings.IndexAny(line, "{ \t")
	if end < 0 {
		return ""
	}
	switch strings.TrimSuffix(line[:end], "_total") {
	case "telemt_user_octets_from_client":
		return "from"
	case "telemt_user_octets_to_client":
		return "to"
	}
	return ""
}

func parsePromUserOctets(r io.Reader) (map[string]promUserOctets, error) {
	out := make(map[string]promUserOctets)
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		kind := promUserOctetsKind(line)
		if kind == "" {
			continue
		}
		user := promLabelUser(line)
		if user == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		v, err := strconv.ParseUint(parts[len(parts)-1], 10, 64)
		if err != nil {
			continue
		}
		entry := out[user]
		if kind == "from" {
			entry.FromClient = v
		} else {
			entry.ToClient = v
		}
		out[user] = entry
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func promLabelUser(line string) string {
	i := strings.Index(line, `user="`)
	if i < 0 {
		return ""
	}
	rest := line[i+6:]
	j := strings.Index(rest, `"`)
	if j < 0 {
		return ""
	}
	return rest[:j]
}

func deltaCounter(cur, old uint64, had bool) uint64 {
	if !had {
		return 0
	}
	if cur >= old {
		return cur - old
	}
	return cur
}

func loadPromOctetsSnapshot(path string) promOctetsSnapshot {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return promOctetsSnapshot{}
	}
	var s promOctetsSnapshot
	if json.Unmarshal(b, &s) != nil {
		return promOctetsSnapshot{}
	}
	return s
}

func savePromOctetsSnapshot(path string, s promOctetsSnapshot) error {
	tmp := path + ".tmp"
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func saveOctetsSnapshot(path string, s octetsSnapshot) error {
	tmp := path + ".tmp"
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
