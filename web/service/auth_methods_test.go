package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/authn/authntest"
	"github.com/konstpic/sharx-code/v2/web/mail/mailtest"
	"github.com/konstpic/sharx-code/v2/web/rbac"
)

type methodsEnv struct {
	*rbacEnv
	smtp *mailtest.Server
}

func newMethodsEnv(t *testing.T) *methodsEnv {
	e := &methodsEnv{rbacEnv: setupRBAC(t)}
	e.smtp = mailtest.New(t, nil)
	return e
}

func (e *methodsEnv) mailOn() {
	e.t.Helper()
	if _, err := Mail.Save(e.admin, MailInput{Enabled: true, Host: e.smtp.Host, Port: e.smtp.Port, From: "panel@example.com", FromName: "SharX", Security: "none"}); err != nil {
		e.t.Fatal(err)
	}
	if err := Mail.SendTest(context.Background(), e.admin, "admin@example.org"); err != nil {
		e.t.Fatal(err)
	}
}

func (e *methodsEnv) methods(mut func(c *MethodsConfig)) {
	e.t.Helper()
	c := Methods.Config()
	c.PublicUrl = "https://panel.example.com:2053/base/"
	if mut != nil {
		mut(&c)
	}
	if _, err := Methods.Save(e.admin, c); err != nil {
		e.t.Fatal(err)
	}
}

var linkRe = regexp.MustCompile(`https://panel\.example\.com:2053/base/\?(magic|confirm|reset)=([A-Za-z0-9_%-]+)`)

// lastLink pulls the link out of the newest message and decodes what was sent.
func lastLink(t *testing.T, s *mailtest.Server, n int) (kind, token string) {
	t.Helper()
	m := s.Wait(t, n)[n-1]
	i := strings.Index(m.Data, "\r\n\r\n")
	raw := regexp.MustCompile(`\s+`).ReplaceAllString(m.Data[i:], "")
	b, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		t.Fatalf("%v\n%s", err, m.Data)
	}
	mm := linkRe.FindStringSubmatch(string(b))
	if mm == nil {
		t.Fatalf("no link in: %s", b)
	}
	return mm[1], mm[2]
}

func TestEmailMethodsNeedAVerifiedMailAccount(t *testing.T) {
	e := newMethodsEnv(t)
	// no SMTP at all
	c := Methods.Config()
	c.MagicLink, c.PublicUrl = true, "https://panel.example.com/"
	_, err := Methods.Save(e.admin, c)
	wantErr(t, err, ErrConflict, "magic link without SMTP")
	if !strings.Contains(err.Error(), "SMTP") {
		t.Fatalf("the message must say what is needed: %v", err)
	}
	// an account that was saved but never verified is not enough
	if _, err := Mail.Save(e.admin, MailInput{Enabled: true, Host: e.smtp.Host, Port: e.smtp.Port, From: "panel@example.com", Security: "none"}); err != nil {
		t.Fatal(err)
	}
	if _, err := Methods.Save(e.admin, c); !errorsIs(err, ErrConflict) {
		t.Fatalf("an unverified account must not be enough: %v", err)
	}
	if err := Mail.SendTest(context.Background(), e.admin, "admin@example.org"); err != nil {
		t.Fatal(err)
	}
	if _, err := Methods.Save(e.admin, c); err != nil {
		t.Fatalf("verified: %v", err)
	}
	if !Methods.Effective().MagicLink || !Methods.Public().MagicLink {
		t.Fatal("effective once verified")
	}
	// changing the server forgets the verification and the method stops being offered, but stays configured
	if _, err := Mail.Save(e.admin, MailInput{Enabled: true, Host: "127.0.0.1", Port: e.smtp.Port + 1, From: "panel@example.com", Security: "none"}); err != nil {
		t.Fatal(err)
	}
	if Methods.Effective().MagicLink || Methods.Public().MagicLink {
		t.Fatal("an unverified account must switch the e-mail methods off in effect")
	}
	v := Methods.View()
	if len(v.Blocked) != 1 || v.Blocked[0] != "magicLink" || len(v.NeedsMail) != 3 {
		t.Fatalf("the UI is told what is blocked and why: %+v", v)
	}
	// the account cannot be switched off while a method depends on it
	if _, err := Mail.Save(e.admin, MailInput{Enabled: false, Host: "127.0.0.1", Port: e.smtp.Port + 1, From: "panel@example.com", Security: "none"}); !errorsIs(err, ErrConflict) {
		t.Fatalf("switching the account off under a method: %v", err)
	}
}

