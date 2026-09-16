// Package telemtweb runs the shared HTTPS front for Telemt "WEB" mode inbounds: a
// TLS-terminating, SNI-routed reverse proxy that owns a public port (default 443),
// obtains and renews Let's Encrypt certificates automatically (ACME TLS-ALPN-01, so no
// separate port 80 listener is needed), and forwards plaintext HTTP/1.1 to each vhost's
// private Telemt "transport=web" listener. This replaces the manual external
// NGINX/HAProxy step previously required for WEB mode: SharX now supervises the whole
// stack, matching how every other inbound protocol is self-contained.
package telemtweb

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"

	"golang.org/x/crypto/acme/autocert"

	"github.com/konstpic/sharx-code/v2/logger"
)

// Vhost is one Telemt WEB inbound's public domain and its private backend address
// (Telemt's own "transport=web" listener, e.g. "127.0.0.1:18443"). Also the wire shape
// pushed from panel to worker nodes alongside Telemt/Xray config payloads.
type Vhost struct {
	Domain  string `json:"domain"`
	Backend string `json:"backend"`
	// FrontPort is the shared public HTTPS port this vhost's front should listen on.
	// All vhosts applied together must agree on one value; Apply rejects a mismatch.
	FrontPort int `json:"frontPort"`
}

// DefaultFrontPort is the shared public HTTPS port used when a Vhost doesn't specify one.
const DefaultFrontPort = 443

// Manager supervises one shared HTTPS listener for all Telemt WEB vhosts on this
// node/panel host. Domains are routed by SNI/Host; certificates are issued and cached
// per-domain by autocert, restricted to domains currently registered via Apply.
type Manager struct {
	mu   sync.Mutex
	port int    // current listener port (0 when not running)
	bind string // listen host prefix, e.g. "" (all interfaces); tests set "127.0.0.1"

	certDir string // autocert.DirCache directory
	certMgr *autocert.Manager
	srv     *http.Server
	routes  map[string]*httputil.ReverseProxy
	running bool
}

// NewManager creates a telemtweb Manager whose cert cache lives under certDir.
func NewManager(certDir string) *Manager {
	return &Manager{certDir: certDir, routes: make(map[string]*httputil.ReverseProxy)}
}

func (m *Manager) listenAddr(port int) string {
	return fmt.Sprintf("%s:%d", m.bind, port)
}

// RunningCount returns the number of vhosts currently routed.
func (m *Manager) RunningCount() int {
	if m == nil {
		return 0
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.routes)
}

// Domains returns the currently registered vhost domains (for status/debug reporting).
func (m *Manager) Domains() []string {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.routes))
	for d := range m.routes {
		out = append(out, d)
	}
	return out
}

func newReverseProxy(domain, backend string) (*httputil.ReverseProxy, error) {
	target, err := url.Parse("http://" + backend)
	if err != nil {
		return nil, fmt.Errorf("invalid backend %q for %s: %w", backend, domain, err)
	}
	// httputil.ReverseProxy sets/appends X-Forwarded-For from req.RemoteAddr on its own
	// (the direct TCP peer of this TLS front, i.e. the real client, since TLS terminates
	// here) — exactly what Telemt's web_client_ip_source=x_forwarded_for expects from its
	// trusted peer, so no custom Director is needed.
	return httputil.NewSingleHostReverseProxy(target), nil
}

// hostOf strips an optional port from a Host header value.
func hostOf(hostHeader string) string {
	h := strings.TrimSpace(hostHeader)
	if host, _, err := net.SplitHostPort(h); err == nil {
		return strings.ToLower(host)
	}
	return strings.ToLower(h)
}

func (m *Manager) handle(w http.ResponseWriter, r *http.Request) {
	domain := hostOf(r.Host)
	m.mu.Lock()
	proxy := m.routes[domain]
	m.mu.Unlock()
	if proxy == nil {
		http.Error(w, "unknown host", http.StatusNotFound)
		return
	}
	proxy.ServeHTTP(w, r)
}

