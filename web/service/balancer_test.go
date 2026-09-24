package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
)

func TestBalancerHostOnly(t *testing.T) {
	for in, want := range map[string]string{
		"1.2.3.4": "1.2.3.4", "lb.example.com": "lb.example.com", "https://lb.example.com:8443/x": "lb.example.com",
		"http://10.0.0.5:8080": "10.0.0.5", "lb.example.com:443": "lb.example.com", " [::1] ": "::1", "": "",
	} {
		if got := balancerHostOnly(in); got != want {
			t.Errorf("%q: got %q want %q", in, got, want)
		}
	}
}

func TestPoolTransport(t *testing.T) {
	if PoolTransport(model.VLESS, `{"network":"tcp"}`) != "tcp" {
		t.Error("vless tcp")
	}
	if PoolTransport(model.VLESS, `{"network":"kcp"}`) != "udp" {
		t.Error("vless kcp is udp")
	}
	for _, p := range []model.Protocol{model.Hysteria2, model.WireGuard, model.AmneziaWG} {
		if PoolTransport(p, "") != "udp" {
			t.Errorf("%s must be udp", p)
		}
	}
	if PoolTransport(model.Telemt, "") != "tcp" {
		t.Error("telemt is tcp")
	}
}

func TestBuildSpecFor(t *testing.T) {
	b := &model.Balancer{Id: 1, Engine: "haproxy", Pools: []model.BalancerPool{
		{Id: 10, Enable: true, ListenPort: 0, InboundPort: 443, InboundRemark: "vless", Transport: "tcp", Algorithm: "leastconn", HealthCheck: true,
			Members: []model.BalancerPoolMember{
				{NodeId: 1, Weight: 2, Enable: true, NodeAddr: "10.0.0.1", NodeStatus: "online"},
				{NodeId: 2, Weight: 1, Enable: true, NodeAddr: "10.0.0.2", NodeStatus: "disabled"},
				{NodeId: 3, Weight: 1, Enable: false, NodeAddr: "10.0.0.3"},
				{NodeId: 4, Weight: 1, Enable: true, NodeAddr: "10.0.0.4", AddressOverride: "backup.example.com", PortOverride: 8443, Backup: true},
			}},
		{Id: 11, Enable: false, InboundPort: 80, Transport: "tcp", Algorithm: "roundrobin", Members: []model.BalancerPoolMember{{NodeId: 1, Enable: true, NodeAddr: "10.0.0.1"}}},
		{Id: 12, Enable: true, InboundPort: 90, Transport: "tcp", Algorithm: "roundrobin"},
	}}
	sp := (&BalancerService{}).buildSpecFor(b)
	if len(sp.Pools) != 1 {
		t.Fatalf("only the enabled pool with members is deployed: %+v", sp.Pools)
	}
	p := sp.Pools[0]
	if p.ListenPort != 443 || p.Algorithm != "leastconn" || len(p.Members) != 2 {
		t.Fatalf("pool: %+v", p)
	}
	if p.Members[0].Host != "10.0.0.1" || p.Members[0].Port != 443 || p.Members[0].Weight != 2 {
		t.Errorf("m0: %+v", p.Members[0])
	}
	if p.Members[1].Host != "backup.example.com" || p.Members[1].Port != 8443 || !p.Members[1].Backup {
		t.Errorf("m1: %+v", p.Members[1])
	}
	if err := sp.Validate(); err != nil {
		t.Fatal(err)
	}
}
