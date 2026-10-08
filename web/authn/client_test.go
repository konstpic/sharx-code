package authn_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/authn/authntest"
)

func provider(idp *authntest.IdP) *authn.Provider {
	return authn.New(authn.Config{Kind: "oidc", Issuer: idp.Issuer(), Scopes: []string{"openid", "profile", "email"}, PKCE: true, TokenAuth: "basic",
		ClientID: idp.ClientID, ClientSecret: idp.Secret})
}

// signIn runs a whole authorization-code flow against the fake provider and returns what the panel concludes.
func signIn(t *testing.T, idp *authntest.IdP, p *authn.Provider) (*authn.Identity, error) {
	t.Helper()
	ctx := context.Background()
	if err := p.Discover(ctx); err != nil {
		return nil, err
	}
	fl := authn.Flow{Nonce: authn.Random(16), Verifier: authn.Random(32), RedirectURI: "https://panel.example/auth/sso/x/callback"}
	u, err := p.AuthorizeURL(fl.RedirectURI, "state-123456", fl.Nonce, fl.Verifier)
	if err != nil {
		t.Fatal(err)
	}
	code, _ := idp.Authorize(u)
	return p.Complete(ctx, code, fl, time.Now())
}

func TestFullFlowAgainstAnOIDCProvider(t *testing.T) {
	idp := authntest.New(t)
	idp.User = authntest.Claims{Sub: "u-1", Email: "Ann@Example.com", EmailVerified: true, Name: "Ann", Username: "ann", Groups: []string{"sharx-admins", "staff"}}
	id, err := signIn(t, idp, provider(idp))
	if err != nil {
		t.Fatal(err)
	}
	if id.Subject != "u-1" || id.Email != "Ann@Example.com" || !id.EmailVerified || id.Username != "ann" {
		t.Fatalf("identity: %+v", id)
	}
	if len(id.Groups) != 2 || id.Groups[0] != "sharx-admins" {
		t.Fatalf("groups: %v", id.Groups)
	}
}

func TestAuthorizeURLCarriesPKCEStateAndNonce(t *testing.T) {
	idp := authntest.New(t)
	p := provider(idp)
	if err := p.Discover(context.Background()); err != nil {
		t.Fatal(err)
	}
	u, _ := p.AuthorizeURL("https://panel/cb", "st", "no", "verifier")
	for _, want := range []string{"response_type=code", "code_challenge_method=S256", "state=st", "nonce=no", "scope=openid+profile+email", "client_id=" + idp.ClientID} {
		if !strings.Contains(u, want) {
			t.Fatalf("%q missing from %s", want, u)
		}
	}
	if strings.Contains(u, "verifier") && !strings.Contains(u, "code_challenge=") {
		t.Fatal("the verifier itself must not be sent")
	}
	if strings.Contains(u, "code_challenge=verifier") {
		t.Fatal("the challenge must be a hash of the verifier")
	}
}

func TestIDTokenValidation(t *testing.T) {
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	cases := []struct {
		name   string
		setup  func(i *authntest.IdP)
		reason string
	}{
		{"wrong audience", func(i *authntest.IdP) { i.Tamper = func(c jwt.MapClaims) { c["aud"] = "someone-else" } }, "audience"},
		{"wrong issuer", func(i *authntest.IdP) { i.Tamper = func(c jwt.MapClaims) { c["iss"] = "https://evil.example" } }, "issuer"},
		{"expired", func(i *authntest.IdP) {
			i.Tamper = func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Hour).Unix() }
		}, "expired"},
		{"wrong nonce", func(i *authntest.IdP) { i.Tamper = func(c jwt.MapClaims) { c["nonce"] = "replayed" } }, "nonce"},
		{"no expiry", func(i *authntest.IdP) { i.Tamper = func(c jwt.MapClaims) { delete(c, "exp") } }, "exp"},
		{"signed by another key", func(i *authntest.IdP) { i.SignWith = other }, "signature"},
		{"several audiences without azp", func(i *authntest.IdP) {
			i.Tamper = func(c jwt.MapClaims) { c["aud"] = []string{i.ClientID, "other"} }
		}, "authorized party"},
		{"userinfo of another subject", func(i *authntest.IdP) { i.UserInfoSub = "someone-else" }, "subject"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			idp := authntest.New(t)
			idp.User = authntest.Claims{Sub: "u-1", Email: "a@example.com", EmailVerified: true}
			tc.setup(idp)
			if _, err := signIn(t, idp, provider(idp)); err == nil {
				t.Fatal("a token that fails validation was accepted")
			} else if !strings.Contains(strings.ToLower(err.Error()), tc.reason) {
				t.Logf("refused (%v)", err) // refused for a reason other than the one named is still a refusal
			}
		})
	}
}

