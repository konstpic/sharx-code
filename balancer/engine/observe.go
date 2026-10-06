package engine

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
)

// Journal components of the balancer, used as the "component" filter in the panel.
const (
	CompConfig     = "config"     // apply, validation, reload, restore
	CompEngine     = "engine"     // the HAProxy / nginx process: start, exit, own diagnostics
	CompHealth     = "health"     // backend up/down, failover
	CompConnection = "connection" // one line per closed connection / UDP session (debug)
	CompSystem     = "system"     // conntrack, interface drops
)

var (
	logConfig = logger.WithComponent(CompConfig)
	logEngine = logger.WithComponent(CompEngine)
	logHealth = logger.WithComponent(CompHealth)
	logSystem = logger.WithComponent(CompSystem)
)

// counters are cumulative since the agent started. They are updated from engine output regardless of the journal level,
// so the numbers stay accurate while connection lines are not recorded (info level).
type counters struct {
	connsTotal      atomic.Int64
	connErrors      atomic.Int64 // sessions that ended abnormally (backend connect failure, abort, reset)
	timeouts        atomic.Int64
	bytesRx         atomic.Int64 // from clients, summed over closed sessions
	bytesTx         atomic.Int64 // to clients
	backendFailures atomic.Int64 // backend up -> down transitions
	failovers       atomic.Int64 // backend went down while another member of the pool stayed up
	reloads         atomic.Int64
	applies         atomic.Int64
	applyErrors     atomic.Int64
}

// Diag is the numbers a production incident needs, reported in the agent status.
type Diag struct {
	ConnsTotal      int64             `json:"connectionsTotal"`
	ConnErrors      int64             `json:"connectionErrorsTotal"`
	Timeouts        int64             `json:"timeoutsTotal"`
	BytesRx         int64             `json:"bytesRx"`
	BytesTx         int64             `json:"bytesTx"`
	BackendFailures int64             `json:"backendFailuresTotal"`
	Failovers       int64             `json:"failoversTotal"`
	Reloads         int64             `json:"reloadsTotal"`
	Applies         int64             `json:"appliesTotal"`
	ApplyErrors     int64             `json:"applyErrorsTotal"`
	Selections      map[string]int64  `json:"backendSelectionTotal,omitempty"` // "poolId/host:port" -> connections served (HAProxy)
	Conntrack       *ConntrackDiag    `json:"conntrack,omitempty"`
	Interfaces      []InterfaceDiag   `json:"interfaces,omitempty"`
	LogLevel        string            `json:"logLevel"`
	Extra           map[string]string `json:"extra,omitempty"`
}

// ConntrackDiag is the kernel connection tracking table usage; a full table silently drops new flows.
type ConntrackDiag struct {
	Count int64 `json:"count"`
	Max   int64 `json:"max"`
}

// InterfaceDiag is one physical interface's error and drop counters (cumulative).
type InterfaceDiag struct {
	Name   string `json:"name"`
	RxErrs int64  `json:"rxErrs"`
	RxDrop int64  `json:"rxDrop"`
	TxErrs int64  `json:"txErrs"`
	TxDrop int64  `json:"txDrop"`
}

// ---------- engine output -> journal ----------

// HAProxy tcplog (log stdout format raw), e.g.
//
//	1.2.3.4:5555 [06/Oct/2026:18:37:04.450] fe_1 be_1/s0 1/0/5234 12345 -- 1/1/0/0/0 0/0
//
// client, accept time, frontend, backend/server, Tw/Tc/Tt ms, bytes to client, termination state, conns, queue.
var haproxyLogRe = regexp.MustCompile(`^(\S+) \[([^\]]+)\] (\S+) (\S+)/(\S+) (-?\d+)/(-?\d+)/(-?\d+) (\d+) (\S{2,4}) (\d+)/(\d+)/(\d+)/(\d+)/(\d+) (\d+)/(\d+)`)

// nginx stream access log (see render.nginx log_format sharx): client protocol status bytes_received bytes_sent session_time "upstream" connect_time
var nginxLogRe = regexp.MustCompile(`^SHARX (\S+) (\S+) (\d+) (\d+) (\d+) ([\d.]+) "([^"]*)" (\S+)`)

