package mesh

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/konstpic/sharx-code/v2/mesh/agent"
	"github.com/konstpic/sharx-code/v2/mesh/protocol"
	"net"
	"strings"
	"sync"
	"time"
)

func (c *Controller) cycle() {
	c.cycles++
	c.lastCycle = time.Now().Unix()
	if e := c.configurePorts(); e != nil {
		c.event("Порты mesh: " + e.Error())
		return
	}
	if len(c.members) == 0 {
		return
	}
	c.quorum = c.readQuorum()
	if !c.storeHealthy() {
		return
	}
	s, e := c.store()
	if e != nil {
		return
	}
	defer s.Client.CloseIdleConnections()
	kv, e := s.Prefix(c.ctx, protocol.Prefix)
	if e != nil {
		return
	}
	c.observations = map[string]protocol.Observation{}
	c.routes = map[string]map[string]string{}
	for k, v := range kv {
		if strings.HasPrefix(k, protocol.Prefix+"obs/") {
			n := strings.TrimPrefix(k, protocol.Prefix+"obs/")
			var o protocol.Observation
			if _, known := c.enrolled[n]; known && json.Unmarshal(v, &o) == nil && time.Now().Unix()-o.TS < 60 {
				c.observations[n] = o
			}
		}
		if strings.HasPrefix(k, protocol.Prefix+"route/") {
			n := strings.TrimPrefix(k, protocol.Prefix+"route/")
			var r struct {
				TS  int64             `json:"ts"`
				Via map[string]string `json:"via"`
			}
			if _, known := c.enrolled[n]; known && json.Unmarshal(v, &r) == nil && time.Now().Unix()-r.TS < 60 {
				c.routes[n] = r.Via
			}
		}
	}
	if raw := kv[protocol.Prefix+"flags/main"]; raw != nil {
		var flags Flags
		if json.Unmarshal(raw, &flags) == nil {
			if flags.Modes == nil {
				flags.Modes = map[string]string{}
			}
			c.flags = flags
			_ = c.save("flags.json", flags)
		}
	}
	if e = c.reconcileIPs(); e != nil {
		c.event("Обновление IP: " + e.Error())
	}
	if !c.bootstrapPending() {
		if ms, e := c.listMembers(); e == nil {
			if records, e := c.records(ms); e == nil {
				_ = c.cacheMembers(records)
			}
		}
	}
	if c.operation != nil {
		if e = c.changeMember(c.operation.Name, c.operation.Kind == "add", nil); e != nil {
			c.event("Восстановление состава etcd: " + e.Error())
		}
		return
	}
	c.probe()
	if e = c.reconcileRelays(); e != nil {
		c.event("Релей: " + e.Error())
	}
	if e = c.reconcileBalancer(); e != nil {
		c.balancerError = e.Error()
	} else {
		c.balancerError = ""
	}
}
func (c *Controller) probe() {
	if len(c.settings.Ports) == 0 || c.settings.SNI == "" {
		return
	}
	exits := map[string]protocol.Node{}
	for n, d := range c.enrolled {
		if d.Role == "exit" {
			exits[n] = c.seed()[n]
		}
	}
	if len(exits) == 0 {
		return
	}
	b, _ := json.Marshal(agent.ProbeRequest{SNI: c.settings.SNI, Ports: c.settings.Ports, Exits: exits})
	results := map[string]map[string]map[string]agent.PathResult{}
	var wg sync.WaitGroup
	var mu sync.Mutex
	for n, d := range c.enrolled {
		if d.Role != "entry" {
			continue
		}
		wg.Add(1)
		go func(n string) {
			defer wg.Done()
			var out []byte
			var e error
			if c.enrolled[n].Transport == "embedded" {
				var raw json.RawMessage
				e = c.agentCall(n, "probe", json.RawMessage(b), &raw)
				out = raw
			} else {
				out, e = c.remote(n, "/usr/local/lib/sharx-mesh/sharx-mesh-agent probe", b, 90*time.Second)
			}
			if e != nil {
				return
			}
			var v map[string]map[string]agent.PathResult
			if json.Unmarshal(out, &v) != nil {
				return
			}
			mu.Lock()
			results[n] = v
			mu.Unlock()
		}(n)
	}
	wg.Wait()
	c.matrix = results
	for n := range exits {
		h := c.health[n]
		if h == nil {
			h = &ExitHealth{}
			c.health[n] = h
		}
		for _, kind := range []string{"direct", "wg"} {
			known := false
			ok := false
			for _, r := range results {
				if p, exists := r[n][kind]; exists && p.Total > 0 {
					known = true
					if p.Ratio() >= .67 {
						ok = true
					}
				}
			}
			if known {
				if kind == "direct" {
					h.Direct.observe(ok)
				} else {
					h.WG.observe(ok)
				}
			}
		}
	}
}
func (c *Controller) reconcileBalancer() error {
	if c.settings.Balancer == "" {
		return nil
	}
	var b struct {
		UUID  string `json:"uuid"`
		Nodes []struct {
			Name     string `json:"nodeName"`
			Disabled bool   `json:"isDisabled"`
		} `json:"nodes"`
	}
	if e := c.rpc("balancer", map[string]string{"uuid": c.settings.Balancer}, &b); e != nil {
		return e
	}
	if !c.flags.AutoBalancer {
		return nil
	}
	expected := map[string]bool{}
	desired := map[string]bool{}
	for _, n := range b.Nodes {
		expected[n.Name] = n.Disabled
	}
	for name, d := range c.enrolled {
		if d.Role != "exit" {
			continue
		}
		if _, known := expected[d.Node]; !known {
			continue
		}
		h := c.health[name]
		if contains(c.flags.Pinned, d.Node) {
			desired[d.Node] = true
		} else if h != nil && h.Direct.Healthy != nil {
			desired[d.Node] = !*h.Direct.Healthy
		}
	}
	if len(desired) == 0 {
		return nil
	}
	return c.rpc("balancer-patch", map[string]any{"uuid": b.UUID, "disabled": desired, "expected": expected}, nil)
}

