package agent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/konstpic/sharx-code/v2/mesh/protocol"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestForwardRejectsInvalidPlanBeforeAnyFirewallCommand(t *testing.T) {
	for _, body := range []string{`{"rules":[{"id":"n1","target":"127.0.0.1","maps":[["tcp",55000,443]]}]}`, `{"rules":[{"id":"n1","target":"10.203.0.2","maps":[["tcp",55000,443],["tcp",55000,8443]]}]}`, `{"rules":[{"id":"n1;reboot","target":"10.203.0.2","maps":[]}]}`, `{"rules":[{"id":"n1","target":"10.203.0.2","maps":[["tcp",22,443]]}]}`} {
		p := filepath.Join(t.TempDir(), "rules.json")
		os.WriteFile(p, []byte(body), 0600)
		e := Forward(context.Background(), p)
		if e == nil || strings.Contains(e.Error(), "operation failed") {
			t.Fatal("validation did not precede firewall effects", e)
		}
	}
}

func TestPartialBootstrapPrefixCannotDeleteEstablishedLinks(t *testing.T) {
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	nodes := map[string]protocol.Node{"n1": {Underlay: "172.30.203.11", Overlay: "10.203.0.1", Pubkey: key}, "n2": {Underlay: "172.30.203.12", Overlay: "10.203.0.2", Pubkey: key}}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var q map[string]string
		json.NewDecoder(r.Body).Decode(&q)
		if q["key"] == protocol.B64(protocol.Prefix+"nodes/") {
			t.Error("agent read non-atomic node prefix")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"kvs":[]}`))
	}))
	defer server.Close()
	a := &Agent{cfg: Config{Name: "n2", Overlay: "10.203.0.2", NodesFile: filepath.Join(t.TempDir(), "nodes.json")}, nodes: nodes, store: &protocol.Store{Endpoints: []string{server.URL}, Client: server.Client()}}
	a.refresh(context.Background())
	if len(a.nodes) != 2 {
		t.Fatal("incomplete publication removed a peer")
	}
}

func TestJoiningAgentSeedsRoutesBeforeEtcdAndPreservesCachedTransit(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "routes.log")
	script := `#!/bin/sh
case "$*" in
  "-j link show") echo '[]';;
  "-j route show exact 10.203.0.1/32") echo '[]';;
  "-j route show exact 10.203.0.2/32") echo '[{"dev":"sxm-n1"}]';;
  "route replace "*) echo "$*" >> "` + logPath + `";;
esac
exit 0
`
	if err := os.WriteFile(filepath.Join(dir, "ip"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	for _, bin := range []string{"wg", "sysctl", "iptables"} {
		if err := os.WriteFile(filepath.Join(dir, bin), []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	checked := make(chan bool, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, err := os.ReadFile(logPath)
		good := err == nil && strings.Contains(string(raw), "route replace 10.203.0.1/32 dev sxm-n1 src 10.203.0.5 metric 50") && !strings.Contains(string(raw), "route replace 10.203.0.2")
		select {
		case checked <- good:
		default:
		}
		cancel()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"kvs":[]}`))
	}))
	defer server.Close()
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	a := &Agent{cfg: Config{Name: "n5", Overlay: "10.203.0.5"}, nodes: map[string]protocol.Node{
		"n1": {Underlay: "172.30.203.11", Overlay: "10.203.0.1", Pubkey: key},
		"n2": {Underlay: "172.30.203.12", Overlay: "10.203.0.2", Pubkey: key},
		"n5": {Underlay: "172.30.203.15", Overlay: "10.203.0.5", Pubkey: key},
	}, endpoints: map[string]string{}, store: &protocol.Store{Endpoints: []string{server.URL}, Client: server.Client()}}
	_ = a.Round(ctx)
	select {
	case good := <-checked:
		if !good {
			t.Fatal("etcd requested before direct seed routes, or cached transit overwritten")
		}
	default:
		t.Fatal("etcd discovery was never reached")
	}
}

// Docker mounts /proc/sys read-only even with NET_ADMIN. Values which are
// already suitable must not cause a write and fail an otherwise usable mesh.
func TestSysctlDoesNotRewriteSuitableDockerDefaults(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\nif [ \"$1\" = '-n' ]; then case \"$2\" in net.ipv4.ip_forward) echo 1;; *) echo 2;; esac; exit 0; fi\nexit 1\n"
	if e := os.WriteFile(filepath.Join(dir, "sysctl"), []byte(script), 0700); e != nil {
		t.Fatal(e)
	}
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))
	if e := setSysctl(context.Background(), "net.ipv4.ip_forward", "1"); e != nil {
		t.Fatal(e)
	}
	if e := setSysctl(context.Background(), "net.ipv4.conf.sxm-n2.rp_filter", "0", "2"); e != nil {
		t.Fatal(e)
	}
	if e := setSysctl(context.Background(), "net.ipv4.conf.sxm-n2.rp_filter", "0"); e == nil {
		t.Fatal("strict unsuitable defaults were silently accepted")
	}
}
