package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/balancer/spec"
	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"gorm.io/gorm"
)

// BalancerService manages edge balancers, their pools and the config pushed to their agents.
// See docs/architecture/balancer.md.
type BalancerService struct{}

// ---------- validation helpers ----------

// balancerHostOnly reduces "https://host:443/x" or "host:443" to "host".
func balancerHostOnly(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.Contains(raw, "://") {
		if u, err := url.Parse(raw); err == nil {
			raw = u.Host
		}
	}
	if h, _, err := net.SplitHostPort(raw); err == nil {
		raw = h
	}
	return strings.Trim(raw, "[]/ ")
}

func normalizeBalancer(b *model.Balancer) error {
	b.Name = strings.TrimSpace(b.Name)
	b.Address = balancerHostOnly(b.Address)
	b.Remark = strings.TrimSpace(b.Remark)
	if b.Name == "" {
		return errors.New("name is required")
	}
	if b.Address == "" {
		return errors.New("public address is required")
	}
	switch strings.ToLower(strings.TrimSpace(b.Engine)) {
	case model.BalancerEngineNginx:
		b.Engine = model.BalancerEngineNginx
	default:
		b.Engine = model.BalancerEngineHAProxy
	}
	b.ApiAddress = strings.TrimRight(strings.TrimSpace(b.ApiAddress), "/")
	if b.ApiAddress == "" {
		b.ApiAddress = "http://" + b.Address + ":8080"
	}
	if !strings.Contains(b.ApiAddress, "://") {
		b.ApiAddress = "http://" + b.ApiAddress
	}
	if u, err := url.Parse(b.ApiAddress); err != nil || u.Host == "" {
		return errors.New("invalid agent API address")
	}
	return nil
}

// PoolTransport reports whether an inbound is carried over tcp or udp (decides the engine and the listener).
func PoolTransport(protocol model.Protocol, streamSettings string) string {
	switch model.NormalizeProtocol(protocol) {
	case model.Hysteria, model.Hysteria2, model.WireGuard, model.AmneziaWG:
		return spec.ProtoUDP
	}
	var st struct {
		Network string `json:"network"`
	}
	if json.Unmarshal([]byte(streamSettings), &st) == nil {
		switch strings.ToLower(st.Network) {
		case "kcp", "mkcp", "quic", "hysteria":
			return spec.ProtoUDP
		}
	}
	return spec.ProtoTCP
}

// ---------- reads ----------

// List returns all balancers with their pools and members.
func (s *BalancerService) List() ([]*model.Balancer, error) {
	db := database.GetDB()
	var out []*model.Balancer
	if err := db.Order("sort_order ASC, id ASC").Find(&out).Error; err != nil {
		return nil, err
	}
	for _, b := range out {
		pools, err := s.poolsFor(b.Id)
		if err != nil {
			return nil, err
		}
		b.Pools = pools
	}
	return out, nil
}

// Get returns one balancer with pools and members.
func (s *BalancerService) Get(id int) (*model.Balancer, error) {
	db := database.GetDB()
	var b model.Balancer
	if err := db.First(&b, id).Error; err != nil {
		return nil, err
	}
	pools, err := s.poolsFor(b.Id)
	if err != nil {
		return nil, err
	}
	b.Pools = pools
	return &b, nil
}

func (s *BalancerService) poolsFor(balancerId int) ([]model.BalancerPool, error) {
	db := database.GetDB()
	var pools []model.BalancerPool
	if err := db.Where("balancer_id = ?", balancerId).Order("sort_order ASC, id ASC").Find(&pools).Error; err != nil {
		return nil, err
	}
	nodeSvc := &NodeService{}
	for i := range pools {
		p := &pools[i]
		var ib model.Inbound
		if err := db.Select("id, remark, protocol, port, stream_settings").First(&ib, p.InboundId).Error; err == nil {
			p.InboundRemark, p.InboundProtocol, p.InboundPort = ib.Remark, string(ib.Protocol), ib.Port
			p.Transport = PoolTransport(ib.Protocol, ib.StreamSettings)
		}
		members, err := s.effectiveMembers(p, nodeSvc)
		if err != nil {
			return nil, err
		}
		p.Members = members
	}
	return pools, nil
}

