package controller

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"
)

var (
	emailReqRL   = authn.NewLimiter(10, 10*time.Minute) // requests that send mail, per address of the caller
	tokenUseRL   = authn.NewLimiter(30, 10*time.Minute) // attempts to use a token
	passkeyRL    = authn.NewLimiter(40, 10*time.Minute)
	methodsPubRL = authn.NewLimiter(120, time.Minute)
)

// registerAuthMethods adds the public routes of the e-mail and passkey sign-in methods. Each is gated by its switch and by
// rate limits, and none of them says whether an address has an account.
func (a *IndexController) registerAuthMethods(g *gin.RouterGroup) {
	g.GET("/auth/methods", a.authMethods)
	g.POST("/auth/magic/request", a.magicRequest)
	g.POST("/auth/magic/verify", a.magicVerify)
	g.POST("/auth/register", a.registerRequest)
	g.POST("/auth/register/confirm", a.registerConfirm)
	g.POST("/auth/password/forgot", a.passwordForgot)
	g.POST("/auth/password/reset", a.passwordReset)
	g.POST("/auth/passkey/login/begin", a.passkeyLoginBegin)
	g.POST("/auth/passkey/login/finish", a.passkeyLoginFinish)
}

func (a *IndexController) authMethods(c *gin.Context) {
	if !methodsPubRL.Allow(getRemoteIp(c)) {
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false})
		return
	}
	jsonObj(c, service.Methods.Public(), nil)
}

// emailLink builds a link from the configured public address of the panel (never from the request's Host header).
func emailLink(param string) func(string) string {
	base := service.Methods.Config().PublicUrl
	return func(raw string) string { return base + "?" + param + "=" + url.QueryEscape(raw) }
}

func bodyOf(c *gin.Context, v any) bool {
	if err := json.NewDecoder(io.LimitReader(c.Request.Body, 1<<20)).Decode(v); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "invalid request"})
		return false
	}
	return true
}

func methodFail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrInvalid):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": err.Error()})
	case errors.Is(err, service.ErrToken):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": err.Error()})
	case errors.Is(err, service.ErrConflict):
		c.JSON(http.StatusConflict, gin.H{"success": false, "msg": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "msg": "internal error"})
	}
}

// the same answer whether or not the address has an account
func sentAnswer(c *gin.Context) {
	jsonMsg(c, "If the address belongs to an account, a message has been sent.", nil)
}

func (a *IndexController) magicRequest(c *gin.Context) {
	var b struct {
		Email string `json:"email"`
	}
	if !bodyOf(c, &b) {
		return
	}
	if !emailReqRL.Allow(getRemoteIp(c)) {
		sentAnswer(c)
		return
	}
	if err := service.AuthEmail.RequestMagicLink(b.Email, getRemoteIp(c), emailLink("magic")); err != nil {
		methodFail(c, err)
		return
	}
	sentAnswer(c)
}

