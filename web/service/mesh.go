package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/mesh"
	"gorm.io/gorm"
)

type MeshSettings struct {
	Enabled      bool   `json:"enabled"`
	RelayAddress string `json:"relay_address"`
	ProbePorts   []int  `json:"probe_ports"`
	SNI          string `json:"sni"`
	BalancerUUID string `json:"balancer_uuid"`
	Interval     int    `json:"interval"`
}

var meshMu sync.Mutex
var meshRuntime *mesh.Runtime
var meshStateMu sync.Mutex
var meshOperationsMu sync.Mutex
var meshDNS = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$`)

func meshDirectory() string {
	if p := os.Getenv("XUI_MESH_STATE_DIR"); p != "" {
		return p
	}
	return "/etc/x-ui/mesh"
}
func meshMulti() bool { v, e := (&SettingService{}).GetMultiNodeMode(); return e == nil && v }
func StartMesh(ctx context.Context) {
	meshMu.Lock()
	defer meshMu.Unlock()
	if meshRuntime != nil {
		meshRuntime.Stop()
	}
	meshRuntime = &mesh.Runtime{Dir: meshDirectory(), Gate: meshMulti, Bridge: meshBridge}
	meshRuntime.Start(ctx)
}
func StopMesh() {
	meshMu.Lock()
	defer meshMu.Unlock()
	if meshRuntime != nil {
		meshRuntime.Stop()
		meshRuntime = nil
	}
}
func getMeshRuntime() *mesh.Runtime { meshMu.Lock(); defer meshMu.Unlock(); return meshRuntime }
func MeshConfig() (MeshSettings, error) {
	var c MeshSettings
	c.Interval = 30
	c.ProbePorts = []int{}
	b, e := os.ReadFile(filepath.Join(meshDirectory(), "settings.json"))
	if errors.Is(e, os.ErrNotExist) {
		return c, nil
	}
	if e != nil {
		return c, e
	}
	e = json.Unmarshal(b, &c)
	return c, e
}
func ValidateMeshSettings(c MeshSettings) error {
	if c.Interval < 15 || c.Interval > 300 {
		return errors.New("интервал должен быть от 15 до 300 секунд")
	}
	if c.SNI != "" && !meshDNS.MatchString(c.SNI) {
		return errors.New("SNI должен быть именем хоста")
	}
	if c.RelayAddress != "" && net.ParseIP(c.RelayAddress) == nil && !meshDNS.MatchString(c.RelayAddress) {
		return errors.New("адрес релея должен быть IP или именем хоста без URL/порта")
	}
	if len(c.ProbePorts) > 8 {
		return errors.New("не больше восьми портов для проверок")
	}
	seen := map[int]bool{}
	for _, p := range c.ProbePorts {
		if p < 1 || p > 65535 || seen[p] {
			return errors.New("неверный или повторяющийся порт проверки")
		}
		seen[p] = true
	}
	if len(c.ProbePorts) > 0 && c.SNI == "" {
		return errors.New("для TLS-проверок укажите SNI")
	}
	if c.BalancerUUID != "" {
		if _, e := meshID(c.BalancerUUID, "pool-"); e != nil {
			return e
		}
	}
	return nil
}
func SaveMeshConfig(c MeshSettings) error {
	meshOperationsMu.Lock()
	defer meshOperationsMu.Unlock()
	if c.ProbePorts == nil {
		c.ProbePorts = []int{}
	}
	if !meshMulti() {
		return errors.New("mesh доступен только в multi-node режиме")
	}
	if e := ValidateMeshSettings(c); e != nil {
		return e
	}
	// Do not change relay destinations underneath a durable in-flight/saved restore plan.
	old, e := MeshConfig()
	if e != nil {
		return e
	}
	if old.Enabled {
		r := getMeshRuntime()
		if r == nil {
			return errors.New("контроллер недоступен: проверьте состояние релеев перед изменением")
		}
		b, e := r.Call(context.Background(), "status", nil)
		if e != nil {
			return e
		}
		var s struct {
			Busy   bool `json:"busy"`
			Relays map[string]struct {
				On      bool `json:"on"`
				Pending bool `json:"pending"`
			} `json:"relays"`
		}
		if e = json.Unmarshal(b, &s); e != nil {
			return e
		}
		if s.Busy {
			return errors.New("дождитесь завершения текущей операции")
		}
		for _, v := range s.Relays {
			if (old.RelayAddress != c.RelayAddress || !c.Enabled) && (v.On || v.Pending) {
				return errors.New("сначала переведите релеи в прямой режим и дождитесь восстановления хостов")
			}
		}
	}
	if e = mesh.AtomicJSON(filepath.Join(meshDirectory(), "settings.json"), c); e != nil {
		return e
	}
	if r := getMeshRuntime(); r != nil {
		r.RequestRestart()
	}
	return nil
}

// StartMeshOwner owns exactly one native controller throughout a web server lifetime, including settings changes.
// The runtime observes its own context. An old server's cancellation must never
// stop a newer server's controller through the global owner pointer.
func StartMeshOwner(ctx context.Context) { StartMesh(ctx) }
func MeshAction(ctx context.Context, action string, body json.RawMessage) (any, error) {
	if action != "status" {
		meshOperationsMu.Lock()
		defer meshOperationsMu.Unlock()
	}
	if !meshMulti() {
		return nil, errors.New("mesh недоступен в одиночном режиме")
	}
	if action == "status" {
		c, e := MeshConfig()
		if e != nil {
			return nil, e
		}
		r := getMeshRuntime()
		out := map[string]any{"settings": c, "running": false}
		if r == nil || !c.Enabled {
			return out, nil
		}
		for k, v := range r.State() {
			out[k] = v
		}
		data, e := r.Call(ctx, "status", nil)
		if e != nil {
			out["error"] = e.Error()
			return out, nil
		}
		var status map[string]any
		if json.Unmarshal(data, &status) == nil {
			for k, v := range status {
				out[k] = v
			}
		}
		return out, nil
	}
	r := getMeshRuntime()
	if r == nil {
		return nil, errors.New("контроллер mesh недоступен")
	}
	return r.Call(ctx, action, body)
}
func meshID(s, prefix string) (int, error) {
	if !strings.HasPrefix(s, prefix) {
		return 0, errors.New("invalid mesh object ID")
	}
	i, e := strconv.Atoi(strings.TrimPrefix(s, prefix))
	if e != nil || i <= 0 {
		return 0, errors.New("invalid mesh object ID")
	}
	return i, nil
}
func meshNodeURL(address, newIP string) (string, error) {
	u, e := url.Parse(address)
	if e != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "", errors.New("invalid node URL")
	}
	if p := u.Port(); p != "" {
		u.Host = net.JoinHostPort(newIP, p)
	} else {
		u.Host = newIP
	}
	return u.String(), nil
}

type meshHost struct {
	UUID       string   `json:"uuid"`
	Address    string   `json:"address"`
	Port       int      `json:"port"`
	RawPort    int      `json:"raw_port"`
	Customized bool     `json:"customized"`
	Nodes      []string `json:"nodes"`
	Enabled    bool     `json:"enabled"`
	Eligible   bool     `json:"mesh_eligible"`
}

func meshHosts(db *gorm.DB) ([]meshHost, error) {
	var hosts []model.Host
	if e := db.Where("kind = ? AND node_id IS NOT NULL AND inbound_id IS NOT NULL", model.HostKindPlacement).Find(&hosts).Error; e != nil {
		return nil, e
	}
	out := []meshHost{}
	for _, h := range hosts {
		var ib model.Inbound
		if e := db.First(&ib, *h.InboundId).Error; e != nil {
			return nil, e
		}
		port := h.Port
		if port == 0 {
			port = ib.Port
		}
		out = append(out, meshHost{fmt.Sprint("host-", h.Id), h.Address, port, h.Port, h.Customized, []string{fmt.Sprint("node-", *h.NodeId)}, h.Enable, h.Port == 0 || h.Port == ib.Port})
	}
	return out, nil
}
func meshBridge(ctx context.Context, action string, body json.RawMessage) (any, error) {
	if !meshMulti() {
		return nil, errors.New("multi-node mode is disabled")
	}
	db := database.GetDB().WithContext(ctx)
	switch action {
	case "nodes":
		var nodes []model.Node
		if e := db.Order("id").Find(&nodes).Error; e != nil {
			return nil, e
		}
		out := []map[string]any{}
		for _, n := range nodes {
			out = append(out, map[string]any{"uuid": fmt.Sprint("node-", n.Id), "name": fmt.Sprint("node-", n.Id), "displayName": n.Name, "address": hostNodeAddress(n.Address), "enabled": n.Enable})
		}
		return out, nil
	case "hosts":
		return meshHosts(db)
	case "ports":
		var q struct {
			IDs []int `json:"ids"`
		}
		if err := json.Unmarshal(body, &q); err != nil {
			return nil, err
		}
		if len(q.IDs) == 0 {
			return []int{}, nil
		}
		var ports []int
		e := db.Table("inbounds i").Distinct("i.port").Joins("JOIN inbound_node_mappings m ON m.inbound_id=i.id").Where("i.enable = ? AND m.node_id IN ?", true, q.IDs).Order("i.port").Pluck("i.port", &ports).Error
		return ports, e
	case "node-ip":
		var q struct {
			UUID    string `json:"uuid"`
			Old     string `json:"oldAddress"`
			Address string `json:"address"`
		}
		if e := json.Unmarshal(body, &q); e != nil {
			return nil, e
		}
		id, e := meshID(q.UUID, "node-")
		if e != nil {
			return nil, e
		}
		ip := net.ParseIP(q.Address)
		if ip == nil || !ip.IsGlobalUnicast() || ip.IsLoopback() {
			return nil, errors.New("invalid new node IP")
		}
		e = db.Transaction(func(tx *gorm.DB) error {
			var n model.Node
			if e := tx.First(&n, id).Error; e != nil {
				return e
			}
			if !n.Enable {
				return errors.New("node is disabled")
			}
			current := hostNodeAddress(n.Address)
			if current != q.Old && current != q.Address {
				return errors.New("адрес ноды изменён вручную; автоматическая перезапись отклонена")
			}
			if current == q.Old {
				address, e := meshNodeURL(n.Address, q.Address)
				if e != nil {
					return e
				}
				result := tx.Model(&model.Node{}).Where("id = ? AND address = ?", id, n.Address).Update("address", address)
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					return errors.New("node address changed concurrently")
				}
			}
			if e := tx.Model(&model.Host{}).Where("node_id = ? AND kind = ? AND address = ?", id, model.HostKindPlacement, q.Old).Update("address", q.Address).Error; e != nil {
				return e
			}
			return tx.Model(&model.InboundNodeMapping{}).Where("node_id = ? AND published_address = ?", id, q.Old).Update("published_address", q.Address).Error
		})
		if e != nil {
			return nil, e
		}
		TriggerHostSync()
		return map[string]bool{"ok": true}, nil
	case "host-patch":
		var q struct {
			UUID               string `json:"uuid"`
			Address            string `json:"address"`
			Port               int    `json:"port"`
			ExpectedAddress    string `json:"expectedAddress"`
			ExpectedPort       int    `json:"expectedPort"`
			Restore            bool   `json:"restore"`
			OriginalPort       int    `json:"originalPort"`
			OriginalCustomized bool   `json:"originalCustomized"`
		}
		if e := json.Unmarshal(body, &q); e != nil {
			return nil, e
		}
		id, e := meshID(q.UUID, "host-")
		if e != nil {
			return nil, e
		}
		if q.Port < 1 || q.Port > 65535 || q.Address == "" {
			return nil, errors.New("invalid relay host")
		}
		e = db.Transaction(func(tx *gorm.DB) error {
			var h model.Host
			if e := tx.First(&h, id).Error; e != nil {
				return e
			}
			if h.Kind != model.HostKindPlacement || h.NodeId == nil || h.InboundId == nil {
				return errors.New("mesh may only change node placement hosts")
			}
			var ib model.Inbound
			if e := tx.First(&ib, *h.InboundId).Error; e != nil {
				return e
			}
			port := h.Port
			if port == 0 {
				port = ib.Port
			}
			if h.Address != q.ExpectedAddress || port != q.ExpectedPort {
				return errors.New("хост изменён вне операции mesh; восстановление остановлено")
			}
			targetPort := q.Port
			custom := true
			if q.Restore {
				targetPort = q.OriginalPort
				custom = q.OriginalCustomized
			}
			res := tx.Model(&model.Host{}).Where("id = ? AND address = ? AND port = ? AND customized = ?", id, h.Address, h.Port, h.Customized).Updates(map[string]any{"address": q.Address, "port": targetPort, "customized": custom})
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected != 1 {
				return errors.New("host changed concurrently")
			}
			return nil
		})
		return map[string]bool{"ok": e == nil}, e
	case "balancer", "balancer-patch":
		return meshBalancerBridge(action, body)
	}
	return nil, errors.New("unknown embedded mesh callback")
}

func meshPoolDisabled() map[string]map[string]bool {
	out := map[string]map[string]bool{}
	c, e := MeshConfig()
	if e != nil || !c.Enabled || !meshMulti() {
		return out
	}
	b, e := os.ReadFile(filepath.Join(meshDirectory(), "balancer.json"))
	if e == nil {
		_ = json.Unmarshal(b, &out)
	}
	if cfg, e := MeshConfig(); e == nil {
		return map[string]map[string]bool{cfg.BalancerUUID: out[cfg.BalancerUUID]}
	}
	return map[string]map[string]bool{}
}
func meshBalancerBridge(action string, body json.RawMessage) (any, error) {
	meshStateMu.Lock()
	defer meshStateMu.Unlock()
	var q struct {
		UUID     string          `json:"uuid"`
		Disabled map[string]bool `json:"disabled"`
		Expected map[string]bool `json:"expected"`
	}
	if e := json.Unmarshal(body, &q); e != nil {
		return nil, e
	}
	id, e := meshID(q.UUID, "pool-")
	if e != nil {
		return nil, e
	}
	cfg, e := MeshConfig()
	if e != nil {
		return nil, e
	}
	if cfg.BalancerUUID != q.UUID {
		return nil, errors.New("mesh may only manage the explicitly selected pool")
	}
	var pool model.BalancerPool
	if e = database.GetDB().First(&pool, id).Error; e != nil {
		return nil, e
	}
	b, e := (&BalancerService{}).Get(pool.BalancerId)
	if e != nil {
		return nil, e
	}
	if !b.Enable || !pool.Enable {
		return nil, errors.New("selected balancer/pool is disabled")
	}
	members, e := (&BalancerService{}).effectiveMembers(&pool, &NodeService{})
	if e != nil {
		return nil, e
	}
	disabled := meshPoolDisabled()
	state := disabled[q.UUID]
	if state == nil {
		state = map[string]bool{}
		disabled[q.UUID] = state
	}
	live := map[string]bool{}
	nodes := []map[string]any{}
	for _, m := range members {
		if !m.Enable || m.NodeStatus == "disabled" {
			continue
		}
		name := fmt.Sprint("node-", m.NodeId)
		live[name] = state[name]
		nodes = append(nodes, map[string]any{"nodeName": name, "nodeUuid": name, "isDisabled": state[name], "weight": m.Weight})
	}
	if action == "balancer" {
		return map[string]any{"uuid": q.UUID, "name": b.Name, "nodes": nodes}, nil
	}
	for n := range q.Disabled {
		if _, ok := live[n]; !ok {
			return nil, errors.New("node is not an enabled member of the selected pool")
		}
		if live[n] != q.Expected[n] {
			return nil, errors.New("mesh pool state changed concurrently")
		}
	}
	for n, v := range q.Disabled {
		state[n] = v
	}
	if e = mesh.AtomicJSON(filepath.Join(meshDirectory(), "balancer.json"), disabled); e != nil {
		return nil, e
	}
	// Applying is deliberately retried even after the desired state was stored on a previous attempt.
	if e = (&BalancerService{}).Apply(pool.BalancerId); e != nil {
		return nil, errors.New("состояние пула сохранено; применение на балансировщике не подтверждено")
	}
	return map[string]bool{"ok": true}, nil
}

// MeshNodeHost exposes only the registered node hostname for confirmed SSH enrollment.
func MeshNodeHost(address string) string { return hostNodeAddress(address) }
