package mesh

import (
	"context"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/konstpic/sharx-code/v2/mesh/agent"
	"github.com/konstpic/sharx-code/v2/mesh/protocol"
	"golang.org/x/crypto/ssh"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Settings struct {
	Enabled      bool   `json:"enabled"`
	RelayAddress string `json:"relay_address"`
	Ports        []int  `json:"probe_ports"`
	SNI          string `json:"sni"`
	Balancer     string `json:"balancer_uuid"`
	Interval     int    `json:"interval"`
}
type Member struct {
	Name      string `json:"name"`
	Host      string `json:"host"`
	Overlay   string `json:"overlay"`
	ClientURL string `json:"client_url"`
	PeerURL   string `json:"peer_url"`
}
type Job struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
	Steps  []Step `json:"steps"`
	T0     int64  `json:"t0"`
}
type Step struct {
	TS   int64  `json:"ts"`
	T    string `json:"t"`
	Text string `json:"text"`
}
type Event struct {
	Level string `json:"level"`
	TS    int64  `json:"ts"`
	ID    string `json:"id"`
	T     string `json:"t"`
	Msg   string `json:"msg"`
}
type Flags struct {
	AutoRelay    bool              `json:"auto_relay"`
	AutoBalancer bool              `json:"auto_balancer"`
	AutoIP       bool              `json:"auto_ip_update"`
	Modes        map[string]string `json:"relay_modes"`
	Pinned       []string          `json:"pin_disabled"`
}
type Health struct {
	Healthy   *bool
	good, bad int
}

func (h *Health) observe(ok bool) {
	if ok {
		h.good++
		h.bad = 0
	} else {
		h.bad++
		h.good = 0
	}
	if (ok && h.good >= 3) || (!ok && h.bad >= 3) {
		v := ok
		h.Healthy = &v
	}
}

type ExitHealth struct {
	Direct Health
	WG     Health
}
type Controller struct {
	dir           string
	ctx           context.Context
	cancel        context.CancelFunc
	bridge        Bridge
	signer        ssh.Signer
	ca            *x509.Certificate
	caKey         any
	caPEM         []byte
	settings      Settings
	enrolled      map[string]Enrolled
	members       []Member
	flags         Flags
	ports         map[string]int
	relays        map[string]*RelayState
	operation     *MembershipOperation
	observations  map[string]protocol.Observation
	routes        map[string]map[string]string
	matrix        map[string]map[string]map[string]agent.PathResult
	health        map[string]*ExitHealth
	ipSeen        map[string]string
	ipCount       map[string]int
	ipTS          map[string]int64
	quorum        map[string]any
	events        []Event
	balancerError string
	cycles        int
	lastCycle     int64
	op            sync.Mutex
	jobsMu        sync.Mutex
	jobs          []*Job
	busy          atomic.Bool
	view          atomic.Value
	life          sync.Mutex
	wg            sync.WaitGroup
	wake          chan struct{}
}

