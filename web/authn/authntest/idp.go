// Package authntest is a small in-process OpenID Connect provider for tests: discovery, signing keys, a token endpoint that
// checks PKCE, and a user-info endpoint. It behaves like Authentik or Keycloak as far as the panel can tell.
package authntest

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// IdP is the fake provider.
type IdP struct {
	T        *testing.T
	Srv      *httptest.Server
	Key      *rsa.PrivateKey
	Kid      string
	ClientID string
	Secret   string

	mu    sync.Mutex
	codes map[string]*Grant
	// User is what the provider says about the person who signs in; tests change it between sign-ins.
	User Claims
	// Tamper, when set, edits the ID token claims before signing (to produce invalid tokens).
	Tamper func(c jwt.MapClaims)
	// SignWith replaces the signing key (a token signed by somebody else).
	SignWith *rsa.PrivateKey
	// UserInfoSub, when set, makes the user-info endpoint answer for a different subject.
	UserInfoSub string
	// Calls counts hits per path.
	Calls map[string]int

	// OfflineAccess makes the provider issue refresh tokens (rotating: each use returns a new one and kills the old one).
	OfflineAccess bool
	users         map[string]Claims // the current state of each person, as the provider would say it now
	refresh       map[string]string // refresh token -> subject
	revoked       map[string]bool   // subject -> deactivated
}

// SetUser changes what the provider says about a person from now on (group membership, e-mail, ...).
func (p *IdP) SetUser(c Claims) {
	p.mu.Lock()
	p.users[c.Sub] = c
	p.mu.Unlock()
}

// Deactivate makes the provider refuse every refresh token of the person.
func (p *IdP) Deactivate(sub string) {
	p.mu.Lock()
	p.revoked[sub] = true
	p.mu.Unlock()
}

// Claims is the user the provider authenticates.
type Claims struct {
	Sub           string
	Email         string
	EmailVerified bool
	Name          string
	Username      string
	Groups        []string
}

// Grant is an authorization code that was issued.
type Grant struct {
	Nonce     string
	Challenge string
	User      Claims
}

// New starts a provider. The issuer is its own URL.
func New(t *testing.T) *IdP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	p := &IdP{T: t, Key: key, Kid: "k1", ClientID: "sharx-client", Secret: "s3cret", codes: map[string]*Grant{}, Calls: map[string]int{}, users: map[string]Claims{}, refresh: map[string]string{}, revoked: map[string]bool{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", p.discovery)
	mux.HandleFunc("/jwks", p.jwks)
	mux.HandleFunc("/token", p.token)
	mux.HandleFunc("/userinfo", p.userinfo)
	p.Srv = httptest.NewServer(mux)
	t.Cleanup(p.Srv.Close)
	return p
}

func (p *IdP) count(path string) {
	p.mu.Lock()
	p.Calls[path]++
	p.mu.Unlock()
}

// Issuer is the issuer URL.
func (p *IdP) Issuer() string { return p.Srv.URL }

func (p *IdP) discovery(w http.ResponseWriter, r *http.Request) {
	p.count("discovery")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"issuer": p.Srv.URL, "authorization_endpoint": p.Srv.URL + "/authorize", "token_endpoint": p.Srv.URL + "/token",
		"userinfo_endpoint": p.Srv.URL + "/userinfo", "jwks_uri": p.Srv.URL + "/jwks",
	})
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func (p *IdP) jwks(w http.ResponseWriter, r *http.Request) {
	p.count("jwks")
	pub := p.Key.PublicKey
	_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{
		"kty": "RSA", "use": "sig", "alg": "RS256", "kid": p.Kid, "n": b64(pub.N.Bytes()), "e": b64(big.NewInt(int64(pub.E)).Bytes()),
	}}})
}

// Authorize simulates the user approving the request that the panel redirected to: it records the nonce and PKCE challenge
// from the authorization URL and returns the code to send to the callback.
func (p *IdP) Authorize(authURL string) (code, state string) {
	p.T.Helper()
	u, err := url.Parse(authURL)
	if err != nil {
		p.T.Fatal(err)
	}
	q := u.Query()
	code = "code-" + q.Get("state")[:6]
	p.mu.Lock()
	p.codes[code] = &Grant{Nonce: q.Get("nonce"), Challenge: q.Get("code_challenge"), User: p.User}
	p.users[p.User.Sub] = p.User
	delete(p.revoked, p.User.Sub)
	p.mu.Unlock()
	return code, q.Get("state")
}

