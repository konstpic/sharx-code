package service

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/rbac"
)

// AuthMethodsService holds which ways of signing in are open, and the MFA policy. Methods that need e-mail can be switched on
// only while a verified SMTP account exists (see MailService), and the check is made here, on the server, not only in the UI.
type AuthMethodsService struct {
	settings SettingService
}

// Methods is the shared instance.
var Methods = &AuthMethodsService{}

// MethodsConfig is the stored configuration.
type MethodsConfig struct {
	MagicLink     bool     `json:"magicLink"`
	Signup        bool     `json:"signup"`
	SignupRoleId  int      `json:"signupRoleId"`
	SignupDomains []string `json:"signupDomains"`
	PasswordReset bool     `json:"passwordReset"`
	// EmailLogin lets people type their e-mail address instead of the username (when it identifies exactly one account).
	EmailLogin bool `json:"emailLogin"`
	Passkeys   bool `json:"passkeys"`
	// MfaPolicy: off | admins | all. A role or a user can require MFA on their own as well.
	MfaPolicy string `json:"mfaPolicy"`
	// SsoCountsAsMfa: a sign-in through an identity provider satisfies the policy (the provider does the MFA).
	SsoCountsAsMfa bool `json:"ssoCountsAsMfa"`
	// RpId / Origins pin the WebAuthn relying party when the panel is behind a proxy; empty = derived from the request.
	RpId    string   `json:"rpId"`
	Origins []string `json:"origins"`
	// PublicUrl is the address the panel is reached at, with its secret path, as people use it ("https://panel.example.com:2053/x7k2/").
	// Links in e-mail are built from it and from nothing else: the Host header of a request is attacker-controlled, and a
	// reset link pointing at somebody else's server would hand them the token.
	PublicUrl string `json:"publicUrl"`
}

// MethodsView adds what the UI needs to explain the dependencies.
type MethodsView struct {
	MethodsConfig
	Mail MailView `json:"mail"`
	// NeedsMail lists the methods that cannot work without a verified SMTP account, so the UI can warn about each.
	NeedsMail []string `json:"needsMail"`
	// Blocked lists methods that are switched on but not working because the e-mail account is not verified.
	Blocked []string `json:"blocked"`
}

// needsMail names the methods that depend on e-mail.
var needsMail = []string{"magicLink", "signup", "passwordReset"}

func (m *AuthMethodsService) cfg() MethodsConfig {
	b := func(k string) bool { v, _ := m.settings.getBool(k); return v }
	id, _ := m.settings.getInt("authSignupRoleId")
	c := MethodsConfig{MagicLink: b("authMagicLink"), Signup: b("authSignup"), SignupRoleId: id, PasswordReset: b("authPasswordReset"),
		EmailLogin: b("authEmailLogin"), Passkeys: b("authPasskeys"), SsoCountsAsMfa: b("authSsoCountsAsMfa")}
	c.SignupDomains = decodeList(m.str("authSignupDomains"))
	c.Origins = decodeList(m.str("authWebauthnOrigins"))
	c.MfaPolicy = m.str("authMfaPolicy")
	if c.MfaPolicy != "admins" && c.MfaPolicy != "all" {
		c.MfaPolicy = "off"
	}
	c.RpId = m.str("authRpId")
	c.PublicUrl = m.str("authPublicUrl")
	return c
}

func (m *AuthMethodsService) str(k string) string { v, _ := m.settings.getString(k); return v }

// Config returns the stored configuration.
func (m *AuthMethodsService) Config() MethodsConfig { return m.cfg() }

// Effective is what actually works right now: a method that needs e-mail counts only while the SMTP account is verified.
func (m *AuthMethodsService) Effective() MethodsConfig {
	c := m.cfg()
	if !Mail.Usable() {
		c.MagicLink, c.Signup, c.PasswordReset = false, false, false
	}
	return c
}

func (m *AuthMethodsService) dependsOnMail() []string {
	c := m.cfg()
	var out []string
	if c.MagicLink {
		out = append(out, "magic link")
	}
	if c.Signup {
		out = append(out, "self-registration")
	}
	if c.PasswordReset {
		out = append(out, "password reset")
	}
	return out
}

// View returns the configuration for the admin UI.
func (m *AuthMethodsService) View() MethodsView {
	c := m.cfg()
	v := MethodsView{MethodsConfig: c, Mail: Mail.Get(), NeedsMail: needsMail}
	if !v.Mail.Usable {
		for name, on := range map[string]bool{"magicLink": c.MagicLink, "signup": c.Signup, "passwordReset": c.PasswordReset} {
			if on {
				v.Blocked = append(v.Blocked, name)
			}
		}
	}
	return v
}

