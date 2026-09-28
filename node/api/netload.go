package api

import (
	"net"
	"sync"
	"time"

	psnet "github.com/shirou/gopsutil/v4/net"
)

// netLoadSampler tracks throughput of this host's main interface (the one used for the default
// route — nodes are assumed to have exactly one that matters) so GET /api/v1/status can report
// current bytes/sec without the panel having to compute a delta across polls itself. Sampling
// runs on its own ticker instead of piggybacking on however often the panel happens to poll, so
// the reported rate is accurate regardless of poll cadence.
//
// Used by balancer pools with weightMode "load" (see web/service/balancer_weight.go): the panel
// turns this bytes/sec figure into a load percentage using the node's admin-set bandwidthMbps.
type netLoadSampler struct {
	mu        sync.RWMutex
	bytesPerS float64
	iface     string

	startOnce sync.Once
}

var netLoad netLoadSampler

const netLoadSampleInterval = 3 * time.Second

// start begins the sampling loop the first time it's called; subsequent calls are no-ops.
func (s *netLoadSampler) start() {
	s.startOnce.Do(func() {
		go s.loop()
	})
}

func (s *netLoadSampler) loop() {
	var lastIface string
	var lastTotal uint64
	var lastAt time.Time

	tick := time.NewTicker(netLoadSampleInterval)
	defer tick.Stop()
	for {
		iface := mainInterfaceName()
		counters, err := psnet.IOCounters(true)
		if err == nil && iface != "" {
			for _, c := range counters {
				if c.Name != iface {
					continue
				}
				total := c.BytesSent + c.BytesRecv
				now := time.Now()
				if iface == lastIface && !lastAt.IsZero() && total >= lastTotal {
					dt := now.Sub(lastAt).Seconds()
					if dt > 0 {
						bps := float64(total-lastTotal) / dt
						s.mu.Lock()
						s.bytesPerS = bps
						s.iface = iface
						s.mu.Unlock()
					}
				}
				lastIface, lastTotal, lastAt = iface, total, now
				break
			}
		}
		<-tick.C
	}
}

// snapshot returns the last computed bytes/sec (combined rx+tx) and the interface it came from.
// Zero/empty until the second sample (one sample interval after start).
func (s *netLoadSampler) snapshot() (float64, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.bytesPerS, s.iface
}

// mainInterfaceName finds the interface that owns the address used for the default route, via the
// standard "connect a UDP socket, read back its local address" trick — no packets are actually
// sent for a UDP "connect". Returns "" if it cannot be determined (e.g. no route to the internet).
func mainInterfaceName() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return ""
	}
	defer conn.Close()
	udpAddr, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok {
		return ""
	}
	ip := udpAddr.IP
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, ifc := range ifaces {
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipNet, ok := a.(*net.IPNet)
			if ok && ipNet.IP.Equal(ip) {
				return ifc.Name
			}
		}
	}
	return ""
}
