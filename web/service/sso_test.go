package service

import (
	"errors"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/rbac"
)

// These tests need PostgreSQL (SHARX_TEST_DB), like the access-control tests.

type ssoEnv struct {
	*rbacEnv
	p *model.AuthProvider
}

func setupSSO(t *testing.T, mutate func(in *ProviderInput)) *ssoEnv {
	t.Helper()
	e := &ssoEnv{rbacEnv: setupRBAC(t)}
	in := ProviderInput{Key: "authentik", Name: "Authentik", Preset: "authentik", Enabled: true, ClientId: "cid", ClientSecret: ptr("sec"),
		Params: map[string]string{"baseUrl": "https://auth.example.com", "slug": "sharx"}, AllowSignup: true, RoleMode: "idp", NoMatch: "deny"}
	if mutate != nil {
		mutate(&in)
	}
	v, err := SSO.SaveProvider(e.admin, 0, in)
	if err != nil {
		t.Fatalf("save provider: %v", err)
	}
	var p model.AuthProvider
	if err := database.GetDB().First(&p, v.Id).Error; err != nil {
		t.Fatal(err)
	}
	e.p = &p
	return e
}

func ptr[T any](v T) *T { return &v }

func (e *ssoEnv) rule(kind, value string, roleID int) {
	e.t.Helper()
	if _, err := SSO.SaveRule(e.admin, 0, RuleInput{ProviderId: &e.p.Id, Position: 0, Kind: kind, Value: value, RoleId: roleID, Enabled: true}); err != nil {
		e.t.Fatalf("rule %s=%s: %v", kind, value, err)
	}
}

func ident(sub, email string, verified bool, groups ...string) authn.Identity {
	return authn.Identity{Subject: sub, Email: email, EmailVerified: verified, Username: strings.Split(email, "@")[0], Name: sub, Groups: groups, Claims: map[string]any{}}
}

func (e *ssoEnv) roleOf(userID int) string {
	e.t.Helper()
	var u model.User
	database.GetDB().First(&u, userID)
	if u.RoleId == nil {
		return ""
	}
	var r model.Role
	database.GetDB().First(&r, *u.RoleId)
	return r.Name
}

func TestSecretIsStoredSealedAndNeverReturned(t *testing.T) {
	e := setupSSO(t, nil)
	if !strings.HasPrefix(e.p.ClientSecret, "enc:v1:") || strings.Contains(e.p.ClientSecret, "sec") && !strings.HasPrefix(e.p.ClientSecret, "enc:v1:") {
		t.Fatalf("stored: %q", e.p.ClientSecret)
	}
	list, _ := SSO.ListProviders()
	if !list[0].HasSecret {
		t.Fatal("the view says there is a secret")
	}
	// updating without a secret keeps it
	in := ProviderInput{Key: "authentik", Name: "Authentik 2", Preset: "authentik", Enabled: true, ClientId: "cid", Params: map[string]string{"baseUrl": "https://auth.example.com", "slug": "sharx"}, RoleMode: "idp", NoMatch: "deny"}
	if _, err := SSO.SaveProvider(e.admin, e.p.Id, in); err != nil {
		t.Fatal(err)
	}
	var again model.AuthProvider
	database.GetDB().First(&again, e.p.Id)
	if again.ClientSecret != e.p.ClientSecret {
		t.Fatal("an update without a secret must keep the stored one")
	}
}

func TestProviderConfigurationIsValidated(t *testing.T) {
	e := setupRBAC(t)
	bad := []ProviderInput{
		{Key: "Bad Key", Name: "x", Preset: "oidc", Params: map[string]string{"issuer": "https://i.example"}},
		{Key: "plain", Name: "x", Preset: "oidc", Params: map[string]string{"issuer": "http://idp.example.com"}},
		{Key: "apple", Name: "x", Preset: "apple"},
		{Key: "noid", Name: "x", Preset: "oidc", Enabled: true, Params: map[string]string{"issuer": "https://i.example"}},
		{Key: "nodef", Name: "x", Preset: "oidc", NoMatch: "default", Params: map[string]string{"issuer": "https://i.example"}},
	}
	for i, in := range bad {
		if _, err := SSO.SaveProvider(e.admin, 0, in); !errors.Is(err, ErrInvalid) {
			t.Fatalf("case %d: want invalid, got %v", i, err)
		}
	}
}

