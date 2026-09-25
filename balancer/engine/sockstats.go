package engine

import (
	"bufio"
	"context"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// sockKey identifies one client connection (local address on a pool port plus the peer).
type sockKey struct{ local, peer string }

type sockBytes struct{ in, out int64 } // in: received from the client, out: acknowledged by the client

// sockTracker turns the kernel's per-socket byte counters into cumulative per-pool counters. The kernel numbers are live
// (unlike HAProxy's frontend counters, which only move when a session ends), and identical for HAProxy and nginx.
type sockTracker struct {
	mu   sync.Mutex
	prev map[sockKey]sockBytes
	cum  map[int]PoolBytes // by pool id
	warm bool              // the first pass only learns the existing sockets, so old traffic is not counted
}

func newSockTracker() *sockTracker {
	return &sockTracker{prev: map[sockKey]sockBytes{}, cum: map[int]PoolBytes{}}
}

// parseSS parses `ss -tinH` output for sockets of the listed local ports. Each socket is a line with the addresses
// followed by an indented line with the TCP info.
func parseSS(text string, ports map[int]int) map[sockKey]struct {
	pool int
	b    sockBytes
} {
	out := map[sockKey]struct {
		pool int
		b    sockBytes
	}{}
	sc := bufio.NewScanner(strings.NewReader(text))
	sc.Buffer(make([]byte, 64*1024), 1<<20)
	var key sockKey
	pool := -1
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		if line[0] != ' ' && line[0] != '\t' {
			f := strings.Fields(line)
			pool = -1
			// with -H the columns are: [State] Recv-Q Send-Q Local Peer; find the first host:port pair.
			for i := 0; i+1 < len(f); i++ {
				if strings.Contains(f[i], ":") && strings.Contains(f[i+1], ":") {
					port := portOf(f[i])
					if id, ok := ports[port]; ok {
						key, pool = sockKey{f[i], f[i+1]}, id
					}
					break
				}
			}
			continue
		}
		if pool < 0 {
			continue
		}
		var b sockBytes
		for _, tok := range strings.Fields(line) {
			switch {
			case strings.HasPrefix(tok, "bytes_received:"):
				b.in, _ = strconv.ParseInt(strings.TrimPrefix(tok, "bytes_received:"), 10, 64)
			case strings.HasPrefix(tok, "bytes_acked:"):
				b.out, _ = strconv.ParseInt(strings.TrimPrefix(tok, "bytes_acked:"), 10, 64)
			}
		}
		out[key] = struct {
			pool int
			b    sockBytes
		}{pool, b}
	}
	return out
}

func portOf(addr string) int {
	i := strings.LastIndexByte(addr, ':')
	if i < 0 {
		return -1
	}
	p, err := strconv.Atoi(addr[i+1:])
	if err != nil {
		return -1
	}
	return p
}

// update folds one snapshot in and returns the cumulative counters per pool id.
func (s *sockTracker) update(cur map[sockKey]struct {
	pool int
	b    sockBytes
}) map[int]PoolBytes {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := make(map[sockKey]sockBytes, len(cur))
	for k, v := range cur {
		next[k] = v.b
		if !s.warm {
			continue
		}
		pb := s.cum[v.pool]
		p, seen := s.prev[k]
		switch {
		case seen:
			if d := v.b.in - p.in; d > 0 {
				pb.In += d
			}
			if d := v.b.out - p.out; d > 0 {
				pb.Out += d
			}
		default: // a connection opened since the last pass: everything it moved is new
			pb.In += v.b.in
			pb.Out += v.b.out
		}
		s.cum[v.pool] = pb
	}
	s.prev, s.warm = next, true
	out := make(map[int]PoolBytes, len(s.cum))
	for id, v := range s.cum {
		out[id] = v
	}
	return out
}

// readSocketBytes runs ss for the given pool ports. ok is false when ss is unavailable.
func readSocketBytes(ports map[int]int) (map[sockKey]struct {
	pool int
	b    sockBytes
}, bool) {
	if len(ports) == 0 {
		return nil, true
	}
	var filter []string
	for p := range ports {
		filter = append(filter, "sport = :"+strconv.Itoa(p))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	out, err := exec.CommandContext(ctx, envOr("SS_BIN", "ss"), "-tinH", "state", "established", "( "+strings.Join(filter, " or ")+" )").Output()
	if err != nil {
		return nil, false
	}
	return parseSS(string(out), ports), true
}