// effectiveMembers returns the pool's members. With auto_members every node of the inbound is a member (stored rows
// only carry per-node overrides); otherwise only the stored rows are members.
func (s *BalancerService) effectiveMembers(p *model.BalancerPool, nodeSvc *NodeService) ([]model.BalancerPoolMember, error) {
	db := database.GetDB()
	var rows []model.BalancerPoolMember
	if err := db.Where("pool_id = ?", p.Id).Order("id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	byNode := map[int]model.BalancerPoolMember{}
	for _, r := range rows {
		byNode[r.NodeId] = r
	}
	var out []model.BalancerPoolMember
	add := func(n *model.Node, r model.BalancerPoolMember, hasRow bool) {
		if !hasRow {
			r = model.BalancerPoolMember{PoolId: p.Id, NodeId: n.Id, Weight: 1, Enable: true}
		}
		r.NodeName, r.NodeAddr, r.NodeStatus = n.Name, balancerHostOnly(n.Address), n.Status
		if !n.Enable {
			r.NodeStatus = "disabled"
		}
		out = append(out, r)
	}
	if p.AutoMembers {
		nodes, err := nodeSvc.GetNodesForInbound(p.InboundId)
		if err != nil {
			return nil, err
		}
		for _, n := range nodes {
			r, ok := byNode[n.Id]
			add(n, r, ok)
		}
		return out, nil
	}
	for _, r := range rows {
		n, err := nodeSvc.GetNode(r.NodeId)
		if err != nil || n == nil {
			continue
		}
		add(n, r, true)
	}
	return out, nil
}

// ---------- writes ----------

// Add creates a balancer.
func (s *BalancerService) Add(b *model.Balancer) error {
	if err := normalizeBalancer(b); err != nil {
		return err
	}
	b.Id, b.Status, b.Enable = 0, "unknown", true
	if err := database.GetDB().Create(b).Error; err != nil {
		return err
	}
	return database.GetDB().First(b, b.Id).Error // reload the trigger-assigned sort_order
}

// Update changes the editable fields of a balancer.
func (s *BalancerService) Update(in *model.Balancer) error {
	var cur model.Balancer
	db := database.GetDB()
	if err := db.First(&cur, in.Id).Error; err != nil {
		return err
	}
	in.Enable = cur.Enable // toggled through SetEnabled only
	if err := normalizeBalancer(in); err != nil {
		return err
	}
	if in.Engine == model.BalancerEngineHAProxy {
		pools, err := s.poolsFor(cur.Id)
		if err != nil {
			return err
		}
		for _, p := range pools {
			if p.Transport == spec.ProtoUDP {
				return fmt.Errorf("pool %q is UDP: the HAProxy engine cannot balance it, use nginx", p.InboundRemark)
			}
		}
	}
	return db.Model(&model.Balancer{}).Where("id = ?", in.Id).Updates(map[string]any{
		"name": in.Name, "address": in.Address, "api_address": in.ApiAddress, "remark": in.Remark,
		"engine": in.Engine, "enable": in.Enable, "updated_at": time.Now().Unix(),
	}).Error
}

// SetEnabled turns a balancer on or off. A disabled balancer is not pushed to, and disappears from subscriptions.
func (s *BalancerService) SetEnabled(id int, enable bool) error {
	return database.GetDB().Model(&model.Balancer{}).Where("id = ?", id).Update("enable", enable).Error
}

// Delete removes a balancer (pools and members cascade).
func (s *BalancerService) Delete(id int) error {
	return database.GetDB().Delete(&model.Balancer{}, id).Error
}

// Reorder stores the manual order of balancers.
func (s *BalancerService) Reorder(ids []int) error {
	if len(ids) == 0 {
		return errors.New("ids are required")
	}
	db := database.GetDB()
	var current []int
	if err := db.Model(&model.Balancer{}).Order("sort_order ASC, id ASC").Pluck("id", &current).Error; err != nil {
		return err
	}
	final := mergeOrder(current, ids)
	return db.Transaction(func(tx *gorm.DB) error {
		for i, id := range final {
			if err := tx.Exec("UPDATE balancers SET sort_order = ? WHERE id = ?", i+1, id).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func normalizePoolAlgo(a string) string {
	switch strings.ToLower(strings.TrimSpace(a)) {
	case spec.AlgoLeastConn:
		return spec.AlgoLeastConn
	case spec.AlgoSource:
		return spec.AlgoSource
	default:
		return spec.AlgoRoundRobin
	}
}

// SavePool creates (Id == 0) or updates a pool and replaces its member overrides.
func (s *BalancerService) SavePool(p *model.BalancerPool, members []model.BalancerPoolMember) (*model.BalancerPool, error) {
	db := database.GetDB()
	var bal model.Balancer
	if err := db.First(&bal, p.BalancerId).Error; err != nil {
		return nil, errors.New("balancer not found")
	}
	var ib model.Inbound
	if err := db.First(&ib, p.InboundId).Error; err != nil {
		return nil, errors.New("inbound not found")
	}
	transport := PoolTransport(ib.Protocol, ib.StreamSettings)
	if transport == spec.ProtoUDP && bal.Engine != model.BalancerEngineNginx {
		return nil, errors.New("this inbound uses UDP: switch the balancer engine to nginx")
	}
	p.Algorithm = normalizePoolAlgo(p.Algorithm)
	p.SubMode = model.NormalizeBalancerSubMode(p.SubMode)
	if p.ListenPort < 0 || p.ListenPort > 65535 {
		return nil, errors.New("invalid listen port")
	}
	if p.ProxyProtocol && transport == spec.ProtoUDP {
		return nil, errors.New("PROXY protocol is not available for UDP")
	}
	effective := p.ListenPort
	if effective == 0 {
		effective = ib.Port
	}
	// One listener per (port, transport) on a balancer.
	var others []model.BalancerPool
	if err := db.Where("balancer_id = ? AND id <> ?", p.BalancerId, p.Id).Find(&others).Error; err != nil {
		return nil, err
	}
	for _, o := range others {
		var oib model.Inbound
		if err := db.Select("id, protocol, port, stream_settings").First(&oib, o.InboundId).Error; err != nil {
			continue
		}
		op := o.ListenPort
		if op == 0 {
			op = oib.Port
		}
		if op == effective && PoolTransport(oib.Protocol, oib.StreamSettings) == transport {
			return nil, fmt.Errorf("port %d/%s is already used by another pool of this balancer: set a different listen port", effective, transport)
		}
	}

	now := time.Now().Unix()
	err := db.Transaction(func(tx *gorm.DB) error {
		if p.Id == 0 {
			p.CreatedAt, p.UpdatedAt = now, now
			if err := tx.Create(p).Error; err != nil {
				if strings.Contains(err.Error(), "uq_balancer_pool_inbound") {
					return errors.New("this inbound is already in the balancer")
				}
				return err
			}
		} else {
			if err := tx.Model(&model.BalancerPool{}).Where("id = ? AND balancer_id = ?", p.Id, p.BalancerId).Updates(map[string]any{
				"listen_port": p.ListenPort, "algorithm": p.Algorithm, "proxy_protocol": p.ProxyProtocol,
				"health_check": p.HealthCheck, "sub_enabled": p.SubEnabled, "sub_mode": p.SubMode,
				"auto_members": p.AutoMembers, "enable": p.Enable, "updated_at": now,
			}).Error; err != nil {
				return err
			}
		}
		if members != nil {
			if err := tx.Where("pool_id = ?", p.Id).Delete(&model.BalancerPoolMember{}).Error; err != nil {
				return err
			}
			seen := map[int]bool{}
			for _, m := range members {
				if m.NodeId == 0 || seen[m.NodeId] {
					continue
				}
				seen[m.NodeId] = true
				if m.Weight < 0 || m.Weight > 256 {
					return errors.New("weight must be between 0 and 256")
				}
				if m.Weight == 0 {
					m.Weight = 1
				}
				row := model.BalancerPoolMember{
					PoolId: p.Id, NodeId: m.NodeId, Weight: m.Weight, Backup: m.Backup, Enable: m.Enable,
					AddressOverride: strings.TrimSpace(m.AddressOverride), PortOverride: m.PortOverride,
				}
				if err := tx.Create(&row).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	go func() { _ = s.Apply(p.BalancerId) }()
	pools, err := s.poolsFor(p.BalancerId)
	if err != nil {
		return nil, err
	}
	for i := range pools {
		if pools[i].Id == p.Id {
			return &pools[i], nil
		}
	}
	return p, nil
}

// DeletePool removes a pool.
func (s *BalancerService) DeletePool(id int) error {
	db := database.GetDB()
	var p model.BalancerPool
	if err := db.First(&p, id).Error; err != nil {
		return err
	}
	if err := db.Delete(&model.BalancerPool{}, id).Error; err != nil {
		return err
	}
	go func() { _ = s.Apply(p.BalancerId) }()
	return nil
}

// ---------- spec ----------

// BuildSpec computes the desired agent configuration from the DB.
func (s *BalancerService) BuildSpec(id int) (spec.Spec, error) {
	b, err := s.Get(id)
	if err != nil {
		return spec.Spec{}, err
	}
	return s.buildSpecFor(b), nil
}

func (s *BalancerService) buildSpecFor(b *model.Balancer) spec.Spec {
	out := spec.Spec{Engine: b.Engine, Pools: []spec.Pool{}}
	for _, p := range b.Pools {
		if !p.Enable {
			continue
		}
		port := p.ListenPort
		if port == 0 {
			port = p.InboundPort
		}
		sp := spec.Pool{
			ID: p.Id, Name: p.InboundRemark, ListenPort: port, Proto: p.Transport, Algorithm: p.Algorithm,
			ProxyProtocol: p.ProxyProtocol, HealthCheck: p.HealthCheck,
		}
		for _, m := range p.Members {
			if !m.Enable || m.NodeStatus == "disabled" {
				continue
			}
			host := strings.TrimSpace(m.AddressOverride)
			if host == "" {
				host = m.NodeAddr
			}
			bport := m.PortOverride
			if bport == 0 {
				bport = p.InboundPort
			}
			if host == "" || bport == 0 {
				continue
			}
			sp.Members = append(sp.Members, spec.Member{Host: host, Port: bport, Weight: m.Weight, Backup: m.Backup})
		}
		if len(sp.Members) == 0 {
			logger.Warningf("balancer %d: pool %d has no usable members, not deployed", b.Id, p.Id)
			continue
		}
		out.Pools = append(out.Pools, sp)
	}
	return out
}

// ---------- agent communication ----------

var balancerHTTP = &http.Client{Timeout: 15 * time.Second}

type agentStatusResp struct {
	AgentVersion   string            `json:"agentVersion"`
	EngineVersions map[string]string `json:"engineVersions"`
	Status         json.RawMessage   `json:"status"`
}

// AgentStatus is the parsed part of the agent status the panel keeps and shows.
type AgentStatus struct {
	Engine    string `json:"engine"`
	Running   bool   `json:"running"`
	Hash      string `json:"hash"`
	AppliedAt int64  `json:"appliedAt"`
	LastError string `json:"lastError"`
	Pools     []struct {
		ID        int    `json:"id"`
		Port      int    `json:"port"`
		Proto     string `json:"proto"`
		Listening *bool  `json:"listening"`
		Members   []struct {
			Host     string `json:"host"`
			Port     int    `json:"port"`
			Up       *bool  `json:"up"`
			Sessions int    `json:"sessions"`
			Total    int64  `json:"total"`
		} `json:"members"`
	} `json:"pools"`
}

var (
	balancerLiveMu sync.Mutex
	balancerLive   = map[int]*AgentStatus{}
	balancerTry    = map[int]struct {
		hash string
		at   time.Time
	}{}
	balancerApplyMu sync.Map // id -> *sync.Mutex
)

// LiveStatus returns the last agent status the panel saw (nil if none).
func (s *BalancerService) LiveStatus(id int) *AgentStatus {
	balancerLiveMu.Lock()
	defer balancerLiveMu.Unlock()
	return balancerLive[id]
}

func (s *BalancerService) agentRequest(b *model.Balancer, method, path string, body []byte) (*http.Response, error) {
	tok, err := (&NodeService{}).bearerTokenForNode(&model.Node{})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(method, b.ApiAddress+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return balancerHTTP.Do(req)
}

// Refresh polls the agent: reachability, versions and per-backend health.
func (s *BalancerService) Refresh(id int) (*AgentStatus, error) {
	b, err := s.Get(id)
	if err != nil {
		return nil, err
	}
	start := time.Now()
	resp, err := s.agentRequest(b, http.MethodGet, "/api/v1/status", nil)
	rt := time.Since(start).Milliseconds()
	db := database.GetDB()
	set := func(status string, fields map[string]any) {
		fields["status"], fields["last_check"], fields["response_time"] = status, time.Now().Unix(), rt
		db.Model(&model.Balancer{}).Where("id = ?", id).Updates(fields)
	}
	if err != nil {
		set("offline", map[string]any{})
		balancerLiveMu.Lock()
		delete(balancerLive, id)
		balancerLiveMu.Unlock()
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode != http.StatusOK {
		set("error", map[string]any{})
		return nil, fmt.Errorf("agent returned %d", resp.StatusCode)
	}
	var full agentStatusResp
	if err := json.Unmarshal(raw, &full); err != nil {
		set("error", map[string]any{})
		return nil, err
	}
	var st AgentStatus
	_ = json.Unmarshal(full.Status, &st)
	ev := ""
	if st.Engine != "" {
		ev = full.EngineVersions[st.Engine]
	}
	set("online", map[string]any{"agent_version": full.AgentVersion, "engine_version": ev})
	balancerLiveMu.Lock()
	balancerLive[id] = &st
	balancerLiveMu.Unlock()
	return &st, nil
}

// Apply pushes the current desired spec to the agent.
func (s *BalancerService) Apply(id int) error {
	mu, _ := balancerApplyMu.LoadOrStore(id, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	defer mu.(*sync.Mutex).Unlock()

	b, err := s.Get(id)
	if err != nil {
		return err
	}
	sp := s.buildSpecFor(b)
	hash := sp.Hash()
	db := database.GetDB()
	db.Model(&model.Balancer{}).Where("id = ?", id).Update("config_hash", hash)
	if err := sp.Validate(); err != nil {
		db.Model(&model.Balancer{}).Where("id = ?", id).Update("last_error", err.Error())
		return err
	}
	body, _ := json.Marshal(sp)
	resp, err := s.agentRequest(b, http.MethodPost, "/api/v1/apply", body)
	if err != nil {
		db.Model(&model.Balancer{}).Where("id = ?", id).Updates(map[string]any{"last_error": "agent unreachable: " + err.Error(), "status": "offline"})
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		msg := e.Error
		if msg == "" {
			msg = fmt.Sprintf("agent returned %d", resp.StatusCode)
		}
		db.Model(&model.Balancer{}).Where("id = ?", id).Update("last_error", msg)
		return errors.New(msg)
	}
	db.Model(&model.Balancer{}).Where("id = ?", id).Updates(map[string]any{"applied_hash": hash, "last_applied_at": time.Now().Unix(), "last_error": ""})
	_, _ = s.Refresh(id)
	return nil
}

// Metrics returns the agent's sampled traffic history newer than sinceMs, as the agent sent it. The panel stores
// nothing: history lives in the agent (one hour), which keeps the panel database free of high-frequency writes.
func (s *BalancerService) Metrics(id int, sinceMs int64) (json.RawMessage, error) {
	b, err := s.Get(id)
	if err != nil {
		return nil, err
	}
	resp, err := s.agentRequest(b, http.MethodGet, fmt.Sprintf("/api/v1/metrics?since=%d", sinceMs), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("agent returned %d (update the agent to get traffic history)", resp.StatusCode)
	}
	return raw, nil
}

// StartSSHInstall installs the balancer agent on the balancer's server over SSH (same runner, host-key pinning and progress
// as node provisioning) and returns the task id to poll with NodeService.GetSSHProvisionTask.
func (s *BalancerService) StartSSHInstall(nodeSvc *NodeService, id int, req NodeSSHProvisionRequest) (string, error) {
	b, err := s.Get(id)
	if err != nil {
		return "", errors.New("balancer not found")
	}
	pairing := &PanelPairingService{}
	secret, err := pairing.GetSecretKey()
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(req.Host) == "" {
		req.Host = b.Address
	}
	port := 8080
	if u, err := url.Parse(b.ApiAddress); err == nil && u.Port() != "" {
		if n, err := strconv.Atoi(u.Port()); err == nil && n > 0 {
			port = n
		}
	}
	req.Role, req.AgentPort, req.SecretKey, req.NodeId = BalancerRole, port, secret, 0
	return nodeSvc.StartNodeSSHProvision(req)
}

// Reconcile refreshes every enabled balancer and re-applies the spec when the agent drifted from the panel
// (node or inbound changed, agent restarted without state). Failed applies of the same spec are retried at most every 30 s.
func (s *BalancerService) Reconcile() {
	var list []model.Balancer
	if err := database.GetDB().Where("enable = ?", true).Find(&list).Error; err != nil {
		return
	}
	for _, b := range list {
		st, err := s.Refresh(b.Id)
		if err != nil {
			continue
		}
		full, err := s.Get(b.Id)
		if err != nil {
			continue
		}
		want := s.buildSpecFor(full).Hash()
		if st.Hash == want {
			continue
		}
		balancerLiveMu.Lock()
		t := balancerTry[b.Id]
		recent := t.hash == want && time.Since(t.at) < 30*time.Second
		if !recent {
			balancerTry[b.Id] = struct {
				hash string
				at   time.Time
			}{want, time.Now()}
		}
		balancerLiveMu.Unlock()
		if recent {
			continue
		}
		if err := s.Apply(b.Id); err != nil {
			logger.Warningf("balancer %d (%s): apply failed: %v", b.Id, b.Name, err)
		}
	}
}

// ---------- subscription ----------

// BalancerSubEntry is one balancer address to show in a subscription.
type BalancerSubEntry struct {
	Address string
	Port    int // 0 = the inbound's own port
	Mode    string
	Name    string
}

// SubscriptionEntries lists the balancer entries for an inbound (enabled balancer, enabled pool, subscription on).
func (s *BalancerService) SubscriptionEntries(inboundId int, inboundPort int) []BalancerSubEntry {
	db := database.GetDB()
	var pools []model.BalancerPool
	if err := db.Where("inbound_id = ? AND enable = ? AND sub_enabled = ?", inboundId, true, true).
		Order("id ASC").Find(&pools).Error; err != nil || len(pools) == 0 {
		return nil
	}
	var out []BalancerSubEntry
	for _, p := range pools {
		var b model.Balancer
		if err := db.First(&b, p.BalancerId).Error; err != nil || !b.Enable || strings.TrimSpace(b.Address) == "" {
			continue
		}
		port := p.ListenPort
		if port == inboundPort {
			port = 0
		}
		out = append(out, BalancerSubEntry{Address: b.Address, Port: port, Mode: model.NormalizeBalancerSubMode(p.SubMode), Name: b.Name})
	}
	return out
}
