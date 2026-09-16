// Package amneziawg runs AmneziaWG-go sidecar processes on the SharX panel/node host.
//
// Architecture (mirrors node/telemt):
//   - Protocol `amneziawg` in the panel — NOT emitted into Xray JSON.
//   - One OS process per inbound: amneziawg-go -f awg-{tag} (userspace from github.com/amnezia-vpn/amneziawg-go).
//   - Config applied via amneziawg-tools (`awg setconf` / wg-quick-compatible .conf with Jc/H/S params).
//   - Subscription page exports .conf + QR for the AmneziaWG mobile/desktop app.
//
// Why not Xray fork: stock Xray WireGuard is plain WG; AmneziaWG obfuscation lives in amneziawg-go / kernel module.
package amneziawg

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/node/nodecache"
)

const (
	sidecarStopTimeout = 8 * time.Second
	setconfRetryAttempts = 15
	setconfRetryInterval = 200 * time.Millisecond
)

// Payload is one inbound's awg setconf config and interface name.
type Payload struct {
	InboundId     int    `json:"inboundId"`
	Tag           string `json:"tag"`
	Conf          string `json:"conf"`
	Iface         string `json:"iface"`
	TunnelAddress string            `json:"tunnelAddress,omitempty"`
	TunnelSubnet  string            `json:"tunnelSubnet,omitempty"`
	PeerEmails    map[string]string `json:"peerEmails,omitempty"`
}

// Manager supervises one amneziawg-go process per inbound tag.
type Manager struct {
	mu       sync.Mutex
	running  map[string]*procState
	workRoot string

	replayMu sync.RWMutex
	replay   []Payload
	replayOK bool

	// cachePath, when set, persists every successful Apply's payloads to disk so
	// LoadAndApplyCache can resume AmneziaWG sidecars on process restart without the panel —
	// see package node/nodecache doc comment for why this exists.
	cachePathMu sync.RWMutex
	cachePath   string
}

// SetCachePath sets the on-disk path Apply() persists its payloads to (empty disables caching).
// Call before the first Apply/LoadAndApplyCache; typically a path under the node's persistent
// data volume, e.g. /app/data/node-cache/amneziawg.json.
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
// applies them, so this Manager can start serving AmneziaWG traffic before/without the panel
// being reachable. A missing cache file is not an error (nothing to resume from yet).
func (m *Manager) LoadAndApplyCache() error {
	if m == nil {
		return nil
	}
	path := m.getCachePath()
	var payloads []Payload
	found, err := nodecache.Load(path, &payloads)
	if err != nil {
		return fmt.Errorf("amneziawg: read cache %s: %w", path, err)
	}
	if !found || len(payloads) == 0 {
		return nil
	}
	logger.Infof("AmneziaWG: resuming %d sidecar(s) from local cache (panel not required)", len(payloads))
	return m.Apply(payloads)
}

// SetWorkRoot sets per-manager state directory (panel: $XUI_DATA_FOLDER/amneziawg).
func (m *Manager) SetWorkRoot(root string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.workRoot = strings.TrimSpace(root)
}

// RunningCount returns supervised sidecar tags.
func (m *Manager) RunningCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.running)
}

type procState struct {
	cancel     context.CancelFunc
	hash       string
	cmd        *exec.Cmd
	iface      string
	done       chan struct{}
	configured bool
	confPath   string
	peerEmails map[string]string
}

// NewManager creates an AmneziaWG sidecar manager.
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
			logger.Warningf("AmneziaWG: write local cache %s: %v", path, err)
		}
	}
}

// ReplaySnapshotForRestart returns the last payloads successfully applied to this Manager, if any.
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