func TestFirstSignInCreatesTheUserWithTheRoleOfTheMatchingRule(t *testing.T) {
	e := setupSSO(t, nil)
	admins := e.role(rbac.GroupsRead, rbac.ClientsRead)
	e.rule(authn.RuleGroup, "sharx-ops", admins.Id)
	u, err := SSO.SignIn(e.p, ident("sub-1", "ann@corp.example", true, "sharx-ops"), "1.2.3.4", 0)
	if err != nil {
		t.Fatal(err)
	}
	if e.roleOf(u.Id) != admins.Name {
		t.Fatalf("role: %s", e.roleOf(u.Id))
	}
	var got model.User
	database.GetDB().First(&got, u.Id)
	if !got.RoleManaged || got.AuthSource != "authentik" || got.Email != "ann@corp.example" || !got.Enabled {
		t.Fatalf("user: %+v", got)
	}
	if !(&RBACService{}).CanSignIn(&got) {
		t.Fatal("the new user can sign in")
	}
	// the password is random: nobody can use the password form for this account
	if SSO.LocalLoginEnabled() != true {
		t.Fatal("default")
	}
}

func TestSignInWithoutAnAccountAndWithoutSignupIsRefused(t *testing.T) {
	e := setupSSO(t, func(in *ProviderInput) { in.AllowSignup = false })
	_, err := SSO.SignIn(e.p, ident("sub-1", "ann@corp.example", true, "x"), "ip", 0)
	var se *SSOError
	if !errors.As(err, &se) || se.Code != "no_account" {
		t.Fatalf("want no_account, got %v", err)
	}
	var n int64
	database.GetDB().Model(&model.User{}).Where("email = ?", "ann@corp.example").Count(&n)
	if n != 0 {
		t.Fatal("no account may be created")
	}
}

func TestNoMatchingRuleDeniesNewUsers(t *testing.T) {
	e := setupSSO(t, nil)
	e.rule(authn.RuleGroup, "sharx-ops", e.role(rbac.GroupsRead).Id)
	_, err := SSO.SignIn(e.p, ident("sub-2", "bob@corp.example", true, "marketing"), "ip", 0)
	var se *SSOError
	if !errors.As(err, &se) || se.Code != "no_access" {
		t.Fatalf("deny by default: %v", err)
	}
}

func TestRoleFollowsTheProviderAtTheNextSignInAndIsRevoked(t *testing.T) {
	e := setupSSO(t, nil)
	viewer := e.role(rbac.ClientsRead)
	editor := e.role(rbac.ClientsRead, rbac.ClientsUpdate)
	// rules: ops -> editor, staff -> viewer (the first match wins)
	e.rule(authn.RuleGroup, "ops", editor.Id)
	e.rule(authn.RuleGroup, "staff", viewer.Id)
	u, err := SSO.SignIn(e.p, ident("sub-1", "cy@corp.example", true, "ops", "staff"), "ip", 0)
	if err != nil {
		t.Fatal(err)
	}
	if e.roleOf(u.Id) != editor.Name {
		t.Fatalf("start: %s", e.roleOf(u.Id))
	}
	// removed from ops in the provider: demoted at the next sign-in
	if _, err := SSO.SignIn(e.p, ident("sub-1", "cy@corp.example", true, "staff"), "ip", 0); err != nil {
		t.Fatal(err)
	}
	if e.roleOf(u.Id) != viewer.Name {
		t.Fatalf("demotion: %s", e.roleOf(u.Id))
	}
	// removed from everything: access revoked, sessions of the user end, sign-in refused
	_, err = SSO.SignIn(e.p, ident("sub-1", "cy@corp.example", true, "other"), "ip", 0)
	var se *SSOError
	if !errors.As(err, &se) || se.Code != "no_access" {
		t.Fatalf("revocation: %v", err)
	}
	if e.roleOf(u.Id) != "" {
		t.Fatalf("the role must be gone: %q", e.roleOf(u.Id))
	}
	var got model.User
	database.GetDB().First(&got, u.Id)
	if (&RBACService{}).CanSignIn(&got) {
		t.Fatal("a user without a role cannot sign in")
	}
	// added to a group again: access returns
	if _, err := SSO.SignIn(e.p, ident("sub-1", "cy@corp.example", true, "ops"), "ip", 0); err != nil {
		t.Fatal(err)
	}
	if e.roleOf(u.Id) != editor.Name {
		t.Fatalf("restored: %s", e.roleOf(u.Id))
	}
	// every change is in the audit trail
	var n int64
	database.GetDB().Model(&model.AuditLog{}).Where("action IN ('auth.role_sync','auth.role_revoke')").Count(&n)
	if n < 3 {
		t.Fatalf("expected the role changes to be audited, got %d", n)
	}
}

