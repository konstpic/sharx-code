// Package mailtest is a tiny SMTP server for tests: it accepts messages, keeps them, and can require a login or speak TLS.
package mailtest

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"fmt"
	"math/big"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// Message is what the server received.
type Message struct {
	From, To string
	Data     string
}

// Server is the fake SMTP server.
type Server struct {
	Addr     string
	Host     string
	Port     int
	User     string // when set, AUTH PLAIN with these credentials is required
	Pass     string
	StartTLS bool // offers STARTTLS
	Implicit bool // TLS from the first byte

	mu   sync.Mutex
	msgs []Message
	ln   net.Listener
	cfg  *tls.Config
}

func cert() tls.Certificate {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "localhost"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, _ := x509.CreateCertificate(rand.Reader, tpl, tpl, &k.PublicKey, k)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: k}
}

// New starts a server on a free loopback port.
func New(t *testing.T, mutate func(*Server)) *Server {
	t.Helper()
	s := &Server{}
	if mutate != nil {
		mutate(s)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s.ln = ln
	s.Addr = ln.Addr().String()
	host, port, _ := net.SplitHostPort(s.Addr)
	s.Host = host
	fmt.Sscan(port, &s.Port)
	s.cfg = &tls.Config{Certificates: []tls.Certificate{cert()}}
	go s.serve()
	t.Cleanup(func() { ln.Close() })
	return s
}

// Messages returns what arrived so far.
func (s *Server) Messages() []Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Message(nil), s.msgs...)
}

// Wait blocks until n messages have arrived (messages are sent in the background by the panel).
func (s *Server) Wait(t *testing.T, n int) []Message {
	t.Helper()
	for i := 0; i < 200; i++ {
		if m := s.Messages(); len(m) >= n {
			return m
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("expected %d message(s), got %d", n, len(s.Messages()))
	return nil
}

func (s *Server) serve() {
	for {
		c, err := s.ln.Accept()
		if err != nil {
			return
		}
		go s.handle(c)
	}
}

func (s *Server) handle(c net.Conn) {
	defer c.Close()
	if s.Implicit {
		c = tls.Server(c, s.cfg)
	}
	r := bufio.NewReader(c)
	w := func(f string, a ...any) { fmt.Fprintf(c, f+"\r\n", a...) }
	w("220 mailtest ready")
	authed := s.User == ""
	tlsOn := s.Implicit
	var from, to string
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		up := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(up, "EHLO"), strings.HasPrefix(up, "HELO"):
			w("250-mailtest")
			if s.StartTLS && !tlsOn {
				w("250-STARTTLS")
			}
			if s.User != "" {
				w("250-AUTH PLAIN LOGIN")
			}
			w("250 OK")
		case up == "STARTTLS":
			w("220 go ahead")
			c = tls.Server(c, s.cfg)
			r = bufio.NewReader(c)
			w = func(f string, a ...any) { fmt.Fprintf(c, f+"\r\n", a...) }
			tlsOn = true
		case strings.HasPrefix(up, "AUTH PLAIN"):
			raw, _ := base64.StdEncoding.DecodeString(strings.TrimSpace(line[10:]))
			parts := strings.Split(string(raw), "\x00")
			if len(parts) == 3 && parts[1] == s.User && parts[2] == s.Pass {
				authed = true
				w("235 ok")
			} else {
				w("535 bad credentials")
			}
		case strings.HasPrefix(up, "MAIL FROM:"):
			if !authed {
				w("530 authentication required")
				continue
			}
			from = strings.Trim(line[10:], "<> ")
			w("250 ok")
		case strings.HasPrefix(up, "RCPT TO:"):
			to = strings.Trim(line[8:], "<> ")
			w("250 ok")
		case up == "DATA":
			w("354 go")
			var b strings.Builder
			for {
				l, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if l == ".\r\n" {
					break
				}
				b.WriteString(l)
			}
			s.mu.Lock()
			s.msgs = append(s.msgs, Message{From: from, To: to, Data: b.String()})
			s.mu.Unlock()
			w("250 queued")
		case up == "QUIT":
			w("221 bye")
			return
		default:
			w("250 ok")
		}
	}
}
