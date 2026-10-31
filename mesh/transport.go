package mesh

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"github.com/konstpic/sharx-code/v2/mesh/agent"
	"github.com/konstpic/sharx-code/v2/mesh/protocol"
	"golang.org/x/crypto/ssh"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Enrolled struct {
	Host        string `json:"host"`
	User        string `json:"user"`
	Sudo        bool   `json:"sudo"`
	Role        string `json:"role"`
	Overlay     string `json:"overlay"`
	Slot        *int   `json:"slot"`
	Node        string `json:"rw_node"`
	Fingerprint string `json:"fingerprint"`
	SSHPort     int    `json:"ssh_port"`
	KeyType     string `json:"key_type"`
	Pubkey      string `json:"pubkey"`
}

func readJSON(path string, out any) error {
	b, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	return json.Unmarshal(b, out)
}
func loadOptional(path string, out any) error {
	e := readJSON(path, out)
	if os.IsNotExist(e) {
		return nil
	}
	return e
}
func quote(s string) string                   { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }
func privateFile(path string, b []byte) error { return agent.Write(path, b, 0600) }
func (c *Controller) identity() error {
	path := filepath.Join(c.dir, "id_ed25519")
	b, e := os.ReadFile(path)
	if os.IsNotExist(e) {
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return err
		}
		raw, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			return err
		}
		b = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: raw})
		e = privateFile(path, b)
	}
	if e != nil {
		return e
	}
	c.signer, e = ssh.ParsePrivateKey(b)
	if e != nil {
		return errors.New("mesh SSH identity is unreadable")
	}
	caFile, keyFile := filepath.Join(c.dir, "ca.crt"), filepath.Join(c.dir, "ca.key")
	ca, e := os.ReadFile(caFile)
	if os.IsNotExist(e) {
		if _, err := os.Stat(keyFile); err == nil {
			return errors.New("mesh CA certificate missing; refusing replacement")
		}
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return err
		}
		serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
		tpl := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "SharX mesh CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().AddDate(10, 0, 0), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign}
		raw, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
		if err != nil {
			return err
		}
		kb, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			return err
		}
		if err = privateFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: kb})); err != nil {
			return err
		}
		ca = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: raw})
		e = privateFile(caFile, ca)
	}
	if e != nil {
		return e
	}
	b, e = os.ReadFile(keyFile)
	if e != nil {
		return errors.New("mesh CA private key missing; refusing replacement")
	}
	block, _ := pem.Decode(ca)
	if block == nil {
		return errors.New("invalid mesh CA")
	}
	c.ca, e = x509.ParseCertificate(block.Bytes)
	if e != nil {
		return e
	}
	block, _ = pem.Decode(b)
	if block == nil {
		return errors.New("invalid mesh CA key")
	}
	c.caKey, e = x509.ParsePKCS8PrivateKey(block.Bytes)
	if e != nil && block.Type == "EC PRIVATE KEY" {
		c.caKey, e = x509.ParseECPrivateKey(block.Bytes)
	}
	if e != nil {
		return errors.New("invalid mesh CA key")
	}
	c.caPEM = ca
	return nil
}
func (c *Controller) issue(name string, hosts []string, server bool) ([]byte, []byte, error) {
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		return nil, nil, e
	}
	serial, e := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if e != nil {
		return nil, nil, e
	}
	tpl := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: name}, NotBefore: time.Now().Add(-5 * time.Minute), NotAfter: time.Now().AddDate(1, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	if server {
		tpl.ExtKeyUsage = append(tpl.ExtKeyUsage, x509.ExtKeyUsageServerAuth)
	}
	for _, h := range hosts {
		if ip := net.ParseIP(h); ip != nil {
			tpl.IPAddresses = append(tpl.IPAddresses, ip)
		} else {
			tpl.DNSNames = append(tpl.DNSNames, h)
		}
	}
	raw, e := x509.CreateCertificate(rand.Reader, tpl, c.ca, &key.PublicKey, c.caKey)
	if e != nil {
		return nil, nil, e
	}
	kb, e := x509.MarshalPKCS8PrivateKey(key)
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: raw}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: kb}), e
}
func sshDial(ctx context.Context, d Enrolled, auth ssh.AuthMethod) (*ssh.Client, error) {
	port := d.SSHPort
	if port == 0 {
		port = 22
	}
	cfg := &ssh.ClientConfig{User: d.User, Auth: []ssh.AuthMethod{auth}, Timeout: 12 * time.Second, HostKeyCallback: func(_ string, _ net.Addr, k ssh.PublicKey) error {
		if ssh.FingerprintSHA256(k) != d.Fingerprint || k.Type() != d.KeyType {
			return errors.New("SSH host key mismatch")
		}
		return nil
	}}
	switch d.KeyType {
	case ssh.KeyAlgoRSA:
		cfg.HostKeyAlgorithms = []string{ssh.KeyAlgoRSASHA512, ssh.KeyAlgoRSASHA256}
	default:
		cfg.HostKeyAlgorithms = []string{d.KeyType}
	}
	address := net.JoinHostPort(d.Host, strconv.Itoa(port))
	conn, e := (&net.Dialer{Timeout: 12 * time.Second}).DialContext(ctx, "tcp", address)
	if e != nil {
		return nil, errors.New("SSH connection unavailable")
	}
	conn.SetDeadline(time.Now().Add(15 * time.Second))
	cc, ch, req, e := ssh.NewClientConn(conn, address, cfg)
	if e != nil {
		conn.Close()
		return nil, errors.New("SSH authentication or confirmed host key failed")
	}
	conn.SetDeadline(time.Time{})
	return ssh.NewClient(cc, ch, req), nil
}
func (c *Controller) connect(d Enrolled) (*ssh.Client, error) {
	return sshDial(c.ctx, d, ssh.PublicKeys(c.signer))
}
func runSSH(ctx context.Context, cl *ssh.Client, d Enrolled, cmd string, input []byte) ([]byte, error) {
	s, e := cl.NewSession()
	if e != nil {
		return nil, errors.New("SSH session unavailable")
	}
	defer s.Close()
	var out bytes.Buffer
	s.Stdout = &limitedWriter{w: &out, left: 4 << 20}
	s.Stderr = io.Discard
	if input != nil {
		s.Stdin = bytes.NewReader(input)
	}
	if d.Sudo {
		cmd = "sudo -n bash -c " + quote(cmd)
	} else {
		cmd = "bash -c " + quote(cmd)
	}
	done := make(chan error, 1)
	go func() { done <- s.Run(cmd) }()
	select {
	case e = <-done:
		if e != nil {
			var exit *ssh.ExitError
			if errors.As(e, &exit) {
				return nil, fmt.Errorf("remote operation failed (exit %d)", exit.ExitStatus())
			}
			return nil, errors.New("SSH operation incomplete")
		}
		return out.Bytes(), nil
	case <-ctx.Done():
		s.Close()
		cl.Close()
		<-done
		return nil, ctx.Err()
	}
}