func (m *Manager) hostPolicy(_ context.Context, host string) error {
	m.mu.Lock()
	_, ok := m.routes[strings.ToLower(host)]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("telemtweb: host %q is not a configured WEB vhost", host)
	}
	return nil
}

// Apply replaces the routed vhost set. An empty list stops the shared listener entirely
// (no Telemt WEB inbounds left); a non-empty list starts it on first use and updates routes
// without interrupting already-established connections to unaffected domains. Every vhost
// in one Apply call must agree on the same FrontPort (0 means DefaultFrontPort) — mixed
// ports mean two WEB inbounds on this node/panel were configured inconsistently, which is
// rejected rather than silently picking one.
func (m *Manager) Apply(vhosts []Vhost) error {
	if m == nil {
		return errors.New("telemtweb manager is nil")
	}
	newRoutes := make(map[string]*httputil.ReverseProxy, len(vhosts))
	port := 0
	for _, v := range vhosts {
		domain := strings.ToLower(strings.TrimSpace(v.Domain))
		backend := strings.TrimSpace(v.Backend)
		if domain == "" || backend == "" {
			continue
		}
		vp := v.FrontPort
		if vp <= 0 {
			vp = DefaultFrontPort
		}
		if port == 0 {
			port = vp
		} else if port != vp {
			return fmt.Errorf("telemtweb: vhost %q wants front port %d but another WEB vhost on this node already uses %d — all WEB inbounds sharing a node/panel must use the same front port", domain, vp, port)
		}
		proxy, err := newReverseProxy(domain, backend)
		if err != nil {
			return err
		}
		newRoutes[domain] = proxy
	}

	m.mu.Lock()
	m.routes = newRoutes
	portChanged := m.running && port != 0 && port != m.port
	needStop := (len(newRoutes) == 0 || portChanged) && m.running
	needStart := len(newRoutes) > 0 && (!m.running || portChanged)
	m.mu.Unlock()

	if needStop {
		if err := m.stopLocked(); err != nil {
			return err
		}
	}
	if needStart {
		return m.start(port)
	}
	return nil
}

func (m *Manager) start(port int) error {
	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return nil
	}
	if m.certMgr == nil {
		m.certMgr = &autocert.Manager{
			Prompt:     autocert.AcceptTOS,
			Cache:      autocert.DirCache(m.certDir),
			HostPolicy: m.hostPolicy,
		}
	}
	tlsCfg := m.certMgr.TLSConfig()
	// TLS-ALPN-01 only (no HTTP-01 fallback listener): avoids competing with the panel's
	// own ACME setup on port 80, and this listener never serves plain HTTP anyway.
	tlsCfg.NextProtos = append([]string{"h2", "http/1.1"}, tlsCfg.NextProtos...)
	addr := m.listenAddr(port)
	srv := &http.Server{
		Addr:      addr,
		Handler:   http.HandlerFunc(m.handle),
		TLSConfig: tlsCfg,
	}
	m.srv = srv
	m.port = port
	m.running = true
	m.mu.Unlock()

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		m.mu.Lock()
		m.running = false
		m.srv = nil
		m.port = 0
		m.mu.Unlock()
		return fmt.Errorf("telemtweb: listen %s: %w", addr, err)
	}
	tlsLn := tls.NewListener(ln, srv.TLSConfig)

	go func() {
		err := srv.Serve(tlsLn)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Warningf("telemtweb: server stopped: %v", err)
		}
	}()
	logger.Infof("telemtweb: TLS front listening on %s", addr)
	return nil
}

func (m *Manager) stopLocked() error {
	m.mu.Lock()
	srv := m.srv
	m.running = false
	m.srv = nil
	m.port = 0
	m.mu.Unlock()
	if srv == nil {
		return nil
	}
	logger.Infof("telemtweb: stopping TLS front")
	return srv.Shutdown(context.Background())
}

// Stop shuts down the shared listener, if running, and clears all routes.
func (m *Manager) Stop() {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.routes = make(map[string]*httputil.ReverseProxy)
	m.mu.Unlock()
	_ = m.stopLocked()
}