func errorsIs(err, target error) bool { return err != nil && strings.Contains(err.Error(), "") && isErr(err, target) }

func isErr(err, target error) bool {
	type is interface{ Is(error) bool }
	for e := err; e != nil; {
		if e == target {
			return true
		}
		if i, ok := e.(is); ok && i.Is(target) {
			return true
		}
		u, ok := e.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		e = u.Unwrap()
	}
	return false
}

func TestMailPasswordIsSealedAndNeverLeaks(t *testing.T) {
	e := newMethodsEnv(t)
	pw := "smtp-secret-pw"
	if _, err := Mail.Save(e.admin, MailInput{Enabled: true, Host: e.smtp.Host, Port: e.smtp.Port, Username: "u", Password: &pw, From: "panel@example.com", Security: "none"}); err != nil {
		t.Fatal(err)
	}
	var stored string
	database.GetDB().Raw("SELECT value FROM settings WHERE key = 'smtpPass'").Scan(&stored)
	if !strings.HasPrefix(stored, "enc:v1:") || strings.Contains(stored, pw) {
		t.Fatalf("stored: %q", stored)
	}
	b, _ := json.Marshal(Mail.Get())
	if strings.Contains(string(b), pw) || !Mail.Get().HasPassword {
		t.Fatalf("view: %s", b)
	}
	var detail string
	database.GetDB().Raw("SELECT after_state FROM audit_log WHERE action = 'mail.settings' ORDER BY id DESC LIMIT 1").Scan(&detail)
	if strings.Contains(detail, pw) {
		t.Fatalf("the audit trail must not hold the password: %s", detail)
	}
}

func TestMethodsConfigurationIsValidated(t *testing.T) {
	e := newMethodsEnv(t)
	e.mailOn()
	var adminRole model.Role
	database.GetDB().Where("system_key = 'administrator'").First(&adminRole)
	base := func() MethodsConfig { c := Methods.Config(); c.PublicUrl = "https://panel.example.com/"; return c }

	c := base()
	c.Signup, c.SignupRoleId = true, adminRole.Id
	if _, err := Methods.Save(e.admin, c); !errorsIs(err, ErrInvalid) {
		t.Fatalf("self-registration must never hand out the administrator role: %v", err)
	}
	sec := e.role(rbac.ClientsRead, rbac.SettingsSecurity)
	c.SignupRoleId = sec.Id
	if _, err := Methods.Save(e.admin, c); !errorsIs(err, ErrInvalid) {
		t.Fatalf("nor a role holding an administrators-only permission: %v", err)
	}
	c = base()
	c.MagicLink, c.PublicUrl = true, ""
	if _, err := Methods.Save(e.admin, c); !errorsIs(err, ErrInvalid) {
		t.Fatalf("links in e-mail need a configured public address: %v", err)
	}
	c = base()
	c.PublicUrl = "http://panel.example.com/"
	c.MagicLink = true
	if _, err := Methods.Save(e.admin, c); !errorsIs(err, ErrInvalid) {
		t.Fatalf("plain http for the public address: %v", err)
	}
	c = base()
	c.MfaPolicy = "sometimes"
	if _, err := Methods.Save(e.admin, c); !errorsIs(err, ErrInvalid) {
		t.Fatal("unknown policy")
	}
	c = base()
	c.Origins = []string{"http://evil.example"}
	if _, err := Methods.Save(e.admin, c); !errorsIs(err, ErrInvalid) {
		t.Fatal("a WebAuthn origin must be https")
	}
}