type limitedWriter struct {
	w    io.Writer
	left int
}

func (w *limitedWriter) Write(b []byte) (int, error) {
	n := len(b)
	if w.left > 0 {
		k := min(w.left, n)
		_, e := w.w.Write(b[:k])
		w.left -= k
		if e != nil {
			return 0, e
		}
	}
	return n, nil
}
func (c *Controller) remote(name, cmd string, input []byte, timeout time.Duration) ([]byte, error) {
	d, ok := c.enrolled[name]
	if !ok {
		return nil, errors.New("unknown enrolled node")
	}
	cl, e := c.connect(d)
	if e != nil {
		return nil, e
	}
	defer cl.Close()
	ctx, cancel := context.WithTimeout(c.ctx, timeout)
	defer cancel()
	return runSSH(ctx, cl, d, cmd, input)
}
func (c *Controller) put(name, path string, b []byte, mode string) error {
	_, e := c.remote(name, "umask 077; mkdir -p "+quote(filepath.Dir(path))+" && cat > "+quote(path+".tmp")+" && chmod "+mode+" "+quote(path+".tmp")+" && mv -f "+quote(path+".tmp")+" "+quote(path), b, 120*time.Second)
	return e
}
func (c *Controller) store() (*protocol.Store, error) {
	if len(c.members) == 0 {
		return nil, errors.New("etcd не установлен")
	}
	cert, key, e := c.issue("sharx-mesh-controller", nil, false)
	if e != nil {
		return nil, e
	}
	pair, e := tls.X509KeyPair(cert, key)
	if e != nil {
		return nil, e
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(c.caPEM)
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, Certificates: []tls.Certificate{pair}, MinVersion: tls.VersionTLS12}}
	endpoints := []string{}
	memberByOverlay := map[string]string{}
	for _, m := range c.members {
		endpoints = append(endpoints, m.ClientURL)
		memberByOverlay[m.Overlay] = m.Name
	}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, _, e := net.SplitHostPort(address)
		if e != nil {
			return nil, e
		}
		name, ok := memberByOverlay[host]
		if !ok {
			return nil, errors.New("unregistered etcd endpoint")
		}
		d, ok := c.enrolled[name]
		if !ok {
			return nil, errors.New("etcd member not enrolled")
		}
		cl, e := sshDial(ctx, d, ssh.PublicKeys(c.signer))
		if e != nil {
			return nil, e
		}
		conn, e := cl.DialContext(ctx, network, address)
		if e != nil {
			cl.Close()
			return nil, errors.New("etcd SSH tunnel failed")
		}
		return &tunnel{Conn: conn, ssh: cl}, nil
	}
	return &protocol.Store{Endpoints: endpoints, Client: &http.Client{Transport: transport, Timeout: 8 * time.Second}}, nil
}

type tunnel struct {
	net.Conn
	ssh *ssh.Client
}

func (t *tunnel) Close() error { e := t.Conn.Close(); t.ssh.Close(); return e }