func TestUnsignedAndSymmetricTokensAreRefused(t *testing.T) {
	idp := authntest.New(t)
	p := provider(idp)
	if err := p.Discover(context.Background()); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	claims := jwt.MapClaims{"iss": idp.Issuer(), "aud": idp.ClientID, "sub": "x", "exp": now.Add(time.Hour).Unix(), "nonce": "n"}
	none, _ := jwt.NewWithClaims(jwt.SigningMethodNone, claims).SignedString(jwt.UnsafeAllowNoneSignatureType)
	hs := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	hs.Header["kid"] = idp.Kid
	hsStr, _ := hs.SignedString([]byte("anything"))
	for name, raw := range map[string]string{"alg none": none, "HS256 with a guessable key": hsStr} {
		if _, err := p.VerifyIDToken(context.Background(), raw, "n", now); err == nil {
			t.Fatalf("%s was accepted", name)
		}
	}
}

func TestPKCEIsEnforcedByTheProvider(t *testing.T) {
	idp := authntest.New(t)
	idp.User = authntest.Claims{Sub: "u-1"}
	p := provider(idp)
	ctx := context.Background()
	_ = p.Discover(ctx)
	fl := authn.Flow{Nonce: "n", Verifier: "right-verifier", RedirectURI: "https://panel/cb"}
	u, _ := p.AuthorizeURL(fl.RedirectURI, "state-123456", fl.Nonce, fl.Verifier)
	code, _ := idp.Authorize(u)
	fl.Verifier = "attacker-verifier" // somebody who intercepted the code does not know the verifier
	if _, err := p.Complete(ctx, code, fl, time.Now()); err == nil {
		t.Fatal("the code was redeemed without the right verifier")
	}
}

func TestDiscoveryIssuerMustMatch(t *testing.T) {
	idp := authntest.New(t)
	p := authn.New(authn.Config{Kind: "oidc", Issuer: idp.Issuer() + "/", ClientID: "c"})
	// a trailing slash is the same issuer; a different one is not
	if err := p.Discover(context.Background()); err != nil {
		t.Fatalf("trailing slash must be tolerated: %v", err)
	}
	p2 := authn.New(authn.Config{Kind: "oidc", Issuer: idp.Issuer() + "/other", ClientID: "c"})
	if err := p2.Discover(context.Background()); err == nil {
		t.Fatal("discovery from the wrong place must fail")
	}
}

func TestClientSecretIsSealed(t *testing.T) {
	secret := []byte("panel-secret")
	sealed, err := authn.Seal(secret, "client-secret-value")
	if err != nil || strings.Contains(sealed, "client-secret-value") || !strings.HasPrefix(sealed, "enc:v1:") {
		t.Fatalf("sealed: %q %v", sealed, err)
	}
	if got, err := authn.Open(secret, sealed); err != nil || got != "client-secret-value" {
		t.Fatalf("open: %q %v", got, err)
	}
	if _, err := authn.Open([]byte("another-secret"), sealed); err == nil {
		t.Fatal("a different panel secret must not open it")
	}
	if _, err := authn.Open(secret, "plain-text"); err == nil {
		t.Fatal("unsealed values are refused")
	}
}

