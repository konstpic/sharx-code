package authn

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Config describes one provider. Everything that differs between providers is data here; the code is the same for all.
type Config struct {
	Kind         string // "oidc" (ID token, discovery) or "oauth2" (plain; identity from a user-info endpoint)
	Issuer       string
	AuthURL      string
	TokenURL     string
	UserInfoURL  string
	JWKSURL      string
	EmailsURL    string // optional extra endpoint listing e-mails (GitHub style: [{email, primary, verified}])
	Scopes       []string
	PKCE         bool
	TokenAuth    string // "basic" (default) or "post": how the client authenticates at the token endpoint
	Claims       ClaimMap
	TrustEmail   bool              // the provider only ever returns verified addresses and does not say so
	ExtraParams  map[string]string // added to the authorization request (prompt, hd, ...)
	ClientID     string
	ClientSecret string
}

// Provider is a configured identity provider with its caches.
type Provider struct {
	Cfg  Config
	keys *KeyCache

	mu         sync.Mutex
	discovered bool
	discAt     time.Time
}

// SharedKeys is the signing-key cache shared by all providers.
var SharedKeys = NewKeyCache(10 * time.Minute)

// New returns a provider client for cfg.
func New(cfg Config) *Provider { return &Provider{Cfg: cfg, keys: SharedKeys} }

type discovery struct {
	Issuer      string `json:"issuer"`
	AuthURL     string `json:"authorization_endpoint"`
	TokenURL    string `json:"token_endpoint"`
	UserInfoURL string `json:"userinfo_endpoint"`
	JWKSURL     string `json:"jwks_uri"`
}

func isHTTPS(u string) bool { return strings.HasPrefix(strings.ToLower(u), "https://") }