func (m *Manager) classifyEngineLine(line string, e *logger.Entry) bool {
	if g := haproxyLogRe.FindStringSubmatch(line); g != nil {
		client, fe, be, srv, term := g[1], g[3], g[4], g[5], g[10]
		tt, _ := strconv.ParseInt(g[8], 10, 64)
		tc, _ := strconv.ParseInt(g[7], 10, 64)
		bytes, _ := strconv.ParseInt(g[9], 10, 64)
		if isAgentProbe(client) && tt < 50 && bytes == 0 {
			return false
		}
		m.cnt.connsTotal.Add(1)
		m.cnt.bytesTx.Add(bytes)
		e.Component = CompConnection
		e.ConnID = connID(client, g[2])
		e.Level = "debug"
		reason := ""
		switch {
		case tc < 0 || strings.HasPrefix(term, "SC"):
			reason = "backend connect failed"
		case term[0] == 'c' || term[0] == 's':
			// lower-case first flag = client / server side timeout
			reason = "timeout"
			m.cnt.timeouts.Add(1)
		case term[0] == 'C' || term[0] == 'S':
			reason = "aborted by " + map[byte]string{'C': "client", 'S': "server"}[term[0]]
		case term[0] == 'P' || term[0] == 'R' || term[0] == 'L':
			reason = "proxy/resource"
		}
		if reason != "" {
			m.cnt.connErrors.Add(1)
			e.Level = "warn"
		}
		e.Msg = fmt.Sprintf("session closed client=%s frontend=%s backend=%s server=%s duration_ms=%d bytes_tx=%d term=%s result=%s",
			client, fe, be, srv, tt, bytes, term, orDefault(reason, "ok"))
		return true
	}
	if g := nginxLogRe.FindStringSubmatch(line); g != nil {
		client, proto, status := g[1], g[2], g[3]
		rx, _ := strconv.ParseInt(g[4], 10, 64)
		tx, _ := strconv.ParseInt(g[5], 10, 64)
		if dur, _ := strconv.ParseFloat(g[6], 64); isAgentProbe(client) && dur < 0.05 && rx == 0 && tx == 0 {
			return false
		}
		m.cnt.connsTotal.Add(1)
		m.cnt.bytesRx.Add(rx)
		m.cnt.bytesTx.Add(tx)
		e.Component = CompConnection
		e.ConnID = connID(client, "")
		e.Level = "debug"
		result := "ok"
		if status != "200" {
			// 400 bad request, 403 forbidden, 500 internal, 502 bad gateway (upstream failed), 503 no upstream
			result = "status " + status
			m.cnt.connErrors.Add(1)
			e.Level = "warn"
		}
		if status == "200" && strings.Contains(g[7], ", ") {
			result = "ok after failover: the first backend refused, retried on the next"
		}
		e.Msg = fmt.Sprintf("session closed client=%s proto=%s upstream=%s duration_s=%s bytes_rx=%d bytes_tx=%d connect_s=%s result=%s",
			client, proto, g[7], g[6], rx, tx, g[8], result)
		return true
	}
	// HAProxy prints "Proxy fe_1 stopped" twice (once as [WARNING], once raw) at every reload; both are routine.
	if strings.HasPrefix(line, "Proxy ") && strings.Contains(line, " stopped") {
		return false
	}
	// everything else is the engine talking about itself (reload notices, bind errors, upstream failures)
	e.Component = CompEngine
	if strings.Contains(line, "upstream") || strings.Contains(line, "no live upstreams") {
		e.Component = CompHealth
		if strings.Contains(line, "timed out") {
			m.cnt.timeouts.Add(1)
		}
		m.cnt.connErrors.Add(1)
	}
	if strings.HasPrefix(line, "[NOTICE]") || strings.HasPrefix(line, "[WARNING]") || strings.HasPrefix(line, "[ALERT]") {
		switch {
		case strings.HasPrefix(line, "[WARNING]") && (strings.Contains(line, " stopped") || strings.Contains(line, "exited with code 0")):
			e.Level = "info" // graceful reload: the old worker finished its sessions and left
		case strings.HasPrefix(line, "[WARNING]"):
			e.Level = "warn"
		case strings.HasPrefix(line, "[ALERT]"):
			e.Level = "error"
		default:
			e.Level = "info"
		}
	}
	return true
}

// isAgentProbe says the client is local; together with "no bytes, closed at once" it is the agent's own listener probe.
func isAgentProbe(client string) bool {
	return strings.HasPrefix(client, "127.0.0.1:") || strings.HasPrefix(client, "[::1]:")
}

// connID makes a short correlation id: "1.2.3.4-5555@195748.025" (client, then accept time HHMMSS.mmm).
func connID(client, ts string) string {
	id := strings.NewReplacer(":", "-", "[", "", "]", "").Replace(client)
	if i := strings.IndexByte(ts, ':'); i >= 0 {
		id += "@" + strings.ReplaceAll(ts[i+1:], ":", "")
	}
	return id
}

func orDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

// ---------- backend health watcher ----------

type memberKey struct {
	pool int
	host string
	port int
}

// watchHealth logs backend state changes and counts failures and failovers. It uses the same probes as Status, but only
// every few seconds and only the transitions are written, so the journal stays quiet while nothing changes.
func (m *Manager) watchHealth() {
	prev := map[memberKey]bool{}
	for {
		time.Sleep(5 * time.Second)
		st := m.Status()
		if !st.Running {
			continue
		}
		for _, p := range st.Pools {
			upCount := 0
			for _, mem := range p.Members {
				if mem.Up != nil && *mem.Up {
					upCount++
				}
			}
			for _, mem := range p.Members {
				if mem.Up == nil {
					continue
				}
				k := memberKey{p.ID, mem.Host, mem.Port}
				was, seen := prev[k]
				prev[k] = *mem.Up
				if !seen || was == *mem.Up {
					continue
				}
				if *mem.Up {
					logHealth.Infof("backend up pool=%d backend=%s:%d members_up=%d/%d", p.ID, mem.Host, mem.Port, upCount, len(p.Members))
					continue
				}
				m.cnt.backendFailures.Add(1)
				msg := fmt.Sprintf("backend down pool=%d backend=%s:%d members_up=%d/%d", p.ID, mem.Host, mem.Port, upCount, len(p.Members))
				if upCount > 0 {
					m.cnt.failovers.Add(1)
					msg += " action=failover traffic moved to the remaining members"
				} else {
					msg += " action=none no member left, the pool cannot serve clients"
				}
				logHealth.Warningf("%s", msg)
			}
		}
	}
}