func TestMagicLinkFlow(t *testing.T) {
	e := newMethodsEnv(t)
	e.mailOn()
	e.methods(func(c *MethodsConfig) { c.MagicLink = true })
	u := e.user("mia", e.role(rbac.ClientsRead).Id)
	e.svc.UpdateUser(e.admin, u.Id, UserPatch{Email: ptr("Mia@Example.org")})
	before := len(e.smtp.Messages())
	link := func(raw string) string { return "https://panel.example.com:2053/base/?magic=" + raw }

	// unknown address, disabled account, ambiguous address: no message, no error
	for _, addr := range []string{"nobody@example.org", "not an address"} {
		if err := AuthEmail.RequestMagicLink(addr, "1.1.1.1", link); err != nil {
			t.Fatalf("%s: %v", addr, err)
		}
	}
	d := e.user("dis", e.role(rbac.ClientsRead).Id)
	e.svc.UpdateUser(e.admin, d.Id, UserPatch{Email: ptr("dis@example.org")})
	f := false
	e.svc.UpdateUser(e.admin, d.Id, UserPatch{Enabled: &f})
	AuthEmail.RequestMagicLink("dis@example.org", "1.1.1.1", link)
	t1 := e.user("twin1", e.role(rbac.ClientsRead).Id)
	t2 := e.user("twin2", e.role(rbac.ClientsRead).Id)
	e.svc.UpdateUser(e.admin, t1.Id, UserPatch{Email: ptr("twin@example.org")})
	e.svc.UpdateUser(e.admin, t2.Id, UserPatch{Email: ptr("twin@example.org")})
	AuthEmail.RequestMagicLink("twin@example.org", "1.1.1.1", link)
	time.Sleep(200 * time.Millisecond)
	if n := len(e.smtp.Messages()); n != before {
		t.Fatalf("no mail may be sent for those addresses, %d were", n-before)
	}

	// the real one
	if err := AuthEmail.RequestMagicLink("MIA@example.org", "1.1.1.1", link); err != nil {
		t.Fatal(err)
	}
	_, token := lastLink(t, e.smtp, before+1)
	var row model.AuthToken
	database.GetDB().Where("kind = 'magic'").First(&row)
	if row.TokenHash == token || strings.Contains(row.TokenHash+row.Payload, token) {
		t.Fatal("only a hash of the token may be stored")
	}
	if got, err := AuthEmail.MagicUser(token); err != nil || got.Id != u.Id {
		t.Fatalf("peek: %v %v", got, err)
	}
	if _, err := AuthEmail.MagicUser(token); err != nil {
		t.Fatal("peeking must not use the token up (a mistyped second factor must not burn the link)")
	}
	if _, err := AuthEmail.MagicUser("guess" + token[5:]); err == nil {
		t.Fatal("a wrong token")
	}
	if err := AuthEmail.UseMagic(token); err != nil {
		t.Fatal(err)
	}
	if err := AuthEmail.UseMagic(token); err == nil {
		t.Fatal("a link works once")
	}
	if _, err := AuthEmail.MagicUser(token); err == nil {
		t.Fatal("a used link is dead")
	}
	// expiry
	AuthEmail.RequestMagicLink("mia@example.org", "2.2.2.2", link)
	_, t2tok := lastLink(t, e.smtp, before+2)
	database.GetDB().Model(&model.AuthToken{}).Where("token_hash = ?", hashToken(t2tok)).Update("expires_at", time.Now().Add(-time.Minute).Unix())
	if _, err := AuthEmail.MagicUser(t2tok); err == nil {
		t.Fatal("an expired link")
	}
	// a link of another kind cannot sign anybody in
	if _, err := AuthEmail.PeekToken(TokReset, t2tok); err == nil {
		t.Fatal("tokens are bound to their purpose")
	}
}

func TestMagicLinkRateLimitPerAddress(t *testing.T) {
	e := newMethodsEnv(t)
	e.mailOn()
	e.methods(func(c *MethodsConfig) { c.MagicLink = true })
	u := e.user("rate", e.role(rbac.ClientsRead).Id)
	e.svc.UpdateUser(e.admin, u.Id, UserPatch{Email: ptr("rate@example.org")})
	for i := 0; i < 10; i++ {
		AuthEmail.RequestMagicLink("rate@example.org", "9.9.9."+string(rune('0'+i)), func(r string) string { return "https://panel.example.com:2053/base/?magic=" + r })
	}
	var n int64
	database.GetDB().Model(&model.AuthToken{}).Where("kind = 'magic'").Count(&n)
	if n != 5 {
		t.Fatalf("at most 5 links per address per hour, got %d", n)
	}
}

