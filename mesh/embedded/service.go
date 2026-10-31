// Package embedded runs mesh inside the worker or balancer process. It never
// installs host packages, uses SSH, systemd, or a Docker socket.
package embedded

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/konstpic/sharx-code/v2/mesh/agent"
	"github.com/konstpic/sharx-code/v2/mesh/protocol"
)

type Request struct {
	Operation string          `json:"operation"`
	Data      json.RawMessage `json:"data"`
}
type Setup struct {
	Name    string                   `json:"name"`
	Overlay string                   `json:"overlay"`
	Nodes   map[string]protocol.Node `json:"nodes"`
	Etcd    []string                 `json:"etcd"`
	CA      string                   `json:"ca"`
	Cert    string                   `json:"cert"`
	Key     string                   `json:"key"`
}
type EtcdStart struct {
	Cluster string `json:"cluster"`
	State   string `json:"state"`
	Token   string `json:"token"`
}
type EtcdTLS struct {
	CA            string `json:"ca"`
	Cert          string `json:"cert"`
	Key           string `json:"key"`
	AllowExisting bool   `json:"allow_existing"`
}
type Proxy struct {
	Path string          `json:"path"`
	Body json.RawMessage `json:"body"`
}

type Service struct {
	dir       string
	ctx       context.Context
	cancel    context.CancelFunc
	op        sync.Mutex
	mu        sync.Mutex
	wg        sync.WaitGroup
	stopAgent context.CancelFunc
	agentDone chan struct{}
	stopEtcd  context.CancelFunc
	etcdDone  chan struct{}
	lastError string
	agentUp   bool
	etcdUp    bool
	closed    bool
}

