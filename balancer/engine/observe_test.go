package engine

import (
	"os"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/logger"
)

func classify(m *Manager, line string) logger.Entry {
	e := logger.Entry{Component: CompEngine}
	m.classifyEngineLine(line, &e)
	return e
}

func TestClassifyHAProxySession(t *testing.T) {
	m := &Manager{}
	e := classify(m, "10.9.0.3:35753 [06/Oct/2026:18:37:04.450] fe_1 be_1/s0 1/0/5234 12345 -- 1/1/0/0/0 0/0")
	if e.Component != CompConnection || e.Level != "debug" || !strings.Contains(e.Msg, "backend=be_1 server=s0 duration_ms=5234 bytes_tx=12345") || !strings.Contains(e.Msg, "result=ok") {
		t.Fatalf("%+v", e)
	}
	if e.ConnID == "" || m.cnt.connsTotal.Load() != 1 || m.cnt.bytesTx.Load() != 12345 || m.cnt.connErrors.Load() != 0 {
		t.Fatalf("id=%q counters=%d/%d", e.ConnID, m.cnt.connsTotal.Load(), m.cnt.connErrors.Load())
	}
}

func TestClassifyHAProxyFailures(t *testing.T) {
	m := &Manager{}
	// backend unreachable: Tc is -1 and the termination state is SC
	e := classify(m, "1.2.3.4:5000 [06/Oct/2026:18:37:04.450] fe_1 be_1/s1 0/-1/5001 0 SC 1/1/0/0/3 0/0")
	if e.Level != "warn" || !strings.Contains(e.Msg, "backend connect failed") {
		t.Fatalf("%+v", e)
	}
	// client side timeout (lower-case c)
	e = classify(m, "1.2.3.4:5001 [06/Oct/2026:18:37:04.450] fe_1 be_1/s0 0/0/3600000 10 cD 1/1/0/0/0 0/0")
	if e.Level != "warn" || !strings.Contains(e.Msg, "timeout") || m.cnt.timeouts.Load() != 1 {
		t.Fatalf("%+v timeouts=%d", e, m.cnt.timeouts.Load())
	}
	if m.cnt.connErrors.Load() != 2 || m.cnt.connsTotal.Load() != 2 {
		t.Fatalf("errors=%d total=%d", m.cnt.connErrors.Load(), m.cnt.connsTotal.Load())
	}
}

func TestClassifyNginxSessionAndNoise(t *testing.T) {
	m := &Manager{}
	e := classify(m, `SHARX 1.2.3.4:51820 UDP 200 1500 3000 12.500 "10.0.0.1:51820" 0.000`)
	if e.Component != CompConnection || !strings.Contains(e.Msg, "upstream=10.0.0.1:51820") || !strings.Contains(e.Msg, "bytes_rx=1500 bytes_tx=3000") {
		t.Fatalf("%+v", e)
	}
	e = classify(m, `SHARX 1.2.3.4:5 TCP 502 0 0 3.001 "10.0.0.2:443" -`)
	if e.Level != "warn" || !strings.Contains(e.Msg, "status 502") || m.cnt.connErrors.Load() != 1 {
		t.Fatalf("%+v", e)
	}
	e = classify(m, `2026/10/06 18:00:00 [error] 7#7: *1 upstream timed out (110: Connection timed out) while connecting to upstream`)
	if e.Component != CompHealth || m.cnt.timeouts.Load() != 1 {
		t.Fatalf("%+v", e)
	}
	if e = classify(m, `[WARNING] (1) : config: something`); e.Level != "warn" || e.Component != CompEngine {
		t.Fatalf("%+v", e)
	}
}

func TestReadInterfaceDiag(t *testing.T) {
	dir := t.TempDir()
	txt := "Inter-|   Receive |  Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n" +
		"    lo: 1 1 0 0 0 0 0 0 1 1 0 0 0 0 0 0\n  eth0: 5000 10 2 7 0 0 0 0 7000 10 3 9 0 0 0 0\n"
	p := dir + "/dev"
	if err := writeFile(p, txt); err != nil {
		t.Fatal(err)
	}
	got := readInterfaceDiag(p)
	if len(got) != 1 || got[0].Name != "eth0" || got[0].RxErrs != 2 || got[0].RxDrop != 7 || got[0].TxErrs != 3 || got[0].TxDrop != 9 {
		t.Fatalf("%+v", got)
	}
}

func writeFile(p, s string) error { return os.WriteFile(p, []byte(s), 0o600) }

func TestReloadNoiseIsNotAWarning(t *testing.T) {
	m := &Manager{}
	e := classify(m, "[WARNING]  (101) : Proxy fe_1 stopped (cumulated conns: FE: 3, BE: 0).")
	if e.Level != "info" {
		t.Fatalf("%+v", e)
	}
	e = classify(m, "[WARNING]  (20) : Former worker (101) exited with code 0 (Exit)")
	if e.Level != "info" {
		t.Fatalf("%+v", e)
	}
	e = classify(m, "[WARNING]  (20) : config: something real")
	if e.Level != "warn" {
		t.Fatalf("%+v", e)
	}
	if m.classifyEngineLine("Proxy fe_1 stopped (cumulated conns: FE: 3, BE: 0).", &logger.Entry{}) {
		t.Fatal("the duplicate raw line must be dropped")
	}
}

func TestConnID(t *testing.T) {
	if got := connID("1.2.3.4:5555", "06/Oct/2026:19:57:48.025"); got != "1.2.3.4-5555@195748.025" {
		t.Fatal(got)
	}
}