func NewController(ctx context.Context, dir string, bridge Bridge) (*Controller, error) {
	ctx, cancel := context.WithCancel(ctx)
	c := &Controller{dir: dir, ctx: ctx, cancel: cancel, bridge: bridge, enrolled: map[string]Enrolled{}, ports: map[string]int{}, relays: map[string]*RelayState{}, observations: map[string]protocol.Observation{}, routes: map[string]map[string]string{}, matrix: map[string]map[string]map[string]agent.PathResult{}, health: map[string]*ExitHealth{}, ipSeen: map[string]string{}, ipCount: map[string]int{}, ipTS: map[string]int64{}, wake: make(chan struct{}, 1)}
	fail := func(e error) (*Controller, error) { cancel(); return nil, e }
	if e := readJSON(filepath.Join(dir, "settings.json"), &c.settings); e != nil {
		return fail(e)
	}
	if e := os.MkdirAll(dir, 0700); e != nil {
		return fail(e)
	}
	for _, v := range []struct {
		path   string
		target any
	}{{"enrolled.json", &c.enrolled}, {"ports.json", &c.ports}, {"flags.json", &c.flags}, {"relays.json", &c.relays}, {"events.json", &c.events}, {"membership.json", &c.operation}} {
		if e := loadOptional(filepath.Join(dir, v.path), v.target); e != nil {
			return fail(fmt.Errorf("cannot read mesh state %s", v.path))
		}
	}
	var seeds struct {
		Members []Member `json:"members"`
	}
	if e := loadOptional(filepath.Join(dir, "etcd-seeds.json"), &seeds); e != nil {
		return fail(e)
	}
	c.members = seeds.Members
	if c.flags.Modes == nil {
		c.flags.Modes = map[string]string{}
	}
	if e := c.identity(); e != nil {
		return fail(e)
	}
	if len(c.enrolled) > 0 {
		if e := protocol.Validate(c.seed()); e != nil {
			return fail(e)
		}
	}
	for _, m := range c.members {
		d, ok := c.enrolled[m.Name]
		if !ok || d.Overlay != m.Overlay || m.ClientURL != "https://"+d.Overlay+":2399" || m.PeerURL != "https://"+d.Overlay+":2391" {
			return fail(errors.New("invalid saved etcd membership"))
		}
	}
	c.publish()
	c.wg.Add(1)
	go c.loop()
	return c, nil
}
func (c *Controller) Stop() { c.life.Lock(); c.cancel(); c.life.Unlock(); c.wg.Wait() }
func (c *Controller) loop() {
	defer c.wg.Done()
	for {
		if c.ctx.Err() != nil {
			return
		}
		if !c.busy.Load() {
			c.op.Lock()
			if !c.busy.Load() {
				c.cycle()
			}
			c.publish()
			c.op.Unlock()
		}
		interval := c.settings.Interval
		if interval < 15 {
			interval = 15
		}
		select {
		case <-c.ctx.Done():
			return
		case <-c.wake:
		case <-time.After(time.Duration(interval) * time.Second):
		}
	}
}
func (c *Controller) Wake() {
	select {
	case c.wake <- struct{}{}:
	default:
	}
}
func (c *Controller) rpc(action string, body any, out any) error {
	if c.bridge == nil {
		return errors.New("panel bridge unavailable")
	}
	b, e := json.Marshal(body)
	if e != nil {
		return e
	}
	obj, e := c.bridge(c.ctx, action, b)
	if e != nil {
		return e
	}
	b, e = json.Marshal(obj)
	if e != nil {
		return e
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(b, out)
}
func (c *Controller) save(name string, v any) error { return AtomicJSON(filepath.Join(c.dir, name), v) }
func (c *Controller) seed() map[string]protocol.Node {
	out := map[string]protocol.Node{}
	for n, d := range c.enrolled {
		out[n] = protocol.Node{Underlay: d.Host, Overlay: d.Overlay, Pubkey: d.Pubkey}
	}
	return out
}
func (c *Controller) event(msg string) { c.eventLevel(msg, "info") }
func (c *Controller) eventLevel(msg, level string) {
	now := time.Now()
	c.events = append([]Event{{Level: level, TS: now.UnixMilli(), ID: randomID(), T: now.Format(time.DateTime), Msg: msg}}, c.events...)
	if len(c.events) > 50 {
		c.events = c.events[:50]
	}
	_ = c.save("events.json", c.events)
}
func randomID() string { b := make([]byte, 12); rand.Read(b); return hex.EncodeToString(b) }
func (c *Controller) step(j *Job, msg string) {
	if j == nil {
		return
	}
	c.jobsMu.Lock()
	j.Steps = append(j.Steps, Step{TS: time.Now().UnixMilli(), T: time.Now().Format("15:04:05"), Text: msg})
	c.jobsMu.Unlock()
}
func (c *Controller) startJob(title string, fn func(*Job) error) (any, error) {
	c.life.Lock()
	defer c.life.Unlock()
	if c.ctx.Err() != nil {
		return nil, errors.New("controller stopping")
	}
	if !c.busy.CompareAndSwap(false, true) {
		return nil, errors.New("дождитесь завершения текущей операции mesh")
	}
	j := &Job{ID: randomID(), Title: title, Status: "running", Steps: []Step{}, T0: time.Now().Unix()}
	c.jobsMu.Lock()
	c.jobs = append([]*Job{j}, c.jobs...)
	if len(c.jobs) > 5 {
		c.jobs = c.jobs[:5]
	}
	c.jobsMu.Unlock()
	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		c.op.Lock()
		defer c.op.Unlock()
		e := fn(j)
		c.jobsMu.Lock()
		if e != nil {
			j.Status = "failed"
			j.Error = e.Error()
		} else {
			j.Status = "done"
		}
		c.jobsMu.Unlock()
		if e != nil {
			c.eventLevel(title+": "+e.Error(), "error")
		} else {
			c.event(title + ": завершено")
		}
		c.publish()
		c.busy.Store(false)
		c.Wake()
	}()
	return map[string]string{"job": j.ID}, nil
}
func (c *Controller) publish() {
	quorum := c.quorum
	if quorum == nil {
		quorum = map[string]any{"healthy": 0, "size": len(c.members), "members": []any{}}
	}
	top := []any{}
	inventory := map[string]any{}
	relay := map[string]any{}
	modes := map[string]string{}
	exits := map[string]any{}
	obs := protocol.Graph{}
	routes := map[string]map[string]string{}
	for n, d := range c.enrolled {
		var age any
		if o, ok := c.observations[n]; ok {
			age = time.Now().Unix() - o.TS
			obs[n] = o.Links
		}
		routes[n] = c.routes[n]
		inventory[n] = map[string]any{"host": d.Host, "overlay": d.Overlay, "role": d.Role, "rw_node": d.Node}
		isMember := false
		for _, m := range c.members {
			if m.Name == n {
				isMember = true
			}
		}
		leader, _ := quorum["leader"].(string)
		relayOn := false
		if state := c.relays[n]; state != nil {
			relayOn = state.On
		}
		top = append(top, map[string]any{"name": n, "role": d.Role, "underlay": d.Host, "overlay": d.Overlay, "agent_age": age, "etcd": isMember, "leader": leader == n, "relay": relayOn})
		if d.Role == "exit" {
			mode := c.flags.Modes[n]
			if mode == "" {
				mode = "auto"
			}
			modes[n] = mode
			if h := c.health[n]; h != nil {
				exits[n] = map[string]any{"direct_healthy": h.Direct.Healthy, "wg_healthy": h.WG.Healthy}
			}
		}
	}
	for n, s := range c.relays {
		relay[n] = map[string]any{"on": s.On, "pending": s.Operation != nil, "hosts": len(s.Saved), "reason": s.Reason, "since": s.Since}
	}
	_, bootstrapErr := os.Stat(filepath.Join(c.dir, "bootstrap.json"))
	sort.Slice(top, func(i, j int) bool {
		return top[i].(map[string]any)["name"].(string) < top[j].(map[string]any)["name"].(string)
	})
	view := map[string]any{"snapshot_at": time.Now().Unix(), "settings": c.settings, "implementation": "go", "enrolled": inventory, "inventory": inventory, "quorum": quorum, "etcd_mtls": true, "topology": map[string]any{"nodes": top}, "overlay": map[string]any{"nodes": c.seed(), "obs": obs, "route": routes, "etcd_up": c.storeHealthy()}, "relay_modes": modes, "relays": relay, "auto_relay": c.flags.AutoRelay, "auto_balancer": c.flags.AutoBalancer, "auto_ip_update": c.flags.AutoIP, "pinned_disabled": c.flags.Pinned, "exits": exits, "events": c.events, "cycles": c.cycles, "last_cycle": c.lastCycle, "probe_matrix": c.matrix, "balancer_error": c.balancerError, "bootstrap_pending": bootstrapErr == nil, "etcd_operation": c.operation}
	b, _ := json.Marshal(view)
	c.view.Store(b)
}
func (c *Controller) status() any {
	out := map[string]any{}
	if b := c.view.Load(); b != nil {
		json.Unmarshal(b.([]byte), &out)
	}
	out["busy"] = c.busy.Load()
	c.jobsMu.Lock()
	b, _ := json.Marshal(c.jobs)
	c.jobsMu.Unlock()
	var jobs []any
	json.Unmarshal(b, &jobs)
	if jobs == nil {
		jobs = []any{}
	}
	out["jobs"] = jobs
	return out
}
func (c *Controller) Action(ctx context.Context, action string, raw json.RawMessage) (any, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if action == "status" {
		return c.status(), nil
	}
	if action == "probe" {
		c.Wake()
		return map[string]bool{"ok": true}, nil
	}
	if !json.Valid(raw) {
		return nil, errors.New("invalid mesh request")
	}
	switch action {
	case "enroll":
		var q EnrollRequest
		if e := json.Unmarshal(raw, &q); e != nil {
			return nil, e
		}
		return c.startJob("Установка mesh", func(j *Job) error { return c.enroll(q, j) })
	case "bootstrap":
		var q struct {
			Names []string `json:"names"`
		}
		if e := json.Unmarshal(raw, &q); e != nil {
			return nil, e
		}
		return c.startJob("Первичная установка etcd с mTLS", func(j *Job) error { return c.bootstrap(q.Names, j) })
	case "etcd":
		var q struct {
			Name   string `json:"name"`
			Member bool   `json:"member"`
		}
		if e := json.Unmarshal(raw, &q); e != nil {
			return nil, e
		}
		return c.startJob("Изменение состава etcd", func(j *Job) error { return c.changeMember(q.Name, q.Member, j) })
	case "remove":
		var q struct {
			Name string `json:"name"`
		}
		if e := json.Unmarshal(raw, &q); e != nil {
			return nil, e
		}
		return c.startJob("Отключение mesh", func(j *Job) error { return c.remove(q.Name, j) })
	case "flags", "pin", "relay":
		return c.startJob("Настройки mesh", func(j *Job) error { return c.update(action, raw) })
	}
	return nil, errors.New("неизвестная операция mesh")
}

