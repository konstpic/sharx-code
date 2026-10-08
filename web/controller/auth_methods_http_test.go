package controller

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/xlzd/gotp"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/authn/authntest"
	"github.com/konstpic/sharx-code/v2/web/mail/mailtest"
	"github.com/konstpic/sharx-code/v2/web/rbac"
	"github.com/konstpic/sharx-code/v2/web/service"
)

func resetLoginLimits() {
	loginIPFails = authn.NewLimiter(40, 15*time.Minute)
	loginPairFails = authn.NewLimiter(6, 15*time.Minute)
	loginUserFails = authn.NewLimiter(30, 15*time.Minute)
	loginAttempts = authn.NewLimiter(60, time.Minute)
	emailReqRL = authn.NewLimiter(10, 10*time.Minute)
	tokenUseRL = authn.NewLimiter(30, 10*time.Minute)
	passkeyRL = authn.NewLimiter(40, 10*time.Minute)
}

type authHTTP struct {
	*httpEnv
	smtp *mailtest.Server
	base int // messages that are not the test's (the one that verified the account)
}

func newAuthHTTP(t *testing.T) *authHTTP {
	resetLoginLimits()
	e := newHTTPEnv(t)
	a := &authHTTP{httpEnv: e, smtp: mailtest.New(t, nil)}
	if _, err := service.Mail.Save(e.admin, service.MailInput{Enabled: true, Host: a.smtp.Host, Port: a.smtp.Port, From: "panel@example.com", Security: "none"}); err != nil {
		t.Fatal(err)
	}
	if err := service.Mail.SendTest(nil2ctx(), e.admin, "admin@example.org"); err != nil {
		t.Fatal(err)
	}
	a.base = len(a.smtp.Wait(t, 1))
	return a
}

// enrolAdmin gives the acting administrator a second factor, so that a policy covering them may be saved.
func (a *authHTTP) enrolAdmin() {
	service.EnableUserTwoFactor(a.admin.Principal.UserId, gotp.RandomSecret(20))
	p, _ := a.svc.GetPrincipal(a.admin.Principal.UserId)
	a.admin.Principal = p
}

func (a *authHTTP) methods(mut func(c *service.MethodsConfig)) {
	a.t.Helper()
	c := service.Methods.Config()
	c.PublicUrl = "https://panel.example.com:2053/base/"
	if mut != nil {
		mut(&c)
	}
	if _, err := service.Methods.Save(a.admin, c); err != nil {
		a.t.Fatal(err)
	}
}

