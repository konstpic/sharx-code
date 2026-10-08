package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/authn/authntest"
	"github.com/konstpic/sharx-code/v2/web/rbac"
)

type resyncEnv struct {
	*ssoEnv
	idp      *authntest.IdP
	viewer   *RoleView
	operator *RoleView
}

// newResyncEnv has a real (fake) OpenID provider with offline access and a provider configured to re-check people.
func newResyncEnv(t *testing.T) *resyncEnv {
	e := &resyncEnv{ssoEnv: &ssoEnv{rbacEnv: setupRBAC(t)}}
	e.idp = authntest.New(t)
	e.idp.OfflineAccess = true
	v, err := SSO.SaveProvider(e.admin, 0, ProviderInput{Key: "idp", Name: "IdP", Preset: "oidc", Enabled: true, ClientId: e.idp.ClientID, ClientSecret: ptr(e.idp.Secret),
		Params: map[string]string{"issuer": e.idp.Issuer()}, AllowSignup: true, RoleMode: "idp", NoMatch: "deny", Resync: true, ResyncMinutes: 5, RotateWebhook: true,
		Overrides: Overrides{Claims: authn.ClaimMap{Groups: "groups"}}})
	if err != nil {
		t.Fatal(err)
	}
	var p model.AuthProvider
	database.GetDB().First(&p, v.Id)
	e.p = &p
	e.viewer = e.role(rbac.ClientsRead)
	e.operator = e.role(rbac.ClientsRead, rbac.ClientsUpdate)
	e.rule(authn.RuleGroup, "ops", e.operator.Id)
	e.rule(authn.RuleGroup, "view", e.viewer.Id)
	return e
}

// login runs the real flow against the fake provider and signs the identity in.
func (e *resyncEnv) login(c authntest.Claims) *model.User {
	e.t.Helper()
	e.idp.User = c
	cl, err := SSO.Client(e.p)
	if err != nil {
		e.t.Fatal(err)
	}
	ctx := context.Background()
	if err := cl.Discover(ctx); err != nil {
		e.t.Fatal(err)
	}
	fl := authn.Flow{Nonce: authn.Random(8), Verifier: authn.Random(32), RedirectURI: "https://panel/cb"}
	u, err := cl.AuthorizeURL(fl.RedirectURI, "state-abcdef", fl.Nonce, fl.Verifier)
	if err != nil {
		e.t.Fatal(err)
	}
	code, _ := e.idp.Authorize(u)
	id, err := cl.Complete(ctx, code, fl, time.Now())
	if err != nil {
		e.t.Fatal(err)
	}
	user, err := SSO.SignIn(e.p, *id, "ip", 0)
	if err != nil {
		e.t.Fatal(err)
	}
	return user
}

func (e *resyncEnv) identityOf(userID int) model.UserIdentity {
	var i model.UserIdentity
	database.GetDB().Where("user_id = ?", userID).First(&i)
	return i
}

func (e *resyncEnv) age(identityID int) {
	database.GetDB().Model(&model.UserIdentity{}).Where("id = ?", identityID).Update("refreshed_at", time.Now().Add(-time.Hour).Unix())
}

func TestScopeRequestsOfflineAccessWhenResyncIsOn(t *testing.T) {
	e := newResyncEnv(t)
	cl, _ := SSO.Client(e.p)
	found := false
	for _, s := range cl.Cfg.Scopes {
		found = found || s == "offline_access"
	}
	if !found {
		t.Fatalf("scopes: %v", cl.Cfg.Scopes)
	}
}

