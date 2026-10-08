package authn

import (
	"context"
	"crypto/ecdsa"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ---------- Sign in with Apple ----------

// AppleSecret builds the client secret Apple wants: a short-lived ES256 JWT signed with the developer's key.
func AppleSecret(teamID, keyID, clientID, privateKeyPEM string, now time.Time) (string, error) {
	block, _ := pem.Decode([]byte(privateKeyPEM))
	if block == nil {
		return "", errors.New("the Apple private key is not PEM (paste the contents of the .p8 file)")
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("the Apple private key cannot be read: %w", err)
	}
	ec, ok := k.(*ecdsa.PrivateKey)
	if !ok {
		return "", errors.New("the Apple private key must be an EC key")
	}
	t := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"iss": teamID, "iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(), "aud": "https://appleid.apple.com", "sub": clientID,
	})
	t.Header["kid"] = keyID
	return t.SignedString(ec)
}

// mergeAppleName reads Apple's one-time "user" JSON ({"name":{"firstName":..,"lastName":..},"email":..}).
func mergeAppleName(claims map[string]any, hint string) {
	var u struct {
		Name struct {
			First string `json:"firstName"`
			Last  string `json:"lastName"`
		} `json:"name"`
	}
	if json.Unmarshal([]byte(hint), &u) != nil {
		return
	}
	if n := strings.TrimSpace(u.Name.First + " " + u.Name.Last); n != "" {
		if cur, _ := claims["name"].(string); cur == "" {
			claims["name"] = n
		}
	}
}

// ---------- VK ID ----------

// completeVK finishes a VK ID sign-in (OAuth 2.1 with PKCE). VK adds a device_id to the redirect, wants it in the token
// request, and serves the profile from a POST endpoint.
func (p *Provider) completeVK(ctx context.Context, code string, fl Flow) (*Identity, error) {
	if fl.DeviceID == "" {
		return nil, errors.New("VK did not return a device id")
	}
	form := url.Values{
		"grant_type": {"authorization_code"}, "code": {code}, "code_verifier": {fl.Verifier}, "client_id": {p.Cfg.ClientID},
		"device_id": {fl.DeviceID}, "redirect_uri": {fl.RedirectURI}, "state": {fl.State},
	}
	var t Tokens
	if err := postForm(ctx, p.Cfg.TokenURL, form, "", "", &t); err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}
	if t.AccessToken == "" {
		return nil, errors.New("token exchange: the provider returned no access token")
	}
	var out struct {
		User map[string]any `json:"user"`
	}
	if err := postForm(ctx, p.Cfg.UserInfoURL, url.Values{"client_id": {p.Cfg.ClientID}, "access_token": {t.AccessToken}}, "", "", &out); err != nil {
		return nil, fmt.Errorf("userinfo: %w", err)
	}
	if out.User == nil {
		return nil, errors.New("userinfo: empty answer")
	}
	if n := strings.TrimSpace(asString(out.User["first_name"]) + " " + asString(out.User["last_name"])); n != "" {
		out.User["name"] = n
	}
	id := ExtractIdentity(out.User, p.Cfg.Claims)
	if id.Subject == "" {
		return nil, errors.New("the provider returned no stable user id")
	}
	id.RefreshToken = t.RefreshToken
	return &id, nil
}

// ---------- Telegram Login widget ----------

// VerifyTelegram checks the signed payload that the Telegram Login widget sends to the callback: the hash is an HMAC-SHA256
// over the sorted "key=value" lines, keyed with SHA-256 of the bot token, and the authorization must be fresh.
func VerifyTelegram(botToken string, q url.Values, now time.Time, maxAge time.Duration) (*Identity, error) {
	hash := q.Get("hash")
	if hash == "" || botToken == "" {
		return nil, errors.New("telegram: no signature")
	}
	var lines []string
	for k, v := range q {
		if k == "hash" || len(v) == 0 {
			continue
		}
		lines = append(lines, k+"="+v[0])
	}
	sort.Strings(lines)
	key := sha256.Sum256([]byte(botToken))
	mac := hmac.New(sha256.New, key[:])
	mac.Write([]byte(strings.Join(lines, "\n")))
	want := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(strings.ToLower(hash))) {
		return nil, errors.New("telegram: the signature does not match")
	}
	authDate, err := strconv.ParseInt(q.Get("auth_date"), 10, 64)
	if err != nil {
		return nil, errors.New("telegram: no authorization time")
	}
	age := now.Sub(time.Unix(authDate, 0))
	if age > maxAge || age < -2*time.Minute {
		return nil, errors.New("telegram: the authorization is not fresh")
	}
	id := q.Get("id")
	if id == "" {
		return nil, errors.New("telegram: no user id")
	}
	name := strings.TrimSpace(q.Get("first_name") + " " + q.Get("last_name"))
	return &Identity{Subject: id, Name: name, Username: q.Get("username"), Claims: map[string]any{}}, nil
}