// Discover fills the endpoints that the configuration left empty from {issuer}/.well-known/openid-configuration. The
// document's own "issuer" must equal the configured one (RFC 8414 §3.3): otherwise a different tenant's metadata could be
// substituted. Endpoints set by hand are never overwritten.
func (p *Provider) Discover(ctx context.Context) error {
	if p.Cfg.Kind != "oidc" || p.Cfg.Issuer == "" {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.discovered && time.Since(p.discAt) < time.Hour {
		return nil
	}
	if p.Cfg.AuthURL != "" && p.Cfg.TokenURL != "" && p.Cfg.JWKSURL != "" {
		p.discovered, p.discAt = true, time.Now()
		return nil
	}
	var d discovery
	if err := getJSON(ctx, strings.TrimRight(p.Cfg.Issuer, "/")+"/.well-known/openid-configuration", "", &d); err != nil {
		return fmt.Errorf("discovery failed: %w", err)
	}
	if strings.TrimRight(d.Issuer, "/") != strings.TrimRight(p.Cfg.Issuer, "/") {
		return fmt.Errorf("discovery: issuer mismatch (configured %q, provider says %q)", p.Cfg.Issuer, d.Issuer)
	}
	set := func(dst *string, v string) {
		if *dst == "" {
			*dst = v
		}
	}
	set(&p.Cfg.AuthURL, d.AuthURL)
	set(&p.Cfg.TokenURL, d.TokenURL)
	set(&p.Cfg.UserInfoURL, d.UserInfoURL)
	set(&p.Cfg.JWKSURL, d.JWKSURL)
	p.discovered, p.discAt = true, time.Now()
	return nil
}

// AuthorizeURL builds the authorization request (code flow, PKCE S256 when enabled, nonce for OIDC).
func (p *Provider) AuthorizeURL(redirectURI, state, nonce, verifier string) (string, error) {
	if p.Cfg.AuthURL == "" {
		return "", errors.New("no authorization endpoint")
	}
	u, err := url.Parse(p.Cfg.AuthURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", p.Cfg.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("state", state)
	if len(p.Cfg.Scopes) > 0 {
		q.Set("scope", strings.Join(p.Cfg.Scopes, " "))
	}
	if p.Cfg.Kind == "oidc" {
		q.Set("nonce", nonce)
	}
	if p.Cfg.PKCE {
		q.Set("code_challenge", ChallengeS256(verifier))
		q.Set("code_challenge_method", "S256")
	}
	for k, v := range p.Cfg.ExtraParams {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// Tokens is the part of the token response that is used. The access token is used once (user info) and then dropped.
type Tokens struct {
	AccessToken string `json:"access_token"`
	IDToken     string `json:"id_token"`
	TokenType   string `json:"token_type"`
}

// Exchange trades the authorization code for tokens.
func (p *Provider) Exchange(ctx context.Context, code, redirectURI, verifier string) (*Tokens, error) {
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {redirectURI}}
	if p.Cfg.PKCE {
		form.Set("code_verifier", verifier)
	}
	var t Tokens
	var err error
	if p.Cfg.TokenAuth == "post" {
		form.Set("client_id", p.Cfg.ClientID)
		form.Set("client_secret", p.Cfg.ClientSecret)
		err = postForm(ctx, p.Cfg.TokenURL, form, "", "", &t)
	} else {
		if p.Cfg.ClientSecret == "" { // public client: identify by client_id in the body
			form.Set("client_id", p.Cfg.ClientID)
			err = postForm(ctx, p.Cfg.TokenURL, form, "", "", &t)
		} else {
			err = postForm(ctx, p.Cfg.TokenURL, form, p.Cfg.ClientID, p.Cfg.ClientSecret, &t)
		}
	}
	if err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}
	if t.AccessToken == "" && t.IDToken == "" {
		return nil, errors.New("token exchange: the provider returned no tokens")
	}
	return &t, nil
}

var allowedAlgs = []string{"RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"}

// VerifyIDToken checks signature (against the provider's published keys, asymmetric algorithms only), issuer, audience (and
// authorized party when there are several), expiry, not-before, issued-at and nonce. It returns the claims.
func (p *Provider) VerifyIDToken(ctx context.Context, raw, nonce string, now time.Time) (map[string]any, error) {
	if p.Cfg.JWKSURL == "" {
		return nil, errors.New("no signing keys configured for this provider")
	}
	claims := jwt.MapClaims{}
	parser := jwt.NewParser(
		jwt.WithValidMethods(allowedAlgs),
		jwt.WithIssuer(p.Cfg.Issuer),
		jwt.WithAudience(p.Cfg.ClientID),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(60*time.Second),
		jwt.WithTimeFunc(func() time.Time { return now }),
	)
	_, err := parser.ParseWithClaims(raw, claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return p.keys.Key(ctx, p.Cfg.JWKSURL, kid)
	})
	if err != nil {
		return nil, fmt.Errorf("invalid ID token: %w", err)
	}
	if got, _ := claims["nonce"].(string); !SameBinding(got, nonce) {
		return nil, errors.New("invalid ID token: nonce mismatch")
	}
	if aud, ok := claims["aud"].([]any); ok && len(aud) > 1 {
		if azp, _ := claims["azp"].(string); azp != p.Cfg.ClientID {
			return nil, errors.New("invalid ID token: authorized party mismatch")
		}
	}
	if iat, err := claims.GetIssuedAt(); err == nil && iat != nil && iat.Time.After(now.Add(5*time.Minute)) {
		return nil, errors.New("invalid ID token: issued in the future")
	}
	return map[string]any(claims), nil
}

// UserInfo fetches the user-info endpoint with the access token.
func (p *Provider) UserInfo(ctx context.Context, accessToken string) (map[string]any, error) {
	if p.Cfg.UserInfoURL == "" || accessToken == "" {
		return nil, nil
	}
	var m map[string]any
	if err := getJSON(ctx, p.Cfg.UserInfoURL, accessToken, &m); err != nil {
		return nil, fmt.Errorf("userinfo: %w", err)
	}
	return m, nil
}

type emailEntry struct {
	Email    string `json:"email"`
	Primary  bool   `json:"primary"`
	Verified bool   `json:"verified"`
}

// Complete finishes a sign-in: it exchanges the code, validates what the provider sent and returns the identity. The access
// token is not kept.
func (p *Provider) Complete(ctx context.Context, code string, fl Flow, now time.Time) (*Identity, error) {
	if err := p.Discover(ctx); err != nil {
		return nil, err
	}
	toks, err := p.Exchange(ctx, code, fl.RedirectURI, fl.Verifier)
	if err != nil {
		return nil, err
	}
	merged := map[string]any{}
	var idSub string
	if p.Cfg.Kind == "oidc" {
		if toks.IDToken == "" {
			return nil, errors.New("the provider returned no ID token (is the openid scope enabled?)")
		}
		idc, err := p.VerifyIDToken(ctx, toks.IDToken, fl.Nonce, now)
		if err != nil {
			return nil, err
		}
		for k, v := range idc {
			merged[k] = v
		}
		idSub, _ = idc["sub"].(string)
		if idSub == "" {
			return nil, errors.New("invalid ID token: no subject")
		}
	}
	// Claims that are not in the ID token (groups, e-mail) usually come from the user-info endpoint. OIDC Core §5.3.2: its
	// "sub" must equal the ID token's, otherwise the answer belongs to someone else and is ignored.
	if ui, err := p.UserInfo(ctx, toks.AccessToken); err != nil {
		if p.Cfg.Kind == "oauth2" {
			return nil, err
		}
	} else if ui != nil {
		if p.Cfg.Kind == "oidc" {
			if s, _ := ui["sub"].(string); s != idSub {
				return nil, errors.New("userinfo subject does not match the ID token")
			}
		}
		for k, v := range ui {
			if _, have := merged[k]; !have || p.Cfg.Kind == "oauth2" {
				merged[k] = v
			}
		}
	}
	if p.Cfg.EmailsURL != "" && toks.AccessToken != "" {
		var list []emailEntry
		if err := getJSON(ctx, p.Cfg.EmailsURL, toks.AccessToken, &list); err == nil {
			for _, e := range list {
				if e.Primary && e.Verified {
					merged["email"], merged["email_verified"] = e.Email, true
				}
			}
		}
	}
	id := ExtractIdentity(merged, p.Cfg.Claims)
	if p.Cfg.TrustEmail && id.Email != "" {
		id.EmailVerified = true
	}
	if id.Subject == "" {
		return nil, errors.New("the provider returned no stable user id")
	}
	return &id, nil
}
