// Package render turns a spec.Spec into an HAProxy or nginx configuration. Pure functions, no I/O.
package render

import (
	"fmt"
	"net"
	"strconv"

	"github.com/konstpic/sharx-code/v2/balancer/spec"
)

// Render returns the config text for the spec's engine.
func Render(s spec.Spec) (string, error) {
	if err := s.Validate(); err != nil {
		return "", err
	}
	switch s.Engine {
	case spec.EngineHAProxy:
		return haproxy(s), nil
	case spec.EngineNginx:
		return nginx(s), nil
	}
	return "", fmt.Errorf("unknown engine %q", s.Engine)
}

// backendAddr formats host:port, bracketing IPv6 literals.
func backendAddr(m spec.Member) string {
	return net.JoinHostPort(m.Host, strconv.Itoa(m.Port))
}

func weightOf(m spec.Member) int {
	if m.Weight <= 0 {
		return 1
	}
	return m.Weight
}