func (a *IndexController) magicVerify(c *gin.Context) {
	var form LoginForm
	var b struct {
		Token string `json:"token"`
		LoginForm
	}
	if !bodyOf(c, &b) {
		return
	}
	form = b.LoginForm
	ip := getRemoteIp(c)
	if !tokenUseRL.Allow(ip) || !service.Methods.Effective().MagicLink {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongUsernameOrPassword"))
		return
	}
	user, err := service.AuthEmail.MagicUser(strings.TrimSpace(b.Token))
	if err != nil || !rbacService.CanSignIn(user) {
		pureJsonMsg(c, http.StatusOK, false, "The link is invalid or has expired. Request a new one.")
		return
	}
	if !service.SSO.LocalLoginEnabled() {
		if p, err := rbacService.GetPrincipal(user.Id); err != nil || p == nil || !p.Super {
			pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.passwordLoginDisabled"))
			return
		}
	}
	timeStr := time.Now().Format("2006-01-02 15:04:05")
	form.Username = user.Username
	a.completeFirstFactor(c, user, form, user.Username, timeStr, func() bool {
		if err := service.AuthEmail.UseMagic(strings.TrimSpace(b.Token)); err != nil {
			pureJsonMsg(c, http.StatusOK, false, "The link is invalid or has expired. Request a new one.")
			return false
		}
		service.Audit.Record(service.Actor{Principal: &service.Principal{UserId: user.Id, Username: user.Username}, IP: ip}, "auth.magic_login", "user",
			itoa(user.Id), user.Username, nil, nil, "ok", "signed in with an e-mail link")
		return true
	})
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func (a *IndexController) registerRequest(c *gin.Context) {
	var b struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !bodyOf(c, &b) {
		return
	}
	if !emailReqRL.Allow(getRemoteIp(c)) {
		sentAnswer(c)
		return
	}
	if err := service.AuthEmail.RequestSignup(b.Email, b.Password, getRemoteIp(c), emailLink("confirm")); err != nil {
		methodFail(c, err)
		return
	}
	jsonMsg(c, "Check your e-mail: open the link in the message to finish creating your account.", nil)
}

func (a *IndexController) registerConfirm(c *gin.Context) {
	var b struct {
		Token string `json:"token"`
	}
	if !bodyOf(c, &b) {
		return
	}
	ip := getRemoteIp(c)
	if !tokenUseRL.Allow(ip) {
		pureJsonMsg(c, http.StatusOK, false, "Too many attempts. Wait a few minutes.")
		return
	}
	if _, err := service.AuthEmail.ConfirmSignup(strings.TrimSpace(b.Token), ip); err != nil {
		methodFail(c, err)
		return
	}
	jsonMsg(c, "Your account is ready. You can sign in now.", nil)
}

func (a *IndexController) passwordForgot(c *gin.Context) {
	var b struct {
		Email string `json:"email"`
	}
	if !bodyOf(c, &b) {
		return
	}
	if !emailReqRL.Allow(getRemoteIp(c)) {
		sentAnswer(c)
		return
	}
	if err := service.AuthEmail.RequestReset(b.Email, getRemoteIp(c), emailLink("reset")); err != nil {
		methodFail(c, err)
		return
	}
	sentAnswer(c)
}

func (a *IndexController) passwordReset(c *gin.Context) {
	var b struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if !bodyOf(c, &b) {
		return
	}
	ip := getRemoteIp(c)
	if !tokenUseRL.Allow(ip) {
		pureJsonMsg(c, http.StatusOK, false, "Too many attempts. Wait a few minutes.")
		return
	}
	if err := service.AuthEmail.ResetPassword(strings.TrimSpace(b.Token), b.Password, ip); err != nil {
		methodFail(c, err)
		return
	}
	jsonMsg(c, "Your password has been changed. Sign in with the new one.", nil)
}

// ---------- passkeys ----------

// webauthnFor builds the relying party from the address this request arrived at, unless the administrator pinned it.
func (a *IndexController) webauthnFor(c *gin.Context) (*webauthn.WebAuthn, error) {
	return webauthnForRequest(c)
}

func webauthnForRequest(c *gin.Context) (*webauthn.WebAuthn, error) {
	host := c.Request.Host
	rpID := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		rpID = h
	}
	scheme := "http"
	if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return service.Passkeys.WebAuthn(service.RP{ID: rpID, Origins: []string{scheme + "://" + host}})
}

func (a *IndexController) passkeyLoginBegin(c *gin.Context) {
	if !passkeyRL.Allow(getRemoteIp(c)) || !service.Methods.Config().Passkeys {
		c.JSON(http.StatusNotFound, gin.H{"success": false})
		return
	}
	wa, err := webauthnForRequest(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false})
		return
	}
	opts, sid, err := service.Passkeys.BeginLogin(wa)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false})
		return
	}
	jsonObj(c, gin.H{"state": sid, "options": opts}, nil)
}

func (a *IndexController) passkeyLoginFinish(c *gin.Context) {
	var b struct {
		State    string          `json:"state"`
		Response json.RawMessage `json:"response"`
	}
	if !bodyOf(c, &b) {
		return
	}
	ip := getRemoteIp(c)
	fail := func() {
		loginFailed(ip, "passkey")
		pureJsonMsg(c, http.StatusOK, false, "The security key could not be verified.")
	}
	if !passkeyRL.Allow(ip) || !service.Methods.Config().Passkeys || loginIPFails.Over(ip) {
		fail()
		return
	}
	wa, err := webauthnForRequest(c)
	if err != nil {
		fail()
		return
	}
	user, err := service.Passkeys.FinishLogin(wa, b.State, b.Response)
	if err != nil || !rbacService.CanSignIn(user) {
		fail()
		return
	}
	if !service.SSO.LocalLoginEnabled() { // a passkey is a local credential: the single-sign-on-only switch covers it
		if p, err := rbacService.GetPrincipal(user.Id); err != nil || p == nil || !p.Super {
			fail()
			return
		}
	}
	timeStr := time.Now().Format("2006-01-02 15:04:05")
	// the authenticator verified the person (PIN, fingerprint, face): possession and verification are two factors in one
	if !a.establishSession(c, user, user.Username, timeStr, true) {
		fail()
		return
	}
	service.Audit.Record(service.Actor{Principal: &service.Principal{UserId: user.Id, Username: user.Username}, IP: ip}, "auth.passkey_login", "user",
		itoa(user.Id), user.Username, nil, nil, "ok", "signed in with a passkey")
	jsonMsg(c, I18nWeb(c, "pages.login.toasts.successLogin"), nil)
}

var _ = context.Background
var _ = session.IsLogin
