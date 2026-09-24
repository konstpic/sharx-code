package engine

import (
	"bufio"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/balancer/spec"
)

func TestParseHAProxyStat(t *testing.T) {
	csvText := "# pxname,svname,qcur,qmax,scur,smax,slim,stot,bin,bout,dreq,dresp,ereq,econ,eresp,wretr,wredis,status\n" +
		"fe_1,FRONTEND,,,3,3,50000,3,0,0,0,0,0,,,,,OPEN\n" +
		"be_1,s0,0,0,2,2,,2,0,0,,0,,0,0,0,0,UP\n" +
		"be_1,s1,0,0,0,0,,0,0,0,,0,,0,0,0,0,DOWN\n" +
		"be_1,BACKEND,0,0,2,2,5000,2,0,0,0,0,,0,0,0,0,UP\n"
	m, err := parseHAProxyStat(bufio.NewReader(strings.NewReader(csvText)))
	if err != nil {
		t.Fatal(err)
	}
	if !m["be_1/s0"].Up || m["be_1/s0"].Sessions != 2 || m["be_1/s1"].Up {
		t.Fatalf("got %+v", m)
	}
	if len(m) != 2 {
		t.Fatalf("frontend/backend rows must be ignored: %+v", m)
	}
}

func TestResolveForNginxDropsUnresolvable(t *testing.T) {
	s := spec.Spec{Engine: spec.EngineNginx, Pools: []spec.Pool{
		{ID: 1, ListenPort: 1, Proto: "tcp", Algorithm: "roundrobin", Members: []spec.Member{{Host: "127.0.0.1", Port: 1}, {Host: "no-such-host.invalid", Port: 1}}},
		{ID: 2, ListenPort: 2, Proto: "tcp", Algorithm: "roundrobin", Members: []spec.Member{{Host: "no-such-host.invalid", Port: 1}}},
	}}
	out := resolveForNginx(s)
	if len(out.Pools) != 1 || len(out.Pools[0].Members) != 1 || out.Pools[0].Members[0].Host != "127.0.0.1" {
		t.Fatalf("got %+v", out)
	}
}
