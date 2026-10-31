package mesh

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/konstpic/sharx-code/v2/mesh/protocol"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"
)

type Host struct {
	UUID       string   `json:"uuid"`
	Address    string   `json:"address"`
	Port       int      `json:"port"`
	RawPort    int      `json:"raw_port"`
	Customized bool     `json:"customized"`
	Nodes      []string `json:"nodes"`
	Enabled    bool     `json:"enabled"`
	Eligible   bool     `json:"mesh_eligible"`
}
type HostPlan struct {
	UUID       string `json:"uuid"`
	Address    string `json:"address"`
	Port       int    `json:"port"`
	RawPort    int    `json:"raw_port"`
	Customized bool   `json:"customized"`
	NewAddress string `json:"new_address"`
	NewPort    int    `json:"new_port"`
}
type RelayOperation struct {
	Target bool       `json:"target"`
	Hosts  []HostPlan `json:"hosts"`
	Reason string     `json:"reason"`
}
type RelayState struct {
	On        bool            `json:"on"`
	Saved     []HostPlan      `json:"saved"`
	Operation *RelayOperation `json:"operation,omitempty"`
	Since     int64           `json:"since"`
	Reason    string          `json:"reason"`
}

func PlanEnable(hosts []Host, d Enrolled, address string, ports map[string]int, saved []HostPlan) ([]HostPlan, []HostPlan, error) {
	if d.Slot == nil {
		return nil, nil, errors.New("exit has no relay slot")
	}
	plans := []HostPlan{}
	originals := append([]HostPlan{}, saved...)
	known := map[string]bool{}
	for _, s := range saved {
		known[s.UUID] = true
	}
	for _, h := range hosts {
		if !h.Enabled || !h.Eligible || !contains(h.Nodes, d.Node) || h.Address == address {
			continue
		}
		idx, ok := ports[strconv.Itoa(h.Port)]
		if !ok {
			continue
		}
		if known[h.UUID] {
			return nil, nil, fmt.Errorf("host %s was changed outside the relay plan", h.UUID)
		}
		p := HostPlan{h.UUID, h.Address, h.Port, h.RawPort, h.Customized, address, 55000 + 100**d.Slot + idx}
		plans = append(plans, p)
		originals = append(originals, p)
	}
	return plans, originals, nil
}
func HostPatches(plans []HostPlan, hosts []Host, on bool) ([]map[string]any, error) {
	live := map[string]Host{}
	for _, h := range hosts {
		live[h.UUID] = h
	}
	out := []map[string]any{}
	for _, p := range plans {
		h, ok := live[p.UUID]
		if !ok {
			continue
		}
		original := h.Address == p.Address && h.Port == p.Port
		relayed := h.Address == p.NewAddress && h.Port == p.NewPort
		if !original && !relayed {
			return nil, fmt.Errorf("host %s изменён вручную; согласуйте адрес перед повтором", p.UUID)
		}
		if (on && relayed) || (!on && original) {
			continue
		}
		address, port := p.Address, p.Port
		if on {
			address, port = p.NewAddress, p.NewPort
		}
		out = append(out, map[string]any{"uuid": p.UUID, "address": address, "port": port, "expectedAddress": h.Address, "expectedPort": h.Port, "restore": !on, "originalPort": p.RawPort, "originalCustomized": p.Customized})
	}
	return out, nil
}
func (c *Controller) saveRelays() error { return c.save("relays.json", c.relays) }
func (c *Controller) forwarding(extra string, on bool) ([]map[string]any, error) {
	rules := []map[string]any{}
	for n, s := range c.relays {
		active := s.On
		if s.Operation != nil && s.Operation.Target {
			active = true
		}
		if n == extra {
			active = on
		}
		if !active {
			continue
		}
		d, ok := c.enrolled[n]
		if !ok || d.Slot == nil || !protocol.Overlay(d.Overlay) {
			return nil, errors.New("invalid relay inventory")
		}
		// The global map reserves stable numbers, but an exit must expose only
		// inbound ports actually assigned to that node.
		id, _ := strconv.Atoi(n[1:])
		var assigned []int
		if e := c.rpc("ports", map[string]any{"ids": []int{id}}, &assigned); e != nil {
			return nil, e
		}
		maps := [][]any{}
		for _, port := range assigned {
			idx, known := c.ports[strconv.Itoa(port)]
			if !known || port < 1 || port > 65535 || idx < 0 || idx >= 100 || *d.Slot < 0 || *d.Slot >= 100 {
				return nil, errors.New("invalid stable port mapping")
			}
			for _, proto := range []string{"tcp", "udp"} {
				maps = append(maps, []any{proto, 55000 + 100**d.Slot + idx, port})
			}
		}
		rules = append(rules, map[string]any{"id": n, "target": d.Overlay, "maps": maps})
	}
	return rules, nil
}
func (c *Controller) pushForwards(extra string, on bool) error {
	rules, e := c.forwarding(extra, on)
	if e != nil {
		return e
	}
	b, _ := json.Marshal(map[string]any{"rules": rules})
	entries := 0
	for n, d := range c.enrolled {
		if d.Role != "entry" {
			continue
		}
		entries++
		if d.Transport == "embedded" {
			if e = c.agentCall(n, "forward", json.RawMessage(b), nil); e != nil {
				return e
			}
			continue
		}
		if e = c.put(n, "/etc/sharx-meshfwd/rules.json", b, "600"); e != nil {
			return e
		}
		unit := "[Unit]\nDescription=SharX mesh relay rules\nAfter=network-online.target docker.service sharx-mesh-agent.service\n[Service]\nType=oneshot\nExecStart=/usr/local/lib/sharx-mesh/sharx-mesh-agent forward\nRemainAfterExit=yes\n[Install]\nWantedBy=multi-user.target\n"
		if e = c.put(n, "/etc/systemd/system/sharx-mesh-fwd.service", []byte(unit), "600"); e != nil {
			return e
		}
		if _, e = c.remote(n, "systemctl daemon-reload && systemctl enable sharx-mesh-fwd >/dev/null && systemctl restart sharx-mesh-fwd", nil, 30*time.Second); e != nil {
			return e
		}
	}
	if entries == 0 {
		return errors.New("нужна хотя бы одна входная mesh-нода")
	}
	return nil
}
func (c *Controller) finishRelay(name string, s *RelayState) error {
	op := s.Operation
	if op == nil {
		return nil
	}
	if op.Target {
		if e := c.pushForwards(name, true); e != nil {
			return e
		}
	}
	var hosts []Host
	if e := c.rpc("hosts", nil, &hosts); e != nil {
		return e
	}
	patches, e := HostPatches(op.Hosts, hosts, op.Target)
	if e != nil {
		return e
	}
	for _, p := range patches {
		if e = c.rpc("host-patch", p, nil); e != nil {
			return e
		}
	}
	if e = c.rpc("hosts", nil, &hosts); e != nil {
		return e
	}
	patches, e = HostPatches(op.Hosts, hosts, op.Target)
	if e != nil {
		return e
	}
	if len(patches) > 0 {
		return errors.New("изменения хостов ещё не применены; журнал сохранён")
	}
	if !op.Target {
		if e = c.pushForwards(name, false); e != nil {
			return e
		}
	}
	old := *s
	s.On = op.Target
	s.Since = time.Now().Unix()
	s.Reason = op.Reason
	s.Operation = nil
	if !s.On {
		s.Saved = []HostPlan{}
	}
	if e = c.saveRelays(); e != nil {
		*s = old
		return e
	}
	c.event(name + ": переключение релея завершено")
	return nil
}
func (c *Controller) setRelay(name string, on bool, reason string) error {
	d, ok := c.enrolled[name]
	if !ok || d.Role != "exit" || d.Slot == nil {
		return errors.New("нужна установленная выходная нода")
	}
	s := c.relays[name]
	if s == nil {
		s = &RelayState{Saved: []HostPlan{}}
		c.relays[name] = s
	}
	if s.Operation != nil {
		if e := c.finishRelay(name, s); e != nil {
			return e
		}
	}
	if s.On == on {
		return nil
	}
	var plans, saved []HostPlan
	if on {
		if c.settings.RelayAddress == "" {
			return errors.New("задайте адрес входа для релеев")
		}
		var hosts []Host
		if e := c.rpc("hosts", nil, &hosts); e != nil {
			return e
		}
		var e error
		plans, saved, e = PlanEnable(hosts, d, c.settings.RelayAddress, c.ports, s.Saved)
		if e != nil {
			return e
		}
		if len(plans) == 0 {
			return errors.New("нет подходящих прямых placement-хостов")
		}
	} else {
		plans = append([]HostPlan{}, s.Saved...)
		saved = s.Saved
	}
	old := *s
	s.Saved = saved
	s.Operation = &RelayOperation{Target: on, Hosts: plans, Reason: reason}
	if e := c.saveRelays(); e != nil {
		*s = old
		return e
	}
	return c.finishRelay(name, s)
}
func (c *Controller) update(action string, raw json.RawMessage) error {
	if !c.storeHealthy() {
		return errors.New("для изменения mesh нужен здоровый кворум etcd")
	}
	old := c.flags
	next := old
	next.Modes = map[string]string{}
	for k, v := range old.Modes {
		next.Modes[k] = v
	}
	switch action {
	case "flags":
		var q map[string]bool
		if e := json.Unmarshal(raw, &q); e != nil {
			return e
		}
		for k, v := range q {
			switch k {
			case "auto_relay":
				next.AutoRelay = v
			case "auto_balancer":
				next.AutoBalancer = v
			case "auto_ip_update":
				next.AutoIP = v
			default:
				return errors.New("invalid automation flag")
			}
		}
		if (next.AutoRelay || next.AutoBalancer) && (len(c.settings.Ports) == 0 || c.settings.SNI == "") {
			return errors.New("сначала настройте рабочие TLS-пробы")
		}
		if next.AutoRelay && c.settings.RelayAddress == "" {
			return errors.New("укажите адрес релея")
		}
		if next.AutoBalancer && c.settings.Balancer == "" {
			return errors.New("выберите конкретный пул балансировщика")
		}
	case "relay":
		var q struct {
			Exit string `json:"exit"`
			Mode string `json:"mode"`
		}
		if e := json.Unmarshal(raw, &q); e != nil {
			return e
		}
		d, known := c.enrolled[q.Exit]
		if !known || d.Role != "exit" || (q.Mode != "auto" && q.Mode != "relay" && q.Mode != "direct") {
			return errors.New("invalid exit or relay mode")
		}
		if q.Mode == "relay" && c.settings.RelayAddress == "" {
			return errors.New("укажите адрес релея")
		}
		next.Modes[q.Exit] = q.Mode
	case "pin":
		var q struct {
			Node   string `json:"node"`
			Pinned bool   `json:"pinned"`
		}
		if e := json.Unmarshal(raw, &q); e != nil {
			return e
		}
		known := false
		for _, d := range c.enrolled {
			if d.Node == q.Node && d.Role == "exit" {
				known = true
			}
		}
		if !known {
			return errors.New("неизвестная выходная нода")
		}
		pins := []string{}
		for _, n := range old.Pinned {
			if n != q.Node {
				pins = append(pins, n)
			}
		}
		if q.Pinned {
			pins = append(pins, q.Node)
		}
		sort.Strings(pins)
		next.Pinned = pins
	}
	s, e := c.store()
	if e != nil {
		return e
	}
	defer s.Client.CloseIdleConnections()
	if e = s.Put(c.ctx, protocol.Prefix+"flags/main", next, 0); e != nil {
		return e
	}
	if e = c.save("flags.json", next); e != nil {
		return e
	}
	c.flags = next
	if action == "relay" {
		for n, m := range next.Modes {
			if m == "direct" || m == "relay" {
				if e = c.setRelay(n, m == "relay", "manual"); e != nil {
					return e
				}
			}
		}
	}
	return nil
}
func (c *Controller) remove(name string, j *Job) error {
	d, known := c.enrolled[name]
	if !known {
		return errors.New("неизвестная нода")
	}
	if c.operation != nil {
		return errors.New("завершите изменение состава etcd")
	}
	for _, m := range c.members {
		if m.Name == name {
			return errors.New("сначала выведите ноду из состава etcd")
		}
	}
	if d.Role == "entry" {
		for _, s := range c.relays {
			if s.On || s.Operation != nil {
				return errors.New("сначала отключите релейные режимы и восстановите хосты")
			}
		}
	}
	if s := c.relays[name]; s != nil && (s.On || s.Operation != nil) {
		if e := c.setRelay(name, false, "node removed"); e != nil {
			return e
		}
	}
	if len(c.members) > 0 {
		s, e := c.store()
		if e != nil {
			return e
		}
		defer s.Client.CloseIdleConnections()
		for _, suffix := range []string{"nodes", "inventory", "obs", "route", "relay", "ipmap"} {
			if e = s.Delete(c.ctx, protocol.Prefix+suffix+"/"+name); e != nil {
				return e
			}
		}
	}
	cmd := "systemctl disable --now sharx-mesh-agent >/dev/null 2>&1; for d in $(ip -o link show | grep -o 'sxm-n[0-9]*' | sort -u); do ip link del \"$d\"; done; ip addr del " + quote(d.Overlay+"/32") + " dev lo 2>/dev/null || true"
	var removeErr error
	if d.Transport == "embedded" {
		removeErr = c.agentCall(name, "remove", nil, nil)
	} else {
		_, removeErr = c.remote(name, cmd, nil, 45*time.Second)
	}
	if e := removeErr; e != nil {
		return e
	}
	delete(c.enrolled, name)
	delete(c.relays, name)
	delete(c.flags.Modes, name)
	if e := c.save("enrolled.json", c.enrolled); e != nil {
		return e
	}
	if e := c.saveRelays(); e != nil {
		return e
	}
	if e := c.save("flags.json", c.flags); e != nil {
		return e
	}
	if len(c.members) > 0 {
		if e := c.publishRegistry(); e != nil {
			return e
		}
	}
	return c.seedAgents(j)
}

