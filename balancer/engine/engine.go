// Package engine runs HAProxy or nginx for the agent: it validates and renders a spec, swaps the live config
// atomically, reloads gracefully, restarts the process if it dies, and reports backend health.
package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/konstpic/sharx-code/v2/balancer/render"
	"github.com/konstpic/sharx-code/v2/balancer/spec"
	"github.com/konstpic/sharx-code/v2/logger"
)

// Manager owns the engine process and the on-disk state (spec.json, live config).
type Manager struct {
	dir string

	mu        sync.Mutex
	cur       spec.Spec
	hash      string
	rendered  string
	engine    string
	cmd       *exec.Cmd
	want      bool // the process should be running
	lastErr   string
	appliedAt time.Time
	version   map[string]string
	metrics   metricsStore
	socks     *sockTracker
}

// New creates a manager storing its state under dir.
func New(dir string) *Manager {
	m := &Manager{dir: dir, version: map[string]string{}, socks: newSockTracker()}
	go m.collectLoop()
	return m
}

func haproxyBin() string { return envOr("HAPROXY_BIN", "haproxy") }
func nginxBin() string   { return envOr("NGINX_BIN", "nginx") }

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func (m *Manager) livePath(engine string) string {
	if engine == spec.EngineNginx {
		return filepath.Join(m.dir, "nginx.conf")
	}
	return filepath.Join(m.dir, "haproxy.cfg")
}

// Restore starts the engine from the last applied spec (after an agent restart) so traffic flows without the panel.
func (m *Manager) Restore() error {
	b, err := os.ReadFile(filepath.Join(m.dir, "spec.json"))
	if err != nil {
		return nil
	}
	var s spec.Spec
	if err := json.Unmarshal(b, &s); err != nil {
		return fmt.Errorf("stored spec is corrupt: %w", err)
	}
	return m.Apply(context.Background(), s)
}

// Apply validates the spec, renders and checks the config with the engine itself, then swaps and reloads it.
// On any failure the running configuration is left untouched.
func (m *Manager) Apply(ctx context.Context, s spec.Spec) error {
	if err := s.Validate(); err != nil {
		return m.fail(err)
	}
	if s.Engine == spec.EngineNginx {
		s = resolveForNginx(s)
		if len(s.Pools) == 0 {
			return m.fail(errors.New("no pool has a resolvable backend"))
		}
	}
	text, err := render.Render(s)
	if err != nil {
		return m.fail(err)
	}
	if err := os.MkdirAll(m.dir, 0o755); err != nil {
		return m.fail(err)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rendered == text && m.engine == s.Engine && m.cmd != nil {
		m.lastErr = ""
		m.cur = s
		m.hash = s.Hash()
		return nil
	}

	candidate := m.livePath(s.Engine) + ".new"
	if err := os.WriteFile(candidate, []byte(text), 0o600); err != nil {
		return m.failLocked(err)
	}
	if out, err := checkConfig(ctx, s.Engine, candidate); err != nil {
		_ = os.Remove(candidate)
		return m.failLocked(fmt.Errorf("%s rejected the config: %v: %s", s.Engine, err, truncate(out)))
	}
	live := m.livePath(s.Engine)
	if err := os.Rename(candidate, live); err != nil {
		return m.failLocked(err)
	}

	if m.cmd != nil && m.engine != s.Engine {
		m.stopLocked()
	}
	m.engine = s.Engine
	if m.cmd == nil {
		if err := m.startLocked(live); err != nil {
			return m.failLocked(err)
		}
	} else if err := m.reloadLocked(); err != nil {
		return m.failLocked(err)
	}

	m.cur, m.hash, m.rendered = s, s.Hash(), text
	m.lastErr, m.appliedAt = "", time.Now()
	if b, err := json.Marshal(s); err == nil {
		_ = os.WriteFile(filepath.Join(m.dir, "spec.json"), b, 0o600)
	}
	return nil
}

func (m *Manager) fail(err error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.failLocked(err)
}

func (m *Manager) failLocked(err error) error {
	m.lastErr = err.Error()
	logger.Warningf("balancer apply failed: %v", err)
	return err
}

func truncate(s string) string {
	if len(s) > 800 {
		return s[:800] + "..."
	}
	return s
}

func checkConfig(ctx context.Context, engine, path string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	var cmd *exec.Cmd
	if engine == spec.EngineNginx {
		cmd = exec.CommandContext(ctx, nginxBin(), "-t", "-c", path)
	} else {
		cmd = exec.CommandContext(ctx, haproxyBin(), "-c", "-f", path)
	}
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func (m *Manager) command(live string) *exec.Cmd {
	if m.engine == spec.EngineNginx {
		return exec.Command(nginxBin(), "-c", live, "-g", "daemon off;")
	}
	return exec.Command(haproxyBin(), "-W", "-db", "-f", live)
}

func (m *Manager) startLocked(live string) error {
	cmd := m.command(live)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	m.cmd, m.want = cmd, true
	logger.Infof("%s started (pid %d)", m.engine, cmd.Process.Pid)
	go m.supervise(cmd, live)
	return nil
}

// supervise restarts the engine if it exits while it should be running.
func (m *Manager) supervise(cmd *exec.Cmd, live string) {
	err := cmd.Wait()
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd != cmd {
		return // replaced or stopped on purpose
	}
	m.cmd = nil
	if !m.want {
		return
	}
	logger.Warningf("%s exited unexpectedly: %v; restarting", m.engine, err)
	m.lastErr = fmt.Sprintf("engine exited: %v", err)
	go func() {
		time.Sleep(2 * time.Second)
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.want && m.cmd == nil {
			if err := m.startLocked(live); err != nil {
				m.lastErr = err.Error()
			}
		}
	}()
}

func (m *Manager) reloadLocked() error {
	if m.cmd == nil || m.cmd.Process == nil {
		return errors.New("engine is not running")
	}
	sig := syscall.SIGUSR2 // haproxy master-worker: graceful re-exec
	if m.engine == spec.EngineNginx {
		sig = syscall.SIGHUP
	}
	return m.cmd.Process.Signal(sig)
}

func (m *Manager) stopLocked() {
	m.want = false
	cmd := m.cmd
	m.cmd = nil
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Signal(syscall.SIGTERM)
	}
}

// Stop terminates the engine.
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopLocked()
}