func TestRefreshTokenIsStoredSealedAndRotates(t *testing.T) {
	e := newResyncEnv(t)
	u := e.login(authntest.Claims{Sub: "s1", Email: "a@x.example", EmailVerified: true, Groups: []string{"view"}})
	ident := e.identityOf(u.Id)
	if len(ident.RefreshToken) < 20 || ident.RefreshToken[:7] != "enc:v1:" {
		t.Fatalf("stored: %q", ident.RefreshToken)
	}
	e.age(ident.Id)
	if err := SSO.ResyncIdentity(context.Background(), ident.Id); err != nil {
		t.Fatal(err)
	}
	after := e.identityOf(u.Id)
	if after.RefreshToken == ident.RefreshToken || after.RefreshToken == "" {
		t.Fatal("the stored refresh token must be replaced by the rotated one")
	}
	// a second re-check works with the new token (the old one would be refused)
	if err := SSO.ResyncIdentity(context.Background(), ident.Id); err != nil {
		t.Fatalf("second resync: %v", err)
	}
}

func TestResyncAppliesGroupChangesWithoutASignIn(t *testing.T) {
	e := newResyncEnv(t)
	u := e.login(authntest.Claims{Sub: "s1", Email: "a@x.example", EmailVerified: true, Groups: []string{"view"}})
	if e.roleOf(u.Id) != e.viewer.Name {
		t.Fatal("start")
	}
	ident := e.identityOf(u.Id)
	e.idp.SetUser(authntest.Claims{Sub: "s1", Email: "a@x.example", EmailVerified: true, Groups: []string{"ops"}})
	if err := SSO.ResyncIdentity(context.Background(), ident.Id); err != nil {
		t.Fatal(err)
	}
	if e.roleOf(u.Id) != e.operator.Name {
		t.Fatalf("promoted by the re-check: %s", e.roleOf(u.Id))
	}
	// removed from every mapped group
	e.idp.SetUser(authntest.Claims{Sub: "s1", Email: "a@x.example", EmailVerified: true, Groups: []string{"other"}})
	SSO.ResyncIdentity(context.Background(), ident.Id)
	if e.roleOf(u.Id) != "" {
		t.Fatalf("the role must be revoked: %s", e.roleOf(u.Id))
	}
}

func TestDeactivationAtTheProviderEndsSessionsAndTokens(t *testing.T) {
	e := newResyncEnv(t)
	u := e.login(authntest.Claims{Sub: "s1", Email: "a@x.example", EmailVerified: true, Groups: []string{"ops"}})
	tok := model.APIToken{UserId: u.Id, Jti: "jti-1", Name: "t", CreatedAt: time.Now().Unix()}
	database.GetDB().Create(&tok)
	ident := e.identityOf(u.Id)
	e.idp.Deactivate("s1")
	if err := SSO.ResyncIdentity(context.Background(), ident.Id); err != nil {
		t.Fatal(err)
	}
	var got model.APIToken
	database.GetDB().First(&got, tok.Id)
	if got.RevokedAt == nil {
		t.Fatal("API tokens of a deactivated person must be revoked")
	}
	after := e.identityOf(u.Id)
	if after.RefreshToken != "" || after.ResyncError == "" {
		t.Fatalf("the dead grant is forgotten: %+v", after)
	}
	var n int64
	database.GetDB().Model(&model.AuditLog{}).Where("action = 'auth.resync_revoked'").Count(&n)
	if n != 1 {
		t.Fatal("audited")
	}
	// the role stays: the person can sign in again if the provider lets them
	if e.roleOf(u.Id) != e.operator.Name {
		t.Fatal("the role is kept so a returning person is not locked out locally")
	}
}

func TestResyncDueOnlyTouchesIdentitiesWhoseTurnHasCome(t *testing.T) {
	e := newResyncEnv(t)
	fresh := e.login(authntest.Claims{Sub: "fresh", Email: "f@x.example", EmailVerified: true, Groups: []string{"view"}})
	stale := e.login(authntest.Claims{Sub: "stale", Email: "s@x.example", EmailVerified: true, Groups: []string{"view"}})
	e.age(e.identityOf(stale.Id).Id)
	before := e.idp.Calls["token"]
	n := SSO.ResyncDue(context.Background(), 10)
	if n != 1 {
		t.Fatalf("only the stale identity is due, did %d", n)
	}
	if e.idp.Calls["token"] != before+1 {
		t.Fatal("one refresh request")
	}
	_ = fresh
}

