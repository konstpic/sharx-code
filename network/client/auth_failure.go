package client

import (
	"crypto/tls"
	"errors"
	"net"
)

// AuthenticationRejected distinguishes explicit credential rejection from an
// outage. Direct traffic must survive timeouts, refused connections and HTTP 5xx.
func AuthenticationRejected(err error) bool {
	var ce *CoordinatorError
	if errors.As(err, &ce) {
		return ce.Status == 401 || ce.Status == 403
	}
	var alert tls.AlertError
	if errors.As(err, &alert) {
		return true
	}
	var op *net.OpError
	if errors.As(err, &op) && op.Op == "remote error" {
		switch op.Err.Error() {
		case "tls: bad certificate", "tls: unknown certificate", "tls: certificate required", "tls: certificate revoked":
			return true
		}
	}
	return false
}