// MemberStatus is the health of one backend.
type MemberStatus struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Up       *bool  `json:"up"` // nil = unknown (UDP)
	Sessions int    `json:"sessions"`
	Total    int64  `json:"total"` // connections served since the engine started (HAProxy only)
}

// PoolStatus is the health of one pool.
type PoolStatus struct {
	ID    int    `json:"id"`
	Port  int    `json:"port"`
	Proto string `json:"proto"`
	// Listening is whether the listener really accepts connections on the port (false = the bind failed, e.g. the port is
	// taken by another program). nil for UDP, where this cannot be probed.
	Listening *bool          `json:"listening"`
	Members   []MemberStatus `json:"members"`
}

// Status is what the agent reports to the panel.
type Status struct {
	Engine    string       `json:"engine"`
	Running   bool         `json:"running"`
	Hash      string       `json:"hash"`
	AppliedAt int64        `json:"appliedAt"`
	LastError string       `json:"lastError"`
	Pools     []PoolStatus `json:"pools"`
}

// Status probes the backends and reads engine statistics.
func (m *Manager) Status() Status {
	m.mu.Lock()
	st := Status{Engine: m.engine, Running: m.cmd != nil, Hash: m.hash, LastError: m.lastErr}
	if !m.appliedAt.IsZero() {
		st.AppliedAt = m.appliedAt.Unix()
	}
	cur := m.cur
	engine := m.engine
	m.mu.Unlock()

	var stats map[string]haproxyServer
	if engine == spec.EngineHAProxy && st.Running {
		stats, _ = readHAProxyStats()
	}
	for _, p := range cur.Pools {
		ps := PoolStatus{ID: p.ID, Port: p.ListenPort, Proto: p.Proto}
		if p.Proto == spec.ProtoTCP && st.Running {
			l := probeTCP("127.0.0.1", p.ListenPort)
			ps.Listening = &l
		}
		for i, mem := range p.Members {
			ms := MemberStatus{Host: mem.Host, Port: mem.Port}
			if hs, ok := stats[fmt.Sprintf("be_%d/s%d", p.ID, i)]; ok {
				up := hs.Up
				ms.Up, ms.Sessions, ms.Total = &up, hs.Sessions, hs.Total
			} else if p.Proto == spec.ProtoTCP {
				up := probeTCP(mem.Host, mem.Port)
				ms.Up = &up
			}
			ps.Members = append(ps.Members, ms)
		}
		st.Pools = append(st.Pools, ps)
	}
	return st
}

func probeTCP(host string, port int) bool {
	c, err := net.DialTimeout("tcp", net.JoinHostPort(host, fmt.Sprint(port)), 2*time.Second)
	if err != nil {
		return false
	}
	_ = c.Close()
	return true
}
