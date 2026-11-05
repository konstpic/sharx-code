// Package qos applies SharX Network client-facing traffic limits with Linux tc.
package qos

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/node/nodecache"
)

const (
	DefaultCommandTimeout = 5 * time.Second
	filterPriority        = "10"
	filterPriorityIPv6    = "11"
)

var interfaceNamePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,15}$`)

// Spec describes the configured bottleneck and the dedicated network inbound.
// SpeedLimitMbps is a hard RX/TX ceiling; ReserveMbps is the guaranteed default-class TX rate.
type Spec struct {
	Interface      string `json:"interface,omitempty"`
	Port           int    `json:"port"`
	CapacityMbps   int    `json:"capacityMbps"`
	SpeedLimitMbps int    `json:"speedLimitMbps"`
	ReserveMbps    int    `json:"reserveMbps"`
}

// Status reports the desired and actually observed tc state.
type Status struct {
	Ready          bool   `json:"ready"`
	State          string `json:"state"`
	Interface      string `json:"interface,omitempty"`
	Port           int    `json:"port,omitempty"`
	CapacityMbps   int    `json:"capacityMbps,omitempty"`
	SpeedLimitMbps int    `json:"speedLimitMbps,omitempty"`
	ReserveMbps    int    `json:"reserveMbps,omitempty"`
	DesiredHash    string `json:"desiredHash,omitempty"`
	AppliedHash    string `json:"appliedHash,omitempty"`
	Error          string `json:"error,omitempty"`
	CheckedAt      int64  `json:"checkedAt"`
}

type Runner interface {
	Run(ctx context.Context, name string, args ...string) (string, error)
}

type execRunner struct{}

func (execRunner) Run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return string(output), nil
}

// Manager serializes changes and verifies every applied configuration against tc output.
type Manager struct {
	mu             sync.Mutex
	runner         Runner
	cachePath      string
	commandTimeout time.Duration
	desired        *Spec
	status         Status
}

func NewManager(cachePath string) *Manager {
	return &Manager{
		runner:         execRunner{},
		cachePath:      cachePath,
		commandTimeout: DefaultCommandTimeout,
		status:         Status{State: "disabled", CheckedAt: time.Now().Unix()},
	}
}

func Validate(spec Spec) error {
	if spec.Interface != "" && !interfaceNamePattern.MatchString(spec.Interface) {
		return errors.New("qos: invalid interface name")
	}
	if spec.Port < 1 || spec.Port > 65535 {
		return errors.New("qos: port out of range")
	}
	if spec.CapacityMbps < 1 || spec.CapacityMbps > 10000 {
		return errors.New("qos: configured capacity is required (1..10000 Mbps)")
	}
	if spec.SpeedLimitMbps < 1 || spec.SpeedLimitMbps > 10000 {
		return errors.New("qos: speed limit out of range")
	}
	if spec.ReserveMbps < 0 || spec.ReserveMbps > 10000 {
		return errors.New("qos: reserve out of range")
	}
	if spec.SpeedLimitMbps+spec.ReserveMbps > spec.CapacityMbps {
		return errors.New("qos: speedLimitMbps + reserveMbps exceeds configured capacity")
	}
	return nil
}

func (m *Manager) run(ctx context.Context, name string, args ...string) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	commandCtx, cancel := context.WithTimeout(ctx, m.commandTimeout)
	defer cancel()
	output, err := m.runner.Run(commandCtx, name, args...)
	if errors.Is(commandCtx.Err(), context.DeadlineExceeded) {
		return output, fmt.Errorf("%s command timed out: %w", name, commandCtx.Err())
	}
	return output, err
}

func (m *Manager) resolveInterface(ctx context.Context, name string) (string, error) {
	if name != "" {
		return name, nil
	}
	output, err := m.run(ctx, "ip", "route", "show", "default")
	if err != nil {
		return "", fmt.Errorf("qos: discover default interface: %w", err)
	}
	interfaces := map[string]struct{}{}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		for i := 0; i+1 < len(fields); i++ {
			if fields[i] == "dev" && interfaceNamePattern.MatchString(fields[i+1]) {
				interfaces[fields[i+1]] = struct{}{}
			}
		}
	}
	if len(interfaces) != 1 {
		return "", fmt.Errorf("qos: explicit interface required; found %d default-route interfaces", len(interfaces))
	}
	for iface := range interfaces {
		return iface, nil
	}
	return "", errors.New("qos: no default interface")
}

func qdiscKind(output string) (string, string) {
	fields := strings.Fields(output)
	if len(fields) < 2 || fields[0] != "qdisc" {
		return "", ""
	}
	handle := ""
	if len(fields) > 2 {
		handle = fields[2]
	}
	return strings.ToLower(fields[1]), handle
}

func (m *Manager) preflightLocked(ctx context.Context, spec Spec) error {
	root, err := m.run(ctx, "tc", "qdisc", "show", "dev", spec.Interface, "root")
	if err != nil {
		return fmt.Errorf("qos: inspect root qdisc: %w", err)
	}
	kind, handle := qdiscKind(root)
	ownedHTB := kind == "htb" && handle == "1:" && m.desired != nil && m.desired.Interface == spec.Interface
	if !ownedHTB {
		switch kind {
		case "noqueue", "pfifo_fast", "fq_codel":
		case "mq":
			return errors.New("qos: refusing to replace mq root qdisc")
		default:
			return fmt.Errorf("qos: refusing to replace unknown or custom root qdisc %q", strings.TrimSpace(root))
		}
	}
	ingress, err := m.run(ctx, "tc", "qdisc", "show", "dev", spec.Interface, "ingress")
	if err != nil {
		return fmt.Errorf("qos: inspect ingress qdisc: %w", err)
	}
	kind, _ = qdiscKind(ingress)
	if kind == "ingress" && m.desired == nil {
		filters, err := m.run(ctx, "tc", "filter", "show", "dev", spec.Interface, "parent", "ffff:")
		if err != nil {
			return err
		}
		if strings.TrimSpace(filters) != "" {
			return errors.New("qos: refusing to replace foreign ingress filters")
		}
	}
	if kind != "" && kind != "ingress" {
		return fmt.Errorf("qos: refusing to replace custom ingress qdisc %q", strings.TrimSpace(ingress))
	}
	output, err := m.run(ctx, "tc", "actions", "get", "action", "police", "index", strconv.Itoa(100000+spec.Port))
	if err == nil && strings.TrimSpace(output) != "" && (m.desired == nil || m.desired.Port != spec.Port) {
		return errors.New("qos: refusing to replace a foreign policing action")
	}
	return nil
}

func specHash(spec Spec) string {
	data, _ := json.Marshal(spec)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func statusFor(spec Spec, hash string) Status {
	return Status{
		State: "failed", Interface: spec.Interface, Port: spec.Port,
		CapacityMbps: spec.CapacityMbps, SpeedLimitMbps: spec.SpeedLimitMbps,
		ReserveMbps: spec.ReserveMbps, DesiredHash: hash, CheckedAt: time.Now().Unix(),
	}
}

func rate(mbps int) string {
	if mbps == 0 {
		return "1kbit"
	}
	return strconv.Itoa(mbps) + "mbit"
}

func (m *Manager) failLocked(spec Spec, err error) error {
	hash := ""
	if spec.Interface != "" {
		hash = specHash(spec)
	}
	st := statusFor(spec, hash)
	st.Error = err.Error()
	m.status = st
	return err
}

// Apply installs or reconciles HTB+bounded FIFO egress and ingress police rules.
func (m *Manager) Apply(ctx context.Context, spec Spec) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := Validate(spec); err != nil {
		return m.failLocked(spec, err)
	}
	iface, err := m.resolveInterface(ctx, spec.Interface)
	if err != nil {
		return m.failLocked(spec, err)
	}
	spec.Interface = iface
	if m.desired != nil && (m.desired.Interface != iface || m.desired.Port != spec.Port) {
		return m.failLocked(spec, errors.New("qos: clear old configuration before changing interface or port"))
	}
	if err := m.preflightLocked(ctx, spec); err != nil {
		return m.failLocked(spec, err)
	}
	if err := nodecache.Save(m.cachePath, spec); err != nil {
		return m.failLocked(spec, fmt.Errorf("qos: persist desired state: %w", err))
	}
	m.desired = &spec
	m.status = statusFor(spec, specHash(spec))

	root, err := m.run(ctx, "tc", "qdisc", "show", "dev", iface, "root")
	if err != nil {
		return m.failLocked(spec, err)
	}
	ingress, err := m.run(ctx, "tc", "qdisc", "show", "dev", iface, "ingress")
	if err != nil {
		return m.failLocked(spec, err)
	}
	actionIndex := strconv.Itoa(100000 + spec.Port)
	commands := [][]string{
		{"actions", "replace", "action", "police", "rate", rate(spec.SpeedLimitMbps), "burst", "256k", "conform-exceed", "drop", "index", actionIndex},
		{"qdisc", "replace", "dev", iface, "root", "handle", "1:", "htb", "default", "20"},
		{"class", "replace", "dev", iface, "parent", "1:", "classid", "1:1", "htb", "rate", rate(spec.CapacityMbps), "ceil", rate(spec.CapacityMbps)},
		{"class", "replace", "dev", iface, "parent", "1:1", "classid", "1:10", "htb", "rate", rate(spec.SpeedLimitMbps), "ceil", rate(spec.SpeedLimitMbps), "burst", "256k", "prio", "7"},
		{"qdisc", "replace", "dev", iface, "parent", "1:10", "handle", "110:", "pfifo", "limit", "256"},
		{"class", "replace", "dev", iface, "parent", "1:1", "classid", "1:20", "htb", "rate", rate(spec.ReserveMbps), "ceil", rate(spec.CapacityMbps), "burst", "256k", "prio", "0"},
		{"qdisc", "replace", "dev", iface, "parent", "1:20", "handle", "120:", "pfifo", "limit", "256"},
		{"filter", "replace", "dev", iface, "parent", "1:", "protocol", "ip", "pref", filterPriority, "handle", "1", "flower", "ip_proto", "tcp", "src_port", strconv.Itoa(spec.Port), "classid", "1:10"},
		{"filter", "replace", "dev", iface, "parent", "1:", "protocol", "ipv6", "pref", filterPriorityIPv6, "handle", "2", "flower", "ip_proto", "tcp", "src_port", strconv.Itoa(spec.Port), "classid", "1:10"},
		{"qdisc", "replace", "dev", iface, "handle", "ffff:", "ingress"},
		{"filter", "replace", "dev", iface, "parent", "ffff:", "protocol", "ip", "pref", filterPriority, "handle", "1", "flower", "ip_proto", "tcp", "dst_port", strconv.Itoa(spec.Port), "action", "police", "index", actionIndex},
		{"filter", "replace", "dev", iface, "parent", "ffff:", "protocol", "ipv6", "pref", filterPriorityIPv6, "handle", "2", "flower", "ip_proto", "tcp", "dst_port", strconv.Itoa(spec.Port), "action", "police", "index", actionIndex},
	}
	for _, args := range commands {
		// HTB and ingress do not implement qdisc change on all supported kernels.
		// Retain the owned root and update its classes/filters in place.
		if args[0] == "qdisc" && args[4] == "root" && containsAll(root, "qdisc htb 1:") {
			continue
		}
		if args[0] == "qdisc" && args[len(args)-1] == "ingress" && containsAll(ingress, "qdisc ingress ffff:") {
			continue
		}
		if _, err := m.run(ctx, "tc", args...); err != nil {
			return m.failLocked(spec, fmt.Errorf("qos: tc %s: %w", args[0], err))
		}
	}
	return m.verifyLocked(ctx)
}

func containsAll(output string, parts ...string) bool {
	output = normalizeTCRates(strings.ToLower(output))
	for _, part := range parts {
		if !strings.Contains(output, normalizeTCRates(strings.ToLower(part))) {
			return false
		}
	}
	return true
}

func (m *Manager) verifyLocked(ctx context.Context) error {
	if m.desired == nil {
		return errors.New("qos: no desired state")
	}
	spec := *m.desired
	hash := specHash(spec)
	st := statusFor(spec, hash)
	fail := func(format string, args ...any) error {
		st.Error = fmt.Sprintf(format, args...)
		m.status = st
		return errors.New(st.Error)
	}
	root, err := m.run(ctx, "tc", "qdisc", "show", "dev", spec.Interface, "root")
	if err != nil {
		return fail("qos: verify root qdisc: %v", err)
	}
	if !containsAll(root, "qdisc htb 1:") {
		return fail("qos: owned HTB root qdisc is missing")
	}
	classes, err := m.run(ctx, "tc", "class", "show", "dev", spec.Interface, "parent", "1:")
	if err != nil {
		return fail("qos: verify classes: %v", err)
	}
	if !classMatches(classes, "htb 1:10", "rate "+rate(spec.SpeedLimitMbps), "ceil "+rate(spec.SpeedLimitMbps)) ||
		!classMatches(classes, "htb 1:20", "rate "+rate(spec.ReserveMbps), "ceil "+rate(spec.CapacityMbps)) {
		return fail("qos: configured HTB rates do not match desired state")
	}
	egress, err := m.run(ctx, "tc", "filter", "show", "dev", spec.Interface, "parent", "1:")
	if err != nil {
		return fail("qos: verify egress filters: %v", err)
	}
	port := strconv.Itoa(spec.Port)
	if !filterMatches(egress, "protocol ip ", "src_port "+port, "classid 1:10") ||
		!filterMatches(egress, "protocol ipv6 ", "src_port "+port, "classid 1:10") {
		return fail("qos: IPv4/IPv6 egress flower filters are missing")
	}
	ingress, err := m.run(ctx, "tc", "filter", "show", "dev", spec.Interface, "parent", "ffff:")
	if err != nil {
		return fail("qos: verify ingress filters: %v", err)
	}
	if !filterMatches(ingress, "protocol ip ", "dst_port "+port, "police", "rate "+rate(spec.SpeedLimitMbps)) ||
		!filterMatches(ingress, "protocol ipv6 ", "dst_port "+port, "police", "rate "+rate(spec.SpeedLimitMbps)) {
		return fail("qos: IPv4/IPv6 ingress police filters are missing")
	}
	st.Ready = true
	st.State = "ready"
	st.AppliedHash = hash
	st.CheckedAt = time.Now().Unix()
	m.status = st
	return nil
}

// Status verifies the current kernel state; failed or stale state is never reported ready.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.desired == nil {
		if m.status.State == "failed" {
			return m.status
		}
		m.status = Status{State: "disabled", CheckedAt: time.Now().Unix()}
		return m.status
	}
	_ = m.verifyLocked(context.Background())
	return m.status
}

func filterPresent(output, protocol, portKey, port string) bool {
	for _, block := range strings.Split(output, "filter ") {
		if containsAll(block, "protocol "+protocol, portKey+" "+port) {
			return true
		}
	}
	return false
}

// Clear removes only SharX filters and an owned HTB root. Foreign qdiscs are left untouched.
func (m *Manager) Clear(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.desired == nil {
		if err := os.Remove(m.cachePath); err != nil && !os.IsNotExist(err) {
			return err
		}
		m.status = Status{State: "disabled", CheckedAt: time.Now().Unix()}
		return nil
	}
	spec := *m.desired
	root, err := m.run(ctx, "tc", "qdisc", "show", "dev", spec.Interface, "root")
	if err != nil {
		return m.failLocked(spec, fmt.Errorf("qos: clear inspect root: %w", err))
	}
	kind, handle := qdiscKind(root)
	ownedRoot := kind == "htb" && handle == "1:"
	if !ownedRoot {
		switch kind {
		case "noqueue", "pfifo_fast", "fq_codel":
		default:
			return m.failLocked(spec, fmt.Errorf("qos: refusing to clear foreign root qdisc %q", strings.TrimSpace(root)))
		}
	}
	port := strconv.Itoa(spec.Port)
	if ownedRoot {
		filters, err := m.run(ctx, "tc", "filter", "show", "dev", spec.Interface, "parent", "1:")
		if err != nil {
			return m.failLocked(spec, fmt.Errorf("qos: clear inspect egress: %w", err))
		}
		for _, item := range []struct {
			protocol string
			handle   string
			priority string
		}{{"ip", "1", filterPriority}, {"ipv6", "2", filterPriorityIPv6}} {
			if !filterPresent(filters, item.protocol, "src_port", port) {
				continue
			}
			if _, err := m.run(ctx, "tc", "filter", "del", "dev", spec.Interface, "parent", "1:", "protocol", item.protocol, "pref", item.priority, "handle", item.handle, "flower"); err != nil {
				return m.failLocked(spec, fmt.Errorf("qos: clear egress filter: %w", err))
			}
		}
	}
	ingressQdisc, err := m.run(ctx, "tc", "qdisc", "show", "dev", spec.Interface, "ingress")
	if err != nil {
		return m.failLocked(spec, fmt.Errorf("qos: clear inspect ingress qdisc: %w", err))
	}
	if kind, _ := qdiscKind(ingressQdisc); kind == "ingress" {
		filters, err := m.run(ctx, "tc", "filter", "show", "dev", spec.Interface, "parent", "ffff:")
		if err != nil {
			return m.failLocked(spec, fmt.Errorf("qos: clear inspect ingress: %w", err))
		}
		for _, item := range []struct {
			protocol string
			handle   string
			priority string
		}{{"ip", "1", filterPriority}, {"ipv6", "2", filterPriorityIPv6}} {
			if !filterPresent(filters, item.protocol, "dst_port", port) {
				continue
			}
			if _, err := m.run(ctx, "tc", "filter", "del", "dev", spec.Interface, "parent", "ffff:", "protocol", item.protocol, "pref", item.priority, "handle", item.handle, "flower"); err != nil {
				return m.failLocked(spec, fmt.Errorf("qos: clear ingress filter: %w", err))
			}
		}
	}
	// Some kernels collect the action when its last filter is detached. Do not
	// infer absence from a failed delete: enumerate the kernel state explicitly.
	index := strconv.Itoa(100000 + spec.Port)
	actionPresent := func() (bool, error) {
		out, err := m.run(ctx, "tc", "actions", "list", "action", "police")
		return regexp.MustCompile(`\bindex\s+` + index + `\b`).MatchString(out), err
	}
	present, err := actionPresent()
	if err != nil {
		return m.failLocked(spec, fmt.Errorf("qos: inspect owned policing action: %w", err))
	}
	if present {
		if _, err := m.run(ctx, "tc", "actions", "delete", "action", "police", "index", index); err != nil {
			stillPresent, inspectErr := actionPresent()
			if inspectErr != nil || stillPresent {
				return m.failLocked(spec, fmt.Errorf("qos: clear owned policing action: %w", err))
			}
		}
	}
	if ownedRoot {
		if _, err := m.run(ctx, "tc", "qdisc", "del", "dev", spec.Interface, "root"); err != nil {
			return m.failLocked(spec, fmt.Errorf("qos: clear owned root: %w", err))
		}
	}
	if err := os.Remove(m.cachePath); err != nil && !os.IsNotExist(err) {
		return m.failLocked(spec, fmt.Errorf("qos: remove desired state: %w", err))
	}
	m.desired = nil
	m.status = Status{State: "disabled", CheckedAt: time.Now().Unix()}
	return nil
}

// LoadAndApplyCache restores shaping without requiring panel reachability.
func (m *Manager) LoadAndApplyCache(ctx context.Context) error {
	m.mu.Lock()
	var spec Spec
	found, err := nodecache.Load(m.cachePath, &spec)
	m.mu.Unlock()
	if err != nil {
		m.mu.Lock()
		defer m.mu.Unlock()
		return m.failLocked(spec, fmt.Errorf("qos: load desired state: %w", err))
	}
	if !found {
		return nil
	}
	if err := Validate(spec); err != nil {
		return err
	}
	m.mu.Lock()
	m.desired = &spec
	m.mu.Unlock()
	return m.Apply(ctx, spec)
}

func filterMatches(output string, parts ...string) bool {
	for _, block := range strings.Split(output, "filter ") {
		if containsAll(block, parts...) {
			return true
		}
	}
	return false
}

var tcRatePattern = regexp.MustCompile(`(?i)([0-9]+(?:\.[0-9]+)?)([kmgt]?)bit\b`)

func normalizeTCRates(s string) string {
	return tcRatePattern.ReplaceAllStringFunc(s, func(token string) string {
		match := tcRatePattern.FindStringSubmatch(token)
		n, err := strconv.ParseFloat(match[1], 64)
		if err != nil {
			return token
		}
		factor := map[string]float64{"": 1, "k": 1e3, "m": 1e6, "g": 1e9, "t": 1e12}[strings.ToLower(match[2])]
		return strconv.FormatFloat(n*factor, 'f', 0, 64) + "bit"
	})
}
func classMatches(output string, parts ...string) bool {
	for _, block := range strings.Split(output, "class ") {
		if containsAll(block, parts...) {
			return true
		}
	}
	return false
}
