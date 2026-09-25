package engine

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/balancer/spec"
)

// SampleInterval is how often the collector samples.
const SampleInterval = 2 * time.Second

// maxSamples is the ring size: one hour at the sample interval.
const maxSamples = 1800

// PoolBytes is the cumulative client-facing traffic of one pool since the agent started.
type PoolBytes struct {
	In  int64 `json:"in"`  // from clients
	Out int64 `json:"out"` // to clients
}

// Sample is one point of the history. Counters are cumulative, so the reader computes rates.
type Sample struct {
	T     int64             `json:"t"`  // unix ms
	Rx    uint64            `json:"rx"` // server network interfaces, all legs
	Tx    uint64            `json:"tx"`
	Conns map[int]int       `json:"conns"`           // established client connections per pool id (TCP)
	Pools map[int]PoolBytes `json:"pools,omitempty"` // client-facing bytes per pool (TCP)
}

type metricsStore struct {
	mu      sync.Mutex
	samples []Sample
}

func (s *metricsStore) add(x Sample) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.samples = append(s.samples, x)
	if len(s.samples) > maxSamples {
		s.samples = append([]Sample(nil), s.samples[len(s.samples)-maxSamples:]...)
	}
}

func (s *metricsStore) since(t int64) []Sample {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Sample
	for _, x := range s.samples {
		if x.T > t {
			out = append(out, x)
		}
	}
	return out
}

// Metrics returns the samples newer than sinceMs (unix ms), oldest first.
func (m *Manager) Metrics(sinceMs int64) []Sample { return m.metrics.since(sinceMs) }

func (m *Manager) collectLoop() {
	t := time.NewTicker(SampleInterval)
	defer t.Stop()
	for range t.C {
		m.metrics.add(m.sampleOnce())
	}
}

func (m *Manager) sampleOnce() Sample {
	m.mu.Lock()
	cur, engine, running := m.cur, m.engine, m.cmd != nil
	m.mu.Unlock()

	rx, tx := readNICBytes("/proc/net/dev")
	sm := Sample{T: time.Now().UnixMilli(), Rx: rx, Tx: tx, Conns: map[int]int{}}

	ports := map[int]int{} // port -> pool id (TCP pools)
	for _, p := range cur.Pools {
		if p.Proto == spec.ProtoTCP {
			ports[p.ListenPort] = p.ID
		}
	}
	if len(ports) > 0 {
		for port, n := range countEstablished([]string{"/proc/net/tcp", "/proc/net/tcp6"}, ports) {
			sm.Conns[ports[port]] = n
		}
	}
	// Exact client-facing bytes from the kernel's per-socket counters (works the same for both engines).
	if running && len(ports) > 0 {
		if snap, ok := readSocketBytes(ports); ok {
			all := m.socks.update(snap)
			sm.Pools = map[int]PoolBytes{}
			for _, id := range ports {
				sm.Pools[id] = all[id]
			}
		}
	}
	_ = engine
	return sm
}

// readNICBytes sums the traffic of real interfaces (not loopback, docker bridges or veth pairs).
func readNICBytes(path string) (rx, tx uint64) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		i := strings.IndexByte(line, ':')
		if i < 0 {
			continue
		}
		name := strings.TrimSpace(line[:i])
		if name == "lo" || strings.HasPrefix(name, "docker") || strings.HasPrefix(name, "veth") || strings.HasPrefix(name, "br-") {
			continue
		}
		f := strings.Fields(line[i+1:])
		if len(f) < 9 {
			continue
		}
		r, _ := strconv.ParseUint(f[0], 10, 64)
		t, _ := strconv.ParseUint(f[8], 10, 64)
		rx += r
		tx += t
	}
	return rx, tx
}

// countEstablished counts ESTABLISHED sockets whose local port is one of ports.
func countEstablished(files []string, ports map[int]int) map[int]int {
	out := map[int]int{}
	for _, path := range files {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		sc.Scan() // header
		for sc.Scan() {
			f := strings.Fields(sc.Text())
			if len(f) < 4 || f[3] != "01" {
				continue
			}
			i := strings.LastIndexByte(f[1], ':')
			if i < 0 {
				continue
			}
			p, err := strconv.ParseUint(f[1][i+1:], 16, 32)
			if err != nil {
				continue
			}
			if _, ok := ports[int(p)]; ok {
				out[int(p)]++
			}
		}
		f.Close()
	}
	return out
}
