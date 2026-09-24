package engine

import (
	"net"
	"time"

	"github.com/konstpic/sharx-code/v2/balancer/spec"
	"github.com/konstpic/sharx-code/v2/logger"
)

// resolveForNginx replaces backend host names with IPs: nginx refuses to load a config whose upstream name does not
// resolve, which would take the whole balancer down because of one bad node. Unresolvable members are dropped
// (and a pool without members is skipped) instead.
func resolveForNginx(s spec.Spec) spec.Spec {
	out := spec.Spec{Engine: s.Engine}
	for _, p := range s.Pools {
		np := p
		np.Members = nil
		for _, m := range p.Members {
			ip := resolveHost(m.Host)
			if ip == "" {
				logger.Warningf("balancer: cannot resolve backend %q of pool %d, skipping it", m.Host, p.ID)
				continue
			}
			m.Host = ip
			np.Members = append(np.Members, m)
		}
		if len(np.Members) > 0 {
			out.Pools = append(out.Pools, np)
		}
	}
	return out
}

func resolveHost(h string) string {
	if net.ParseIP(h) != nil {
		return h
	}
	done := make(chan []string, 1)
	go func() {
		addrs, _ := net.LookupHost(h)
		done <- addrs
	}()
	select {
	case addrs := <-done:
		for _, a := range addrs {
			if ip := net.ParseIP(a); ip != nil && ip.To4() != nil {
				return a
			}
		}
		if len(addrs) > 0 {
			return addrs[0]
		}
	case <-time.After(5 * time.Second):
	}
	return ""
}
