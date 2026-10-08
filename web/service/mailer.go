package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/mail"
)

// MailService holds the SMTP account that the panel sends sign-in e-mail through. The administrator enters the details of a
// mail server they already have; the password is sealed like a provider's client secret and never returned.
//
// A method that depends on e-mail (magic link, self-registration, password reset) can only be switched on while the account
// has been *verified*: a test message was accepted by the server with exactly these settings. Changing the account resets
// that, and switching the account off while such a method is on is refused.
type MailService struct {
	settings SettingService
}

// Mail is the shared instance.
var Mail = &MailService{}

// MailView is the account as the admin UI shows it.
type MailView struct {
	Enabled     bool   `json:"enabled"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	HasPassword bool   `json:"hasPassword"`
	From        string `json:"from"`
	FromName    string `json:"fromName"`
	Security    string `json:"security"`
	SkipVerify  bool   `json:"skipVerify"`
	VerifiedAt  int64  `json:"verifiedAt"`
	// Usable: switched on, complete and verified. Only then do the methods that need e-mail work.
	Usable bool `json:"usable"`
}

// MailInput is what the form sends. Password nil keeps the stored one.
type MailInput struct {
	Enabled    bool    `json:"enabled"`
	Host       string  `json:"host"`
	Port       int     `json:"port"`
	Username   string  `json:"username"`
	Password   *string `json:"password"`
	From       string  `json:"from"`
	FromName   string  `json:"fromName"`
	Security   string  `json:"security"`
	SkipVerify bool    `json:"skipVerify"`
}

func (m *MailService) str(k string) string { v, _ := m.settings.getString(k); return v }

// Get returns the account for the UI.
func (m *MailService) Get() MailView {
	en, _ := m.settings.getBool("smtpEnabled")
	port, _ := m.settings.getInt("smtpPort")
	skip, _ := m.settings.getBool("smtpSkipVerify")
	ver, _ := strconv.ParseInt(m.str("smtpVerifiedAt"), 10, 64)
	v := MailView{Enabled: en, Host: m.str("smtpHost"), Port: port, Username: m.str("smtpUser"), HasPassword: m.str("smtpPass") != "",
		From: m.str("smtpFrom"), FromName: m.str("smtpFromName"), Security: m.str("smtpSecurity"), SkipVerify: skip, VerifiedAt: ver}
	v.Usable = v.Enabled && v.VerifiedAt > 0 && v.Host != "" && v.From != ""
	return v
}

// Usable reports whether e-mail can be sent right now.
func (m *MailService) Usable() bool { return m.Get().Usable }

func (m *MailService) config() (mail.Config, error) {
	pass, err := authn.Open(SSO.secret(), m.str("smtpPass"))
	if err != nil {
		return mail.Config{}, err
	}
	port, _ := m.settings.getInt("smtpPort")
	skip, _ := m.settings.getBool("smtpSkipVerify")
	return mail.Config{Host: m.str("smtpHost"), Port: port, Username: m.str("smtpUser"), Password: pass, From: m.str("smtpFrom"),
		FromName: m.str("smtpFromName"), Security: mail.Security(m.str("smtpSecurity")), InsecureSkipVerify: skip}, nil
}

// Save stores the account. Any change of what the server sees clears the verification.
func (m *MailService) Save(a Actor, in MailInput) (*MailView, error) {
	before := m.Get()
	pass := m.str("smtpPass")
	if in.Password != nil {
		sealed, err := authn.Seal(SSO.secret(), *in.Password)
		if err != nil {
			return nil, err
		}
		pass = sealed
	}
	cfg := mail.Config{Host: strings.TrimSpace(in.Host), Port: in.Port, Username: strings.TrimSpace(in.Username), From: strings.TrimSpace(in.From),
		FromName: strings.TrimSpace(in.FromName), Security: mail.Security(in.Security)}
	if in.Enabled || cfg.Host != "" {
		if err := cfg.Validate(); err != nil {
			return nil, invalid("%v", err)
		}
	}
	if !in.Enabled {
		if dep := Methods.dependsOnMail(); len(dep) > 0 {
			return nil, conflict("turn off %s first: they need e-mail", strings.Join(dep, ", "))
		}
	}
	changed := before.Host != cfg.Host || before.Port != cfg.Port || before.Username != cfg.Username || before.From != cfg.From ||
		before.Security != in.Security || before.SkipVerify != in.SkipVerify || in.Password != nil
	set := map[string]string{"smtpHost": cfg.Host, "smtpPort": strconv.Itoa(cfg.Port), "smtpUser": cfg.Username, "smtpPass": pass, "smtpFrom": cfg.From,
		"smtpFromName": cfg.FromName, "smtpSecurity": in.Security, "smtpSkipVerify": strconv.FormatBool(in.SkipVerify), "smtpEnabled": strconv.FormatBool(in.Enabled)}
	if changed {
		set["smtpVerifiedAt"] = "0"
	}
	for k, v := range set {
		if err := m.settings.setString(k, v); err != nil {
			return nil, err
		}
	}
	Audit.Record(a, "mail.settings", "setting", "", "SMTP server", map[string]any{"host": before.Host, "enabled": before.Enabled},
		map[string]any{"host": cfg.Host, "port": cfg.Port, "user": cfg.Username, "from": cfg.From, "security": in.Security, "enabled": in.Enabled, "passwordSet": pass != "", "skipVerify": in.SkipVerify}, "ok", "")
	v := m.Get()
	return &v, nil
}

// SendTest sends a message to the given address with the stored account. On success the account is marked verified.
func (m *MailService) SendTest(ctx context.Context, a Actor, to string) error {
	cfg, err := m.config()
	if err != nil {
		return err
	}
	if err := cfg.Send(ctx, mail.Message{To: to, Subject: "SharX Panel: test message",
		Text: "This is a test message from your SharX panel.\r\nIf you can read it, e-mail sign-in methods can be switched on.\r\n"}); err != nil {
		Audit.Record(a, "mail.test", "setting", "", "SMTP server", nil, map[string]any{"to": to}, "denied", err.Error())
		return err
	}
	_ = m.settings.setString("smtpVerifiedAt", strconv.FormatInt(time.Now().Unix(), 10))
	Audit.Record(a, "mail.test", "setting", "", "SMTP server", nil, map[string]any{"to": to}, "ok", "")
	return nil
}

// Send sends a message through the verified account.
func (m *MailService) Send(ctx context.Context, to, subject, text, html string) error {
	if !m.Usable() {
		return fmt.Errorf("e-mail is not set up")
	}
	cfg, err := m.config()
	if err != nil {
		return err
	}
	return cfg.Send(ctx, mail.Message{To: to, Subject: subject, Text: text, HTML: html})
}
