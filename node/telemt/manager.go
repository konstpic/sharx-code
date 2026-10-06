// Package telemt runs Telemt (MTProto) sidecar processes on the SharX node.
package telemt

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/node/nodecache"
	telemtinstall "github.com/konstpic/sharx-code/v2/telemt/install"
)

// Payload is one inbound worth of Telemt configuration (TOML file contents).
type Payload struct {
	InboundId int    `json:"inboundId"`
	Tag       string `json:"tag"`
	Toml      string `json:"toml"`
}

// Manager supervises one Telemt OS process per inbound tag.
type Manager struct {
	mu         sync.Mutex
	running    map[string]*procState
	workRootMu sync.RWMutex
	workRoot   string // if empty: TELEMT_WORK_ROOT env, else /app/telemt

	// Replay snapshot used by POST /restart-telemt after any successful Apply (including config pull).
	replayMu sync.RWMutex
	replayOK bool
	replay   []Payload

	// cachePath, when set, persists every successful Apply's payloads to disk (see
	// nodecache) so LoadAndApplyCache can resume Telemt sidecars on process restart without
	// the panel — see package node/nodecache doc comment for why this exists.
	cachePathMu sync.RWMutex
	cachePath   string
}

// SetCachePath sets the on-disk path Apply() persists its payloads to (empty disables caching).
// Call before the first Apply/LoadAndApplyCache; typically a path under the node's persistent
// data volume, e.g. /app/data/node-cache/telemt.json.
func (m *Manager) SetCachePath(path string) {
	if m == nil {
		return
	}
	m.cachePathMu.Lock()
	m.cachePath = strings.TrimSpace(path)
	m.cachePathMu.Unlock()
}

func (m *Manager) getCachePath() string {
	m.cachePathMu.RLock()
	defer m.cachePathMu.RUnlock()
	return m.cachePath
}

// LoadAndApplyCache reads the last-applied payloads from SetCachePath's path (if any) and
// applies them, so this Manager can start serving Telemt traffic before/without the panel
// being reachable. A missing cache file is not an error (nothing to resume from yet).
func (m *Manager) LoadAndApplyCache() error {
	if m == nil {
		return nil
	}
	path := m.getCachePath()
	var payloads []Payload
	found, err := nodecache.Load(path, &payloads)
	if err != nil {
		return fmt.Errorf("telemt: read cache %s: %w", path, err)
	}
	if !found || len(payloads) == 0 {
		return nil
	}
	lg.Infof("Telemt: resuming %d sidecar(s) from local cache (panel not required)", len(payloads))
	return m.Apply(payloads)
}

type procState struct {
	cancel context.CancelFunc
	hash   string
	// done is closed once the supervising goroutine has fully finished (the process is gone and
	// will not be restarted), so a replacement can wait for the listening ports to be released.
	done chan struct{}
}

const (
	// stopWaitTimeout bounds how long Apply waits for a replaced/removed process to exit.
	stopWaitTimeout = 10 * time.Second
	// maxQuickRestarts is how many times an instance that keeps dying right after start is retried.
	maxQuickRestarts = 5
	// stableRunSecs: a run at least this long resets the consecutive-failure counter.
	stableRun = 60 * time.Second
)

// telemtEntry is the base journal entry for lines printed by the telemt process of an inbound tag.
// telemtLineLevel reads the level telemt prints ("<ts> INFO module: msg") and demotes the middle-proxy handshake and
// health chatter, which repeats several times a second, to debug.
// telemt prints "<rfc3339 ts> LEVEL module::path: message key=value ...". The timestamp and level are already columns in
// the journal, so they are cut from the text, and the module is shortened to its last two segments.
var telemtLineRe = regexp.MustCompile(`^\s*\S+\s+(ERROR|WARN|INFO|DEBUG|TRACE)\s+(\S+?):\s+(.*)$`)

func telemtLineLevel(line string, e *logger.Entry) bool {
	m := telemtLineRe.FindStringSubmatch(line)
	if m == nil {
		return true
	}
	switch m[1] {
	case "ERROR":
		e.Level = "error"
	case "WARN":
		e.Level = "warn"
	case "DEBUG", "TRACE":
		e.Level = "debug"
	default:
		e.Level = "info"
		if strings.Contains(m[2], "middle_proxy::") && !strings.Contains(m[3], "idle timeout") {
			e.Level = "debug" // handshake and health chatter repeats several times a second
		}
	}
	if strings.HasSuffix(m[2], "health::idle_refresh") {
		e.Level = "debug" // routine writer rotation, logged by telemt as WARN several times a second
	}
	mod := strings.Split(m[2], "::")
	if len(mod) > 2 {
		mod = mod[len(mod)-2:]
	}
	e.Msg = strings.Join(mod, "::") + ": " + m[3]
	return true
}