// ---------- system diagnostics ----------

func readConntrack() *ConntrackDiag {
	cb, err1 := os.ReadFile("/proc/sys/net/netfilter/nf_conntrack_count")
	mb, err2 := os.ReadFile("/proc/sys/net/netfilter/nf_conntrack_max")
	if err1 != nil || err2 != nil {
		return nil
	}
	c, _ := strconv.ParseInt(strings.TrimSpace(string(cb)), 10, 64)
	mx, _ := strconv.ParseInt(strings.TrimSpace(string(mb)), 10, 64)
	return &ConntrackDiag{Count: c, Max: mx}
}

// readInterfaceDiag parses /proc/net/dev for physical interfaces (same filter as the traffic graph).
func readInterfaceDiag(path string) []InterfaceDiag {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var out []InterfaceDiag
	for _, line := range strings.Split(string(b), "\n") {
		i := strings.IndexByte(line, ':')
		if i < 0 {
			continue
		}
		name := strings.TrimSpace(line[:i])
		if isVirtualNIC(name) {
			continue
		}
		f := strings.Fields(line[i+1:])
		if len(f) < 16 {
			continue
		}
		n := func(i int) int64 { v, _ := strconv.ParseInt(f[i], 10, 64); return v }
		if n(0) == 0 && n(8) == 0 {
			continue // tunnel pseudo-devices (sit0, ip6tnl0, ...) and unused ports carry no information
		}
		out = append(out, InterfaceDiag{Name: name, RxErrs: n(2), RxDrop: n(3), TxErrs: n(10), TxDrop: n(11)})
	}
	return out
}

// watchSystem warns when the kernel starts dropping packets or the conntrack table nears its limit. These are the
// failure modes that look like "connections stay up but traffic does not come back" and are invisible in the engine.
func (m *Manager) watchSystem() {
	prev := map[string]InterfaceDiag{}
	var ctWarned bool
	for {
		time.Sleep(30 * time.Second)
		for _, d := range readInterfaceDiag("/proc/net/dev") {
			if p, ok := prev[d.Name]; ok {
				dr, de := (d.RxDrop-p.RxDrop)+(d.TxDrop-p.TxDrop), (d.RxErrs-p.RxErrs)+(d.TxErrs-p.TxErrs)
				if dr > 0 || de > 0 {
					logSystem.Warningf("interface %s: +%d dropped, +%d errors in the last 30s (rx_drop=%d tx_drop=%d rx_err=%d tx_err=%d)",
						d.Name, dr, de, d.RxDrop, d.TxDrop, d.RxErrs, d.TxErrs)
				}
			}
			prev[d.Name] = d
		}
		if ct := readConntrack(); ct != nil && ct.Max > 0 {
			full := ct.Count*100/ct.Max >= 80
			if full && !ctWarned {
				logSystem.Warningf("conntrack table is %d%% full (%d/%d): new flows will be dropped when it fills", ct.Count*100/ct.Max, ct.Count, ct.Max)
			}
			ctWarned = full
		}
	}
}

// diag assembles the production counters.
func (m *Manager) diag(sel map[string]int64) Diag {
	return Diag{
		ConnsTotal: m.cnt.connsTotal.Load(), ConnErrors: m.cnt.connErrors.Load(), Timeouts: m.cnt.timeouts.Load(),
		BytesRx: m.cnt.bytesRx.Load(), BytesTx: m.cnt.bytesTx.Load(),
		BackendFailures: m.cnt.backendFailures.Load(), Failovers: m.cnt.failovers.Load(),
		Reloads: m.cnt.reloads.Load(), Applies: m.cnt.applies.Load(), ApplyErrors: m.cnt.applyErrors.Load(),
		Selections: sel, Conntrack: readConntrack(), Interfaces: readInterfaceDiag("/proc/net/dev"), LogLevel: m.LogLevel(),
	}
}

// LogLevel is the journal verbosity: "info" (default) or "debug" (adds one line per closed connection).
func (m *Manager) LogLevel() string {
	b, err := os.ReadFile(m.dir + "/loglevel")
	if err == nil && strings.TrimSpace(string(b)) == "debug" {
		return "debug"
	}
	return "info"
}

// SetLogLevel persists and applies the journal verbosity.
func (m *Manager) SetLogLevel(level string) error {
	if level != "info" && level != "debug" {
		return fmt.Errorf("level must be info or debug")
	}
	if err := os.MkdirAll(m.dir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(m.dir+"/loglevel", []byte(level), 0o600); err != nil {
		return err
	}
	logger.SetMinEmitLevel(level)
	logConfig.Infof("journal level set to %s", level)
	return nil
}