func TestTheLastAdministratorIsNotLockedOutByTheProvider(t *testing.T) {
	e := setupSSO(t, nil)
	var adminRole model.Role
	database.GetDB().Where("system_key = 'administrator'").First(&adminRole)
	// the only administrator is a provider-managed account whose group disappears
	database.GetDB().Model(&model.User{}).Where("deleted_at IS NULL").Update("enabled", false)
	e.rule(authn.RuleGroup, "root", adminRole.Id)
	u, err := SSO.SignIn(e.p, ident("sub-9", "root@corp.example", true, "root"), "ip", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := SSO.SignIn(e.p, ident("sub-9", "root@corp.example", true, "nobody"), "ip", 0); err != nil {
		t.Fatalf("the last administrator keeps access: %v", err)
	}
	if e.roleOf(u.Id) != adminRole.Name {
		t.Fatal("the role must be kept")
	}
}

func TestAnyRuleCannotGrantAdministrator(t *testing.T) {
	e := setupSSO(t, nil)
	var adminRole model.Role
	database.GetDB().Where("system_key = 'administrator'").First(&adminRole)
	_, err := SSO.SaveRule(e.admin, 0, RuleInput{ProviderId: &e.p.Id, Kind: authn.RuleAny, RoleId: adminRole.Id, Enabled: true})
	wantErr(t, err, ErrInvalid, "an unconditional administrator rule")
}

func TestManagedRoleCannotBeChangedByHandUntilDetached(t *testing.T) {
	e := setupSSO(t, nil)
	r1, r2 := e.role(rbac.ClientsRead), e.role(rbac.GroupsRead)
	e.rule(authn.RuleGroup, "g", r1.Id)
	u, _ := SSO.SignIn(e.p, ident("s", "d@corp.example", true, "g"), "ip", 0)
	_, err := e.svc.UpdateUser(e.admin, u.Id, UserPatch{RoleId: &r2.Id})
	wantErr(t, err, ErrConflict, "manual role change of a managed user")
	if _, err := e.svc.UpdateUser(e.admin, u.Id, UserPatch{DetachRole: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.UpdateUser(e.admin, u.Id, UserPatch{RoleId: &r2.Id}); err != nil {
		t.Fatalf("after detaching the role is local: %v", err)
	}
	// and the provider no longer touches it
	if _, err := SSO.SignIn(e.p, ident("s", "d@corp.example", true, "g"), "ip", 0); err != nil {
		t.Fatal(err)
	}
	if e.roleOf(u.Id) != r2.Name {
		t.Fatalf("a detached user keeps the locally assigned role, got %s", e.roleOf(u.Id))
	}
}

func TestLocalRoleModeLeavesRolesToAdministrators(t *testing.T) {
	e := setupSSO(t, func(in *ProviderInput) {
		in.RoleMode = "local"
	})
	def := e.role(rbac.GroupsRead)
	in := ProviderInput{Key: "authentik", Name: "A", Preset: "authentik", Enabled: true, ClientId: "cid", Params: map[string]string{"baseUrl": "https://auth.example.com", "slug": "sharx"},
		AllowSignup: true, RoleMode: "local", NoMatch: "deny", DefaultRoleId: &def.Id}
	if _, err := SSO.SaveProvider(e.admin, e.p.Id, in); err != nil {
		t.Fatal(err)
	}
	database.GetDB().First(e.p, e.p.Id)
	u, err := SSO.SignIn(e.p, ident("s", "l@corp.example", true, "anything"), "ip", 0)
	if err != nil {
		t.Fatal(err)
	}
	if e.roleOf(u.Id) != def.Name {
		t.Fatalf("new users get the default role: %s", e.roleOf(u.Id))
	}
	other := e.role(rbac.ClientsRead)
	if _, err := e.svc.UpdateUser(e.admin, u.Id, UserPatch{RoleId: &other.Id}); err != nil {
		t.Fatalf("roles stay under local control: %v", err)
	}
	if _, err := SSO.SignIn(e.p, ident("s", "l@corp.example", true, "x"), "ip", 0); err != nil {
		t.Fatal(err)
	}
	if e.roleOf(u.Id) != other.Name {
		t.Fatalf("sign-in must not overwrite a locally managed role: %s", e.roleOf(u.Id))
	}
}

func TestAccountLinkingCannotBeUsedToTakeOverAnAccount(t *testing.T) {
	e := setupSSO(t, func(in *ProviderInput) { in.AllowSignup = false; in.RoleMode = "local" })
	victim := e.user("victim", e.role(rbac.ClientsRead).Id)
	var v model.User
	database.GetDB().First(&v, victim.Id)
	if _, err := e.svc.UpdateUser(e.admin, victim.Id, UserPatch{Email: ptr("victim@corp.example")}); err != nil {
		t.Fatal(err)
	}
	attacker := ident("evil-sub", "victim@corp.example", true)

	// 1. link-by-email is off: the same address changes nothing
	if _, err := SSO.SignIn(e.p, attacker, "ip", 0); err == nil {
		t.Fatal("an unknown identity must not reach an existing account through its e-mail address")
	}
	// 2. turned on: an UNVERIFIED address still does not link
	on := ProviderInput{Key: "authentik", Name: "A", Preset: "authentik", Enabled: true, ClientId: "cid", Params: map[string]string{"baseUrl": "https://auth.example.com", "slug": "sharx"},
		LinkByEmail: true, RoleMode: "local", NoMatch: "deny"}
	if _, err := SSO.SaveProvider(e.admin, e.p.Id, on); err != nil {
		t.Fatal(err)
	}
	database.GetDB().First(e.p, e.p.Id)
	if _, err := SSO.SignIn(e.p, ident("evil-sub", "victim@corp.example", false), "ip", 0); err == nil {
		t.Fatal("an unverified e-mail address must never link accounts")
	}
	// 3. verified: it links, exactly once, to that account
	u, err := SSO.SignIn(e.p, attacker, "ip", 0)
	if err != nil || u.Id != victim.Id {
		t.Fatalf("a verified address links to the owner: %v %v", u, err)
	}
	// 4. a different subject with the same address cannot take the account over afterwards
	if _, err := SSO.SignIn(e.p, ident("another-sub", "victim@corp.example", true), "ip", 0); err == nil {
		t.Fatal("the account already has an identity at this provider")
	}
	// 5. ambiguous addresses never link
	twin := e.user("twin", e.role(rbac.ClientsRead).Id)
	e.svc.UpdateUser(e.admin, twin.Id, UserPatch{Email: ptr("dup@corp.example")})
	twin2 := e.user("twin2", e.role(rbac.ClientsRead).Id)
	e.svc.UpdateUser(e.admin, twin2.Id, UserPatch{Email: ptr("dup@corp.example")})
	if _, err := SSO.SignIn(e.p, ident("dup-sub", "dup@corp.example", true), "ip", 0); err == nil {
		t.Fatal("an address held by two accounts must not link to either")
	}
}

func TestSeveralIdentitiesOnOneUser(t *testing.T) {
	e := setupSSO(t, nil)
	// a second provider
	second, err := SSO.SaveProvider(e.admin, 0, ProviderInput{Key: "github", Name: "GitHub", Preset: "github", Enabled: true, ClientId: "gh", ClientSecret: ptr("x"), RoleMode: "local", NoMatch: "deny"})
	if err != nil {
		t.Fatal(err)
	}
	var gh model.AuthProvider
	database.GetDB().First(&gh, second.Id)
	u := e.user("multi", e.role(rbac.ClientsRead).Id)

	if _, err := SSO.SignIn(e.p, ident("a-1", "m@corp.example", true), "ip", u.Id); err != nil {
		t.Fatal(err)
	}
	if _, err := SSO.SignIn(&gh, ident("gh-77", "m@users.noreply.github.com", true), "ip", u.Id); err != nil {
		t.Fatal(err)
	}
	ids, _ := SSO.Identities(u.Id)
	if len(ids) != 2 {
		t.Fatalf("both providers are linked: %+v", ids)
	}
	// each identity signs in as that user
	for _, c := range []struct {
		p  *model.AuthProvider
		id authn.Identity
	}{{e.p, ident("a-1", "m@corp.example", true)}, {&gh, ident("gh-77", "x@y", false)}} {
		got, err := SSO.SignIn(c.p, c.id, "ip", 0)
		if err != nil || got.Id != u.Id {
			t.Fatalf("sign in via %s: %v %v", c.p.Key, got, err)
		}
	}
	// the same provider account cannot be attached to a second user
	other := e.user("other", e.role(rbac.ClientsRead).Id)
	if _, err := SSO.SignIn(e.p, ident("a-1", "m@corp.example", true), "ip", other.Id); err == nil {
		t.Fatal("an identity belongs to one user only")
	}
	// one account per provider per user
	if _, err := SSO.SignIn(e.p, ident("a-2", "m2@corp.example", true), "ip", u.Id); err == nil {
		t.Fatal("a user cannot link two accounts of the same provider")
	}
}

func TestAllowListsAndDisabledUsers(t *testing.T) {
	e := setupSSO(t, func(in *ProviderInput) { in.AllowedDomains = []string{"corp.example"}; in.RoleMode = "local" })
	def := e.role(rbac.GroupsRead)
	in := ProviderInput{Key: "authentik", Name: "A", Preset: "authentik", Enabled: true, ClientId: "cid", Params: map[string]string{"baseUrl": "https://auth.example.com", "slug": "sharx"},
		AllowSignup: true, RoleMode: "local", NoMatch: "deny", DefaultRoleId: &def.Id, AllowedDomains: []string{"corp.example"}}
	SSO.SaveProvider(e.admin, e.p.Id, in)
	database.GetDB().First(e.p, e.p.Id)
	if _, err := SSO.SignIn(e.p, ident("x1", "mal@evil.example", true), "ip", 0); err == nil {
		t.Fatal("a domain outside the allow list")
	}
	if _, err := SSO.SignIn(e.p, ident("x2", "mal@corp.example", false), "ip", 0); err == nil {
		t.Fatal("an unverified address does not satisfy the allow list")
	}
	u, err := SSO.SignIn(e.p, ident("x3", "ok@corp.example", true), "ip", 0)
	if err != nil {
		t.Fatal(err)
	}
	// an administrator disables the account locally: the provider cannot bring it back
	f := false
	if _, err := e.svc.UpdateUser(e.admin, u.Id, UserPatch{Enabled: &f}); err != nil {
		t.Fatal(err)
	}
	if _, err := SSO.SignIn(e.p, ident("x3", "ok@corp.example", true), "ip", 0); err == nil {
		t.Fatal("a disabled account stays disabled")
	}
}

func TestRuleChangesAreAudited(t *testing.T) {
	e := setupSSO(t, nil)
	r := e.role(rbac.ClientsRead)
	rule, err := SSO.SaveRule(e.admin, 0, RuleInput{ProviderId: &e.p.Id, Kind: authn.RuleGroup, Value: "ops", RoleId: r.Id, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := SSO.DeleteRule(e.admin, rule.Id); err != nil {
		t.Fatal(err)
	}
	var n int64
	database.GetDB().Model(&model.AuditLog{}).Where("action IN ('sso.rule_create','sso.rule_delete','sso.provider_create')").Count(&n)
	if n != 3 {
		t.Fatalf("audit entries: %d", n)
	}
	_, _, m := DescribeAudit(model.AuditLog{ActorName: "admin", Action: "sso.rule_create", TargetName: `group ops -> r`, Result: "ok"})
	if !strings.Contains(m, "rule") {
		t.Fatalf("readable: %s", m)
	}
}