type EnrollRequest struct {
	NodeID      int    `json:"nodeId"`
	Role        string `json:"role"`
	User        string `json:"user"`
	SSHPort     int    `json:"sshPort"`
	Fingerprint string `json:"fingerprint"`
	KeyType     string `json:"keyType"`
	Password    string `json:"password"`
	PrivateKey  string `json:"privateKey"`
	Passphrase  string `json:"passphrase"`
}

func (c *Controller) enroll(q EnrollRequest, j *Job) error {
	if q.NodeID < 1 || q.NodeID > 9999999 || (q.Role != "entry" && q.Role != "exit") {
		return errors.New("invalid node ID or role")
	}
	if c.operation != nil {
		return errors.New("завершите изменение состава etcd")
	}
	if q.User == "" {
		q.User = "root"
	}
	if q.SSHPort == 0 {
		q.SSHPort = 22
	}
	if !regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`).MatchString(q.User) || q.SSHPort < 1 || q.SSHPort > 65535 || !regexp.MustCompile(`^SHA256:[A-Za-z0-9+/]{43}$`).MatchString(q.Fingerprint) {
		return errors.New("проверьте SSH user, port и подтверждённый отпечаток")
	}
	switch q.KeyType {
	case ssh.KeyAlgoED25519, ssh.KeyAlgoECDSA256, ssh.KeyAlgoECDSA384, ssh.KeyAlgoECDSA521, ssh.KeyAlgoRSA:
	default:
		return errors.New("подтвердите тип SSH host key")
	}
	var rows []struct {
		UUID    string `json:"uuid"`
		Address string `json:"address"`
		Enabled bool   `json:"enabled"`
	}
	if e := c.rpc("nodes", nil, &rows); e != nil {
		return e
	}
	var host string
	for _, r := range rows {
		if r.UUID == fmt.Sprintf("node-%d", q.NodeID) && r.Enabled {
			host = r.Address
		}
	}
	ip := net.ParseIP(host)
	if ip == nil || ip.To4() == nil || ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() {
		return errors.New("для установки нужен IPv4 включённой ноды")
	}
	name := "n" + strconv.Itoa(q.NodeID)
	d := Enrolled{Host: host, User: q.User, Sudo: q.User != "root", Role: q.Role, Node: fmt.Sprintf("node-%d", q.NodeID), Fingerprint: q.Fingerprint, SSHPort: q.SSHPort, KeyType: q.KeyType}
	if old, ok := c.enrolled[name]; ok {
		if old.Host != host || old.Role != q.Role {
			return errors.New("сначала безопасно выведите ноду с изменённой ролью/адресом")
		}
		d.Overlay = old.Overlay
		d.Slot = old.Slot
	}
	var auth ssh.AuthMethod
	if q.PrivateKey != "" {
		var k ssh.Signer
		var e error
		if q.Passphrase != "" {
			k, e = ssh.ParsePrivateKeyWithPassphrase([]byte(q.PrivateKey), []byte(q.Passphrase))
		} else {
			k, e = ssh.ParsePrivateKey([]byte(q.PrivateKey))
		}
		if e != nil {
			return errors.New("не удалось прочитать одноразовый SSH-ключ")
		}
		auth = ssh.PublicKeys(k)
	} else if q.Password != "" {
		auth = ssh.Password(q.Password)
	} else {
		return errors.New("нужны одноразовые SSH credentials")
	}
	cl, e := sshDial(c.ctx, d, auth)
	q.Password = ""
	q.PrivateKey = ""
	q.Passphrase = ""
	auth = nil
	if e != nil {
		return e
	}
	pub := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(c.signer.PublicKey()))) + " sharx-mesh@panel"
	ctx, cancel := context.WithTimeout(c.ctx, 30*time.Second)
	_, e = runSSH(ctx, cl, Enrolled{}, "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF "+quote(pub)+" ~/.ssh/authorized_keys || printf '%s\\n' "+quote(pub)+" >> ~/.ssh/authorized_keys", nil)
	cancel()
	cl.Close()
	if e != nil {
		return e
	}
	c.step(j, "SSH host key проверен, ключ контроллера установлен")
	if d.Overlay == "" {
		used := map[string]bool{}
		for _, v := range c.enrolled {
			used[v.Overlay] = true
		}
		for i := 1; i <= 200; i++ {
			ip := "10.203.0." + strconv.Itoa(i)
			if !used[ip] {
				d.Overlay = ip
				break
			}
		}
	}
	if d.Overlay == "" {
		return errors.New("нет свободных overlay адресов")
	}
	if d.Role == "exit" && d.Slot == nil {
		used := map[int]bool{}
		for _, v := range c.enrolled {
			if v.Slot != nil {
				used[*v.Slot] = true
			}
		}
		for i := 0; i < 100; i++ {
			if !used[i] {
				v := i
				d.Slot = &v
				break
			}
		}
		if d.Slot == nil {
			return errors.New("нет свободных слотов релея")
		}
	}
	// Save the enrollment before installation so interrupted SSH jobs can be retried.
	// A public key must be obtained before publishing this record to any agent.
	cl, e = c.connect(d)
	if e != nil {
		return e
	}
	ctx, cancel = context.WithTimeout(c.ctx, 10*time.Minute)
	out, e := runSSH(ctx, cl, d, "command -v systemctl >/dev/null && command -v ip >/dev/null && (command -v wg >/dev/null && command -v iptables >/dev/null || (DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wireguard-tools iptables >/dev/null)); install -d -m 700 /etc/wireguard /etc/sharx-mesh; test -s /etc/wireguard/sharx-mesh.key || (umask 077; wg genkey > /etc/wireguard/sharx-mesh.key); wg pubkey < /etc/wireguard/sharx-mesh.key", nil)
	cancel()
	cl.Close()
	if e != nil {
		return e
	}
	key := strings.TrimSpace(string(out))
	kb, e := base64.StdEncoding.DecodeString(key)
	if e != nil || len(kb) != 32 {
		return errors.New("invalid WireGuard public key")
	}
	d.Pubkey = key
	c.enrolled[name] = d
	if e = c.save("enrolled.json", c.enrolled); e != nil {
		return e
	}
	if e = c.configurePorts(); e != nil {
		return e
	}
	if e = c.seedAgents(j); e != nil {
		return e
	}
	if len(c.members) > 0 {
		return c.publishRegistry()
	}
	return nil
}
func (c *Controller) installAgent(name string) error {
	d := c.enrolled[name]
	out, e := c.remote(name, "uname -m", nil, 20*time.Second)
	if e != nil {
		return e
	}
	arch := ""
	switch strings.TrimSpace(string(out)) {
	case "x86_64":
		arch = "amd64"
	case "aarch64", "arm64":
		arch = "arm64"
	default:
		return errors.New("agent supports Linux amd64/arm64")
	}
	base := os.Getenv("XUI_MESH_AGENT_DIR")
	if base == "" {
		base = "/opt/sharx-mesh"
	}
	binary, e := os.ReadFile(filepath.Join(base, "linux-"+arch))
	if e != nil {
		return errors.New("native Go agent binary missing from panel image")
	}
	if e = c.put(name, "/usr/local/lib/sharx-mesh/sharx-mesh-agent", binary, "700"); e != nil {
		return e
	}
	seed, _ := json.Marshal(c.seed())
	if e = c.put(name, "/etc/sharx-mesh/nodes.json", seed, "600"); e != nil {
		return e
	}
	cert, key, e := c.issue("sharx-mesh-agent-"+name, nil, false)
	if e != nil {
		return e
	}
	for _, file := range []struct {
		name string
		data []byte
	}{{"ca.crt", c.caPEM}, {"client.crt", cert}, {"client.key", key}} {
		if e = c.put(name, "/etc/sharx-mesh/tls/"+file.name, file.data, "600"); e != nil {
			return e
		}
	}
	eps := []string{}
	for _, m := range c.members {
		eps = append(eps, m.ClientURL)
	}
	cfg := agent.Config{Name: name, Overlay: d.Overlay, KeyFile: "/etc/wireguard/sharx-mesh.key", NodesFile: "/etc/sharx-mesh/nodes.json", Etcd: eps, TLS: agent.TLSFiles{CA: "/etc/sharx-mesh/tls/ca.crt", Cert: "/etc/sharx-mesh/tls/client.crt", Key: "/etc/sharx-mesh/tls/client.key"}}
	b, _ := json.Marshal(cfg)
	if e = c.put(name, "/etc/sharx-mesh/config.json", b, "600"); e != nil {
		return e
	}
	unit := "[Unit]\nDescription=SharX native Go mesh agent\nAfter=network-online.target\nWants=network-online.target\n[Service]\nExecStart=/usr/local/lib/sharx-mesh/sharx-mesh-agent run /etc/sharx-mesh/config.json\nRestart=always\nRestartSec=5\nUMask=0077\n[Install]\nWantedBy=multi-user.target\n"
	if e = c.put(name, "/etc/systemd/system/sharx-mesh-agent.service", []byte(unit), "600"); e != nil {
		return e
	}
	_, e = c.remote(name, "systemctl daemon-reload && systemctl enable sharx-mesh-agent >/dev/null && systemctl restart sharx-mesh-agent && systemctl is-active --quiet sharx-mesh-agent", nil, 45*time.Second)
	return e
}
func (c *Controller) seedAgents(j *Job) error {
	names := []string{}
	for n := range c.enrolled {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		if e := c.installAgent(n); e != nil {
			return fmt.Errorf("agent %s: %w", n, e)
		}
		if j != nil {
			c.step(j, "Go-агент "+n+" установлен; WireGuard private key сохранён на ноде")
		}
	}
	return nil
}
func (c *Controller) configurePorts() error {
	ids := []int{}
	for n := range c.enrolled {
		id, _ := strconv.Atoi(n[1:])
		ids = append(ids, id)
	}
	var ports []int
	if e := c.rpc("ports", map[string]any{"ids": ids}, &ports); e != nil {
		return e
	}
	next := map[string]int{}
	for p, v := range c.ports {
		next[p] = v
	}
	for _, p := range ports {
		if p < 1 || p > 65535 {
			return errors.New("invalid inbound port")
		}
		key := strconv.Itoa(p)
		if _, ok := next[key]; !ok {
			if len(next) >= 100 {
				return errors.New("максимум 100 различных портов mesh")
			}
			next[key] = len(next)
		}
	}
	if e := c.save("ports.json", next); e != nil {
		return e
	}
	c.ports = next
	return nil
}
func (c *Controller) publishRegistry() error {
	s, e := c.store()
	if e != nil {
		return e
	}
	defer s.Client.CloseIdleConnections()
	for n, d := range c.enrolled {
		if e = s.Put(c.ctx, protocol.Prefix+"nodes/"+n, c.seed()[n], 0); e != nil {
			return e
		}
		if e = s.Put(c.ctx, protocol.Prefix+"inventory/"+n, d, 0); e != nil {
			return e
		}
	}
	if e = s.Put(c.ctx, protocol.Prefix+"registry", c.seed(), 0); e != nil {
		return e
	}
	return s.Put(c.ctx, protocol.Prefix+"control/etcd", map[string]any{"members": c.members}, 0)
}
func (c *Controller) storeHealthy() bool {
	if c.quorum == nil {
		return false
	}
	n, _ := c.quorum["healthy"].(int)
	size := len(c.members)
	return size > 0 && n >= size/2+1
}