func New(dir string) *Service {
	ctx, cancel := context.WithCancel(context.Background())
	s := &Service{dir: filepath.Join(dir, "mesh"), ctx: ctx, cancel: cancel}
	// An ordinary node starts no mesh and creates no mesh files until enrolled.
	if _, e := os.Stat(s.path("config.json")); e == nil {
		s.startAgent()
	}
	if _, e := os.Stat(s.path("etcd.json")); e == nil {
		s.startEtcd()
	}
	return s
}
func (s *Service) path(name string) string { return filepath.Join(s.dir, name) }
func (s *Service) error(e error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e != nil {
		s.lastError = e.Error()
	} else {
		s.lastError = ""
	}
}
func (s *Service) Close() { s.op.Lock(); defer s.op.Unlock(); s.closed = true; s.cancel(); s.wg.Wait() }
func (s *Service) startAgent() {
	ctx, cancel := context.WithCancel(s.ctx)
	s.stopAgent = cancel
	s.agentDone = make(chan struct{})
	done := s.agentDone
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		defer close(done)
		if _, e := os.Stat(s.path("forwards.json")); e == nil {
			s.error(agent.Forward(ctx, s.path("forwards.json")))
		}
		for ctx.Err() == nil {
			s.mu.Lock()
			s.agentUp = true
			s.mu.Unlock()
			e := agent.Run(ctx, s.path("config.json"))
			s.mu.Lock()
			s.agentUp = false
			s.mu.Unlock()
			if ctx.Err() != nil {
				return
			}
			s.error(e)
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Second):
			}
		}
	}()
}
func (s *Service) haltAgent() {
	if s.stopAgent != nil {
		s.stopAgent()
		<-s.agentDone
		s.stopAgent = nil
	}
}
func (s *Service) haltEtcd() {
	if s.stopEtcd != nil {
		s.stopEtcd()
		<-s.etcdDone
		s.stopEtcd = nil
	}
}
func (s *Service) config() (agent.Config, error) {
	var c agent.Config
	b, e := os.ReadFile(s.path("config.json"))
	if e == nil {
		e = json.Unmarshal(b, &c)
	}
	return c, e
}
func run(ctx context.Context, name string, args ...string) (string, error) {
	b, e := exec.CommandContext(ctx, name, args...).Output()
	if e != nil {
		return "", fmt.Errorf("mesh: %s failed; check container NET_ADMIN, NET_RAW and host WireGuard support", name)
	}
	return strings.TrimSpace(string(b)), nil
}
func (s *Service) identity(ctx context.Context) (string, error) {
	if _, e := os.Stat(s.path("config.json")); os.IsNotExist(e) {
		raw, e := run(ctx, "ip", "-j", "addr", "show", "dev", "lo")
		if e != nil {
			return "", e
		}
		var devices []struct {
			Addresses []struct {
				Local string `json:"local"`
			} `json:"addr_info"`
		}
		if e = json.Unmarshal([]byte(raw), &devices); e != nil {
			return "", e
		}
		for _, d := range devices {
			for _, addr := range d.Addresses {
				if protocol.Overlay(addr.Local) {
					return "", errors.New("another mesh agent already owns this network namespace; remove the old enrollment first")
				}
			}
		}
	}
	// Check permissions/support without touching any active mesh interface.
	if e := agent.EnsureInterface(ctx, "sxc-check"); e != nil {
		return "", e
	}
	if _, e := run(ctx, "ip", "link", "del", "sxc-check"); e != nil {
		return "", e
	}
	keyFile := s.path("wireguard.key")
	key, e := os.ReadFile(keyFile)
	if os.IsNotExist(e) {
		v, err := run(ctx, "wg", "genkey")
		if err != nil {
			return "", err
		}
		key = []byte(v + "\n")
		e = agent.Write(keyFile, key, 0600)
	}
	if e != nil {
		return "", e
	}
	cmd := exec.CommandContext(ctx, "wg", "pubkey")
	cmd.Stdin = bytes.NewReader(key)
	out, e := cmd.Output()
	if e != nil {
		return "", errors.New("mesh key unreadable")
	}
	return strings.TrimSpace(string(out)), nil
}
func validateTLS(ca, cert, key string, host string) error {
	pair, e := tls.X509KeyPair([]byte(cert), []byte(key))
	if e != nil {
		return errors.New("invalid mesh certificate/key")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(ca)) {
		return errors.New("invalid mesh CA")
	}
	leaf, e := x509.ParseCertificate(pair.Certificate[0])
	if e != nil {
		return e
	}
	_, e = leaf.Verify(x509.VerifyOptions{Roots: roots, DNSName: host, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}})
	return e
}
func (s *Service) configure(ctx context.Context, q Setup) error {
	if !protocol.Name.MatchString(q.Name) || !protocol.Overlay(q.Overlay) {
		return errors.New("invalid mesh identity")
	}
	if e := protocol.Validate(q.Nodes); e != nil {
		return e
	}
	if q.Nodes[q.Name].Overlay != q.Overlay {
		return errors.New("identity absent from registry")
	}
	for _, ep := range q.Etcd {
		valid := false
		for _, n := range q.Nodes {
			if ep == "https://"+n.Overlay+":2399" {
				valid = true
			}
		}
		if !valid {
			return errors.New("invalid etcd endpoint")
		}
	}
	if e := validateTLS(q.CA, q.Cert, q.Key, ""); e != nil {
		return e
	}
	pub, e := s.identity(ctx)
	if e != nil {
		return e
	}
	if q.Nodes[q.Name].Pubkey != pub {
		return errors.New("mesh key does not match this container")
	}
	if old, e := s.config(); e == nil && (old.Name != q.Name || old.Overlay != q.Overlay) {
		return errors.New("remove existing enrollment before changing identity")
	}
	s.haltAgent()
	for name, data := range map[string]string{"ca.crt": q.CA, "client.crt": q.Cert, "client.key": q.Key} {
		if e = agent.Write(s.path(name), []byte(data), 0600); e != nil {
			return e
		}
	}
	if e = agent.Atomic(s.path("nodes.json"), q.Nodes); e != nil {
		return e
	}
	cfg := agent.Config{Name: q.Name, Overlay: q.Overlay, KeyFile: s.path("wireguard.key"), NodesFile: s.path("nodes.json"), Etcd: q.Etcd, TLS: agent.TLSFiles{CA: s.path("ca.crt"), Cert: s.path("client.crt"), Key: s.path("client.key")}}
	if e = agent.Atomic(s.path("config.json"), cfg); e != nil {
		return e
	}
	s.startAgent()
	return nil
}
func (s *Service) etcdPrepare(q EtcdTLS) error {
	cfg, e := s.config()
	if e != nil {
		return errors.New("enroll mesh first")
	}
	if e = validateTLS(q.CA, q.Cert, q.Key, cfg.Overlay); e != nil {
		return e
	}
	if _, e = os.Stat(s.path("etcd.json")); e == nil {
		return errors.New("existing etcd will not be replaced")
	}
	data := s.path("etcd-data")
	if _, e = os.Stat(filepath.Join(data, "member")); e == nil {
		var marker struct {
			Retired bool `json:"retired"`
		}
		b, _ := os.ReadFile(s.path("etcd-managed.json"))
		_ = json.Unmarshal(b, &marker)
		if !q.AllowExisting || !marker.Retired {
			return errors.New("existing etcd data will not be replaced")
		}
		if e = os.Rename(data, data+".retired-"+fmt.Sprint(time.Now().UnixNano())); e != nil {
			return e
		}
	}
	for name, data := range map[string]string{"etcd-ca.crt": q.CA, "etcd-server.crt": q.Cert, "etcd-server.key": q.Key} {
		if e = agent.Write(s.path(name), []byte(data), 0600); e != nil {
			return e
		}
	}
	return nil
}
func (s *Service) etcdArgs(q EtcdStart) ([]string, error) {
	c, e := s.config()
	if e != nil {
		return nil, e
	}
	b, e := os.ReadFile(c.NodesFile)
	if e != nil {
		return nil, e
	}
	var nodes map[string]protocol.Node
	if e = json.Unmarshal(b, &nodes); e != nil {
		return nil, e
	}
	own := false
	seen := map[string]bool{}
	for _, item := range strings.Split(q.Cluster, ",") {
		name, ep, ok := strings.Cut(item, "=")
		n, known := nodes[name]
		if !ok || !known || seen[name] || ep != "https://"+n.Overlay+":2391" {
			return nil, errors.New("invalid etcd cluster")
		}
		seen[name] = true
		own = own || name == c.Name
	}
	if !own || (q.State != "new" && q.State != "existing") || (q.State == "new" && q.Token == "") {
		return nil, errors.New("invalid etcd bootstrap")
	}
	client := "https://" + c.Overlay + ":2399"
	peer := "https://" + c.Overlay + ":2391"
	return []string{"--name=" + c.Name, "--data-dir=" + s.path("etcd-data"), "--initial-cluster-state=" + q.State, "--initial-cluster=" + q.Cluster, "--initial-cluster-token=" + q.Token, "--listen-client-urls=" + client + ",https://127.0.0.1:2399", "--advertise-client-urls=" + client, "--listen-peer-urls=" + peer, "--initial-advertise-peer-urls=" + peer, "--cert-file=" + s.path("etcd-server.crt"), "--key-file=" + s.path("etcd-server.key"), "--trusted-ca-file=" + s.path("etcd-ca.crt"), "--client-cert-auth=true", "--peer-cert-file=" + s.path("etcd-server.crt"), "--peer-key-file=" + s.path("etcd-server.key"), "--peer-trusted-ca-file=" + s.path("etcd-ca.crt"), "--peer-client-cert-auth=true", "--auto-compaction-retention=1", "--quota-backend-bytes=268435456"}, nil
}
func (s *Service) startEtcd() {
	ctx, cancel := context.WithCancel(s.ctx)
	s.stopEtcd = cancel
	s.etcdDone = make(chan struct{})
	done := s.etcdDone
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		defer close(done)
		b, e := os.ReadFile(s.path("etcd.json"))
		var q EtcdStart
		if e == nil {
			e = json.Unmarshal(b, &q)
		}
		if e != nil {
			s.error(e)
			return
		}
		args, e := s.etcdArgs(q)
		if e != nil {
			s.error(e)
			return
		}
		for ctx.Err() == nil {
			cmd := exec.Command("/usr/local/bin/etcd", args...)
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			e = cmd.Start()
			if e == nil {
				s.mu.Lock()
				s.etcdUp = true
				s.mu.Unlock()
				wait := make(chan error, 1)
				go func() { wait <- cmd.Wait() }()
				select {
				case e = <-wait:
				case <-ctx.Done():
					_ = cmd.Process.Signal(syscall.SIGTERM)
					select {
					case <-wait:
					case <-time.After(5 * time.Second):
						_ = cmd.Process.Kill()
						<-wait
					}
				}
				s.mu.Lock()
				s.etcdUp = false
				s.mu.Unlock()
			}
			if ctx.Err() != nil {
				return
			}
			s.error(e)
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Second):
			}
		}
	}()
}