func TestSelfRegistrationFlow(t *testing.T) {
	e := newMethodsEnv(t)
	e.mailOn()
	role := e.role(rbac.ClientsRead)
	e.methods(func(c *MethodsConfig) { c.Signup, c.SignupRoleId, c.SignupDomains = true, role.Id, []string{"corp.example"} })
	link := func(raw string) string { return "https://panel.example.com:2053/base/?confirm=" + raw }

	if err := AuthEmail.RequestSignup("x@evil.example", "long-enough-pw", "1.1.1.1", link); !errorsIs(err, ErrInvalid) {
		t.Fatalf("a domain that is not allowed: %v", err)
	}
	if err := AuthEmail.RequestSignup("x@corp.example", "short", "1.1.1.1", link); !errorsIs(err, ErrInvalid) {
		t.Fatalf("a weak password: %v", err)
	}
	var users int64
	database.GetDB().Model(&model.User{}).Count(&users)
	before := len(e.smtp.Messages())
	if err := AuthEmail.RequestSignup("new@corp.example", "long-enough-pw", "1.1.1.1", link); err != nil {
		t.Fatal(err)
	}
	_, token := lastLink(t, e.smtp, before+1)
	var after int64
	database.GetDB().Model(&model.User{}).Count(&after)
	if after != users {
		t.Fatal("nothing may be created before the address is confirmed")
	}
	var tok model.AuthToken
	database.GetDB().Where("kind = 'signup'").First(&tok)
	if strings.Contains(tok.Payload, "long-enough-pw") {
		t.Fatal("the password waits for confirmation only as a hash")
	}
	u, err := AuthEmail.ConfirmSignup(token, "1.1.1.1")
	if err != nil {
		t.Fatal(err)
	}
	if u.Email != "new@corp.example" || u.RoleId == nil || *u.RoleId != role.Id || !u.Enabled {
		t.Fatalf("account: %+v", u)
	}
	if got := (&UserService{}).VerifyPassword(u.Username, "long-enough-pw"); got == nil || got.Id != u.Id {
		t.Fatal("the chosen password works")
	}
	if _, err := AuthEmail.ConfirmSignup(token, "1.1.1.1"); err == nil {
		t.Fatal("a confirmation link works once")
	}
	// registering again with an address that has an account sends nothing
	n := len(e.smtp.Messages())
	AuthEmail.RequestSignup("new@corp.example", "long-enough-pw", "3.3.3.3", link)
	time.Sleep(150 * time.Millisecond)
	if len(e.smtp.Messages()) != n {
		t.Fatal("an existing account must not receive a registration mail")
	}
	// the role was made an administrator after the link was sent: the account is not created
	AuthEmail.RequestSignup("late@corp.example", "long-enough-pw", "4.4.4.4", link)
	_, late := lastLink(t, e.smtp, n+1)
	database.GetDB().Model(&model.Role{}).Where("id = ?", role.Id).Update("permissions", `["*"]`)
	if _, err := AuthEmail.ConfirmSignup(late, "4.4.4.4"); err == nil {
		t.Fatal("registration must never produce an administrator, even if the role changed meanwhile")
	}
}