// Recover relay journals before new decisions; never drop a partially restored host.
func (c *Controller) reconcileRelays() error {
	for n, s := range c.relays {
		if s.Operation != nil {
			if e := c.finishRelay(n, s); e != nil {
				return e
			}
		}
	}
	for n, d := range c.enrolled {
		if d.Role != "exit" {
			continue
		}
		mode := c.flags.Modes[n]
		if mode == "relay" || mode == "direct" {
			if e := c.setRelay(n, mode == "relay", "manual mode"); e != nil {
				return e
			}
		} else if c.flags.AutoRelay {
			h := c.health[n]
			if h == nil || h.Direct.Healthy == nil {
				continue
			}
			want := false
			if !*h.Direct.Healthy {
				if h.WG.Healthy == nil || !*h.WG.Healthy {
					continue
				}
				want = true
			}
			if e := c.setRelay(n, want, "automatic path health"); e != nil {
				return e
			}
		}
		s := c.relays[n]
		if s == nil || !s.On || s.Operation != nil {
			continue
		}
		var hosts []Host
		if e := c.rpc("hosts", nil, &hosts); e != nil {
			return e
		}
		plans, saved, e := PlanEnable(hosts, d, c.settings.RelayAddress, c.ports, s.Saved)
		if e != nil {
			return e
		}
		if len(plans) > 0 {
			old := *s
			s.Saved = saved
			s.Operation = &RelayOperation{Target: true, Hosts: plans, Reason: "new placement hosts"}
			if e = c.saveRelays(); e != nil {
				*s = old
				return e
			}
			if e = c.finishRelay(n, s); e != nil {
				return e
			}
		}
	}
	return nil
}

// Pending journals live on the panel's persistent volume; never in the image.
func (c *Controller) bootstrapPending() bool {
	_, e := os.Stat(filepath.Join(c.dir, "bootstrap.json"))
	return e == nil
}