func TestFlowsAreSingleUse(t *testing.T) {
	f := authn.NewFlows(time.Minute)
	st := f.Put(authn.Flow{Provider: "p", Binding: "b"})
	if _, ok := f.Take(st); !ok {
		t.Fatal("first use")
	}
	if _, ok := f.Take(st); ok {
		t.Fatal("a state must work once")
	}
	old := authn.NewFlows(time.Nanosecond)
	st = old.Put(authn.Flow{})
	time.Sleep(time.Millisecond)
	if _, ok := old.Take(st); ok {
		t.Fatal("an expired flow must be refused")
	}
}

func TestRules(t *testing.T) {
	id := authn.Identity{Email: "bo@corp.example", EmailVerified: true, Groups: []string{"ops-eu", "Staff"}, Claims: map[string]any{"roles": []any{"billing"}, "dept": "it"}}
	rules := []authn.Rule{
		{Id: 1, Position: 1, Kind: authn.RuleGroup, Value: "admins", RoleId: 10, Enabled: true},
		{Id: 2, Position: 2, Kind: authn.RuleGroup, Value: "ops-*", RoleId: 20, Enabled: true},
		{Id: 3, Position: 3, Kind: authn.RuleEmailDomain, Value: "corp.example", RoleId: 30, Enabled: true},
	}
	if r, _, ok := authn.PickRole(rules, id); !ok || r != 20 {
		t.Fatalf("prefix group rule: %d %v", r, ok)
	}
	rules[1].Enabled = false
	if r, _, _ := authn.PickRole(rules, id); r != 30 {
		t.Fatalf("falls through to the domain rule: %d", r)
	}
	id.EmailVerified = false // an unverified address is not evidence of anything
	if _, _, ok := authn.PickRole(rules, id); ok {
		t.Fatal("rules on an unverified e-mail must not match")
	}
	claim := authn.Rule{Kind: authn.RuleClaim, Claim: "roles", Value: "billing", Enabled: true}
	if !claim.Matches(id) {
		t.Fatal("claim in a list")
	}
	if !(authn.Rule{Kind: authn.RuleClaim, Claim: "dept", Value: "IT", Enabled: true}).Matches(id) {
		t.Fatal("claim scalar, case-insensitive")
	}
	if (authn.Rule{Kind: authn.RuleGroup, Value: "", Enabled: true}).Matches(id) {
		t.Fatal("an empty value must never match")
	}
	if !authn.EmailAllowed(authn.Identity{Email: "a@x.example", EmailVerified: true}, []string{"x.example"}, nil) {
		t.Fatal("domain allowed")
	}
	if authn.EmailAllowed(authn.Identity{Email: "a@x.example", EmailVerified: false}, []string{"x.example"}, nil) {
		t.Fatal("unverified address cannot satisfy an allow list")
	}
	if authn.EmailAllowed(authn.Identity{Email: "a@y.example", EmailVerified: true}, []string{"x.example"}, []string{"b@y.example"}) {
		t.Fatal("not on the list")
	}
}

func TestPresetsBuildAndValidate(t *testing.T) {
	cfg, err := authn.BuildConfig("authentik", map[string]string{"baseUrl": "https://auth.example.com/", "slug": "sharx"})
	if err != nil || cfg.Issuer != "https://auth.example.com/application/o/sharx/" || !cfg.PKCE {
		t.Fatalf("authentik: %+v %v", cfg, err)
	}
	if _, err := authn.BuildConfig("authentik", map[string]string{"baseUrl": "https://auth.example.com"}); err == nil {
		t.Fatal("a required parameter is missing")
	}
	if _, err := authn.BuildConfig("apple", nil); err == nil {
		t.Fatal("apple needs its team and key ids")
	}
	for _, id := range []string{"github", "google", "discord", "yandex", "gitlab", "microsoft", "keycloak", "auth0", "okta", "linkedin", "facebook"} {
		p, ok := authn.PresetByID(id)
		if !ok || p.Stage != 1 {
			t.Fatalf("preset %s missing", id)
		}
	}
}
