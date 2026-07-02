package pairing_outbound

import "testing"

func TestKeyFromAuthSecretStable(t *testing.T) {
	a := KeyFromAuthSecret("panel-node-auth-secret-32chars!!")
	b := KeyFromAuthSecret("panel-node-auth-secret-32chars!!")
	if a != b {
		t.Fatal("auth secret key must be stable")
	}
	if a == ([32]byte{}) {
		t.Fatal("expected non-zero key")
	}
}

func TestKeyFromAuthSecretDiffersFromLegacy(t *testing.T) {
	auth := KeyFromAuthSecret("test-secret")
	legacy := OutboundHMACKey("ca-pem", "jwt-pem")
	if auth == legacy {
		t.Fatal("auth secret key should differ from legacy derivation")
	}
}
