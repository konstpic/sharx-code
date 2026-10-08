package authn_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/authn/authntest"
)

func TestRefreshTokensRotateAndReflectTheProvidersCurrentState(t *testing.T) {
	idp := authntest.New(t)
	idp.OfflineAccess = true
	idp.User = authntest.Claims{Sub: "u-1", Email: "a@example.com", EmailVerified: true, Groups: []string{"ops"}}
	p := provider(idp)
	id, err := signIn(t, idp, p)
	if err != nil || id.RefreshToken == "" {
		t.Fatalf("no refresh token: %v %+v", err, id)
	}
	// the provider changes its mind about the person
	idp.SetUser(authntest.Claims{Sub: "u-1", Email: "a@example.com", EmailVerified: true, Groups: []string{"viewers"}})
	got, err := p.Resync(context.Background(), id.RefreshToken, "u-1", time.Now())
	if err != nil || len(got.Groups) != 1 || got.Groups[0] != "viewers" {
		t.Fatalf("resync: %v %+v", err, got)
	}
	if got.RefreshToken == "" || got.RefreshToken == id.RefreshToken {
		t.Fatal("the refresh token must rotate")
	}
	// the old token is dead: a stolen copy is useless once the real client has used its own
	if _, err := p.Resync(context.Background(), id.RefreshToken, "u-1", time.Now()); !authn.IsGrantRevoked(err) {
		t.Fatalf("a used refresh token must be refused as revoked: %v", err)
	}
	// deactivated at the provider
	idp.Deactivate("u-1")
	if _, err := p.Resync(context.Background(), got.RefreshToken, "u-1", time.Now()); !authn.IsGrantRevoked(err) {
		t.Fatalf("a deactivated person: %v", err)
	}
}

func TestResyncRefusesAnIdentityThatBelongsToSomebodyElse(t *testing.T) {
	idp := authntest.New(t)
	idp.OfflineAccess = true
	idp.User = authntest.Claims{Sub: "u-1"}
	p := provider(idp)
	id, _ := signIn(t, idp, p)
	if _, err := p.Resync(context.Background(), id.RefreshToken, "u-2", time.Now()); err == nil {
		t.Fatal("the refreshed identity must be the stored one")
	}
}

func ecKeyPEM(t *testing.T) (*ecdsa.PrivateKey, string) {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, _ := x509.MarshalPKCS8PrivateKey(k)
	return k, string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func TestAppleClientSecretIsASignedShortLivedJWT(t *testing.T) {
	k, pemKey := ecKeyPEM(t)
	now := time.Now()
	raw, err := authn.AppleSecret("TEAM123456", "KEY1234567", "com.example.web", pemKey, now)
	if err != nil {
		t.Fatal(err)
	}
	claims := jwt.MapClaims{}
	tok, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) { return &k.PublicKey, nil }, jwt.WithValidMethods([]string{"ES256"}))
	if err != nil || !tok.Valid {
		t.Fatalf("not verifiable with the key: %v", err)
	}
	if tok.Header["kid"] != "KEY1234567" || claims["iss"] != "TEAM123456" || claims["sub"] != "com.example.web" || claims["aud"] != "https://appleid.apple.com" {
		t.Fatalf("claims: %v %v", tok.Header, claims)
	}
	exp, _ := claims.GetExpirationTime()
	if exp.Sub(now) > 6*time.Minute {
		t.Fatal("the secret must be short-lived")
	}
	if _, err := authn.AppleSecret("T", "K", "c", "not a key", now); err == nil {
		t.Fatal("garbage key")
	}
}

func telegramQuery(token string, fields map[string]string) url.Values {
	var lines []string
	for k, v := range fields {
		lines = append(lines, k+"="+v)
	}
	sort.Strings(lines)
	key := sha256.Sum256([]byte(token))
	mac := hmac.New(sha256.New, key[:])
	mac.Write([]byte(strings.Join(lines, "\n")))
	q := url.Values{}
	for k, v := range fields {
		q.Set(k, v)
	}
	q.Set("hash", hex.EncodeToString(mac.Sum(nil)))
	return q
}