func telemtEntry(tag string) logger.Entry {
	return logger.Entry{Source: "node", Channel: "service", Component: "telemt", Msg: "", EntityType: "node"}
}

// restartDelay is the pause before restart attempt n (1-based); a variable so tests can shorten it.
var restartDelay = func(n int) time.Duration { return time.Duration(n) * 2 * time.Second }

// stopProc cancels a process and waits (bounded) until it has really exited.
func stopProc(tag string, st *procState) {
	if st == nil {
		return
	}
	if st.cancel != nil {
		st.cancel()
	}
	if st.done == nil {
		return
	}
	select {
	case <-st.done:
	case <-time.After(stopWaitTimeout):
		lg.Warningf("Telemt: %s did not exit within %s", tag, stopWaitTimeout)
	}
}

// superviseProc runs the process until ctx is cancelled. An unexpected exit (for instance a
// port that was not yet free right after a config change) is retried with a growing delay, so an
// instance is never left dead until the next config push.
func superviseProc(ctx context.Context, tag, bin, cfgPath, dir string, first *exec.Cmd, firstFinish func(), done chan struct{}) {
	defer close(done)
	cmd, finish := first, firstFinish
	fails := 0
	for {
		started := time.Now()
		err := cmd.Wait()
		if finish != nil {
			finish() // flush the last lines of the dead process into the journal
		}
		if ctx.Err() != nil {
			return
		}
		if time.Since(started) >= stableRun {
			fails = 0
		}
		fails++
		lg.Warningf("Telemt exited: tag=%s err=%v (attempt %d/%d)", tag, err, fails, maxQuickRestarts)
		if fails > maxQuickRestarts {
			lg.Errorf("Telemt: giving up on %s after %d failed starts", tag, maxQuickRestarts)
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(restartDelay(fails)):
		}
		next := exec.CommandContext(ctx, bin, cfgPath)
		next.Dir = dir
		next.Env = os.Environ()
		nextFinish := logger.CaptureOutputFunc(next, telemtEntry(tag), telemtLineLevel)
		if err := next.Start(); err != nil {
			nextFinish()
			lg.Warningf("Telemt restart %s: %v", tag, err)
			finish = nil
			cmd = &exec.Cmd{} // Wait() on an unstarted command fails at once and counts as a failed attempt
			continue
		}
		lg.Infof("Telemt restarted: tag=%s pid=%d", tag, next.Process.Pid)
		cmd, finish = next, nextFinish
	}
}

// NewManager creates a Telemt manager.
func NewManager() *Manager {
	return &Manager{running: make(map[string]*procState)}
}

func (m *Manager) commitReplaySnapshot(payloads []Payload) {
	if m == nil {
		return
	}
	cp := append([]Payload(nil), payloads...)
	m.replayMu.Lock()
	m.replay = cp
	m.replayOK = true
	m.replayMu.Unlock()

	if path := m.getCachePath(); path != "" {
		if err := nodecache.Save(path, cp); err != nil {
			lg.Warningf("Telemt: write local cache %s: %v", path, err)
		}
	}
}

// ReplaySnapshotForRestart returns the last payloads successfully applied to this Manager, if any.
// An empty-but-valid snapshot means Telemt was intentionally cleared via Apply([]Payload{}).
func (m *Manager) ReplaySnapshotForRestart() ([]Payload, bool) {
	if m == nil {
		return nil, false
	}
	m.replayMu.RLock()
	defer m.replayMu.RUnlock()
	if !m.replayOK {
		return nil, false
	}
	return append([]Payload(nil), m.replay...), true
}

// SetWorkRoot sets the per-manager state directory root (e.g.panel: $XUI_DATA_FOLDER/telemt).
// Worker nodes omit this and rely on TELEMT_WORK_ROOT or the default /app/telemt.
func (m *Manager) SetWorkRoot(abs string) {
	if m == nil {
		return
	}
	m.workRootMu.Lock()
	defer m.workRootMu.Unlock()
	m.workRoot = strings.TrimSpace(abs)
}

