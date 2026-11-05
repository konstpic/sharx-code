package xray

import (
	"fmt"
	"github.com/konstpic/sharx-code/v2/node/nodecache"
	core "github.com/konstpic/sharx-code/v2/xray"
	"os"
	"path/filepath"
	"strings"
)

func networkCounterPath() string {
	dir := os.Getenv("SHARX_NODE_DATA_DIR")
	if dir == "" {
		dir = "/app/data"
	}
	return filepath.Join(dir, "network-counters.json")
}

// Called under Manager.lock. Deltas are accumulated before reset snapshots leave the worker.
func (m *Manager) accumulateNetworkCounters(traffic []*core.ClientTraffic, reset bool) (map[string][2]int64, error) {
	if m.networkTotals == nil {
		m.networkTotals = map[string][2]int64{}
		if _, err := nodecache.Load(networkCounterPath(), &m.networkTotals); err != nil {
			return nil, fmt.Errorf("network counter restore: %w", err)
		}
	}
	if m.networkLast == nil || m.networkProcess != m.process {
		m.networkLast = map[string][2]int64{}
		m.networkProcess = m.process
	}
	for _, c := range traffic {
		if !strings.HasPrefix(c.Email, "sn-") {
			continue
		}
		current := [2]int64{c.Up, c.Down}
		previous := m.networkLast[c.Email]
		total := m.networkTotals[c.Email]
		for i := range current {
			delta := current[i] - previous[i]
			if delta < 0 {
				delta = current[i]
			}
			total[i] += delta
		}
		m.networkTotals[c.Email] = total
		if reset {
			m.networkLast[c.Email] = [2]int64{}
		} else {
			m.networkLast[c.Email] = current
		}
	}
	if len(m.networkTotals) > 0 {
		if err := nodecache.Save(networkCounterPath(), m.networkTotals); err != nil {
			return nil, fmt.Errorf("network counter persistence: %w", err)
		}
	}
	out := make(map[string][2]int64, len(m.networkTotals))
	for k, v := range m.networkTotals {
		out[k] = v
	}
	return out, nil
}

func (m *Manager) NetworkInboundPort(tag string) (int, error) {
	m.lock.Lock()
	defer m.lock.Unlock()
	if !strings.HasPrefix(tag, "sharxnet-") {
		return 0, fmt.Errorf("not a network inbound")
	}
	if m.config != nil {
		for _, inbound := range m.config.InboundConfigs {
			if inbound.Tag == tag {
				return inbound.Port, nil
			}
		}
	}
	return 0, fmt.Errorf("network inbound not found")
}
