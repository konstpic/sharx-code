package render

import (
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/balancer/spec"
)

func sample(engine string) spec.Spec {
	return spec.Spec{Engine: engine, Pools: []spec.Pool{{
		ID: 1, Name: "vless", ListenPort: 443, Proto: spec.ProtoTCP, Algorithm: spec.AlgoLeastConn, HealthCheck: true,
		Members: []spec.Member{{Host: "10.0.0.1", Port: 443, Weight: 2}, {Host: "node2.example.com", Port: 8443, Weight: 1, Backup: true}},
	}}}
}

func TestHAProxyRender(t *testing.T) {
	out, err := Render(sample(spec.EngineHAProxy))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"bind :443", "balance leastconn", "server s0 10.0.0.1:443 weight 2 check inter 3s fall 2 rise 2", "server s1 node2.example.com:8443 weight 1 check inter 3s fall 2 rise 2 backup"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
}

func TestNginxRenderTCPAndUDP(t *testing.T) {
	s := sample(spec.EngineNginx)
	s.Pools = append(s.Pools, spec.Pool{ID: 2, ListenPort: 8443, Proto: spec.ProtoUDP, Algorithm: spec.AlgoSource, Members: []spec.Member{{Host: "10.0.0.1", Port: 8443, Weight: 1}}})
	out, err := Render(s)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"zone up_1 128k;", "least_conn;", "server 10.0.0.1:443 weight=2 max_fails=2 fail_timeout=10s;", "listen 443;", "listen 8443 udp;", "hash $remote_addr consistent;", "proxy_pass up_2;"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
}

func TestProxyProtocolFlags(t *testing.T) {
	s := sample(spec.EngineHAProxy)
	s.Pools[0].ProxyProtocol = true
	if out, _ := Render(s); !strings.Contains(out, "send-proxy-v2") {
		t.Error("haproxy send-proxy-v2 missing")
	}
	s.Engine = spec.EngineNginx
	if out, _ := Render(s); !strings.Contains(out, "proxy_protocol on;") {
		t.Error("nginx proxy_protocol missing")
	}
}

func TestValidateRejects(t *testing.T) {
	cases := map[string]func(*spec.Spec){
		"udp on haproxy":    func(s *spec.Spec) { s.Pools[0].Proto = spec.ProtoUDP },
		"injection in host": func(s *spec.Spec) { s.Pools[0].Members[0].Host = "1.1.1.1; }\nserver x" },
		"bad port":          func(s *spec.Spec) { s.Pools[0].ListenPort = 0 },
		"no members":        func(s *spec.Spec) { s.Pools[0].Members = nil },
		"unknown engine":    func(s *spec.Spec) { s.Engine = "caddy" },
		"port clash":        func(s *spec.Spec) { s.Pools = append(s.Pools, s.Pools[0]) },
	}
	for name, mut := range cases {
		s := sample(spec.EngineHAProxy)
		mut(&s)
		if _, err := Render(s); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestHashStable(t *testing.T) {
	a, b := sample(spec.EngineHAProxy), sample(spec.EngineHAProxy)
	if a.Hash() != b.Hash() {
		t.Fatal("hash must be deterministic")
	}
	b.Pools[0].Members[0].Weight = 5
	if a.Hash() == b.Hash() {
		t.Fatal("hash must change with content")
	}
}