// Public is what the login page may learn: which methods to offer. Nothing else about the configuration.
type PublicMethods struct {
	MagicLink     bool `json:"magicLink"`
	Signup        bool `json:"signup"`
	PasswordReset bool `json:"passwordReset"`
	Passkeys      bool `json:"passkeys"`
	EmailLogin    bool `json:"emailLogin"`
}

// Public returns the methods to offer on the login page.
func (m *AuthMethodsService) Public() PublicMethods {
	c := m.Effective()
	return PublicMethods{MagicLink: c.MagicLink, Signup: c.Signup, PasswordReset: c.PasswordReset, Passkeys: c.Passkeys, EmailLogin: c.EmailLogin}
}

// Save validates and stores the configuration.
func (m *AuthMethodsService) Save(a Actor, in MethodsConfig) (*MethodsView, error) {
	before := m.cfg()
	switch in.MfaPolicy {
	case "off", "admins", "all":
	default:
		return nil, invalid("the MFA policy must be off, admins or all")
	}
	// a policy must not lock out the person who sets it: they would be left with the enrolment pages only
	if a.Principal != nil && in.MfaPolicy != before.MfaPolicy && !a.Principal.MFAEnrolled && in.MfaPolicy != "off" {
		if in.MfaPolicy == "all" || (in.MfaPolicy == "admins" && a.Principal.Super) {
			return nil, conflict("set up your own two-factor authentication first (Settings -> Security): this policy would apply to you")
		}
	}
	if !Mail.Usable() {
		var need []string
		if in.MagicLink && !before.MagicLink {
			need = append(need, "magic link")
		}
		if in.Signup && !before.Signup {
			need = append(need, "self-registration")
		}
		if in.PasswordReset && !before.PasswordReset {
			need = append(need, "password reset")
		}
		if len(need) > 0 {
			return nil, conflict("%s needs an SMTP server: set it up and send a test message first (Sign-in methods -> E-mail)", strings.Join(need, ", "))
		}
	}
	in.PublicUrl = strings.TrimSpace(in.PublicUrl)
	if in.PublicUrl != "" {
		if err := allowedURL(in.PublicUrl); err != nil {
			return nil, invalid("the public address: %v", err)
		}
		if !strings.HasSuffix(in.PublicUrl, "/") {
			in.PublicUrl += "/"
		}
	}
	if (in.MagicLink || in.Signup || in.PasswordReset) && in.PublicUrl == "" {
		return nil, invalid("set the public address of the panel: links in e-mail are built from it")
	}
	if in.Signup {
		var r model.Role
		if err := database.GetDB().First(&r, in.SignupRoleId).Error; err != nil {
			return nil, invalid("choose the role that new accounts get")
		}
		// self-registration must never be a way to an administrator or to anything only administrators may hold
		set := rbacSet(r)
		if set.IsSuper() {
			return nil, invalid("the administrator role cannot be given to people who register themselves")
		}
		for _, k := range set.List() {
			if rbac.IsSuperOnly(k) {
				return nil, invalid("the role %q holds %s, which only administrators may have", r.Name, k)
			}
		}
	}
	for _, o := range in.Origins {
		if !strings.HasPrefix(o, "https://") && !strings.HasPrefix(o, "http://localhost") {
			return nil, invalid("a WebAuthn origin must start with https://")
		}
	}
	doms, _ := json.Marshal(decodeListClean(in.SignupDomains))
	orgs, _ := json.Marshal(in.Origins)
	set := map[string]string{
		"authMagicLink": strconv.FormatBool(in.MagicLink), "authSignup": strconv.FormatBool(in.Signup), "authSignupRoleId": strconv.Itoa(in.SignupRoleId),
		"authSignupDomains": string(doms), "authPasswordReset": strconv.FormatBool(in.PasswordReset), "authEmailLogin": strconv.FormatBool(in.EmailLogin),
		"authPasskeys": strconv.FormatBool(in.Passkeys), "authMfaPolicy": in.MfaPolicy, "authSsoCountsAsMfa": strconv.FormatBool(in.SsoCountsAsMfa),
		"authRpId": strings.TrimSpace(in.RpId), "authPublicUrl": in.PublicUrl, "authWebauthnOrigins": string(orgs),
	}
	for k, v := range set {
		if err := m.settings.setString(k, v); err != nil {
			return nil, err
		}
	}
	InvalidateRBAC() // the MFA policy is part of what a principal looks like
	Audit.Record(a, "auth.methods", "setting", "", "sign-in methods", before, m.cfg(), "ok", "")
	v := m.View()
	return &v, nil
}

func decodeListClean(in []string) []string {
	var out []string
	for _, v := range in {
		if v = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(v, "@"))); v != "" {
			out = append(out, v)
		}
	}
	if out == nil {
		out = []string{}
	}
	return out
}

func rbacSet(r model.Role) rbac.Set { return rbac.NewSet(parsePerms(r.Permissions)) }

var _ = fmt.Sprint