func (a *authHTTP) browser() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func (a *authHTTP) postJSON(c *http.Client, path string, body any, host string) (int, map[string]any) {
	a.t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", a.srv.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	if host != "" {
		req.Host = host
	}
	resp, err := c.Do(req)
	if err != nil {
		a.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func (a *authHTTP) login(c *http.Client, user, pass, code string) map[string]any {
	_, r := a.postJSON(c, "/login", map[string]any{"username": user, "password": pass, "twoFactorCode": code}, "")
	return r
}

func (a *authHTTP) me(c *http.Client) (int, map[string]any) {
	return (&client{env: a.httpEnv, c: c}).do("GET", "/panel/rbac/me", nil)
}

func ok(r map[string]any) bool { v, _ := r["success"].(bool); return v }

var linkRx = regexp.MustCompile(`(https?://[^\s/]+/base/)\?(magic|confirm|reset)=([A-Za-z0-9_%-]+)`)

func (a *authHTTP) linkIn(n int) (base, token string) {
	a.t.Helper()
	m := a.smtp.Wait(a.t, n+a.base)[n+a.base-1]
	i := strings.Index(m.Data, "\r\n\r\n")
	b, _ := base64.StdEncoding.DecodeString(regexp.MustCompile(`\s+`).ReplaceAllString(m.Data[i:], ""))
	mm := linkRx.FindStringSubmatch(string(b))
	if mm == nil {
		a.t.Fatalf("no link: %s", b)
	}
	return mm[1], mm[3]
}

func (a *authHTTP) withTOTP(userID int) string {
	secret := gotp.RandomSecret(20)
	if err := service.EnableUserTwoFactor(userID, secret); err != nil {
		a.t.Fatal(err)
	}
	return secret
}

func TestPasswordSignInIsThrottledAfterRepeatedFailures(t *testing.T) {
	a := newAuthHTTP(t)
	a.user("victim", a.role(rbac.ClientsRead).Id)
	b := a.browser()
	for i := 0; i < 6; i++ {
		if ok(a.login(b, "victim", "wrong-"+string(rune('a'+i)), "")) {
			t.Fatal("wrong password accepted")
		}
	}
	// now even the right password is refused from this address for this account, and the answer is the usual one
	if r := a.login(b, "victim", "correct-horse-1", ""); ok(r) {
		t.Fatal("a blocked attempt must not succeed, whatever the password")
	}
	// somebody else's account from the same address still works until the address-wide limit
	a.user("bystander", a.role(rbac.ClientsRead).Id)
	if r := a.login(a.browser(), "bystander", "correct-horse-1", ""); !ok(r) {
		t.Fatalf("an unrelated account must not be locked by one account's failures: %v", r)
	}
	// the account is still reachable from another address (no remote lock-out by a handful of guesses)
	resetLoginLimits()
	loginPairFails.Hit("other-ip|victim")
	if r := a.login(a.browser(), "victim", "correct-horse-1", ""); !ok(r) {
		t.Fatalf("after the window the owner gets in: %v", r)
	}
}

func TestSecondFactorTotpRecoveryCodeAndBruteForce(t *testing.T) {
	a := newAuthHTTP(t)
	uid := a.user("tfa", a.role(rbac.ClientsRead).Id)
	secret := a.withTOTP(uid)
	codes, _ := service.GenerateRecoveryCodes(uid)

	b := a.browser()
	r := a.login(b, "tfa", "correct-horse-1", "")
	obj, _ := r["obj"].(map[string]any)
	if ok(r) || obj["needTwoFactor"] != true || obj["totp"] != true || obj["recovery"] != true {
		t.Fatalf("the code is asked for, with the options: %v", r)
	}
	if ok(a.login(b, "tfa", "correct-horse-1", "000000")) {
		t.Fatal("wrong code")
	}
	if r := a.login(b, "tfa", "correct-horse-1", gotp.NewDefaultTOTP(secret).Now()); !ok(r) {
		t.Fatalf("right TOTP: %v", r)
	}
	// a recovery code replaces the authenticator, once
	b2 := a.browser()
	if r := a.login(b2, "tfa", "correct-horse-1", codes[0]); !ok(r) {
		t.Fatalf("recovery code: %v", r)
	}
	if r := a.login(a.browser(), "tfa", "correct-horse-1", codes[0]); ok(r) {
		t.Fatal("a recovery code works once")
	}
	var n int64
	database.GetDB().Model(&model.AuditLog{}).Where("action = 'auth.recovery_code_used'").Count(&n)
	if n != 1 {
		t.Fatal("the use of a recovery code is audited")
	}
	// guessing the second factor is throttled like guessing the password
	resetLoginLimits()
	for i := 0; i < 6; i++ {
		a.login(a.browser(), "tfa", "correct-horse-1", "11111"+string(rune('0'+i)))
	}
	if r := a.login(a.browser(), "tfa", "correct-horse-1", gotp.NewDefaultTOTP(secret).Now()); ok(r) {
		t.Fatal("six wrong codes block further attempts, even with the right code")
	}
}

func TestMagicLinkSignInOverHTTP(t *testing.T) {
	a := newAuthHTTP(t)
	a.methods(func(c *service.MethodsConfig) { c.MagicLink = true })
	uid := a.user("mag", a.role(rbac.ClientsRead).Id)
	a.svc.UpdateUser(a.admin, uid, service.UserPatch{Email: ptr("mag@example.org")})

	b := a.browser()
	// a poisoned Host header must not change where the link points
	code, r := a.postJSON(b, "/auth/magic/request", map[string]any{"email": "mag@example.org"}, "evil.example")
	if code != 200 || !ok(r) {
		t.Fatalf("request: %d %v", code, r)
	}
	// and an unknown address gets the very same answer
	_, r2 := a.postJSON(b, "/auth/magic/request", map[string]any{"email": "nobody@example.org"}, "")
	if r["msg"] != r2["msg"] {
		t.Fatal("the answer must not reveal whether the address has an account")
	}
	base, token := a.linkIn(1)
	if base != "https://panel.example.com:2053/base/" {
		t.Fatalf("the link must be built from the configured public address, got %s", base)
	}
	if strings.Contains(a.smtp.Messages()[0].Data, "evil.example") {
		t.Fatal("the Host header leaked into the mail")
	}
	// wrong token
	if _, r := a.postJSON(b, "/auth/magic/verify", map[string]any{"token": "nope" + token}, ""); ok(r) {
		t.Fatal("wrong token")
	}
	// the right one signs in
	if _, r := a.postJSON(b, "/auth/magic/verify", map[string]any{"token": token}, ""); !ok(r) {
		t.Fatalf("verify: %v", r)
	}
	if c, me := a.me(b); c != 200 || me["obj"].(map[string]any)["username"] != "mag" {
		t.Fatalf("session: %d %v", c, me)
	}
	if _, r := a.postJSON(a.browser(), "/auth/magic/verify", map[string]any{"token": token}, ""); ok(r) {
		t.Fatal("the link works once")
	}
}

func TestMagicLinkStillAsksForTheSecondFactorAndIsNotBurnedByAMistake(t *testing.T) {
	a := newAuthHTTP(t)
	a.methods(func(c *service.MethodsConfig) { c.MagicLink = true })
	uid := a.user("magtfa", a.role(rbac.ClientsRead).Id)
	a.svc.UpdateUser(a.admin, uid, service.UserPatch{Email: ptr("mt@example.org")})
	secret := a.withTOTP(uid)
	a.postJSON(a.browser(), "/auth/magic/request", map[string]any{"email": "mt@example.org"}, "")
	_, token := a.linkIn(1)
	b := a.browser()
	_, r := a.postJSON(b, "/auth/magic/verify", map[string]any{"token": token}, "")
	if obj, _ := r["obj"].(map[string]any); ok(r) || obj["needTwoFactor"] != true {
		t.Fatalf("an e-mail link is one factor: the second is still required: %v", r)
	}
	if _, r := a.postJSON(b, "/auth/magic/verify", map[string]any{"token": token, "twoFactorCode": "000000"}, ""); ok(r) {
		t.Fatal("wrong code")
	}
	if _, r := a.postJSON(b, "/auth/magic/verify", map[string]any{"token": token, "twoFactorCode": gotp.NewDefaultTOTP(secret).Now()}, ""); !ok(r) {
		t.Fatalf("the link was burned by a mistyped code: %v", r)
	}
}

func TestRegistrationConfirmationAndPasswordResetOverHTTP(t *testing.T) {
	a := newAuthHTTP(t)
	role := a.role(rbac.ClientsRead)
	a.methods(func(c *service.MethodsConfig) { c.Signup, c.SignupRoleId, c.PasswordReset = true, role.Id, true })
	b := a.browser()
	if code, r := a.postJSON(b, "/auth/register", map[string]any{"email": "new@example.org", "password": "weak"}, ""); code != 400 || ok(r) {
		t.Fatalf("weak password: %d %v", code, r)
	}
	if _, r := a.postJSON(b, "/auth/register", map[string]any{"email": "new@example.org", "password": "a-good-password-1"}, ""); !ok(r) {
		t.Fatalf("register: %v", r)
	}
	// nothing works until the link is opened
	if ok(a.login(a.browser(), "new", "a-good-password-1", "")) {
		t.Fatal("an unconfirmed account must not exist")
	}
	_, token := a.linkIn(1)
	if _, r := a.postJSON(b, "/auth/register/confirm", map[string]any{"token": token}, ""); !ok(r) {
		t.Fatalf("confirm: %v", r)
	}
	if r := a.login(a.browser(), "new@example.org", "a-good-password-1", ""); ok(r) {
		t.Fatal("e-mail sign-in is off, only the username works")
	}
	if r := a.login(a.browser(), "new", "a-good-password-1", ""); !ok(r) {
		t.Fatalf("sign in after confirming: %v", r)
	}
	// forgot + reset
	a.postJSON(b, "/auth/password/forgot", map[string]any{"email": "new@example.org"}, "")
	_, rt := a.linkIn(2)
	if _, r := a.postJSON(b, "/auth/password/reset", map[string]any{"token": rt, "password": "a-brand-new-password-2"}, ""); !ok(r) {
		t.Fatalf("reset: %v", r)
	}
	if ok(a.login(a.browser(), "new", "a-good-password-1", "")) || !ok(a.login(a.browser(), "new", "a-brand-new-password-2", "")) {
		t.Fatal("the password changed")
	}
}

func TestEmailMethodsAreRefusedUntilSwitchedOnAndWhileMailIsBroken(t *testing.T) {
	a := newAuthHTTP(t)
	b := a.browser()
	for _, p := range []string{"/auth/magic/request", "/auth/password/forgot"} {
		if code, _ := a.postJSON(b, p, map[string]any{"email": "x@example.org"}, ""); code != 400 {
			t.Fatalf("%s while off: %d", p, code)
		}
	}
	if code, _ := a.postJSON(b, "/auth/register", map[string]any{"email": "x@example.org", "password": "long-enough-pw"}, ""); code != 400 {
		t.Fatalf("registration while off: %d", code)
	}
	// public list: nothing offered
	resp, _ := http.Get(a.srv.URL + "/auth/methods")
	var pub struct{ Obj map[string]bool }
	json.NewDecoder(resp.Body).Decode(&pub)
	resp.Body.Close()
	if pub.Obj["magicLink"] || pub.Obj["signup"] || pub.Obj["passwordReset"] {
		t.Fatalf("offered while off: %v", pub.Obj)
	}
	// administrators only change methods and the account
	low := a.user("low", a.role(rbac.AuthRead).Id)
	c := a.as(low)
	if code, body := c.do("GET", "/panel/auth/methods", nil); code != 200 {
		t.Fatalf("auth:read lists: %d %v", code, body)
	}
	for _, rq := range [][2]string{{"POST", "/panel/auth/methods"}, {"POST", "/panel/auth/mail"}, {"POST", "/panel/auth/mail/test"}} {
		if code, _ := c.do(rq[0], rq[1], map[string]any{}); code != 403 {
			t.Fatalf("%s %s: %d", rq[0], rq[1], code)
		}
	}
	// the password is never in a response
	_, r := c.do("GET", "/panel/auth/mail", nil)
	if strings.Contains(toJSON(r), "password\":\"") {
		t.Fatalf("leak: %v", r)
	}
}

// toLocalhost makes the test server answer to the name "localhost": WebAuthn accepts plain http only there, and a request's
// Host decides the relying party.
func (a *authHTTP) post(c *http.Client, base, path string, body any) (int, map[string]any) {
	a.t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", base+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	resp, err := c.Do(req)
	if err != nil {
		a.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func TestPasskeyOverHTTP(t *testing.T) {
	a := newAuthHTTP(t)
	a.methods(func(c *service.MethodsConfig) { c.Passkeys = true })
	uid := a.user("pkuser", a.role(rbac.ClientsRead).Id)
	base := strings.Replace(a.srv.URL, "127.0.0.1", "localhost", 1)
	auth := authntest.NewAuthenticator(t, base)

	signedIn := func() *http.Client {
		c := a.browser()
		resp, err := c.Get(base + "/__login/" + itoa(uid))
		if err != nil || resp.StatusCode != 200 {
			t.Fatalf("test login: %v %v", resp, err)
		}
		resp.Body.Close()
		return c
	}
	// register from a signed-in session
	b := signedIn()
	bc, beg := a.post(b, base, "/panel/auth/passkeys/register/begin", map[string]any{})
	bo, _ := beg["obj"].(map[string]any)
	if bo == nil {
		t.Fatalf("begin: %d %v", bc, beg)
	}
	opts, _ := json.Marshal(bo["options"])
	_, fin := a.post(b, base, "/panel/auth/passkeys/register/finish", map[string]any{"state": bo["state"], "name": "Laptop", "response": json.RawMessage(auth.Register(opts))})
	if !ok(fin) {
		t.Fatalf("finish: %v", fin)
	}

	// sign in with it: no username, no password
	b2 := a.browser()
	_, lb := a.post(b2, base, "/auth/passkey/login/begin", map[string]any{})
	lo, _ := lb["obj"].(map[string]any)
	lopts, _ := json.Marshal(lo["options"])
	assertion := auth.Assert(lopts)
	_, lf := a.post(b2, base, "/auth/passkey/login/finish", map[string]any{"state": lo["state"], "response": json.RawMessage(assertion)})
	if !ok(lf) {
		t.Fatalf("passkey sign-in: %v", lf)
	}
	req, _ := http.NewRequest("GET", base+"/panel/rbac/me", nil)
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	rs, _ := b2.Do(req)
	var me map[string]any
	json.NewDecoder(rs.Body).Decode(&me)
	rs.Body.Close()
	if rs.StatusCode != 200 || me["obj"].(map[string]any)["username"] != "pkuser" {
		t.Fatalf("session: %d %v", rs.StatusCode, me)
	}
	// replaying the captured answer signs nobody in
	if _, lf := a.post(a.browser(), base, "/auth/passkey/login/finish", map[string]any{"state": lo["state"], "response": json.RawMessage(assertion)}); ok(lf) {
		t.Fatal("a ceremony is single use")
	}

	// the same key as a second factor after the password
	b3 := a.browser()
	_, r := a.post(b3, base, "/login", map[string]any{"username": "pkuser", "password": "correct-horse-1"})
	obj, _ := r["obj"].(map[string]any)
	wa, _ := obj["webauthn"].(map[string]any)
	if ok(r) || wa == nil {
		t.Fatalf("a person with a security key is challenged after the password: %v", r)
	}
	wopts, _ := json.Marshal(wa["options"])
	_, out := a.post(b3, base, "/login", map[string]any{"username": "pkuser", "password": "correct-horse-1", "webauthnState": wa["state"], "webauthnResponse": json.RawMessage(auth.Assert(wopts))})
	if !ok(out) {
		t.Fatalf("password + security key: %v", out)
	}
	// a wrong password with a valid key is still a failure
	_, r = a.post(a.browser(), base, "/login", map[string]any{"username": "pkuser", "password": "wrong"})
	if ok(r) {
		t.Fatal("the key does not replace the password")
	}
	// switched off by the administrator: the endpoints close
	a.methods(func(c *service.MethodsConfig) { c.Passkeys = false })
	if code, _ := a.post(a.browser(), base, "/auth/passkey/login/begin", map[string]any{}); code != 404 {
		t.Fatalf("passkeys off: %d", code)
	}
}

func TestMFAEnrollmentGate(t *testing.T) {
	a := newAuthHTTP(t)
	a.enrolAdmin()
	a.methods(func(c *service.MethodsConfig) { c.MfaPolicy = "all" })
	uid := a.user("gated", a.role(rbac.ClientsRead, rbac.GroupsRead).Id)
	c := a.as(uid)

	if code, body := c.do("GET", "/panel/group/list", nil); code != 403 || body["code"] != "mfa_enrollment_required" {
		t.Fatalf("data endpoints are closed until a second factor exists: %d %v", code, body)
	}
	_, me := c.do("GET", "/panel/rbac/me", nil)
	o := me["obj"].(map[string]any)
	if o["mfaRequired"] != true || o["mfaEnrolled"] != false || o["mfaGated"] != true {
		t.Fatalf("me tells the UI to send the person to enrol: %v", o)
	}
	// the way to enrol stays open
	_, beg := c.do("POST", "/panel/setting/twoFactor/begin", map[string]any{})
	secret, _ := beg["obj"].(map[string]any)["secret"].(string)
	if secret == "" {
		t.Fatalf("2FA setup must stay reachable: %v", beg)
	}
	if code, _ := c.do("GET", "/panel/rbac/audit", nil); code != 403 {
		t.Fatal("still gated elsewhere")
	}
	_, done := c.do("POST", "/panel/setting/twoFactor/complete", map[string]any{"code": gotp.NewDefaultTOTP(secret).Now()})
	codes, _ := done["obj"].(map[string]any)["recoveryCodes"].([]any)
	if !ok(done) || len(codes) != 10 {
		t.Fatalf("enabling shows the recovery codes once: %v", done)
	}
	if code, _ := c.do("GET", "/panel/group/list", nil); code != 200 {
		t.Fatalf("the gate lifts once a second factor exists: %d", code)
	}
}

func TestMFAGateIsSkippedForProviderSignInsThatCountAsMFA(t *testing.T) {
	s := newSSOHTTP(t)
	s.roleFor("g", rbac.ClientsRead, rbac.GroupsRead)
	s.idp.User = authntest.Claims{Sub: "ak-mfa", Email: "m@corp.example", EmailVerified: true, Username: "mfa-ann", Groups: []string{"g"}}
	service.EnableUserTwoFactor(s.admin.Principal.UserId, gotp.RandomSecret(20))
	s.admin.Principal, _ = s.svc.GetPrincipal(s.admin.Principal.UserId)
	c := service.Methods.Config()
	c.MfaPolicy, c.SsoCountsAsMfa = "all", true
	if _, err := service.Methods.Save(s.admin, c); err != nil {
		t.Fatal(err)
	}
	b := s.browser()
	s.login(b)
	cl := &client{env: s.httpEnv, c: b}
	if code, _ := cl.do("GET", "/panel/group/list", nil); code != 200 {
		t.Fatalf("the identity provider did the multi-factor step: %d", code)
	}
	// the administrator can decide it does not count
	c.SsoCountsAsMfa = false
	service.Methods.Save(s.admin, c)
	b2 := s.browser()
	s.login(b2)
	cl2 := &client{env: s.httpEnv, c: b2}
	if code, body := cl2.do("GET", "/panel/group/list", nil); code != 403 || body["code"] != "mfa_enrollment_required" {
		t.Fatalf("when the provider does not count, the panel asks for its own: %d %v", code, body)
	}
}

func ptr[T any](v T) *T { return &v }

func nil2ctx() context.Context { return context.Background() }