var proxyPaths = map[string]bool{"/v3/kv/range": true, "/v3/kv/put": true, "/v3/kv/deleterange": true, "/v3/lease/grant": true, "/v3/cluster/member/list": true, "/v3/cluster/member/add": true, "/v3/cluster/member/remove": true, "/v3/cluster/member/promote": true, "/v3/maintenance/status": true}

func (s *Service) proxy(ctx context.Context, q Proxy) (json.RawMessage, error) {
	if !proxyPaths[q.Path] || !json.Valid(q.Body) {
		return nil, errors.New("unsupported etcd request")
	}
	s.op.Lock()
	cfg, e := s.config()
	if e == nil {
		var client *http.Client
		client, e = agent.TLSClient(cfg.TLS)
		s.op.Unlock()
		if e != nil {
			return nil, e
		}
		defer client.CloseIdleConnections()
		req, e := http.NewRequestWithContext(ctx, "POST", "https://127.0.0.1:2399"+q.Path, bytes.NewReader(q.Body))
		if e != nil {
			return nil, e
		}
		req.Header.Set("Content-Type", "application/json")
		resp, e := client.Do(req)
		if e != nil {
			return nil, errors.New("etcd unavailable")
		}
		defer resp.Body.Close()
		data, e := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		if e != nil || resp.StatusCode != 200 || !json.Valid(data) {
			return nil, errors.New("etcd request failed")
		}
		return json.RawMessage(data), nil
	}
	s.op.Unlock()
	return nil, e
}
func (s *Service) Call(ctx context.Context, q Request) (any, error) {
	if q.Operation == "etcd-proxy" {
		var p Proxy
		if e := json.Unmarshal(q.Data, &p); e != nil {
			return nil, e
		}
		return s.proxy(ctx, p)
	}
	s.op.Lock()
	defer s.op.Unlock()
	if s.closed {
		return nil, errors.New("mesh service closed")
	}
	switch q.Operation {
	case "status":
		s.mu.Lock()
		defer s.mu.Unlock()
		_, e := s.config()
		return map[string]any{"embedded": true, "enabled": e == nil, "agent_running": s.agentUp, "etcd_running": s.etcdUp, "error": s.lastError}, nil
	case "identity":
		pub, e := s.identity(ctx)
		return map[string]any{"pubkey": pub, "embedded": true}, e
	case "configure":
		var p Setup
		if e := json.Unmarshal(q.Data, &p); e != nil {
			return nil, e
		}
		return map[string]bool{"ok": true}, s.configure(ctx, p)
	case "probe":
		var p agent.ProbeRequest
		if e := json.Unmarshal(q.Data, &p); e != nil {
			return nil, e
		}
		if _, e := s.config(); e != nil {
			return nil, errors.New("mesh disabled")
		}
		return agent.Probe(ctx, p)
	case "forward":
		if _, e := s.config(); e != nil {
			return nil, errors.New("mesh disabled")
		}
		if !json.Valid(q.Data) {
			return nil, errors.New("invalid rules")
		}
		tmp := s.path("forwards.next.json")
		if e := agent.Write(tmp, q.Data, 0600); e != nil {
			return nil, e
		}
		if e := agent.Forward(ctx, tmp); e != nil {
			return nil, e
		}
		return map[string]bool{"ok": true}, os.Rename(tmp, s.path("forwards.json"))
	case "etcd-prepare":
		var p EtcdTLS
		if e := json.Unmarshal(q.Data, &p); e != nil {
			return nil, e
		}
		return map[string]bool{"ok": true}, s.etcdPrepare(p)
	case "etcd-start":
		var p EtcdStart
		if e := json.Unmarshal(q.Data, &p); e != nil {
			return nil, e
		}
		if _, e := s.etcdArgs(p); e != nil {
			return nil, e
		}
		if _, e := exec.LookPath("etcd"); e != nil {
			return nil, errors.New("etcd binary missing from image")
		}
		if _, e := os.Stat(s.path("etcd.json")); e == nil {
			return map[string]bool{"ok": true}, nil
		}
		if e := agent.Atomic(s.path("etcd.json"), p); e != nil {
			return nil, e
		}
		s.startEtcd()
		return map[string]bool{"ok": true}, nil
	case "etcd-marker":
		if !json.Valid(q.Data) {
			return nil, errors.New("invalid marker")
		}
		return map[string]bool{"ok": true}, agent.Write(s.path("etcd-managed.json"), q.Data, 0600)
	case "etcd-stop":
		s.haltEtcd()
		e := os.Remove(s.path("etcd.json"))
		if os.IsNotExist(e) {
			e = nil
		}
		return map[string]bool{"ok": true}, e
	case "remove":
		if _, e := os.Stat(s.path("etcd.json")); e == nil {
			return nil, errors.New("remove etcd membership first")
		}
		cfg, e := s.config()
		if e != nil {
			return nil, e
		}
		s.haltAgent()
		b, _ := os.ReadFile(cfg.NodesFile)
		var nodes map[string]protocol.Node
		_ = json.Unmarshal(b, &nodes)
		for n := range nodes {
			if n != cfg.Name {
				_, _ = run(ctx, "ip", "link", "del", "sxm-"+n)
			}
		}
		_, _ = run(ctx, "ip", "addr", "del", cfg.Overlay+"/32", "dev", "lo")
		empty := []byte(`{"rules":[]}`)
		if e = agent.Write(s.path("forwards.json"), empty, 0600); e != nil {
			return nil, e
		}
		if e = agent.Forward(ctx, s.path("forwards.json")); e != nil {
			return nil, e
		}
		return map[string]bool{"ok": true}, os.Remove(s.path("config.json"))
	default:
		return nil, errors.New("unknown mesh operation")
	}
}

// Handler is mounted behind the node/balancer's existing JWT authentication.
func (s *Service) Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	var q Request
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	dec.DisallowUnknownFields()
	if e := dec.Decode(&q); e != nil {
		w.WriteHeader(400)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid mesh request"})
		return
	}
	out, e := s.Call(r.Context(), q)
	if e != nil {
		w.WriteHeader(422)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": e.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(out)
}
