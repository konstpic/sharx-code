package telemtweb

import (
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"testing"
	"time"
)

// freeTCPPort asks the OS for a currently-unused loopback port so tests don't hardcode one
// (and don't need privileges for 443). Small TOCTOU race is acceptable for tests.
func freeTCPPort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("freeTCPPort: %v", err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	m := NewManager(t.TempDir())
	m.bind = "127.0.0.1"
	return m
}

func TestHostOf(t *testing.T) {
	cases := map[string]string{
		"example.com":     "example.com",
		"Example.COM":     "example.com",
		"example.com:443": "example.com",
		"  example.com  ": "example.com",
		"[::1]:443":       "::1",
		"":                "",
	}
	for in, want := range cases {
		if got := hostOf(in); got != want {
			t.Errorf("hostOf(%q) = %q, want %q", in, got, want)
		}
	}
}

// handle() is pure http.Handler logic — independent of whether the TLS listener is
// running — so it's exercised directly via httptest, without binding a real port.
func TestManager_HandleRoutesBySNIHost(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Backend", "ok")
		w.Header().Set("X-Seen-XFF", r.Header.Get("X-Forwarded-For"))
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	m := &Manager{routes: make(map[string]*httputil.ReverseProxy)}
	proxy, err := newReverseProxy("proxy.example.com", backend.Listener.Addr().String())
	if err != nil {
		t.Fatalf("newReverseProxy: %v", err)
	}
	m.routes["proxy.example.com"] = proxy

	req := httptest.NewRequest(http.MethodGet, "https://proxy.example.com/", nil)
	req.Host = "proxy.example.com:443"
	req.RemoteAddr = "203.0.113.5:54321"
	rec := httptest.NewRecorder()
	m.handle(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Backend") != "ok" {
		t.Fatalf("did not reach backend: headers=%v", rec.Header())
	}
	if got := rec.Header().Get("X-Seen-XFF"); got != "203.0.113.5" {
		t.Fatalf("X-Forwarded-For = %q, want %q", got, "203.0.113.5")
	}
}

func TestManager_HandleUnknownHostReturns404(t *testing.T) {
	m := newTestManager(t)
	req := httptest.NewRequest(http.MethodGet, "https://unknown.example.com/", nil)
	req.Host = "unknown.example.com"
	rec := httptest.NewRecorder()
	m.handle(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestManager_ApplyLifecycleStartsAndStops(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	m := newTestManager(t)
	port := freeTCPPort(t)
	if m.RunningCount() != 0 {
		t.Fatalf("expected 0 routes before Apply")
	}

	if err := m.Apply([]Vhost{{Domain: "a.example.com", Backend: backend.Listener.Addr().String(), FrontPort: port}}); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if m.RunningCount() != 1 {
		t.Fatalf("RunningCount = %d, want 1", m.RunningCount())
	}
	m.mu.Lock()
	running := m.running
	m.mu.Unlock()
	if !running {
		t.Fatalf("expected listener to be running after Apply with vhosts")
	}

	// Applying an updated vhost set on the same port should not require restarting the listener.
	if err := m.Apply([]Vhost{
		{Domain: "a.example.com", Backend: backend.Listener.Addr().String(), FrontPort: port},
		{Domain: "b.example.com", Backend: backend.Listener.Addr().String(), FrontPort: port},
	}); err != nil {
		t.Fatalf("Apply (update): %v", err)
	}
	if m.RunningCount() != 2 {
		t.Fatalf("RunningCount = %d, want 2", m.RunningCount())
	}

	if err := m.Apply(nil); err != nil {
		t.Fatalf("Apply(nil): %v", err)
	}
	if m.RunningCount() != 0 {
		t.Fatalf("RunningCount = %d, want 0 after clearing", m.RunningCount())
	}
	m.mu.Lock()
	running = m.running
	m.mu.Unlock()
	if running {
		t.Fatalf("expected listener to be stopped after Apply(nil)")
	}

	// Give the async Shutdown a moment; Stop() on an already-stopped manager must be a no-op.
	time.Sleep(10 * time.Millisecond)
	m.Stop()
}

func TestManager_ApplyRejectsMismatchedFrontPorts(t *testing.T) {
	m := newTestManager(t)
	if err := m.Apply([]Vhost{
		{Domain: "a.example.com", Backend: "127.0.0.1:1111", FrontPort: 8443},
		{Domain: "b.example.com", Backend: "127.0.0.1:2222", FrontPort: 9443},
	}); err == nil {
		t.Fatal("expected an error when vhosts disagree on FrontPort")
	}
}

func TestManager_ApplySkipsEntriesWithEmptyDomainOrBackend(t *testing.T) {
	m := newTestManager(t)
	port := freeTCPPort(t)
	if err := m.Apply([]Vhost{
		{Domain: "", Backend: "127.0.0.1:1234", FrontPort: port},
		{Domain: "example.com", Backend: "", FrontPort: port},
		{Domain: "valid.example.com", Backend: "127.0.0.1:1234", FrontPort: port},
	}); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if m.RunningCount() != 1 {
		t.Fatalf("RunningCount = %d, want 1 (only the fully-populated vhost)", m.RunningCount())
	}
	domains := m.Domains()
	if len(domains) != 1 || domains[0] != "valid.example.com" {
		t.Fatalf("Domains() = %v, want [valid.example.com]", domains)
	}
	m.Stop()
}