func findAmneziaWgBinary() string {
	if p := strings.TrimSpace(os.Getenv("AMNEZIAWG_BIN")); p != "" {
		return p
	}
	for _, c := range []string{"/app/bin/amneziawg-go", "bin/amneziawg-go", "./bin/amneziawg-go"} {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

func findAwgBinary() string {
	if p := strings.TrimSpace(os.Getenv("AWG_BIN")); p != "" {
		return p
	}
	for _, c := range []string{"/app/bin/awg", "bin/awg", "./bin/awg"} {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

func teardownWireGuardIface(iface string) {
	iface = strings.TrimSpace(iface)
	if iface == "" {
		return
	}
	if out, err := exec.Command("ip", "link", "delete", iface).CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		if msg != "" && !strings.Contains(msg, "Cannot find device") {
			logger.Debugf("amneziawg: ip link delete %s: %v (%s)", iface, err, msg)
		}
	}
}

func tunnelSubnetFromPayload(p Payload, conf string) string {
	if s := strings.TrimSpace(p.TunnelSubnet); s != "" {
		return s
	}
	return tunnelSubnetFromConf(conf)
}

func tunnelAddressFromPayload(p Payload, conf string) string {
	if s := strings.TrimSpace(p.TunnelAddress); s != "" {
		return s
	}
	for _, line := range strings.Split(conf, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "Address = ") {
			continue
		}
		addr := strings.TrimSpace(strings.TrimPrefix(line, "Address = "))
		if addr != "" {
			return addr
		}
		break
	}
	return "10.8.0.1/24"
}

func ensureTunnelIfaceAddress(iface, cidr string) {
	iface = strings.TrimSpace(iface)
	cidr = strings.TrimSpace(cidr)
	if iface == "" || cidr == "" {
		return
	}
	host := cidr
	if i := strings.Index(cidr, "/"); i > 0 {
		host = cidr[:i]
	}
	if out, err := exec.Command("ip", "-4", "addr", "show", "dev", iface).CombinedOutput(); err == nil {
		if strings.Contains(string(out), host) {
			if out2, err2 := exec.Command("ip", "link", "set", iface, "up").CombinedOutput(); err2 != nil {
				logger.Warningf("amneziawg ip link up %s: %v (%s)", iface, err2, strings.TrimSpace(string(out2)))
			}
			return
		}
	}
	if out, err := exec.Command("ip", "addr", "add", cidr, "dev", iface).CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		if !strings.Contains(msg, "File exists") {
			logger.Warningf("amneziawg ip addr add %s %s: %v (%s)", iface, cidr, err, msg)
		}
	}
	if out, err := exec.Command("ip", "link", "set", iface, "up").CombinedOutput(); err != nil {
		logger.Warningf("amneziawg ip link up %s: %v (%s)", iface, err, strings.TrimSpace(string(out)))
	} else {
		logger.Infof("amneziawg iface up: %s %s", iface, cidr)
	}
}

func tunnelSubnetFromConf(conf string) string {
	for _, line := range strings.Split(conf, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "Address = ") {
			continue
		}
		addr := strings.TrimSpace(strings.TrimPrefix(line, "Address = "))
		if addr == "" {
			break
		}
		if !strings.Contains(addr, "/") {
			return addr + "/24"
		}
		_, ipnet, err := net.ParseCIDR(addr)
		if err != nil || ipnet == nil {
			return addr
		}
		return ipnet.String()
	}
	return "10.8.0.0/24"
}

// buildIptablesArgs builds argv for iptables: table (-t) before command (-A/-C/-D).
func buildIptablesArgs(table, command string, args ...string) []string {
	cmdArgs := make([]string, 0, 4+len(args))
	if table != "" {
		cmdArgs = append(cmdArgs, "-t", table)
	}
	cmdArgs = append(cmdArgs, command)
	return append(cmdArgs, args...)
}

func iptablesHasRule(table string, args ...string) bool {
	return exec.Command("iptables", buildIptablesArgs(table, "-C", args...)...).Run() == nil
}

func iptablesEnsureAppend(table string, args ...string) {
	if iptablesHasRule(table, args...) {
		return
	}
	cmdArgs := buildIptablesArgs(table, "-A", args...)
	if out, err := exec.Command("iptables", cmdArgs...).CombinedOutput(); err != nil {
		logger.Warningf("amneziawg iptables append %v: %v (%s)", args, err, strings.TrimSpace(string(out)))
	}
}

