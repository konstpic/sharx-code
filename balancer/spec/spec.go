// Package spec is the wire format between the panel and the balancer agent: which ports to listen on
// and which backends to forward to. Both sides import it, so the rendered config never depends on the panel's DB.
package spec

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	EngineHAProxy = "haproxy"
	EngineNginx   = "nginx"

	ProtoTCP = "tcp"
	ProtoUDP = "udp"

	AlgoRoundRobin = "roundrobin"
	AlgoLeastConn  = "leastconn"
	AlgoSource     = "source"
)

// Member is one backend of a pool.
type Member struct {
	Host   string `json:"host"`
	Port   int    `json:"port"`
	Weight int    `json:"weight"`
	Backup bool   `json:"backup,omitempty"`
}

// Pool is one listening port with its backends.
type Pool struct {
	ID            int      `json:"id"`
	Name          string   `json:"name"`
	ListenPort    int      `json:"listenPort"`
	Proto         string   `json:"proto"`
	Algorithm     string   `json:"algorithm"`
	ProxyProtocol bool     `json:"proxyProtocol,omitempty"`
	HealthCheck   bool     `json:"healthCheck"`
	Members       []Member `json:"members"`
}

// Spec is the full desired state of a balancer.
type Spec struct {
	Engine string `json:"engine"`
	Pools  []Pool `json:"pools"`
}

// Hash is a stable digest of the spec, used to skip no-op applies and to compare panel and agent state.
func (s Spec) Hash() string {
	b, _ := json.Marshal(s)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// Validate rejects specs that could not be rendered into a working config. Names and hosts end up inside
// config files, so they are restricted to a safe alphabet (no whitespace, quotes, braces or semicolons).
func (s Spec) Validate() error {
	if s.Engine != EngineHAProxy && s.Engine != EngineNginx {
		return fmt.Errorf("unknown engine %q", s.Engine)
	}
	type key struct {
		port  int
		proto string
	}
	seen := map[key]int{}
	for _, p := range s.Pools {
		if p.ListenPort < 1 || p.ListenPort > 65535 {
			return fmt.Errorf("pool %d: invalid listen port %d", p.ID, p.ListenPort)
		}
		if p.Proto != ProtoTCP && p.Proto != ProtoUDP {
			return fmt.Errorf("pool %d: invalid protocol %q", p.ID, p.Proto)
		}
		if p.Proto == ProtoUDP && s.Engine != EngineNginx {
			return fmt.Errorf("pool %d: UDP needs the nginx engine", p.ID)
		}
		switch p.Algorithm {
		case AlgoRoundRobin, AlgoLeastConn, AlgoSource:
		default:
			return fmt.Errorf("pool %d: invalid algorithm %q", p.ID, p.Algorithm)
		}
		if p.ProxyProtocol && p.Proto == ProtoUDP {
			return fmt.Errorf("pool %d: PROXY protocol is not available for UDP", p.ID)
		}
		k := key{p.ListenPort, p.Proto}
		if other, ok := seen[k]; ok {
			return fmt.Errorf("pool %d and %d listen on %s/%d", other, p.ID, p.Proto, p.ListenPort)
		}
		seen[k] = p.ID
		if len(p.Members) == 0 {
			return fmt.Errorf("pool %d: no members", p.ID)
		}
		for _, m := range p.Members {
			if !safeHost(m.Host) {
				return fmt.Errorf("pool %d: invalid backend host %q", p.ID, m.Host)
			}
			if m.Port < 1 || m.Port > 65535 {
				return fmt.Errorf("pool %d: invalid backend port %d", p.ID, m.Port)
			}
			if m.Weight < 0 || m.Weight > 256 {
				return fmt.Errorf("pool %d: invalid weight %d", p.ID, m.Weight)
			}
		}
	}
	return nil
}

func safeHost(h string) bool {
	if h == "" || len(h) > 253 {
		return false
	}
	for _, r := range h {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == ':', r == '_':
		default:
			return false
		}
	}
	return !strings.HasPrefix(h, "-")
}