func TestTelegramLoginPayloadIsVerified(t *testing.T) {
	now := time.Now()
	fields := map[string]string{"id": "777", "first_name": "Ann", "username": "ann", "auth_date": itoa(now.Unix())}
	q := telegramQuery("123:bot-token", fields)
	id, err := authn.VerifyTelegram("123:bot-token", q, now, 10*time.Minute)
	if err != nil || id.Subject != "777" || id.Username != "ann" || id.Name != "Ann" {
		t.Fatalf("valid payload: %v %+v", err, id)
	}
	if id.EmailVerified || id.Email != "" {
		t.Fatal("telegram vouches for no e-mail")
	}
	if _, err := authn.VerifyTelegram("another-token", q, now, 10*time.Minute); err == nil {
		t.Fatal("a payload signed for another bot")
	}
	forged := telegramQuery("123:bot-token", fields)
	forged.Set("id", "1") // somebody else's account
	if _, err := authn.VerifyTelegram("123:bot-token", forged, now, 10*time.Minute); err == nil {
		t.Fatal("a tampered field")
	}
	if _, err := authn.VerifyTelegram("123:bot-token", q, now.Add(time.Hour), 10*time.Minute); err == nil {
		t.Fatal("a stale authorization (replay)")
	}
	q.Del("hash")
	if _, err := authn.VerifyTelegram("123:bot-token", q, now, 10*time.Minute); err == nil {
		t.Fatal("no signature")
	}
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

func TestVKIDExchangeUsesDeviceIDAndPostsTheProfileRequest(t *testing.T) {
	var gotToken, gotInfo url.Values
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth2/auth", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		gotToken = r.PostForm
		json.NewEncoder(w).Encode(map[string]any{"access_token": "vk-at", "refresh_token": "vk-rt", "user_id": 4242})
	})
	mux.HandleFunc("/oauth2/user_info", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		gotInfo = r.PostForm
		json.NewEncoder(w).Encode(map[string]any{"user": map[string]any{"user_id": "4242", "first_name": "Ivan", "last_name": "Petrov", "email": "ivan@example.ru"}})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	p := authn.New(authn.Config{Kind: "vk", AuthURL: srv.URL + "/authorize", TokenURL: srv.URL + "/oauth2/auth", UserInfoURL: srv.URL + "/oauth2/user_info",
		PKCE: true, ClientID: "vk-app", Claims: authn.ClaimMap{Subject: "user_id", Email: "email", Name: "name", Username: "user_id"}})
	id, err := p.Complete(context.Background(), "the-code", authn.Flow{Verifier: "ver", RedirectURI: "https://panel/cb", State: "st", DeviceID: "dev-1"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if id.Subject != "4242" || id.Name != "Ivan Petrov" || id.Email != "ivan@example.ru" {
		t.Fatalf("identity: %+v", id)
	}
	for k, want := range map[string]string{"device_id": "dev-1", "code_verifier": "ver", "client_id": "vk-app", "state": "st", "code": "the-code"} {
		if gotToken.Get(k) != want {
			t.Fatalf("token request %s = %q", k, gotToken.Get(k))
		}
	}
	if gotInfo.Get("access_token") != "vk-at" || gotInfo.Get("client_id") != "vk-app" {
		t.Fatalf("user info request: %v", gotInfo)
	}
	if _, err := p.Complete(context.Background(), "c", authn.Flow{}, time.Now()); err == nil {
		t.Fatal("a callback without device_id")
	}
}

func TestStage2PresetsAreAvailable(t *testing.T) {
	for _, id := range []string{"apple", "vk", "telegram"} {
		pr, ok := authn.PresetByID(id)
		if !ok || pr.Stage != 1 {
			t.Fatalf("%s should be configurable now", id)
		}
	}
	cfg, err := authn.BuildConfig("apple", map[string]string{"teamId": "T", "keyId": "K"})
	if err != nil || cfg.ExtraParams["response_mode"] != "form_post" || cfg.Issuer != "https://appleid.apple.com" {
		t.Fatalf("apple: %+v %v", cfg, err)
	}
}
