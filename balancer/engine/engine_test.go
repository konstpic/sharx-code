package engine

import (
	"bufio"
	"os"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/balancer/spec"
)

func TestParseHAProxyStat(t *testing.T) {
	csvText := "# pxname,svname,qcur,qmax,scur,smax,slim,stot,bin,bout,dreq,dresp,ereq,econ,eresp,wretr,wredis,status\n" +
		"fe_1,FRONTEND,,,3,3,50000,3,0,0,0,0,0,,,,,OPEN\n" +
		"be_1,s0,0,0,2,2,,7,0,0,,0,,0,0,0,0,UP\n" +
		"be_1,s1,0,0,0,0,,0,0,0,,0,,0,0,0,0,DOWN\n" +
		"be_1,BACKEND,0,0,2,2,5000,2,0,0,0,0,,0,0,0,0,UP\n"
	m, err := parseHAProxyStat(bufio.NewReader(strings.NewReader(csvText)))
	if err != nil {
		t.Fatal(err)
	}
	if !m["be_1/s0"].Up || m["be_1/s0"].Sessions != 2 || m["be_1/s0"].Total != 7 || m["be_1/s1"].Up {
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

func TestReadNICBytesSkipsVirtual(t *testing.T) {
	dir := t.TempDir()
	p := dir + "/dev"
	txt := "Inter-|   Receive |  Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n" +
		"    lo: 1000 1 0 0 0 0 0 0 1000 1 0 0 0 0 0 0\n" +
		"  eth0: 5000 1 0 0 0 0 0 0 7000 1 0 0 0 0 0 0\n" +
		"docker0: 9 1 0 0 0 0 0 0 9 1 0 0 0 0 0 0\n" +
		" veth1a: 9 1 0 0 0 0 0 0 9 1 0 0 0 0 0 0\n"
	if err := os.WriteFile(p, []byte(txt), 0o600); err != nil {
		t.Fatal(err)
	}
	rx, tx := readNICBytes(p)
	if rx != 5000 || tx != 7000 {
		t.Fatalf("rx=%d tx=%d", rx, tx)
	}
}

func TestCountEstablished(t *testing.T) {
	dir := t.TempDir()
	p := dir + "/tcp"
	txt := "  sl  local_address rem_address   st tx_queue rx_queue\n" +
		"   0: 0100007F:01BB 0200007F:D000 01 00000000:00000000 00:00000000 00000000\n" + // :443 established
		"   1: 0100007F:01BB 0300007F:D001 01 00000000:00000000 00:00000000 00000000\n" +
		"   2: 0100007F:01BB 0400007F:D002 06 00000000:00000000 00:00000000 00000000\n" + // TIME_WAIT
		"   3: 0100007F:1F90 0500007F:D003 01 00000000:00000000 00:00000000 00000000\n" // :8080 not a pool
	if err := os.WriteFile(p, []byte(txt), 0o600); err != nil {
		t.Fatal(err)
	}
	got := countEstablished([]string{p}, map[int]int{443: 7})
	if got[443] != 2 || len(got) != 1 {
		t.Fatalf("got %v", got)
	}
}

func TestParseHAProxyFrontends(t *testing.T) {
	csvText := "# pxname,svname,qcur,qmax,scur,smax,slim,stot,bin,bout,dreq,dresp,ereq,econ,eresp,wretr,wredis,status\n" +
		"fe_3,FRONTEND,,,3,3,50000,3,1500,2500,0,0,0,,,,,OPEN\n"
	_, f, err := parseHAProxyStatAll(bufio.NewReader(strings.NewReader(csvText)))
	if err != nil || f["fe_3"].In != 1500 || f["fe_3"].Out != 2500 {
		t.Fatalf("%v %+v", err, f)
	}
}

const ssSample = `0      0        10.0.0.1:443    1.2.3.4:5555
	 cubic wscale:7,7 rto:204 bytes_sent:9000 bytes_retrans:0 bytes_acked:8000 bytes_received:3000 segs_out:10
0      0        10.0.0.1:443    5.6.7.8:6666
	 cubic wscale:7,7 bytes_sent:100 bytes_acked:90 bytes_received:50 segs_out:1
0      0        10.0.0.1:9999   5.6.7.8:7777
	 cubic bytes_sent:1 bytes_acked:1 bytes_received:1
`

func TestParseSSAndTracker(t *testing.T) {
	ports := map[int]int{443: 7}
	snap := parseSS(ssSample, ports)
	if len(snap) != 2 {
		t.Fatalf("only pool-port sockets: %+v", snap)
	}
	tr := newSockTracker()
	if got := tr.update(snap); got[7].In != 0 {
		t.Fatalf("first pass only learns: %+v", got)
	}
	grown := parseSS(strings.ReplaceAll(strings.ReplaceAll(ssSample, "bytes_received:3000", "bytes_received:4000"), "bytes_acked:8000", "bytes_acked:20000"), ports)
	got := tr.update(grown)
	if got[7].In != 1000 || got[7].Out != 12000 {
		t.Fatalf("deltas: %+v", got)
	}
}