func (m *Manager) stateDirForTag(tag string) string {
	m.workRootMu.RLock()
	root := strings.TrimSpace(m.workRoot)
	m.workRootMu.RUnlock()
	if root == "" {
		root = strings.TrimSpace(os.Getenv("TELEMT_WORK_ROOT"))
	}
	if root == "" {
		root = "/app/telemt"
	}
	return filepath.Join(root, tag)
}

func findTelemtBinary() string {
	if p := strings.TrimSpace(os.Getenv("TELEMT_BIN")); p != "" {
		return p
	}
	candidates := []string{
		"/app/bin/telemt",
		"bin/telemt",
		"./bin/telemt",
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// Stop shuts down all Telemt processes.
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for tag, st := range m.running {
		stopProc(tag, st)
		delete(m.running, tag)
	}
}

// Apply replaces running Telemt instances with the given payloads. Missing tags are stopped.
// Empty payloads stops every Telemt process managed by this Manager.
func (m *Manager) Apply(payloads []Payload) error {
	m.mu.Lock()
	if len(payloads) == 0 {
		for tag, st := range m.running {
			stopProc(tag, st)
			delete(m.running, tag)
		}
		m.mu.Unlock()
		m.commitReplaySnapshot(nil)
		return nil
	}
	m.mu.Unlock()

	bin := findTelemtBinary()
	if bin == "" {
		return errors.New("telemt binary not found (install to /app/bin/telemt or set TELEMT_BIN)")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	want := make(map[string]Payload)
	for _, p := range payloads {
		tag := strings.TrimSpace(p.Tag)
		if tag == "" {
			continue
		}
		want[tag] = p
	}

	// Stop removed tags
	for tag, st := range m.running {
		if _, ok := want[tag]; !ok {
			stopProc(tag, st)
			delete(m.running, tag)
		}
	}

	for tag, p := range want {
		toml := p.Toml
		h := sha256.Sum256([]byte(toml))
		hhex := hex.EncodeToString(h[:])
		if cur, ok := m.running[tag]; ok && cur != nil && cur.hash == hhex {
			continue
		}
		if cur, ok := m.running[tag]; ok && cur != nil {
			// Wait for the old process to release its ports before the new one binds them.
			stopProc(tag, cur)
			delete(m.running, tag)
		}

		root := m.stateDirForTag(tag)
		if err := os.MkdirAll(filepath.Join(root, "tlsfront"), 0o755); err != nil {
			return fmt.Errorf("telemt mkdir %s: %w", root, err)
		}
		cfgPath := filepath.Join(root, "config.toml")
		if err := os.WriteFile(cfgPath, []byte(toml), 0o600); err != nil {
			return fmt.Errorf("telemt write %s: %w", cfgPath, err)
		}

		ctx, cancel := context.WithCancel(context.Background())
		cmd := exec.CommandContext(ctx, bin, cfgPath)
		cmd.Dir = root
		cmd.Env = os.Environ()
		finish := logger.CaptureOutputFunc(cmd, telemtEntry(tag), telemtLineLevel)
		if err := cmd.Start(); err != nil {
			finish()
			cancel()
			return fmt.Errorf("telemt start %s: %w", tag, err)
		}
		lg.Infof("Telemt started: tag=%s pid=%d", tag, cmd.Process.Pid)
		done := make(chan struct{})
		go superviseProc(ctx, tag, bin, cfgPath, root, cmd, finish, done)

		m.running[tag] = &procState{cancel: cancel, hash: hhex, done: done}
	}

	m.commitReplaySnapshot(payloads)
	return nil
}

// InstallVersion downloads an official Telemt release and replaces the local binary.
// Running sidecars are stopped and restarted from the last Apply snapshot when applicable.
func (m *Manager) InstallVersion(version string) error {
	if m == nil {
		return errors.New("telemt manager is nil")
	}
	payloads, hasSnapshot := m.ReplaySnapshotForRestart()
	hadRunning := m.RunningCount() > 0
	m.Stop()

	if err := telemtinstall.Install(version, telemtinstall.ResolveBinaryPath()); err != nil {
		return err
	}

	if hasSnapshot && (hadRunning || len(payloads) > 0) {
		return m.Apply(payloads)
	}
	return nil
}

// lg tags this package's journal entries with the telemt component.
var lg = logger.WithComponent("telemt")
