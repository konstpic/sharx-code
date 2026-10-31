// Package agent implements the host-side WireGuard mesh agent. The panel itself
// never executes these privileged networking operations.
package agent

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/konstpic/sharx-code/v2/mesh/protocol"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type TLSFiles struct {
	CA   string `json:"ca_file"`
	Cert string `json:"cert_file"`
	Key  string `json:"key_file"`
}
type Config struct {
	Name      string   `json:"name"`
	Overlay   string   `json:"overlay"`
	KeyFile   string   `json:"key_file"`
	NodesFile string   `json:"nodes_file"`
	Etcd      []string `json:"etcd"`
	TLS       TLSFiles `json:"etcd_tls"`
}

func Atomic(path string, value any) error {
	b, e := json.Marshal(value)
	if e != nil {
		return e
	}
	return Write(path, b, 0600)
}
func Write(path string, b []byte, mode os.FileMode) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".mesh-")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if e = f.Chmod(mode); e == nil {
		_, e = f.Write(b)
	}
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e == nil {
		e = os.Rename(f.Name(), path)
	}
	if e != nil {
		return e
	}
	d, e := os.Open(filepath.Dir(path))
	if e != nil {
		return e
	}
	defer d.Close()
	return d.Sync()
}
func command(ctx context.Context, name string, args ...string) (string, error) {
	c := exec.CommandContext(ctx, name, args...)
	b, e := c.Output()
	if e != nil {
		return "", fmt.Errorf("%s operation failed", name)
	}
	return string(b), nil
}
func must(ctx context.Context, name string, args ...string) error {
	_, e := command(ctx, name, args...)
	return e
}
func TLSClient(files TLSFiles) (*http.Client, error) {
	ca, e := os.ReadFile(files.CA)
	if e != nil {
		return nil, e
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(ca) {
		return nil, errors.New("invalid mesh CA")
	}
	cert, e := tls.LoadX509KeyPair(files.Cert, files.Key)
	if e != nil {
		return nil, e
	}
	return &http.Client{Timeout: 4 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}}}, nil
}

type Agent struct {
	bootstrapped bool
	cfg          Config
	path         string
	nodes        map[string]protocol.Node
	store        *protocol.Store
	trackers     map[string]*protocol.Tracker
	graph        protocol.Graph
	hops         map[string]string
	loads        map[string]float64
	endpoints    map[string]string
}

func validPaths(path string, cfg Config) bool {
	dir := filepath.Dir(path)
	return (cfg.KeyFile == "/etc/wireguard/sharx-mesh.key" && cfg.NodesFile == "/etc/sharx-mesh/nodes.json") || (cfg.KeyFile == filepath.Join(dir, "wireguard.key") && cfg.NodesFile == filepath.Join(dir, "nodes.json"))
}
func New(path string) (*Agent, error) {
	var cfg Config
	b, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	if e = json.Unmarshal(b, &cfg); e != nil {
		return nil, e
	}
	if !protocol.Name.MatchString(cfg.Name) || !protocol.Overlay(cfg.Overlay) || !validPaths(path, cfg) {
		return nil, errors.New("invalid agent configuration")
	}
	var nodes map[string]protocol.Node
	b, e = os.ReadFile(cfg.NodesFile)
	if e != nil {
		return nil, e
	}
	if e = json.Unmarshal(b, &nodes); e != nil {
		return nil, e
	}
	if e = protocol.Validate(nodes); e != nil {
		return nil, e
	}
	if nodes[cfg.Name].Overlay != cfg.Overlay {
		return nil, errors.New("agent not present in registry")
	}
	a := &Agent{cfg: cfg, path: path, nodes: nodes, trackers: map[string]*protocol.Tracker{}, graph: protocol.Graph{}, hops: map[string]string{}, loads: map[string]float64{}, endpoints: map[string]string{}}
	if len(cfg.Etcd) > 0 {
		c, e := TLSClient(cfg.TLS)
		if e != nil {
			return nil, e
		}
		a.store = &protocol.Store{Endpoints: cfg.Etcd, Client: c}
	}
	return a, nil
}
func (a *Agent) refresh(ctx context.Context) {
	if a.store == nil {
		return
	}

	// The complete registry is a single atomic value. A half-published bootstrap
	// prefix must never make an agent delete links needed by the forming quorum.
	next := map[string]protocol.Node{}
	found, e := a.store.Get(ctx, protocol.Prefix+"registry", &next)
	if e != nil {
		return
	}
	if found && protocol.Validate(next) == nil && next[a.cfg.Name].Overlay == a.cfg.Overlay {
		if Atomic(a.cfg.NodesFile, next) == nil {
			a.nodes = next
		}
	}

	control, e := a.store.Prefix(ctx, protocol.Prefix+"control/")
	if e != nil {
		return
	}
	var record struct {
		Members []struct {
			Name string `json:"name"`
			URL  string `json:"client_url"`
		} `json:"members"`
	}
	if json.Unmarshal(control[protocol.Prefix+"control/etcd"], &record) != nil || len(record.Members) == 0 || len(record.Members) > 7 {
		return
	}
	endpoints := []string{}
	seen := map[string]bool{}
	for _, m := range record.Members {
		node, known := a.nodes[m.Name]
		if !known || seen[m.Name] || m.URL != "https://"+node.Overlay+":2399" {
			return
		}
		seen[m.Name] = true
		endpoints = append(endpoints, m.URL)
	}
	if strings.Join(endpoints, ",") != strings.Join(a.store.Endpoints, ",") {
		cfg := a.cfg
		cfg.Etcd = endpoints
		if Atomic(a.path, cfg) == nil {
			a.cfg = cfg
			a.store.Endpoints = endpoints
		}
	}

}