// ensureTunnelRouting enables forward + NAT for the sidecar TUN (awg setconf does not run PostUp hooks).
func ensureTunnelRouting(iface, subnet string) {
	iface = strings.TrimSpace(iface)
	subnet = strings.TrimSpace(subnet)
	if iface == "" {
		return
	}
	if subnet == "" {
		subnet = "10.8.0.0/24"
	}
	if out, err := exec.Command("sysctl", "-w", "net.ipv4.ip_forward=1").CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		if !strings.Contains(msg, "Read-only file system") {
			logger.Warningf("amneziawg sysctl ip_forward: %v (%s)", err, msg)
		}
	}
	iptablesEnsureAppend("", "FORWARD", "-i", iface, "-j", "ACCEPT")
	iptablesEnsureAppend("", "FORWARD", "-o", iface, "-j", "ACCEPT")
	iptablesEnsureAppend("nat", "POSTROUTING", "-s", subnet, "-j", "MASQUERADE")
	logger.Infof("amneziawg routing OK: iface=%s subnet=%s", iface, subnet)
}

func listenPortFromConf(conf string) string {
	for _, line := range strings.Split(conf, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "ListenPort = ") {
			return strings.TrimSpace(strings.TrimPrefix(line, "ListenPort = "))
		}
	}
	return ""
}

func peerCountFromConf(conf string) int {
	n := 0
	for _, line := range strings.Split(conf, "\n") {
		if strings.TrimSpace(line) == "[Peer]" {
			n++
		}
	}
	return n
}

func applyAwgSetconf(tag string, p Payload, confPath string) bool {
	awg := findAwgBinary()
	if awg == "" {
		logger.Warningf("amneziawg: awg binary not found — sidecar %s setconf skipped", tag)
		return false
	}
	iface := strings.TrimSpace(p.Iface)
	confPath = strings.TrimSpace(confPath)
	conf := p.Conf
	if iface == "" || confPath == "" {
		return false
	}
	var lastOut string
	var lastErr error
	for attempt := 1; attempt <= setconfRetryAttempts; attempt++ {
		out, err := exec.Command(awg, "setconf", iface, confPath).CombinedOutput()
		lastOut = strings.TrimSpace(string(out))
		lastErr = err
		if err == nil {
			port := listenPortFromConf(conf)
			peers := peerCountFromConf(conf)
			logger.Infof("amneziawg setconf OK: tag=%s iface=%s listenPort=%s peers=%d (attempt %d)", tag, iface, port, peers, attempt)
			ensureTunnelIfaceAddress(iface, tunnelAddressFromPayload(p, conf))
			ensureTunnelRouting(iface, tunnelSubnetFromPayload(p, conf))
			if showOut, showErr := exec.Command(awg, "show", iface).CombinedOutput(); showErr == nil {
				summary := strings.TrimSpace(string(showOut))
				if len(summary) > 240 {
					summary = summary[:240] + "…"
				}
				if summary != "" {
					logger.Infof("amneziawg show %s: %s", iface, summary)
				}
			}
			return true
		}
		if attempt < setconfRetryAttempts {
			time.Sleep(setconfRetryInterval)
		}
	}
	logger.Warningf("amneziawg setconf FAILED tag=%s iface=%s after %d attempts: %v (%s)", tag, iface, setconfRetryAttempts, lastErr, lastOut)
	return false
}

func (m *Manager) stopProc(st *procState) {
	if st == nil {
		return
	}
	if st.cancel != nil {
		st.cancel()
	}
	if st.done != nil {
		select {
		case <-st.done:
		case <-time.After(sidecarStopTimeout):
			if st.cmd != nil && st.cmd.Process != nil {
				_ = st.cmd.Process.Kill()
				select {
				case <-st.done:
				case <-time.After(2 * time.Second):
				}
			}
		}
	}
	teardownWireGuardIface(st.iface)
}

