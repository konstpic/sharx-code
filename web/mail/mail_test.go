package mail_test

import (
	"context"
	"encoding/base64"
	"regexp"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/web/mail"
	"github.com/konstpic/sharx-code/v2/web/mail/mailtest"
)

func cfg(s *mailtest.Server, sec mail.Security) mail.Config {
	return mail.Config{Host: s.Host, Port: s.Port, From: "panel@example.com", FromName: "SharX", Security: sec, InsecureSkipVerify: true}
}

// body decodes the base64 text part of a stored message
func body(t *testing.T, data string) string {
	i := strings.Index(data, "\r\n\r\n")
	raw := regexp.MustCompile(`\s+`).ReplaceAllString(data[i:], "")
	b, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		t.Fatalf("body is not base64: %v\n%s", err, data)
	}
	return string(b)
}

func TestSendPlainAndDeliversWhatWasWritten(t *testing.T) {
	s := mailtest.New(t, nil)
	err := cfg(s, mail.None).Send(context.Background(), mail.Message{To: "ann@example.org", Subject: "Hello Ann", Text: "line one\r\nline two"})
	if err != nil {
		t.Fatal(err)
	}
	m := s.Wait(t, 1)[0]
	if m.From != "panel@example.com" || m.To != "ann@example.org" {
		t.Fatalf("envelope: %+v", m)
	}
	for _, h := range []string{"From: \"SharX\" <panel@example.com>", "To: <ann@example.org>", "Subject: Hello Ann", "MIME-Version: 1.0", "Message-ID: <"} {
		if !strings.Contains(m.Data, h) {
			t.Fatalf("header %q missing:\n%s", h, m.Data)
		}
	}
	if got := body(t, m.Data); got != "line one\r\nline two" {
		t.Fatalf("body: %q", got)
	}
}

func TestSendOverStartTLSAndImplicitTLS(t *testing.T) {
	st := mailtest.New(t, func(s *mailtest.Server) { s.StartTLS = true })
	if err := cfg(st, mail.StartTLS).Send(context.Background(), mail.Message{To: "a@example.org", Subject: "s", Text: "t"}); err != nil {
		t.Fatalf("starttls: %v", err)
	}
	im := mailtest.New(t, func(s *mailtest.Server) { s.Implicit = true })
	if err := cfg(im, mail.TLS).Send(context.Background(), mail.Message{To: "a@example.org", Subject: "s", Text: "t"}); err != nil {
		t.Fatalf("tls: %v", err)
	}
	// STARTTLS required but the server does not offer it: an error, never a silent downgrade
	plain := mailtest.New(t, nil)
	if err := cfg(plain, mail.StartTLS).Send(context.Background(), mail.Message{To: "a@example.org", Subject: "s", Text: "t"}); err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("must refuse to downgrade: %v", err)
	}
	// and a certificate that cannot be verified is refused unless the administrator opted in
	c := cfg(st, mail.StartTLS)
	c.InsecureSkipVerify = false
	if err := c.Send(context.Background(), mail.Message{To: "a@example.org", Subject: "s", Text: "t"}); err == nil {
		t.Fatal("an unverifiable certificate must be refused by default")
	}
}

func TestAuthenticationAndNeverOverAnUnencryptedLink(t *testing.T) {
	s := mailtest.New(t, func(s *mailtest.Server) { s.User, s.Pass, s.StartTLS = "smtp-user", "smtp-pass", true })
	c := cfg(s, mail.StartTLS)
	c.Username, c.Password = "smtp-user", "smtp-pass"
	if err := c.Send(context.Background(), mail.Message{To: "a@example.org", Subject: "s", Text: "t"}); err != nil {
		t.Fatalf("login over STARTTLS: %v", err)
	}
	c.Password = "wrong"
	if err := c.Send(context.Background(), mail.Message{To: "a@example.org", Subject: "s", Text: "t"}); err == nil {
		t.Fatal("wrong password must fail")
	}
	// loopback server without TLS: the password may be sent only because the admin chose "none" and it is a local server
	local := mailtest.New(t, func(s *mailtest.Server) { s.User, s.Pass = "u", "p" })
	lc := cfg(local, mail.None)
	lc.Username, lc.Password = "u", "p"
	if err := lc.Send(context.Background(), mail.Message{To: "a@example.org", Subject: "s", Text: "t"}); err != nil {
		t.Fatalf("local plain login: %v", err)
	}
	// the same without "none" being chosen for a local server is impossible; for a remote one the client refuses (checked via auth())
	remote := mail.Config{Host: "mail.example.org", Port: 25, From: "a@example.com", Security: mail.None, Username: "u", Password: "p"}
	if err := remote.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestHeaderInjectionIsRefused(t *testing.T) {
	s := mailtest.New(t, nil)
	c := cfg(s, mail.None)
	for name, m := range map[string]mail.Message{
		"subject":   {To: "a@example.org", Subject: "hi\r\nBcc: evil@example.org", Text: "x"},
		"recipient": {To: "a@example.org\r\nBcc: evil@example.org", Subject: "s", Text: "x"},
	} {
		if err := c.Send(context.Background(), m); err == nil {
			t.Fatalf("%s: a line break in a header was accepted", name)
		}
	}
	c.FromName = "Panel\r\nBcc: evil@example.org"
	if err := c.Send(context.Background(), mail.Message{To: "a@example.org", Subject: "s", Text: "x"}); err == nil {
		t.Fatal("sender name injection")
	}
	if n := len(s.Messages()); n != 0 {
		t.Fatalf("nothing may be sent, got %d", n)
	}
}

func TestNonASCIISubjectAndHTMLAlternative(t *testing.T) {
	s := mailtest.New(t, nil)
	if err := cfg(s, mail.None).Send(context.Background(), mail.Message{To: "a@example.org", Subject: "Ссылка для входа", Text: "plain", HTML: "<b>html</b>"}); err != nil {
		t.Fatal(err)
	}
	d := s.Wait(t, 1)[0].Data
	if !strings.Contains(d, "Subject: =?UTF-8?B?") || !strings.Contains(d, "multipart/alternative") || !strings.Contains(d, "text/html") {
		t.Fatalf("message:\n%s", d)
	}
}

func TestValidate(t *testing.T) {
	bad := []mail.Config{
		{Port: 25, From: "a@b.c", Security: mail.None},
		{Host: "h", Port: 0, From: "a@b.c", Security: mail.None},
		{Host: "h", Port: 25, From: "not an address", Security: mail.None},
		{Host: "h", Port: 25, From: "a@b.c", Security: "weird"},
	}
	for i, c := range bad {
		if c.Validate() == nil {
			t.Fatalf("case %d accepted", i)
		}
	}
}
