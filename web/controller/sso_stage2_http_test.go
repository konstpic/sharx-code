package controller

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/authn/authntest"
	"github.com/konstpic/sharx-code/v2/web/rbac"
	"github.com/konstpic/sharx-code/v2/web/service"
)

func (s *ssoHTTP) post(c *http.Client, path string, body []byte, hdr map[string]string, ct string) (*http.Response, string) {
	s.t.Helper()
	req, _ := http.NewRequest("POST", s.srv.URL+path, bytes.NewReader(body))
	if ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := c.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer resp.Body.Close()
	buf := new(bytes.Buffer)
	buf.ReadFrom(resp.Body)
	return resp, buf.String()
}

func TestAppleFormPostCallbackBecomesAGetThatKeepsTheBinding(t *testing.T) {
	s := newSSOHTTP(t)
	s.roleFor("g", rbac.ClientsRead)
	s.idp.User = authntest.Claims{Sub: "ak-apple", Email: "a@corp.example", EmailVerified: true, Username: "apple-ann", Groups: []string{"g"}}
	b := s.browser()
	start := s.get(b, "/auth/sso/authentik/start")
	code, state := s.idp.Authorize(start.Header.Get("Location"))
	form := url.Values{"code": {code}, "state": {state}}
	resp, _ := s.post(b, "/auth/sso/authentik/callback", []byte(form.Encode()), nil, "application/x-www-form-urlencoded")
	if resp.StatusCode != http.StatusSeeOther || !strings.Contains(resp.Header.Get("Location"), "/auth/sso/authentik/callback?") {
		t.Fatalf("POST callback: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	final := s.get(b, resp.Header.Get("Location"))
	if !strings.Contains(final.Header.Get("Location"), "/panel/") {
		t.Fatalf("the redirected GET must sign in: %s", final.Header.Get("Location"))
	}
	// the same POST from a browser that did not start the flow is refused
	start = s.get(s.browser(), "/auth/sso/authentik/start")
	code, state = s.idp.Authorize(start.Header.Get("Location"))
	resp, _ = s.post(s.browser(), "/auth/sso/authentik/callback", []byte(url.Values{"code": {code}, "state": {state}}.Encode()), nil, "application/x-www-form-urlencoded")
	if loc := s.get(s.browser(), resp.Header.Get("Location")).Header.Get("Location"); !strings.Contains(loc, "sso_error=bad_state") {
		t.Fatalf("foreign browser: %s", loc)
	}
}

func telegramPayload(token string, fields map[string]string) url.Values {
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

func TestTelegramLoginWidgetFlow(t *testing.T) {
	s := newSSOHTTP(t)
	role := s.role(rbac.ClientsRead)
	token := "123456:telegram-bot-token"
	if _, err := service.SSO.SaveProvider(s.admin, 0, service.ProviderInput{Key: "tg", Name: "Telegram", Preset: "telegram", Enabled: true, ClientId: "sharx_bot",
		ClientSecret: &token, AllowSignup: true, RoleMode: "local", NoMatch: "deny", DefaultRoleId: &role.Id}); err != nil {
		t.Fatal(err)
	}
	// the login page learns the bot from the public list
	resp, _ := http.Get(s.srv.URL + "/auth/providers")
	buf := new(bytes.Buffer)
	buf.ReadFrom(resp.Body)
	resp.Body.Close()
	if !strings.Contains(buf.String(), `"botUsername":"sharx_bot"`) || strings.Contains(buf.String(), token) {
		t.Fatalf("public list: %s", buf.String())
	}
	b := s.browser()
	// the widget page asks for a state first
	req, _ := http.NewRequest("GET", s.srv.URL+"/auth/sso/tg/begin", nil)
	r, err := b.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var begin struct {
		Obj struct{ State, AuthUrl string } `json:"obj"`
	}
	json.NewDecoder(r.Body).Decode(&begin)
	r.Body.Close()
	if begin.Obj.State == "" || !strings.Contains(begin.Obj.AuthUrl, "state=") {
		t.Fatalf("begin: %+v", begin)
	}
	fields := map[string]string{"id": "5550001", "first_name": "Tom", "username": "tom_t", "auth_date": strconv.FormatInt(time.Now().Unix(), 10)}
	q := telegramPayload(token, fields)
	q.Set("state", begin.Obj.State) // the panel's own parameter is not part of what Telegram signed
	resp2 := s.get(b, "/auth/sso/tg/callback?"+q.Encode())
	if !strings.Contains(resp2.Header.Get("Location"), "/panel/") {
		t.Fatalf("telegram sign-in: %d %s", resp2.StatusCode, resp2.Header.Get("Location"))
	}
	var u model.User
	database.GetDB().Where("auth_source = 'tg'").First(&u)
	if u.Id == 0 || u.Email != "" {
		t.Fatalf("user: %+v", u)
	}
	// a forged payload, even in the right browser with a fresh state, is refused
	b2 := s.browser()
	req, _ = http.NewRequest("GET", s.srv.URL+"/auth/sso/tg/begin", nil)
	r, _ = b2.Do(req)
	json.NewDecoder(r.Body).Decode(&begin)
	r.Body.Close()
	forged := telegramPayload("another:token", fields)
	forged.Set("state", begin.Obj.State)
	if loc := s.get(b2, "/auth/sso/tg/callback?"+forged.Encode()).Header.Get("Location"); !strings.Contains(loc, "sso_error=") {
		t.Fatalf("forged payload accepted: %s", loc)
	}
	// without the begin step (no state) nothing works: login CSRF with a captured signed payload
	if loc := s.get(s.browser(), "/auth/sso/tg/callback?"+q.Encode()).Header.Get("Location"); !strings.Contains(loc, "sso_error=bad_state") {
		t.Fatalf("no state: %s", loc)
	}
}

func TestWebhookEndpoint(t *testing.T) {
	s := newSSOHTTP(t)
	v, err := service.SSO.SaveProvider(s.admin, 0, service.ProviderInput{Key: "hooked", Name: "Hooked", Preset: "oidc", Enabled: true, ClientId: "x",
		Params: map[string]string{"issuer": s.idp.Issuer()}, RoleMode: "local", NoMatch: "deny", RotateWebhook: true})
	if err != nil || v.WebhookSecret == "" {
		t.Fatalf("secret: %v %+v", err, v)
	}
	body := []byte(`{"event":"updated","sub":"nobody"}`)
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if resp, _ := s.post(c, "/auth/sso/hooked/webhook", body, nil, "application/json"); resp.StatusCode != 401 {
		t.Fatalf("no credentials: %d", resp.StatusCode)
	}
	if resp, _ := s.post(c, "/auth/sso/hooked/webhook", body, map[string]string{"Authorization": "Bearer wrong"}, "application/json"); resp.StatusCode != 401 {
		t.Fatalf("wrong secret: %d", resp.StatusCode)
	}
	resp, out := s.post(c, "/auth/sso/hooked/webhook", body, map[string]string{"Authorization": "Bearer " + v.WebhookSecret}, "application/json")
	if resp.StatusCode != 200 || !strings.Contains(out, `"matched":false`) {
		t.Fatalf("valid secret: %d %s", resp.StatusCode, out)
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, []byte(v.WebhookSecret))
	mac.Write([]byte(ts + "." + string(body)))
	hdr := map[string]string{"X-SharX-Timestamp": ts, "X-SharX-Signature": "sha256=" + hex.EncodeToString(mac.Sum(nil))}
	if resp, _ := s.post(c, "/auth/sso/hooked/webhook", body, hdr, "application/json"); resp.StatusCode != 200 {
		t.Fatalf("HMAC: %d", resp.StatusCode)
	}
	if resp, _ := s.post(c, "/auth/sso/hooked/webhook", []byte(`{"event":"explode"}`), map[string]string{"Authorization": "Bearer " + v.WebhookSecret}, "application/json"); resp.StatusCode != 400 {
		t.Fatalf("unknown event: %d", resp.StatusCode)
	}
	// a provider without a webhook answers the same as a wrong secret
	if resp, _ := s.post(c, "/auth/sso/authentik/webhook", body, map[string]string{"Authorization": "Bearer x"}, "application/json"); resp.StatusCode != 401 {
		t.Fatalf("webhook off: %d", resp.StatusCode)
	}
	_ = authn.Random
}