func TestPasswordResetFlow(t *testing.T) {
	e := newMethodsEnv(t)
	e.mailOn()
	e.methods(func(c *MethodsConfig) { c.PasswordReset = true })
	u := e.user("rita", e.role(rbac.ClientsRead).Id)
	e.svc.UpdateUser(e.admin, u.Id, UserPatch{Email: ptr("rita@example.org")})
	tok := model.APIToken{UserId: u.Id, Jti: "j-r", Name: "t", CreatedAt: time.Now().Unix()}
	database.GetDB().Create(&tok)
	link := func(raw string) string { return "https://panel.example.com:2053/base/?reset=" + raw }
	before := len(e.smtp.Messages())
	AuthEmail.RequestReset("rita@example.org", "1.1.1.1", link)
	_, token := lastLink(t, e.smtp, before+1)
	AuthEmail.RequestReset("rita@example.org", "1.1.1.2", link) // a second pending link
	if err := AuthEmail.ResetPassword(token, "short", "1.1.1.1"); !errorsIs(err, ErrInvalid) {
		t.Fatalf("weak new password: %v", err)
	}
	if err := AuthEmail.ResetPassword(token, "brand-new-password-1", "1.1.1.1"); err != nil {
		t.Fatal(err)
	}
	us := &UserService{}
	if us.VerifyPassword("rita", "brand-new-password-1") == nil || us.VerifyPassword("rita", "correct-horse-1") != nil {
		t.Fatal("the new password replaces the old")
	}
	var rev model.APIToken
	database.GetDB().First(&rev, tok.Id)
	if rev.RevokedAt == nil {
		t.Fatal("API tokens end with a password reset")
	}
	if err := AuthEmail.ResetPassword(token, "another-password-2", "1.1.1.1"); err == nil {
		t.Fatal("a reset link works once")
	}
	// the other pending link died with the first reset
	_, second := lastLink(t, e.smtp, before+2)
	if err := AuthEmail.ResetPassword(second, "another-password-2", "1.1.1.1"); err == nil {
		t.Fatal("older links are void after a reset")
	}
	// a disabled account gets no link
	f := false
	e.svc.UpdateUser(e.admin, u.Id, UserPatch{Enabled: &f})
	n := len(e.smtp.Messages())
	AuthEmail.RequestReset("rita@example.org", "5.5.5.5", link)
	time.Sleep(150 * time.Millisecond)
	if len(e.smtp.Messages()) != n {
		t.Fatal("no reset mail for a disabled account")
	}
}

func TestRecoveryCodes(t *testing.T) {
	e := setupRBAC(t)
	u := e.user("rec", e.role(rbac.ClientsRead).Id)
	codes, err := GenerateRecoveryCodes(u.Id)
	if err != nil || len(codes) != 10 {
		t.Fatalf("codes: %v %v", codes, err)
	}
	re := regexp.MustCompile(`^[a-z2-7]{4}(-[a-z2-7]{4}){3}$`)
	seen := map[string]bool{}
	for _, c := range codes {
		if !re.MatchString(c) || seen[c] || !LooksLikeRecoveryCode(c) {
			t.Fatalf("bad code %q", c)
		}
		seen[c] = true
	}
	if LooksLikeRecoveryCode("123456") {
		t.Fatal("a TOTP code is not a recovery code")
	}
	var stored []string
	database.GetDB().Raw("SELECT code_hash FROM user_recovery_codes WHERE user_id = ?", u.Id).Scan(&stored)
	for _, h := range stored {
		if seen[h] || len(h) != 64 {
			t.Fatalf("only hashes are stored: %q", h)
		}
	}
	if !UseRecoveryCode(u.Id, strings.ToUpper(codes[0])) {
		t.Fatal("a code is accepted in any case")
	}
	if UseRecoveryCode(u.Id, codes[0]) {
		t.Fatal("a code works once")
	}
	if UseRecoveryCode(u.Id+1, codes[1]) {
		t.Fatal("a code belongs to its user")
	}
	if RemainingRecoveryCodes(u.Id) != 9 {
		t.Fatal("remaining")
	}
	fresh, _ := GenerateRecoveryCodes(u.Id)
	if UseRecoveryCode(u.Id, codes[2]) {
		t.Fatal("a new set voids the old one")
	}
	if !UseRecoveryCode(u.Id, fresh[0]) {
		t.Fatal("the new set works")
	}
	// switching 2FA off forgets them
	EnableUserTwoFactor(u.Id, "JBSWY3DPEHPK3PXP")
	DisableUserTwoFactor(u.Id)
	if RemainingRecoveryCodes(u.Id) != 0 {
		t.Fatal("2FA off, codes gone")
	}
}

