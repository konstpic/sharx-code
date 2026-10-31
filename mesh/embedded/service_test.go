package embedded

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/konstpic/sharx-code/v2/mesh/agent"
	"github.com/konstpic/sharx-code/v2/mesh/protocol"
)

func TestDisabledServiceCreatesNoState(t *testing.T) {
	dir := t.TempDir()
	s := New(dir)
	defer s.Close()
	out, e := s.Call(context.Background(), Request{Operation: "status"})
	if e != nil || out.(map[string]any)["enabled"] != false {
		t.Fatal(out, e)
	}
	if _, e = os.Stat(filepath.Join(dir, "mesh")); !os.IsNotExist(e) {
		t.Fatal("disabled service created state")
	}
}
func TestAPIRejectsCommandsAndUnboundedProxy(t *testing.T) {
	s := New(t.TempDir())
	defer s.Close()
	for _, op := range []string{"exec", "shell", "put", "ssh"} {
		_, e := s.Call(context.Background(), Request{Operation: op, Data: json.RawMessage(`{"command":"touch /tmp/unwanted"}`)})
		if e == nil {
			t.Fatal(op)
		}
	}
	for _, path := range []string{"http://example.test/", "/v3/../auth/disable", "/v3/auth/disable", "/metrics", "/v3/kv/range?x=1"} {
		b, _ := json.Marshal(Proxy{Path: path, Body: json.RawMessage(`{}`)})
		if _, e := s.Call(context.Background(), Request{Operation: "etcd-proxy", Data: b}); e == nil {
			t.Fatal(path)
		}
	}
	for _, tc := range []struct {
		method, body string
		code         int
	}{{"GET", "", 405}, {"POST", `{"operation":"status","command":"x"}`, 400}, {"POST", `{"operation":"shell"}`, 422}} {
		r := httptest.NewRequest(tc.method, "/api/v1/mesh", strings.NewReader(tc.body))
		w := httptest.NewRecorder()
		s.Handler(w, r)
		if w.Code != tc.code {
			t.Fatalf("%v: %d", tc, w.Code)
		}
	}
}
func pki(t *testing.T) (string, string, string) {
	t.Helper()
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test CA"}, IsCA: true, BasicConstraintsValid: true, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageCertSign}
	raw, e := x509.CreateCertificate(rand.Reader, ca, ca, &k.PublicKey, k)
	if e != nil {
		t.Fatal(e)
	}
	leafKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), NotBefore: ca.NotBefore, NotAfter: ca.NotAfter, IPAddresses: []net.IP{net.ParseIP("10.203.0.1"), net.ParseIP("127.0.0.1")}, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth, x509.ExtKeyUsageServerAuth}, KeyUsage: x509.KeyUsageDigitalSignature}
	cert, e := x509.CreateCertificate(rand.Reader, leaf, ca, &leafKey.PublicKey, k)
	if e != nil {
		t.Fatal(e)
	}
	key, _ := x509.MarshalPKCS8PrivateKey(leafKey)
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: raw})), string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert})), string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}))
}
func TestConfigureAndRetiredEtcdPreserveIdentityAndData(t *testing.T) {
	// Every privileged command is replaced; the service's background context is
	// cancelled so this unit test never opens interfaces or runs etcd on the host.
	bin := t.TempDir()
	pub := base64.StdEncoding.EncodeToString(make([]byte, 32))
	for name, script := range map[string]string{"ip": "#!/bin/sh\nif [ \"$1\" = '-j' ]; then echo '[]'; fi\n", "wg": "#!/bin/sh\nprintf '%s\\n' '" + pub + "'\n"} {
		if e := os.WriteFile(filepath.Join(bin, name), []byte(script), 0700); e != nil {
			t.Fatal(e)
		}
	}
	t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
	t.Setenv("SHARX_MESH_FORCE_USERSPACE", "")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s := &Service{dir: filepath.Join(t.TempDir(), "mesh"), ctx: ctx, cancel: cancel}
	defer s.Close()
	ca, cert, key := pki(t)
	setup := Setup{Name: "n1", Overlay: "10.203.0.1", Nodes: map[string]protocol.Node{"n1": {Overlay: "10.203.0.1", Underlay: "192.0.2.1", Pubkey: pub}}, Etcd: []string{"https://10.203.0.1:2399"}, CA: ca, Cert: cert, Key: key}
	if e := s.configure(context.Background(), setup); e != nil {
		t.Fatal(e)
	}
	before, e := os.ReadFile(s.path("wireguard.key"))
	if e != nil {
		t.Fatal(e)
	}
	if e = s.configure(context.Background(), setup); e != nil {
		t.Fatal(e)
	}
	after, _ := os.ReadFile(s.path("wireguard.key"))
	if string(before) != string(after) {
		t.Fatal("reconfigure replaced identity")
	}
	cfg, e := s.config()
	if e != nil {
		t.Fatal(e)
	}
	if _, e = agent.New(s.path("config.json")); e != nil {
		t.Fatal(e)
	}
	for _, p := range []string{cfg.KeyFile, cfg.TLS.Key, s.path("config.json")} {
		st, _ := os.Stat(p)
		if st.Mode().Perm() != 0600 {
			t.Fatal(p, st.Mode())
		}
	}
	bad := setup
	bad.Nodes = map[string]protocol.Node{"n1": {Overlay: "10.203.0.1", Underlay: "192.0.2.1", Pubkey: base64.StdEncoding.EncodeToString(make([]byte, 33))}}
	if e = s.configure(context.Background(), bad); e == nil {
		t.Fatal("bad registry accepted")
	}
	if e = validateTLS(ca, cert, key, "10.203.0.9"); e == nil {
		t.Fatal("wrong server address accepted")
	}
	data := s.path("etcd-data")
	if e = os.MkdirAll(filepath.Join(data, "member"), 0700); e != nil {
		t.Fatal(e)
	}
	_ = os.WriteFile(filepath.Join(data, "member", "sentinel"), []byte("keep"), 0600)
	q := EtcdTLS{CA: ca, Cert: cert, Key: key, AllowExisting: true}
	if e = s.etcdPrepare(q); e == nil {
		t.Fatal("unretired etcd overwritten")
	}
	_ = agent.Atomic(s.path("etcd-managed.json"), map[string]bool{"retired": true})
	if e = s.etcdPrepare(q); e != nil {
		t.Fatal(e)
	}
	backups, _ := filepath.Glob(data + ".retired-*/member/sentinel")
	if len(backups) != 1 {
		t.Fatal("old etcd data not preserved", backups)
	}
	if _, e = s.etcdArgs(EtcdStart{Cluster: "n1=https://10.203.0.1:2391", State: "existing"}); e != nil {
		t.Fatal(e)
	}
	if _, e = s.etcdArgs(EtcdStart{Cluster: "n1=https://evil.test:2391", State: "new", Token: "test"}); e == nil {
		t.Fatal("arbitrary etcd endpoint accepted")
	}
}
