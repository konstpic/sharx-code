package controller

import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/authn/authntest"
	"github.com/konstpic/sharx-code/v2/web/rbac"
	"github.com/konstpic/sharx-code/v2/web/service"
)

type ssoHTTP struct {
	*httpEnv
	idp *authntest.IdP
}

func newSSOHTTP(t *testing.T) *ssoHTTP {
	e := newHTTPEnv(t)
	idp := authntest.New(t)
	s := &ssoHTTP{httpEnv: e, idp: idp}
	_, err := service.SSO.SaveProvider(e.admin, 0, service.ProviderInput{Key: "authentik", Name: "Authentik", Preset: "oidc", Enabled: true,
		ClientId: idp.ClientID, ClientSecret: &idp.Secret, Params: map[string]string{"issuer": idp.Issuer()}, AllowSignup: true, RoleMode: "idp", NoMatch: "deny",
		Overrides: service.Overrides{Claims: authn.ClaimMap{Groups: "groups"}}})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// browser is a client that follows nothing automatically: the test walks the redirects the way a browser would.
func (s *ssoHTTP) browser() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func (s *ssoHTTP) get(c *http.Client, path string) *http.Response {
	s.t.Helper()
	req, _ := http.NewRequest("GET", s.srv.URL+path, nil)
	resp, err := c.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	resp.Body.Close()
	return resp
}

// login walks start -> provider -> callback and returns the callback response and the browser.
func (s *ssoHTTP) login(c *http.Client) *http.Response {
	s.t.Helper()
	start := s.get(c, "/auth/sso/authentik/start")
	if start.StatusCode != 302 {
		s.t.Fatalf("start: %d", start.StatusCode)
	}
	code, state := s.idp.Authorize(start.Header.Get("Location"))
	return s.get(c, "/auth/sso/authentik/callback?code="+url.QueryEscape(code)+"&state="+url.QueryEscape(state))
}

func (s *ssoHTTP) me(c *http.Client) (int, map[string]any) {
	cl := &client{env: s.httpEnv, c: c}
	return cl.do("GET", "/panel/rbac/me", nil)
}

func (s *ssoHTTP) roleFor(group string, perms ...string) *service.RoleView {
	r := s.role(perms...)
	if _, err := service.SSO.SaveRule(s.admin, 0, service.RuleInput{Kind: authn.RuleGroup, Value: group, RoleId: r.Id, Enabled: true}); err != nil {
		s.t.Fatal(err)
	}
	return r
}

func TestSignInThroughAnOIDCProviderCreatesTheUserAndTheSession(t *testing.T) {
	s := newSSOHTTP(t)
	role := s.roleFor("sharx-ops", rbac.ClientsRead, rbac.GroupsRead)
	s.idp.User = authntest.Claims{Sub: "ak-1", Email: "ann@corp.example", EmailVerified: true, Username: "ann", Name: "Ann", Groups: []string{"sharx-ops"}}

	b := s.browser()
	resp := s.login(b)
	if resp.StatusCode != 302 || !strings.Contains(resp.Header.Get("Location"), "/panel/") {
		t.Fatalf("callback should land in the panel: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	code, me := s.me(b)
	if code != 200 {
		t.Fatalf("me: %d", code)
	}
	obj := me["obj"].(map[string]any)
	if obj["username"] != "ann" || obj["roleName"] != role.Name {
		t.Fatalf("signed in as: %v", obj)
	}
	// the session grants exactly the role's permissions
	cl := &client{env: s.httpEnv, c: b}
	if c, _ := cl.do("GET", "/panel/group/list", nil); c != 200 {
		t.Fatalf("allowed: %d", c)
	}
	if c, _ := cl.do("GET", "/panel/rbac/users", nil); c != 403 {
		t.Fatalf("not allowed: %d", c)
	}
}

func TestRoleChangedInTheProviderAppliesAtTheNextSignInAndRevokesAccess(t *testing.T) {
	s := newSSOHTTP(t)
	s.roleFor("sharx-ops", rbac.ClientsRead, rbac.ClientsUpdate)
	viewer := s.roleFor("sharx-view", rbac.ClientsRead)
	s.idp.User = authntest.Claims{Sub: "ak-2", Email: "bo@corp.example", EmailVerified: true, Username: "bo", Groups: []string{"sharx-ops"}}
	b := s.browser()
	s.login(b)

	s.idp.User.Groups = []string{"sharx-view"}
	b2 := s.browser()
	s.login(b2)
	if _, me := s.me(b2); me["obj"].(map[string]any)["roleName"] != viewer.Name {
		t.Fatalf("demoted: %v", me)
	}
	// the old session of the same user reads the new role at once (the role is read per request)
	if _, me := s.me(b); me["obj"].(map[string]any)["roleName"] != viewer.Name {
		t.Fatalf("an open session follows the role: %v", me)
	}

	// removed from every group: refused, and the open sessions are cut
	s.idp.User.Groups = []string{"nothing"}
	b3 := s.browser()
	resp := s.login(b3)
	if !strings.Contains(resp.Header.Get("Location"), "sso_error=no_access") {
		t.Fatalf("revoked sign-in: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	if code, _ := s.me(b); code != 401 {
		t.Fatalf("the open session must end when the provider revokes access, got %d", code)
	}
}

func TestCallbackRejectsForgedReplayedAndForeignStates(t *testing.T) {
	s := newSSOHTTP(t)
	s.roleFor("g", rbac.ClientsRead)
	s.idp.User = authntest.Claims{Sub: "ak-3", Email: "c@corp.example", EmailVerified: true, Username: "c", Groups: []string{"g"}}

	// 1. a state nobody issued
	if loc := s.get(s.browser(), "/auth/sso/authentik/callback?code=x&state=forged").Header.Get("Location"); !strings.Contains(loc, "sso_error=bad_state") {
		t.Fatalf("forged state: %s", loc)
	}
	// 2. login CSRF: the attacker starts a flow in their browser and gets a victim to open the callback in another browser
	attacker, victim := s.browser(), s.browser()
	start := s.get(attacker, "/auth/sso/authentik/start")
	code, state := s.idp.Authorize(start.Header.Get("Location"))
	cb := "/auth/sso/authentik/callback?code=" + url.QueryEscape(code) + "&state=" + url.QueryEscape(state)
	if loc := s.get(victim, cb).Header.Get("Location"); !strings.Contains(loc, "sso_error=bad_state") {
		t.Fatalf("the callback must only work in the browser that started the flow: %s", loc)
	}
	// 3. the state is gone after the failed attempt: even the right browser cannot reuse it
	if loc := s.get(attacker, cb).Header.Get("Location"); !strings.Contains(loc, "sso_error=bad_state") {
		t.Fatalf("a state is single use: %s", loc)
	}
	// 4. replay of a completed sign-in
	b := s.browser()
	start = s.get(b, "/auth/sso/authentik/start")
	code, state = s.idp.Authorize(start.Header.Get("Location"))
	cb = "/auth/sso/authentik/callback?code=" + url.QueryEscape(code) + "&state=" + url.QueryEscape(state)
	if resp := s.get(b, cb); !strings.Contains(resp.Header.Get("Location"), "/panel/") {
		t.Fatalf("first use works: %s", resp.Header.Get("Location"))
	}
	if loc := s.get(s.browser(), cb).Header.Get("Location"); !strings.Contains(loc, "sso_error=") {
		t.Fatalf("replay: %s", loc)
	}
	// 5. a provider that answers with an error
	b = s.browser()
	start = s.get(b, "/auth/sso/authentik/start")
	st := mustQuery(t, start.Header.Get("Location"), "state")
	if loc := s.get(b, "/auth/sso/authentik/callback?error=access_denied&state="+st).Header.Get("Location"); !strings.Contains(loc, "sso_error=provider_denied") {
		t.Fatalf("provider error: %s", loc)
	}
}

func mustQuery(t *testing.T, raw, key string) string {
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query().Get(key)
}

func TestProviderListIsPublicButShowsNothingSecret(t *testing.T) {
	s := newSSOHTTP(t)
	resp, err := http.Get(s.srv.URL + "/auth/providers")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	buf := make([]byte, 4096)
	n, _ := resp.Body.Read(buf)
	body := string(buf[:n])
	if !strings.Contains(body, `"key":"authentik"`) || strings.Contains(body, s.idp.Secret) || strings.Contains(body, s.idp.ClientID) {
		t.Fatalf("public list: %s", body)
	}
}

func TestOnlyAdministratorsManageProvidersAndRulesAndNoRoleCanGetThatRight(t *testing.T) {
	s := newSSOHTTP(t)
	// a role that has everything except the administrator wildcard, including auth:read
	all := s.role(rbac.AuthRead, rbac.UsersRead, rbac.UsersUpdate, rbac.RolesRead, rbac.RolesCreate, rbac.RolesUpdate)
	mgr := s.user("mgr", all.Id)
	c := s.as(mgr)
	if code, _ := c.do("GET", "/panel/auth/providers", nil); code != 200 {
		t.Fatalf("auth:read lists providers: %d", code)
	}
	for _, rq := range [][2]string{{"POST", "/panel/auth/providers"}, {"POST", "/panel/auth/rules"}, {"POST", "/panel/auth/providers/1/delete"}, {"POST", "/panel/auth/settings"}} {
		if code, _ := c.do(rq[0], rq[1], map[string]any{}); code != 403 {
			t.Fatalf("%s %s must be refused without auth:manage, got %d", rq[0], rq[1], code)
		}
	}
	// the permission cannot be put into a custom role by anybody who is not an administrator
	if _, err := s.svc.CreateRole(service.Actor{Principal: mustPrincipal(t, s, mgr), IP: "127.0.0.1"}, service.RoleInput{Name: "sneaky", Permissions: []string{rbac.AuthManage}}); err == nil {
		t.Fatal("a non-administrator granted auth:manage")
	}
	// the list does not contain the secret
	_, r := c.do("GET", "/panel/auth/providers", nil)
	if strings.Contains(toJSON(r), s.idp.Secret) {
		t.Fatalf("the client secret leaked: %v", r)
	}
}

func toJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func TestLinkingFlowAddsAnIdentityToTheSignedInUserOnly(t *testing.T) {
	s := newSSOHTTP(t)
	u := s.user("local-ann", s.role(rbac.ClientsRead).Id)
	b := s.as(u).c
	start := s.get(b, "/panel/auth/link/authentik/start")
	if start.StatusCode != 302 {
		t.Fatalf("start: %d", start.StatusCode)
	}
	s.idp.User = authntest.Claims{Sub: "ak-link", Email: "x@corp.example", EmailVerified: true, Username: "x"}
	code, state := s.idp.Authorize(start.Header.Get("Location"))
	resp := s.get(b, "/auth/sso/authentik/callback?code="+url.QueryEscape(code)+"&state="+url.QueryEscape(state))
	if !strings.Contains(resp.Header.Get("Location"), "sso_linked=1") {
		t.Fatalf("link: %s", resp.Header.Get("Location"))
	}
	var n int64
	database.GetDB().Model(&model.UserIdentity{}).Where("user_id = ? AND subject = 'ak-link'", u).Count(&n)
	if n != 1 {
		t.Fatalf("identity not linked")
	}
	// the account now signs in through the provider, keeping its own (local) role
	b2 := s.browser()
	if resp := s.login(b2); !strings.Contains(resp.Header.Get("Location"), "/panel/") {
		t.Fatalf("sign in with the linked identity: %s", resp.Header.Get("Location"))
	}
	// a link flow finished by somebody else (another browser, another user) is refused
	other := s.user("other-bob", s.role(rbac.ClientsRead).Id)
	b3 := s.as(other).c
	st := s.get(s.as(u).c, "/panel/auth/link/authentik/start") // started by local-ann in her browser
	s.idp.User = authntest.Claims{Sub: "ak-evil", Email: "e@corp.example", EmailVerified: true}
	code, state = s.idp.Authorize(st.Header.Get("Location"))
	if loc := s.get(b3, "/auth/sso/authentik/callback?code="+url.QueryEscape(code)+"&state="+url.QueryEscape(state)).Header.Get("Location"); !strings.Contains(loc, "sso_error=") {
		t.Fatalf("a link flow must be finished by the browser that started it: %s", loc)
	}
}

func TestPasswordSignInCanBeClosedForOrdinaryUsers(t *testing.T) {
	s := newSSOHTTP(t)
	if err := service.SSO.SetLocalLogin(s.admin, false); err != nil {
		t.Fatal(err)
	}
	defer service.SSO.SetLocalLogin(s.admin, true)
	if service.SSO.LocalLoginEnabled() {
		t.Fatal("flag not stored")
	}
	resp, _ := http.Get(s.srv.URL + "/auth/providers")
	buf := make([]byte, 2048)
	n, _ := resp.Body.Read(buf)
	if !strings.Contains(string(buf[:n]), `"localLogin":false`) {
		t.Fatalf("the login page is told: %s", buf[:n])
	}
}

func mustPrincipal(t *testing.T, s *ssoHTTP, id int) *service.Principal {
	service.InvalidateRBAC()
	p, err := s.svc.GetPrincipal(id)
	if err != nil || p == nil {
		t.Fatal(err)
	}
	return p
}
