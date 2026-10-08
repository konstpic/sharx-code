// Package mail sends the panel's e-mail (sign-in links, confirmations, password resets) through an SMTP server the
// administrator points it at. It uses only the standard library.
package mail

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

// Security says how the connection to the server is protected.
type Security string

// Connection modes.
const (
	StartTLS Security = "starttls" // port 587: plain connection upgraded with STARTTLS (required, not optional)
	TLS      Security = "tls"      // port 465: TLS from the first byte
	None     Security = "none"     // no encryption: only for a server on the same machine or network
)

// Config is an SMTP account.
type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string // the address mails come from
	FromName string
	Security Security
	// InsecureSkipVerify accepts any certificate. Only for a server with a self-signed certificate that the administrator
	// knows; it is off by default and shown as a warning in the UI.
	InsecureSkipVerify bool
}

// Message is one e-mail.
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

// Validate checks the account is complete enough to try.
func (c Config) Validate() error {
	if strings.TrimSpace(c.Host) == "" {
		return errors.New("the SMTP server address is required")
	}
	if c.Port < 1 || c.Port > 65535 {
		return errors.New("the SMTP port is not valid")
	}
	if _, err := mail.ParseAddress(c.From); err != nil {
		return errors.New("the sender address is not valid")
	}
	switch c.Security {
	case StartTLS, TLS, None:
	default:
		return errors.New("choose the connection security: STARTTLS, TLS or none")
	}
	return nil
}

// noCRLF refuses header injection: no value that ends up in a header may contain a line break.
func noCRLF(label, v string) error {
	if strings.ContainsAny(v, "\r\n") {
		return fmt.Errorf("%s contains a line break", label)
	}
	return nil
}

func encodeHeader(s string) string {
	for _, r := range s {
		if r > 126 {
			return "=?UTF-8?B?" + base64.StdEncoding.EncodeToString([]byte(s)) + "?="
		}
	}
	return s
}

func b64Lines(b []byte) string {
	s := base64.StdEncoding.EncodeToString(b)
	var out strings.Builder
	for len(s) > 76 {
		out.WriteString(s[:76] + "\r\n")
		s = s[76:]
	}
	out.WriteString(s + "\r\n")
	return out.String()
}

// build renders the message as RFC 5322 text (multipart/alternative when there is an HTML part).
func (c Config) build(m Message, now time.Time) ([]byte, string, error) {
	for label, v := range map[string]string{"recipient": m.To, "subject": m.Subject, "sender": c.From, "sender name": c.FromName} {
		if err := noCRLF(label, v); err != nil {
			return nil, "", err
		}
	}
	to, err := mail.ParseAddress(m.To)
	if err != nil {
		return nil, "", errors.New("the recipient address is not valid")
	}
	from := mail.Address{Name: c.FromName, Address: c.From}
	idb := make([]byte, 12)
	rand.Read(idb)
	domain := "panel.local"
	if at := strings.LastIndex(c.From, "@"); at > 0 {
		domain = c.From[at+1:]
	}
	var b strings.Builder
	h := func(k, v string) { b.WriteString(k + ": " + v + "\r\n") }
	h("From", from.String())
	h("To", to.String())
	h("Subject", encodeHeader(m.Subject))
	h("Date", now.Format(time.RFC1123Z))
	h("Message-ID", "<"+hex.EncodeToString(idb)+"@"+domain+">")
	h("MIME-Version", "1.0")
	h("Auto-Submitted", "auto-generated")
	if m.HTML == "" {
		h("Content-Type", `text/plain; charset="utf-8"`)
		h("Content-Transfer-Encoding", "base64")
		b.WriteString("\r\n" + b64Lines([]byte(m.Text)))
		return []byte(b.String()), to.Address, nil
	}
	boundary := "sharx-" + hex.EncodeToString(idb)
	h("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
	b.WriteString("\r\n")
	for _, part := range []struct{ typ, body string }{{"text/plain", m.Text}, {"text/html", m.HTML}} {
		b.WriteString("--" + boundary + "\r\n")
		b.WriteString(`Content-Type: ` + part.typ + `; charset="utf-8"` + "\r\nContent-Transfer-Encoding: base64\r\n\r\n")
		b.WriteString(b64Lines([]byte(part.body)))
	}
	b.WriteString("--" + boundary + "--\r\n")
	return []byte(b.String()), to.Address, nil
}

func (c Config) tlsConfig() *tls.Config {
	return &tls.Config{ServerName: c.Host, MinVersion: tls.VersionTLS12, InsecureSkipVerify: c.InsecureSkipVerify} //nolint:gosec // opt-in, shown as a warning
}

// plainAuth sends the credentials only over an encrypted connection (or to a loopback server), like net/smtp.PlainAuth.
func (c Config) auth() smtp.Auth {
	if c.Username == "" {
		return nil
	}
	return loginAuth{user: c.Username, pass: c.Password, host: c.Host, insecureOK: c.Security == None && isLocal(c.Host)}
}

func isLocal(h string) bool {
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// loginAuth tries PLAIN, then LOGIN (some servers, notably Microsoft 365, only offer LOGIN), never over a plain connection.
type loginAuth struct {
	user, pass, host string
	insecureOK       bool
	login            bool
}

func (a loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS && !a.insecureOK {
		return "", nil, errors.New("refusing to send the password over an unencrypted connection")
	}
	supported := map[string]bool{}
	for _, m := range server.Auth {
		supported[strings.ToUpper(m)] = true
	}
	if supported["PLAIN"] || len(supported) == 0 {
		return "PLAIN", []byte("\x00" + a.user + "\x00" + a.pass), nil
	}
	if supported["LOGIN"] {
		return "LOGIN", nil, nil
	}
	return "", nil, errors.New("the server offers neither PLAIN nor LOGIN authentication")
}

func (a loginAuth) Next(from []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch strings.ToLower(strings.TrimSpace(string(from))) {
	case "username:":
		return []byte(a.user), nil
	case "password:":
		return []byte(a.pass), nil
	}
	return nil, fmt.Errorf("unexpected server challenge %q", from)
}

// Send delivers the message. The whole exchange is bounded by ctx and by a 30 second budget.
func (c Config) Send(ctx context.Context, m Message) error {
	if err := c.Validate(); err != nil {
		return err
	}
	body, to, err := c.build(m, time.Now())
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	addr := net.JoinHostPort(c.Host, fmt.Sprint(c.Port))
	d := net.Dialer{Timeout: 10 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("cannot connect to %s: %w", addr, err)
	}
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	}
	if c.Security == TLS {
		conn = tls.Client(conn, c.tlsConfig())
	}
	cl, err := smtp.NewClient(conn, c.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("the server did not greet us: %w", err)
	}
	defer cl.Close()
	if c.Security == StartTLS {
		if ok, _ := cl.Extension("STARTTLS"); !ok {
			return errors.New("the server does not offer STARTTLS; choose another connection security")
		}
		if err := cl.StartTLS(c.tlsConfig()); err != nil {
			return fmt.Errorf("STARTTLS failed: %w", err)
		}
	}
	if a := c.auth(); a != nil {
		if err := cl.Auth(a); err != nil {
			return fmt.Errorf("the server refused the login: %w", err)
		}
	}
	if err := cl.Mail(c.From); err != nil {
		return fmt.Errorf("the server refused the sender: %w", err)
	}
	if err := cl.Rcpt(to); err != nil {
		return fmt.Errorf("the server refused the recipient: %w", err)
	}
	w, err := cl.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("the server did not accept the message: %w", err)
	}
	return cl.Quit()
}