func (p *IdP) token(w http.ResponseWriter, r *http.Request) {
	p.count("token")
	_ = r.ParseForm()
	user, pass, basic := r.BasicAuth()
	if basic {
		user, _ = url.QueryUnescape(user)
		pass, _ = url.QueryUnescape(pass)
	} else {
		user, pass = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	}
	if user != p.ClientID || pass != p.Secret {
		http.Error(w, `{"error":"invalid_client"}`, http.StatusUnauthorized)
		return
	}
	if r.PostForm.Get("grant_type") == "refresh_token" {
		p.refreshGrant(w, r.PostForm.Get("refresh_token"))
		return
	}
	p.mu.Lock()
	g := p.codes[r.PostForm.Get("code")]
	delete(p.codes, r.PostForm.Get("code")) // a code works once
	p.mu.Unlock()
	if g == nil {
		http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
		return
	}
	if g.Challenge != "" {
		sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
		if b64(sum[:]) != g.Challenge {
			http.Error(w, `{"error":"invalid_grant","error_description":"PKCE"}`, http.StatusBadRequest)
			return
		}
	}
	now := time.Now()
	claims := jwt.MapClaims{
		"iss": p.Srv.URL, "aud": p.ClientID, "sub": g.User.Sub, "iat": now.Unix(), "exp": now.Add(10 * time.Minute).Unix(), "nonce": g.Nonce,
		"email": g.User.Email, "email_verified": g.User.EmailVerified, "name": g.User.Name, "preferred_username": g.User.Username,
	}
	if p.Tamper != nil {
		p.Tamper(claims)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = p.Kid
	key := p.Key
	if p.SignWith != nil {
		key = p.SignWith
	}
	signed, err := tok.SignedString(key)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	p.mu.Lock()
	p.codes["at:"+signed[len(signed)-8:]] = g
	p.mu.Unlock()
	out := map[string]any{"access_token": "at-" + signed[len(signed)-8:], "id_token": signed, "token_type": "Bearer"}
	if p.OfflineAccess {
		rt := "rt-" + signed[len(signed)-10:]
		p.mu.Lock()
		p.refresh[rt] = g.User.Sub
		p.mu.Unlock()
		out["refresh_token"] = rt
	}
	_ = json.NewEncoder(w).Encode(out)
}

func (p *IdP) refreshGrant(w http.ResponseWriter, rt string) {
	p.mu.Lock()
	sub, ok := p.refresh[rt]
	delete(p.refresh, rt) // rotation: a refresh token works once
	dead := p.revoked[sub]
	u := p.users[sub]
	p.mu.Unlock()
	if !ok || dead {
		http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
		return
	}
	at := "at-" + b64([]byte(sub + time.Now().String()))[:10]
	nrt := "rt-" + b64([]byte(rt + "x"))[:12]
	p.mu.Lock()
	p.codes["at:"+at[len(at)-8:]] = &Grant{User: u}
	p.refresh[nrt] = sub
	p.mu.Unlock()
	_ = json.NewEncoder(w).Encode(map[string]any{"access_token": at, "refresh_token": nrt, "token_type": "Bearer"})
}

func (p *IdP) userinfo(w http.ResponseWriter, r *http.Request) {
	p.count("userinfo")
	at := r.Header.Get("Authorization")
	if len(at) < 8 {
		http.Error(w, "no token", http.StatusUnauthorized)
		return
	}
	p.mu.Lock()
	g := p.codes["at:"+at[len(at)-8:]]
	p.mu.Unlock()
	if g == nil {
		http.Error(w, "bad token", http.StatusUnauthorized)
		return
	}
	p.mu.Lock()
	if cur, ok := p.users[g.User.Sub]; ok {
		g.User = cur
	}
	p.mu.Unlock()
	sub := g.User.Sub
	if p.UserInfoSub != "" {
		sub = p.UserInfoSub
	}
	groups := g.User.Groups
	if groups == nil {
		groups = []string{}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"sub": sub, "email": g.User.Email, "email_verified": g.User.EmailVerified, "name": g.User.Name,
		"preferred_username": g.User.Username, "groups": groups})
}
