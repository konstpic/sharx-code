package mesh

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"golang.org/x/crypto/ssh"
	"net"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestSSHRejectsChangedHostKeyBeforeAuthentication(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	host, _ := ssh.NewSignerFromKey(key)
	_, wrong, _ := ed25519.GenerateKey(rand.Reader)
	other, _ := ssh.NewSignerFromKey(wrong)
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	defer listener.Close()
	var auth atomic.Int32
	cfg := &ssh.ServerConfig{PasswordCallback: func(ssh.ConnMetadata, []byte) (*ssh.Permissions, error) { auth.Add(1); return nil, nil }}
	cfg.AddHostKey(host)
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, e := listener.Accept()
		if e != nil {
			return
		}
		defer conn.Close()
		_, _, _, _ = ssh.NewServerConn(conn, cfg)
	}()
	d := Enrolled{Host: "127.0.0.1", User: "root", SSHPort: listener.Addr().(*net.TCPAddr).Port, KeyType: ssh.KeyAlgoED25519, Fingerprint: ssh.FingerprintSHA256(other.PublicKey())}
	if cl, e := sshDial(context.Background(), d, ssh.Password("disposable-test-only")); e == nil {
		cl.Close()
		t.Fatal("changed host key accepted")
	}
	<-done
	if auth.Load() != 0 {
		t.Fatal("credentials submitted before host verification")
	}
}
func TestNativePKIAndMissingKeyRefusal(t *testing.T) {
	c := &Controller{dir: t.TempDir()}
	if e := c.identity(); e != nil {
		t.Fatal(e)
	}
	cert, key, e := c.issue("controller", []string{"10.203.0.1"}, true)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = tls.X509KeyPair(cert, key); e != nil {
		t.Fatal(e)
	}
	block, _ := pem.Decode(cert)
	leaf, e := x509.ParseCertificate(block.Bytes)
	if e != nil {
		t.Fatal(e)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(c.caPEM)
	if _, e = leaf.Verify(x509.VerifyOptions{Roots: roots, DNSName: "10.203.0.1", KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}); e != nil {
		t.Fatal(e)
	}
	if time.Until(leaf.NotAfter) < 360*24*time.Hour {
		t.Fatal("short leaf lifetime")
	}
	original := string(c.caPEM)
	if e = os.Remove(filepath.Join(c.dir, "ca.key")); e != nil {
		t.Fatal(e)
	}
	if e = c.identity(); e == nil {
		t.Fatal("CA silently replaced after losing its key")
	}
	b, _ := os.ReadFile(filepath.Join(c.dir, "ca.crt"))
	if string(b) != original {
		t.Fatal("CA certificate changed")
	}
}