// EnsureInterface prefers kernel WireGuard and falls back to the bundled userspace implementation.
func EnsureInterface(ctx context.Context, name string) error {
	if os.Getenv("SHARX_MESH_FORCE_USERSPACE") != "1" {
		if e := must(ctx, "ip", "link", "add", name, "type", "wireguard"); e == nil {
			return nil
		}
	}
	if _, e := os.Stat("/dev/net/tun"); e != nil {
		return errors.New("mesh requires NET_ADMIN and a /dev/net/tun device when kernel WireGuard is unavailable")
	}
	return must(ctx, "wireguard-go", name)
}
func dev(n string) string { return "sxm-" + n }
func link(mine, theirs string) string {
	return fmt.Sprintf("10.204.%d.%d", protocol.Octet(mine), protocol.Octet(theirs))
}
func setSysctl(ctx context.Context, key, want string, accepted ...string) error {
	current, e := command(ctx, "sysctl", "-n", key)
	if e == nil {
		current = strings.TrimSpace(current)
		if current == want {
			return nil
		}
		for _, value := range accepted {
			if current == value {
				return nil
			}
		}
	}
	return must(ctx, "sysctl", "-qw", key+"="+want)
}
func (a *Agent) links(ctx context.Context) error {
	if e := protocol.Validate(a.nodes); e != nil {
		return e
	}
	if e := setSysctl(ctx, "net.ipv4.ip_forward", "1"); e != nil {
		return e
	}
	if e := must(ctx, "ip", "addr", "replace", a.cfg.Overlay+"/32", "dev", "lo"); e != nil {
		return e
	}
	for p, n := range a.nodes {
		if p == a.cfg.Name {
			continue
		}
		d := dev(p)
		_, exists := command(ctx, "ip", "link", "show", "dev", d)
		if exists != nil {
			if e := EnsureInterface(ctx, d); e != nil {
				return e
			}
		}
		ep := net.JoinHostPort(n.Underlay, strconv.Itoa(53000+protocol.Octet(a.cfg.Overlay)))
		args := []string{"set", d, "private-key", a.cfg.KeyFile, "listen-port", strconv.Itoa(53000 + protocol.Octet(n.Overlay)), "peer", n.Pubkey, "allowed-ips", "0.0.0.0/0", "persistent-keepalive", "25"}
		if a.endpoints[p] != ep || exists != nil {
			args = append(args, "endpoint", ep)
		}
		if e := must(ctx, "wg", args...); e != nil {
			return e
		}
		a.endpoints[p] = ep
		for _, args := range [][]string{{"link", "set", d, "mtu", "1280", "up"}, {"addr", "replace", link(a.cfg.Overlay, n.Overlay), "peer", link(n.Overlay, a.cfg.Overlay), "dev", d}} {
			if e := must(ctx, "ip", args...); e != nil {
				return e
			}
		}
		if e := setSysctl(ctx, "net.ipv4.conf."+d+".rp_filter", "0", "2"); e != nil {
			return e
		}
	}
	b, e := command(ctx, "ip", "-j", "link", "show")
	if e != nil {
		return e
	}
	var links []struct {
		Name string `json:"ifname"`
	}
	if e = json.Unmarshal([]byte(b), &links); e != nil {
		return e
	}
	for _, l := range links {
		if strings.HasPrefix(l.Name, "sxm-") {
			p := strings.TrimPrefix(l.Name, "sxm-")
			if _, ok := a.nodes[p]; !ok || p == a.cfg.Name {
				if e = must(ctx, "ip", "link", "del", l.Name); e != nil {
					return e
				}
			}
		}
	}
	chain := "DOCKER-USER"
	if _, e := command(ctx, "iptables", "-S", chain); e != nil {
		chain = "FORWARD"
	}
	for _, direction := range []string{"-i", "-o"} {
		if _, e := command(ctx, "iptables", "-C", chain, direction, "sxm+", "-j", "ACCEPT"); e != nil {
			if e = must(ctx, "iptables", "-I", chain, "1", direction, "sxm+", "-j", "ACCEPT"); e != nil {
				return e
			}
		}
	}
	return nil
}
func ping(source, target string) (float64, bool) {
	c, e := net.ListenIP("ip4:icmp", &net.IPAddr{IP: net.ParseIP(source)})
	if e != nil {
		return 0, false
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(time.Second))
	p := make([]byte, 24)
	p[0] = 8
	rand.Read(p[4:])
	var sum uint32
	for i := 0; i < len(p); i += 2 {
		sum += uint32(binary.BigEndian.Uint16(p[i:]))
	}
	for sum>>16 != 0 {
		sum = (sum & 65535) + (sum >> 16)
	}
	binary.BigEndian.PutUint16(p[2:], ^uint16(sum))
	start := time.Now()
	if _, e = c.WriteToIP(p, &net.IPAddr{IP: net.ParseIP(target)}); e != nil {
		return 0, false
	}
	b := make([]byte, 2048)
	for {
		n, addr, e := c.ReadFromIP(b)
		if e != nil {
			return 0, false
		}
		if n >= len(p) && addr.IP.String() == target && b[0] == 0 && string(b[4:len(p)]) == string(p[4:]) {
			return float64(time.Since(start).Microseconds()) / 1000, true
		}
	}
}
func (a *Agent) measure() map[string]protocol.Link {
	out := map[string]protocol.Link{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for p, n := range a.nodes {
		if p == a.cfg.Name {
			continue
		}
		if a.trackers[p] == nil {
			a.trackers[p] = &protocol.Tracker{}
		}
		wg.Add(1)
		go func(p string, n protocol.Node) {
			defer wg.Done()
			ms, ok := ping(link(a.cfg.Overlay, n.Overlay), link(n.Overlay, a.cfg.Overlay))
			mu.Lock()
			out[p] = a.trackers[p].Update(ms, ok)
			mu.Unlock()
		}(p, n)
	}
	wg.Wait()
	return out
}
func publicIP(ctx context.Context) string {
	s, e := command(ctx, "ip", "-j", "-4", "route", "get", "1.1.1.1")
	if e != nil {
		return ""
	}
	var routes []struct {
		Source string `json:"prefsrc"`
	}
	json.Unmarshal([]byte(s), &routes)
	if len(routes) == 0 {
		return ""
	}
	ip := net.ParseIP(routes[0].Source)
	if ip != nil && ip.To4() != nil && ip.IsGlobalUnicast() && !ip.IsPrivate() {
		return ip.String()
	}
	return ""
}

// seedRoutes installs only missing overlay routes before the first etcd request.
// Existing routes (including cached transit) must survive an agent restart.
func (a *Agent) seedRoutes(ctx context.Context) error {
	for name, node := range a.nodes {
		if name == a.cfg.Name {
			continue
		}
		raw, err := command(ctx, "ip", "-j", "route", "show", "exact", node.Overlay+"/32")
		if err != nil {
			return err
		}
		var routes []json.RawMessage
		if err = json.Unmarshal([]byte(raw), &routes); err != nil {
			return err
		}
		if len(routes) == 0 {
			if err = must(ctx, "ip", "route", "replace", node.Overlay+"/32", "dev", dev(name), "src", a.cfg.Overlay, "metric", "50"); err != nil {
				return err
			}
		}
	}
	return nil
}

func (a *Agent) Round(ctx context.Context) error {
	if !a.bootstrapped {
		if err := a.links(ctx); err != nil {
			return err
		}
		if err := a.seedRoutes(ctx); err != nil {
			return err
		}
		a.bootstrapped = true
	}
	a.refresh(ctx)
	if e := a.links(ctx); e != nil {
		return e
	}
	local := a.measure()
	a.graph[a.cfg.Name] = local
	obs := protocol.Observation{TS: time.Now().Unix(), Links: local, IP: publicIP(ctx)}
	if b, e := os.ReadFile("/proc/loadavg"); e == nil {
		f := strings.Fields(string(b))
		if len(f) > 0 {
			v, _ := strconv.ParseFloat(f[0], 64)
			obs.Load = v / float64(runtime.NumCPU())
		}
	}
	a.loads[a.cfg.Name] = obs.Load
	if a.store != nil {
		if e := a.store.Put(ctx, protocol.Prefix+"obs/"+a.cfg.Name, obs, 60); e == nil {
			kv, e := a.store.Prefix(ctx, protocol.Prefix+"obs/")
			if e == nil {
				g := protocol.Graph{a.cfg.Name: local}
				for k, v := range kv {
					n := strings.TrimPrefix(k, protocol.Prefix+"obs/")
					var o protocol.Observation
					if _, known := a.nodes[n]; known && json.Unmarshal(v, &o) == nil && time.Now().Unix()-o.TS < 60 {
						g[n] = o.Links
						a.loads[n] = o.Load
					}
				}
				a.graph = g
			}
		}
	}
	hops := protocol.NextHops(a.nodes, a.graph, a.cfg.Name, a.hops, a.loads)
	via := map[string]string{}
	for d, n := range a.nodes {
		if d == a.cfg.Name {
			continue
		}
		next := hops[d]
		if next == "" {
			next = d
		} else {
			via[d] = next
		}
		if e := must(ctx, "ip", "route", "replace", n.Overlay+"/32", "dev", dev(next), "src", a.cfg.Overlay, "metric", "50"); e != nil {
			return e
		}
	}
	a.hops = hops
	status := map[string]any{"node": a.cfg.Name, "ts": obs.TS, "links": local, "via": via}
	statusFile := filepath.Join(filepath.Dir(a.path), "status.json")
	if a.cfg.KeyFile == "/etc/wireguard/sharx-mesh.key" {
		statusFile = "/run/sharx-mesh/status.json"
	}
	if e := Atomic(statusFile, status); e != nil {
		return e
	}
	if a.store != nil {
		_ = a.store.Put(ctx, protocol.Prefix+"route/"+a.cfg.Name, map[string]any{"ts": obs.TS, "via": via}, 60)
	}
	return nil
}
func Run(ctx context.Context, path string) error {
	a, e := New(path)
	if e != nil {
		return e
	}
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		round, cancel := context.WithTimeout(ctx, 20*time.Second)
		e = a.Round(round)
		cancel()
		if e != nil {
			fmt.Fprintln(os.Stderr, "mesh round incomplete; retaining previous routes:", e)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
	}
}

type ProbeRequest struct {
	SNI   string                   `json:"sni"`
	Ports []int                    `json:"ports"`
	Exits map[string]protocol.Node `json:"exits"`
}
type PathResult struct {
	OK    int     `json:"ok"`
	Total int     `json:"total"`
	MS    float64 `json:"ms"`
}

func (p PathResult) Ratio() float64 {
	if p.Total == 0 {
		return 0
	}
	return float64(p.OK) / float64(p.Total)
}
func Probe(ctx context.Context, q ProbeRequest) (map[string]map[string]PathResult, error) {
	if len(q.Ports) == 0 {
		return map[string]map[string]PathResult{}, nil
	}
	if len(q.Ports) > 8 || q.SNI == "" {
		return nil, errors.New("invalid TLS probes")
	}
	if e := protocol.Validate(q.Exits); e != nil {
		return nil, e
	}
	out := map[string]map[string]PathResult{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 16)
	for n, d := range q.Exits {
		out[n] = map[string]PathResult{}
		for _, kind := range []string{"direct", "wg"} {
			wg.Add(1)
			go func(n, kind string, d protocol.Node) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				r := PathResult{}
				ip := d.Underlay
				if kind == "wg" {
					ip = d.Overlay
				}
				for _, p := range q.Ports {
					if p < 1 || p > 65535 {
						continue
					}
					for i := 0; i < 3; i++ {
						r.Total++
						tr := &http.Transport{TLSClientConfig: &tls.Config{ServerName: q.SNI, InsecureSkipVerify: true, MinVersion: tls.VersionTLS12}, DialContext: func(c context.Context, network, _ string) (net.Conn, error) {
							return (&net.Dialer{Timeout: 2 * time.Second}).DialContext(c, network, net.JoinHostPort(ip, strconv.Itoa(p)))
						}}
						c := &http.Client{Transport: tr, Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
						req, e := http.NewRequestWithContext(ctx, "GET", "https://"+net.JoinHostPort(q.SNI, strconv.Itoa(p))+"/", nil)
						start := time.Now()
						if e == nil {
							resp, e := c.Do(req)
							if e == nil {
								_, e = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
								resp.Body.Close()
								if e == nil {
									r.OK++
									r.MS = max(r.MS, float64(time.Since(start).Milliseconds()))
								}
							}
						}
						tr.CloseIdleConnections()
					}
				}
				mu.Lock()
				out[n][kind] = r
				mu.Unlock()
			}(n, kind, d)
		}
	}
	wg.Wait()
	return out, nil
}

// Forward validates all input before touching only the SXMFWD firewall chains.
func Forward(ctx context.Context, path string) error {
	var q struct {
		Rules []struct {
			ID     string              `json:"id"`
			Target string              `json:"target"`
			Maps   [][]json.RawMessage `json:"maps"`
		} `json:"rules"`
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	if e = json.Unmarshal(b, &q); e != nil {
		return e
	}
	seen := map[string]bool{}
	tables := map[string][]string{"nat": {}, "filter": {}, "mangle": {}}
	chains := map[string][]string{"nat": {"SXMFWD", "SXMFWD_POST"}, "filter": {"SXMFWD_FW"}, "mangle": {"SXMFWD_MSS"}}
	for _, r := range q.Rules {
		if !protocol.Name.MatchString(r.ID) || !protocol.Overlay(r.Target) {
			return errors.New("invalid forward target")
		}
		for _, m := range r.Maps {
			if len(m) != 3 {
				return errors.New("invalid forward map")
			}
			var proto string
			var listen, target int
			if json.Unmarshal(m[0], &proto) != nil || json.Unmarshal(m[1], &listen) != nil || json.Unmarshal(m[2], &target) != nil || (proto != "tcp" && proto != "udp") || listen < 55000 || listen > 64999 || target < 1 || target > 65535 {
				return errors.New("invalid forward map")
			}
			key := proto + strconv.Itoa(listen)
			if seen[key] {
				return errors.New("forward port collision")
			}
			seen[key] = true
			tables["nat"] = append(tables["nat"], fmt.Sprintf("-A SXMFWD -p %s --dport %d -j DNAT --to-destination %s:%d", proto, listen, r.Target, target), fmt.Sprintf("-A SXMFWD_POST -d %s -p %s --dport %d -j MASQUERADE", r.Target, proto, target))
			tables["filter"] = append(tables["filter"], fmt.Sprintf("-A SXMFWD_FW -d %s -p %s --dport %d -j ACCEPT", r.Target, proto, target), fmt.Sprintf("-A SXMFWD_FW -s %s -p %s --sport %d -j ACCEPT", r.Target, proto, target))
		}
		for _, direction := range []string{"-s", "-d"} {
			tables["mangle"] = append(tables["mangle"], fmt.Sprintf("-A SXMFWD_MSS -p tcp --tcp-flags SYN,RST SYN %s %s -j TCPMSS --set-mss 1200", direction, r.Target))
		}
	}
	order := []string{"nat", "filter", "mangle"}
	for _, t := range order {
		for _, ch := range chains[t] {
			_, _ = command(ctx, "iptables", "-w", "5", "-t", t, "-N", ch)
		}
	}
	var script strings.Builder
	for _, t := range order {
		fmt.Fprintf(&script, "*%s\n", t)
		for _, ch := range chains[t] {
			fmt.Fprintf(&script, "-F %s\n", ch)
		}
		for _, r := range tables[t] {
			script.WriteString(r + "\n")
		}
		script.WriteString("COMMIT\n")
	}
	cmd := exec.CommandContext(ctx, "iptables-restore", "--noflush", "--wait", "5")
	cmd.Stdin = strings.NewReader(script.String())
	if e = cmd.Run(); e != nil {
		return errors.New("cannot apply mesh forward rules")
	}
	parent := "DOCKER-USER"
	if _, e = command(ctx, "iptables", "-S", parent); e != nil {
		parent = "FORWARD"
	}
	jumps := [][3]string{{"nat", "PREROUTING", "SXMFWD"}, {"nat", "POSTROUTING", "SXMFWD_POST"}, {"filter", parent, "SXMFWD_FW"}, {"mangle", "FORWARD", "SXMFWD_MSS"}}
	for _, j := range jumps {
		if _, e = command(ctx, "iptables", "-t", j[0], "-C", j[1], "-j", j[2]); e != nil {
			if e = must(ctx, "iptables", "-t", j[0], "-I", j[1], "1", "-j", j[2]); e != nil {
				return e
			}
		}
	}
	return nil
}