func TestProviderWithResyncOffStoresNoRefreshToken(t *testing.T) {
	e := newResyncEnv(t)
	in := ProviderInput{Key: "idp", Name: "IdP", Preset: "oidc", Enabled: true, ClientId: e.idp.ClientID, Params: map[string]string{"issuer": e.idp.Issuer()},
		AllowSignup: true, RoleMode: "idp", NoMatch: "deny", Resync: false, Overrides: Overrides{Claims: authn.ClaimMap{Groups: "groups"}}}
	if _, err := SSO.SaveProvider(e.admin, e.p.Id, in); err != nil {
		t.Fatal(err)
	}
	database.GetDB().First(e.p, e.p.Id)
	u := e.login(authntest.Claims{Sub: "s9", Email: "n@x.example", EmailVerified: true, Groups: []string{"view"}})
	if e.identityOf(u.Id).RefreshToken != "" {
		t.Fatal("the panel must not keep provider tokens it does not need")
	}
}

// ----- webhook -----

func sign(secret, ts string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "." + string(body)))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func (e *resyncEnv) secret() string {
	var p model.AuthProvider
	database.GetDB().First(&p, e.p.Id)
	s, _ := authn.Open(SSO.secret(), p.WebhookSecret)
	return s
}

func TestWebhookAuthentication(t *testing.T) {
	e := newResyncEnv(t)
	database.GetDB().First(e.p, e.p.Id)
	sec := e.secret()
	body := []byte(`{"event":"updated","sub":"nobody"}`)
	now := time.Now()
	ts := strconv.FormatInt(now.Unix(), 10)
	cases := []struct {
		name string
		h    map[string]string
		ok   bool
	}{
		{"bearer secret", map[string]string{"authorization": "Bearer " + sec}, true},
		{"basic auth with the secret as the password", map[string]string{"authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte("authentik:"+sec))}, true},
		{"basic auth with a wrong password", map[string]string{"authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte("authentik:nope"))}, false},
		{"wrong bearer", map[string]string{"authorization": "Bearer nope"}, false},
		{"valid HMAC", map[string]string{"x-sharx-signature": sign(sec, ts, body), "x-sharx-timestamp": ts}, true},
		{"HMAC of another body", map[string]string{"x-sharx-signature": sign(sec, ts, []byte("x")), "x-sharx-timestamp": ts}, false},
		{"HMAC with the wrong key", map[string]string{"x-sharx-signature": sign("other", ts, body), "x-sharx-timestamp": ts}, false},
		{"old timestamp (replay)", map[string]string{"x-sharx-signature": sign(sec, "1000", body), "x-sharx-timestamp": "1000"}, false},
		{"no credentials", map[string]string{}, false},
	}
	for _, tc := range cases {
		_, err := SSO.HandleWebhook(context.Background(), e.p, tc.h, body, now)
		if (err == nil) != tc.ok {
			t.Fatalf("%s: err=%v", tc.name, err)
		}
	}
}

func TestWebhookDeactivationRemovesAManagedRoleAndCutsAccess(t *testing.T) {
	e := newResyncEnv(t)
	database.GetDB().First(e.p, e.p.Id)
	u := e.login(authntest.Claims{Sub: "w1", Email: "w@x.example", EmailVerified: true, Groups: []string{"ops"}, Username: "wanda"})
	tok := model.APIToken{UserId: u.Id, Jti: "jti-w", Name: "t", CreatedAt: time.Now().Unix()}
	database.GetDB().Create(&tok)
	hdr := map[string]string{"authorization": "Bearer " + e.secret()}
	// an event that matches nobody does nothing
	res, err := SSO.HandleWebhook(context.Background(), e.p, hdr, []byte(`{"event":"deactivated","sub":"ghost"}`), time.Now())
	if err != nil || res.Matched {
		t.Fatalf("unknown person: %v %+v", err, res)
	}
	if e.roleOf(u.Id) == "" {
		t.Fatal("an unmatched event must not touch anybody")
	}
	// matched by e-mail
	res, err = SSO.HandleWebhook(context.Background(), e.p, hdr, []byte(fmt.Sprintf(`{"event":"deactivated","email":%q}`, "w@x.example")), time.Now())
	if err != nil || !res.Matched {
		t.Fatalf("deactivation: %v %+v", err, res)
	}
	if e.roleOf(u.Id) != "" {
		t.Fatalf("the managed role must go: %s", e.roleOf(u.Id))
	}
	var got model.APIToken
	database.GetDB().First(&got, tok.Id)
	if got.RevokedAt == nil {
		t.Fatal("tokens revoked")
	}
}

func TestWebhookUpdatedReChecksThePersonNow(t *testing.T) {
	e := newResyncEnv(t)
	database.GetDB().First(e.p, e.p.Id)
	u := e.login(authntest.Claims{Sub: "w2", Email: "u@x.example", EmailVerified: true, Groups: []string{"view"}})
	e.idp.SetUser(authntest.Claims{Sub: "w2", Email: "u@x.example", EmailVerified: true, Groups: []string{"ops"}})
	res, err := SSO.HandleWebhook(context.Background(), e.p, map[string]string{"authorization": "Bearer " + e.secret()}, []byte(`{"event":"updated","sub":"w2"}`), time.Now())
	if err != nil || !res.Matched || e.roleOf(u.Id) != e.operator.Name {
		t.Fatalf("%v %+v role=%s", err, res, e.roleOf(u.Id))
	}
}

func TestWebhookAmbiguousMatchTouchesNobodyAndLastAdminIsSafe(t *testing.T) {
	e := newResyncEnv(t)
	database.GetDB().First(e.p, e.p.Id)
	a := e.login(authntest.Claims{Sub: "d1", Email: "same@x.example", EmailVerified: true, Groups: []string{"view"}})
	b := e.login(authntest.Claims{Sub: "d2", Email: "same@x.example", EmailVerified: true, Groups: []string{"view"}})
	hdr := map[string]string{"authorization": "Bearer " + e.secret()}
	res, _ := SSO.HandleWebhook(context.Background(), e.p, hdr, []byte(`{"event":"deactivated","email":"same@x.example"}`), time.Now())
	if res.Matched || e.roleOf(a.Id) == "" || e.roleOf(b.Id) == "" {
		t.Fatalf("two people share the address: nobody may be cut off (%+v)", res)
	}
	// the last administrator keeps the role, but the sessions end
	var adminRole model.Role
	database.GetDB().Where("system_key = 'administrator'").First(&adminRole)
	database.GetDB().Model(&model.User{}).Where("deleted_at IS NULL").Update("enabled", false)
	e.rule(authn.RuleGroup, "root", adminRole.Id)
	root := e.login(authntest.Claims{Sub: "root1", Email: "root@x.example", EmailVerified: true, Groups: []string{"root"}})
	SSO.HandleWebhook(context.Background(), e.p, hdr, []byte(`{"event":"deleted","sub":"root1"}`), time.Now())
	if e.roleOf(root.Id) != adminRole.Name {
		t.Fatal("the last administrator must not be left without a role")
	}
}

func TestWebhookIsOffWithoutASecret(t *testing.T) {
	e := newResyncEnv(t)
	in := ProviderInput{Key: "idp", Name: "IdP", Preset: "oidc", Enabled: true, ClientId: e.idp.ClientID, Params: map[string]string{"issuer": e.idp.Issuer()},
		RoleMode: "idp", NoMatch: "deny", ClearWebhook: true}
	SSO.SaveProvider(e.admin, e.p.Id, in)
	database.GetDB().First(e.p, e.p.Id)
	if _, err := SSO.HandleWebhook(context.Background(), e.p, map[string]string{"authorization": "Bearer "}, []byte(`{"event":"updated"}`), time.Now()); err == nil {
		t.Fatal("no secret, no webhook")
	}
}