func TestSignInByEmailAddress(t *testing.T) {
	e := newMethodsEnv(t)
	u := e.user("emma", e.role(rbac.ClientsRead).Id)
	e.svc.UpdateUser(e.admin, u.Id, UserPatch{Email: ptr("emma@example.org")})
	us := &UserService{}
	if us.VerifyPassword("emma@example.org", "correct-horse-1") != nil {
		t.Fatal("off by default")
	}
	e.methods(func(c *MethodsConfig) { c.EmailLogin = true })
	if got := us.VerifyPassword("Emma@Example.org", "correct-horse-1"); got == nil || got.Id != u.Id {
		t.Fatal("the address works in place of the username")
	}
	if us.VerifyPassword("emma@example.org", "wrong") != nil {
		t.Fatal("wrong password")
	}
	o := e.user("emma2", e.role(rbac.ClientsRead).Id)
	e.svc.UpdateUser(e.admin, o.Id, UserPatch{Email: ptr("emma@example.org")})
	if us.VerifyPassword("emma@example.org", "correct-horse-1") != nil {
		t.Fatal("an address held by two accounts identifies nobody")
	}
}

func TestMFAPolicyIsPartOfThePrincipal(t *testing.T) {
	e := newMethodsEnv(t)
	plain := e.user("plain", e.role(rbac.ClientsRead).Id)
	pr := func(id int) *Principal {
		InvalidateRBAC()
		p, _ := e.svc.GetPrincipal(id)
		return p
	}
	if p := pr(plain.Id); p.MFARequired {
		t.Fatal("off by default")
	}
	e.methods(func(c *MethodsConfig) { c.MfaPolicy = "admins" })
	if p := pr(e.admin.Principal.UserId); !p.MFARequired || p.MFAEnrolled {
		t.Fatalf("administrators must enrol under the 'admins' policy: %+v", p)
	}
	if pr(plain.Id).MFARequired {
		t.Fatal("ordinary users are not covered by 'admins'")
	}
	// a role can require it, and so can a single user
	mfaRole := e.role(rbac.GroupsRead)
	database.GetDB().Model(&model.Role{}).Where("id = ?", mfaRole.Id).Update("require_mfa", true)
	byRole := e.user("byrole", mfaRole.Id)
	if !pr(byRole.Id).MFARequired {
		t.Fatal("role flag")
	}
	t1 := true
	e.svc.UpdateUser(e.admin, plain.Id, UserPatch{RequireMFA: &t1})
	if !pr(plain.Id).MFARequired {
		t.Fatal("user flag")
	}
	// enrolling clears the gate; a security key counts as well
	EnableUserTwoFactor(plain.Id, "JBSWY3DPEHPK3PXP")
	if p := pr(plain.Id); !p.MFAEnrolled {
		t.Fatalf("enrolled: %+v", p)
	}
	e.methods(func(c *MethodsConfig) { c.MfaPolicy = "all" })
	if !pr(byRole.Id).MFARequired {
		t.Fatal("everybody under 'all'")
	}
}

// ----- passkeys -----

func passkeyRP() RP { return RP{ID: "panel.example.com", Origins: []string{"https://panel.example.com"}} }