type IPChange struct {
	Old string `json:"old"`
	New string `json:"new"`
}

func (c *Controller) reconcileIPs() error {
	pending := map[string]IPChange{}
	if e := loadOptional(c.dir+"/ip-pending.json", &pending); e != nil {
		return e
	}

	for n, d := range c.enrolled {
		o, ok := c.observations[n]
		if !ok {
			c.ipCount[n] = 0
			continue
		}
		if c.observeIP(n, d.Host, o, time.Now().Unix()) && c.flags.AutoIP {
			if _, ok := pending[n]; !ok {
				pending[n] = IPChange{Old: d.Host, New: o.IP}
				if e := c.save("ip-pending.json", pending); e != nil {
					return e
				}
			}
		}
	}

	for n, p := range pending {
		d, known := c.enrolled[n]
		if !known {
			return errors.New("IP journal references an unknown node")
		}
		if e := c.rpc("node-ip", map[string]string{"uuid": d.Node, "oldAddress": p.Old, "address": p.New}, nil); e != nil {
			return e
		}
		if s := c.relays[n]; s != nil {
			for i := range s.Saved {
				if s.Saved[i].Address == p.Old {
					s.Saved[i].Address = p.New
				}
			}
			if s.Operation != nil {
				for i := range s.Operation.Hosts {
					if s.Operation.Hosts[i].Address == p.Old {
						s.Operation.Hosts[i].Address = p.New
					}
				}
			}
			if e := c.saveRelays(); e != nil {
				return e
			}
		}
		d.Host = p.New
		c.enrolled[n] = d
		if e := c.save("enrolled.json", c.enrolled); e != nil {
			return e
		}
		s, e := c.store()
		if e != nil {
			return e
		}
		e = s.Put(c.ctx, protocol.Prefix+"nodes/"+n, c.seed()[n], 0)
		if e == nil {
			e = s.Put(c.ctx, protocol.Prefix+"registry", c.seed(), 0)
		}
		if e == nil {
			e = s.Put(c.ctx, protocol.Prefix+"ipmap/"+n, map[string]any{"ip": p.New, "old": p.Old, "ts": time.Now().Unix()}, 0)
		}
		s.Client.CloseIdleConnections()
		if e != nil {
			return e
		}
		for i, m := range c.members {
			if m.Name == n {
				c.members[i].Host = p.New
			}
		}
		if e = c.cacheMembers(c.members); e != nil {
			return e
		}
		delete(pending, n)
		if e = c.save("ip-pending.json", pending); e != nil {
			return e
		}
		c.event(fmt.Sprintf("%s: IP обновлён %s → %s", n, p.Old, p.New))
	}
	return nil
}

// Re-reading the same leased observation is not a new confirmation.
func (c *Controller) observeIP(name, old string, o protocol.Observation, now int64) bool {
	ip := net.ParseIP(o.IP)
	if ip == nil || ip.To4() == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || o.IP == old || o.TS <= 0 || o.TS > now+5 || now-o.TS >= 60 {
		c.ipCount[name] = 0
		return false
	}
	if o.TS <= c.ipTS[name] {
		return false
	}
	if c.ipTS[name] > 0 && o.TS-c.ipTS[name] >= 60 {
		c.ipCount[name] = 0
	}
	c.ipTS[name] = o.TS
	if c.ipSeen[name] == o.IP {
		c.ipCount[name]++
	} else {
		c.ipSeen[name] = o.IP
		c.ipCount[name] = 1
	}
	return c.ipCount[name] >= 3
}