// Apply starts or updates sidecars.
func (m *Manager) Apply(payloads []Payload) error {
	m.mu.Lock()
	if len(payloads) == 0 {
		for tag, st := range m.running {
			m.stopProc(st)
			delete(m.running, tag)
		}
		m.mu.Unlock()
		m.commitReplaySnapshot(nil)
		return nil
	}
	m.mu.Unlock()

	bin := findAmneziaWgBinary()
	if bin == "" {
		return errors.New("amneziawg-go binary not found (build to /app/bin/amneziawg-go or set AMNEZIAWG_BIN)")
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

	for tag, st := range m.running {
		if _, ok := want[tag]; !ok {
			m.stopProc(st)
			delete(m.running, tag)
		}
	}

	root := strings.TrimSpace(m.workRoot)
	if root == "" {
		root = strings.TrimSpace(os.Getenv("AMNEZIAWG_WORK_ROOT"))
	}
	if root == "" {
		root = "/app/amneziawg"
	}

	for tag, p := range want {
		conf := p.Conf
		h := sha256.Sum256([]byte(conf))
		hhex := hex.EncodeToString(h[:])

		iface := strings.TrimSpace(p.Iface)
		if iface == "" {
			iface = ifaceForPayload(p)
		}

		if cur, ok := m.running[tag]; ok && cur != nil && cur.hash == hhex {
			if cur.configured {
				continue
			}
			if err := os.WriteFile(cur.confPath, []byte(conf), 0o600); err != nil {
				logger.Warningf("amneziawg rewrite conf %s: %v", tag, err)
			} else {
				retry := p
				retry.Iface = cur.iface
				if applyAwgSetconf(tag, retry, cur.confPath) {
					cur.configured = true
					cur.peerEmails = copyPeerEmails(p.PeerEmails)
				}
			}
			continue
		}
		if cur, ok := m.running[tag]; ok {
			m.stopProc(cur)
			delete(m.running, tag)
		}
		// Stale TUN from a prior crash / kernel AWG module may still hold the name.
		teardownWireGuardIface(iface)

		stateDir := filepath.Join(root, tag)
		if err := os.MkdirAll(stateDir, 0o755); err != nil {
			return fmt.Errorf("amneziawg mkdir %s: %w", stateDir, err)
		}
		confPath := filepath.Join(stateDir, iface+".conf")
		if err := os.WriteFile(confPath, []byte(conf), 0o600); err != nil {
			return fmt.Errorf("amneziawg write conf: %w", err)
		}

		ctx, cancel := context.WithCancel(context.Background())
		cmd := exec.CommandContext(ctx, bin, "-f", iface)
		cmd.Dir = stateDir
		cmd.Env = os.Environ()
		cmd.Stdout = os.Stderr
		cmd.Stderr = os.Stderr

		done := make(chan struct{})
		if err := cmd.Start(); err != nil {
			cancel()
			close(done)
			return fmt.Errorf("amneziawg-go start %s: %w", tag, err)
		}
		go func(tag string, cmd *exec.Cmd, waitCtx context.Context, done chan struct{}) {
			defer close(done)
			err := cmd.Wait()
			if err != nil && waitCtx.Err() == nil {
				logger.Warningf("AmneziaWG-go exited: tag=%s err=%v", tag, err)
			}
		}(tag, cmd, ctx, done)

		p.Iface = iface
		configured := applyAwgSetconf(tag, p, confPath)
		logger.Infof("AmneziaWG-go started: tag=%s iface=%s pid=%d configured=%v", tag, iface, cmd.Process.Pid, configured)

		m.running[tag] = &procState{
			cancel: cancel, hash: hhex, cmd: cmd, iface: iface, done: done,
			configured: configured, confPath: confPath, peerEmails: copyPeerEmails(p.PeerEmails),
		}
	}
	m.commitReplaySnapshot(payloads)
	return nil
}

func ifaceForPayload(p Payload) string {
	if p.InboundId > 0 {
		return fmt.Sprintf("awg%d", p.InboundId)
	}
	tag := strings.TrimSpace(p.Tag)
	if tag == "" {
		return "awg0"
	}
	return "awg-" + sanitizeIface(tag)
}

func copyPeerEmails(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func sanitizeIface(tag string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(tag) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else if r == '-' || r == '_' {
			b.WriteRune('-')
		}
	}
	s := b.String()
	if s == "" {
		return "0"
	}
	if len(s) > 12 {
		s = s[:12]
	}
	return s
}

// Stop shuts down all AmneziaWG sidecars.
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for tag, st := range m.running {
		m.stopProc(st)
		delete(m.running, tag)
	}
}