func TestPasskeyRegistrationLoginAndSecondFactor(t *testing.T) {
	e := setupRBAC(t)
	u := e.user("pk", e.role(rbac.ClientsRead).Id)
	wa, err := Passkeys.WebAuthn(passkeyRP())
	if err != nil {
		t.Fatal(err)
	}
	auth := authntest.NewAuthenticator(t, "https://panel.example.com")

	opts, sid, err := Passkeys.BeginRegistration(wa, u.Id)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(opts)
	if _, err := Passkeys.FinishRegistration(wa, u.Id, sid, "My laptop", auth.Register(raw)); err != nil {
		t.Fatalf("registration: %v", err)
	}
	if !Passkeys.HasPasskeys(u.Id) || len(Passkeys.List(u.Id)) != 1 {
		t.Fatal("stored")
	}
	var stored string
	database.GetDB().Raw("SELECT credential FROM user_passkeys WHERE user_id = ?", u.Id).Scan(&stored)
	if strings.Contains(stored, "PRIVATE") {
		t.Fatal("only public material is stored")
	}
	// the same ceremony cannot be replayed
	if _, err := Passkeys.FinishRegistration(wa, u.Id, sid, "again", auth.Register(raw)); err == nil {
		t.Fatal("a registration ceremony is single use")
	}

	// passkey login (no username): the credential finds the person
	lo, lsid, err := Passkeys.BeginLogin(wa)
	if err != nil {
		t.Fatal(err)
	}
	lraw, _ := json.Marshal(lo)
	user, err := Passkeys.FinishLogin(wa, lsid, auth.Assert(lraw))
	if err != nil || user.Id != u.Id {
		t.Fatalf("login: %v %v", user, err)
	}
	if _, err := Passkeys.FinishLogin(wa, lsid, auth.Assert(lraw)); err == nil {
		t.Fatal("a login ceremony is single use")
	}

	// a challenge answered by the wrong origin (a phishing page) fails
	phish := authntest.NewAuthenticator(t, "https://panel-example.evil.test")
	phish.CredID, phish.UserHandle = auth.CredID, auth.UserHandle
	lo, lsid, _ = Passkeys.BeginLogin(wa)
	lraw, _ = json.Marshal(lo)
	if _, err := Passkeys.FinishLogin(wa, lsid, phish.Assert(lraw)); err == nil {
		t.Fatal("an assertion made for another origin must fail")
	}

	// a passkey sign-in requires user verification
	auth.UV = false
	lo, lsid, _ = Passkeys.BeginLogin(wa)
	lraw, _ = json.Marshal(lo)
	if _, err := Passkeys.FinishLogin(wa, lsid, auth.Assert(lraw)); err == nil {
		t.Fatal("without user verification a passkey is no second factor of its own")
	}
	auth.UV = true

	// as a second factor after the password
	so, ssid, err := Passkeys.BeginSecondFactor(wa, u.Id)
	if err != nil {
		t.Fatal(err)
	}
	sraw, _ := json.Marshal(so)
	if err := Passkeys.FinishSecondFactor(wa, u.Id, ssid, auth.Assert(sraw)); err != nil {
		t.Fatalf("second factor: %v", err)
	}
	// the answer belongs to the person whose password was checked, nobody else
	other := e.user("other", e.role(rbac.ClientsRead).Id)
	so, ssid, _ = Passkeys.BeginSecondFactor(wa, u.Id)
	sraw, _ = json.Marshal(so)
	if err := Passkeys.FinishSecondFactor(wa, other.Id, ssid, auth.Assert(sraw)); err == nil {
		t.Fatal("a ceremony begun for one person cannot be finished for another")
	}
	if _, _, err := Passkeys.BeginSecondFactor(wa, other.Id); err == nil {
		t.Fatal("a person without keys has none to challenge")
	}
}

func TestPasskeyCloneDetectionAndOwnership(t *testing.T) {
	e := setupRBAC(t)
	u := e.user("clone", e.role(rbac.ClientsRead).Id)
	wa, _ := Passkeys.WebAuthn(passkeyRP())
	auth := authntest.NewAuthenticator(t, "https://panel.example.com")
	opts, sid, _ := Passkeys.BeginRegistration(wa, u.Id)
	raw, _ := json.Marshal(opts)
	if _, err := Passkeys.FinishRegistration(wa, u.Id, sid, "k", auth.Register(raw)); err != nil {
		t.Fatal(err)
	}
	login := func() error {
		lo, lsid, _ := Passkeys.BeginLogin(wa)
		lraw, _ := json.Marshal(lo)
		_, err := Passkeys.FinishLogin(wa, lsid, auth.Assert(lraw))
		return err
	}
	auth.Counter = 10
	if err := login(); err != nil {
		t.Fatal(err)
	}
	auth.Counter = 3 // the counter goes backwards: a copy of the key is in use
	if err := login(); err == nil {
		t.Fatal("a signature counter that goes backwards must be refused")
	}
	// somebody else cannot delete or rename the key
	o := e.user("thief", e.role(rbac.ClientsRead).Id)
	list := Passkeys.List(u.Id)
	if err := Passkeys.Delete(o.Id, list[0].Id); err == nil {
		t.Fatal("not yours")
	}
	if err := Passkeys.Rename(o.Id, list[0].Id, "x"); err == nil {
		t.Fatal("not yours")
	}
	if err := Passkeys.Delete(u.Id, list[0].Id); err != nil || Passkeys.HasPasskeys(u.Id) {
		t.Fatal("the owner can remove it")
	}
}
