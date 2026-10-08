package controller

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"
)

const ssoBindingKey = "SSO_BINDING"

var (
	ssoFlows    = authn.NewFlows(10 * time.Minute)
	ssoStartRL  = authn.NewLimiter(30, time.Minute)
	ssoCallbRL  = authn.NewLimiter(60, time.Minute)
	ssoListRL   = authn.NewLimiter(120, time.Minute)
	errBadState = errors.New("invalid or expired sign-in state")
)

// registerSSO adds the public single sign-on routes: the provider list for the login page, the redirect to the provider and
// the callback. The routes live next to /login and need no session; everything they accept is checked inside.
func (a *IndexController) registerSSO(g *gin.RouterGroup) {
	g.GET("/auth/providers", a.ssoProviders)
	g.GET("/auth/sso/:key/start", a.ssoStart)
	g.GET("/auth/sso/:key/callback", a.ssoCallback)
}

func (a *IndexController) ssoProviders(c *gin.Context) {
	if !ssoListRL.Allow(getRemoteIp(c)) {
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false})
		return
	}
	jsonObj(c, gin.H{"providers": service.SSO.PublicProviders(), "localLogin": service.SSO.LocalLoginEnabled()}, nil)
}

// callbackURL is the redirect URI the provider sends the browser back to. It must match what is registered at the provider
// exactly, so an administrator can pin it (redirect base) when a proxy hides the real host.
func callbackURL(c *gin.Context, key, base string) string {
	if base = strings.TrimSpace(base); base != "" {
		return strings.TrimRight(base, "/") + "/auth/sso/" + key + "/callback"
	}
	scheme := "http"
	if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + c.Request.Host + webBasePath(c) + "auth/sso/" + key + "/callback"
}

func (a *IndexController) ssoFail(c *gin.Context, code string, linking bool) {
	if linking {
		c.Redirect(http.StatusFound, webPanelURL(c)+"settings/security/?sso_error="+url.QueryEscape(code))
		return
	}
	c.Redirect(http.StatusFound, webBasePath(c)+"?sso_error="+url.QueryEscape(code))
}

func ssoCode(err error) string {
	var se *service.SSOError
	if errors.As(err, &se) {
		return se.Code
	}
	return "failed"
}

// startFlow builds the authorization redirect. linkUser is non-zero when a signed-in user adds an identity.
func (a *IndexController) startFlow(c *gin.Context, key string, linkUser int) {
	linking := linkUser != 0
	if !ssoStartRL.Allow(getRemoteIp(c)) {
		a.ssoFail(c, "rate_limited", linking)
		return
	}
	p, err := service.SSO.ProviderByKey(key)
	if err != nil {
		a.ssoFail(c, "unknown_provider", linking)
		return
	}
	cl, err := service.SSO.Client(p)
	if err != nil {
		logger.Warningf("sso: provider %s is misconfigured: %v", key, err)
		a.ssoFail(c, "misconfigured", linking)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	if err := cl.Discover(ctx); err != nil {
		logger.Warningf("sso: provider %s: %v", key, err)
		a.ssoFail(c, "provider_unreachable", linking)
		return
	}
	fl := authn.Flow{Provider: key, Nonce: authn.Random(24), Verifier: authn.Random(48), Binding: authn.Random(24), LinkUserID: linkUser,
		RedirectURI: callbackURL(c, key, service.SSO.RedirectBase(p))}
	state := ssoFlows.Put(fl)
	s := sessions.Default(c)
	s.Set(ssoBindingKey, fl.Binding)
	if err := s.Save(); err != nil {
		a.ssoFail(c, "failed", linking)
		return
	}
	u, err := cl.AuthorizeURL(fl.RedirectURI, state, fl.Nonce, fl.Verifier)
	if err != nil {
		a.ssoFail(c, "misconfigured", linking)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Redirect(http.StatusFound, u)
}

func (a *IndexController) ssoStart(c *gin.Context) {
	a.startFlow(c, c.Param("key"), 0)
}

func (a *IndexController) ssoCallback(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ip := getRemoteIp(c)
	if !ssoCallbRL.Allow(ip) {
		a.ssoFail(c, "rate_limited", false)
		return
	}
	s := sessions.Default(c)
	binding, _ := s.Get(ssoBindingKey).(string)
	s.Delete(ssoBindingKey)
	_ = s.Save()

	fl, ok := ssoFlows.Take(c.Query("state"))
	linking := ok && fl.LinkUserID != 0
	if !ok || fl.Provider != c.Param("key") || !authn.SameBinding(binding, fl.Binding) {
		// a callback this browser did not start (login CSRF), a replay, or an expired flow
		service.SSO.RecordDenied(nil, nil, ip, errBadState)
		a.ssoFail(c, "bad_state", linking)
		return
	}
	p, err := service.SSO.ProviderByKey(fl.Provider)
	if err != nil {
		a.ssoFail(c, "unknown_provider", linking)
		return
	}
	if e := c.Query("error"); e != "" {
		service.SSO.RecordDenied(p, nil, ip, errors.New("the provider refused the request: "+e))
		a.ssoFail(c, "provider_denied", linking)
		return
	}
	if linking {
		// the person finishing the flow must still be the signed-in user who started it
		if u := session.GetLoginUser(c); u == nil || u.Id != fl.LinkUserID {
			a.ssoFail(c, "bad_state", true)
			return
		}
	}
	cl, err := service.SSO.Client(p)
	if err != nil {
		a.ssoFail(c, "misconfigured", linking)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()
	id, err := cl.Complete(ctx, c.Query("code"), fl, time.Now())
	if err != nil {
		logger.Warningf("sso: sign-in via %s failed: %v", p.Key, err)
		service.SSO.RecordDenied(p, nil, ip, err)
		a.ssoFail(c, "invalid_response", linking)
		return
	}
	user, err := service.SSO.SignIn(p, *id, ip, fl.LinkUserID)
	if err != nil {
		var se *service.SSOError
		if !errors.As(err, &se) {
			logger.Warningf("sso: sign-in via %s: %v", p.Key, err)
		}
		service.SSO.RecordDenied(p, id, ip, err)
		a.ssoFail(c, ssoCode(err), linking)
		return
	}
	if linking {
		c.Redirect(http.StatusFound, webPanelURL(c)+"settings/security/?sso_linked=1")
		return
	}
	if !rbacService.CanSignIn(user) {
		service.SSO.RecordDenied(p, id, ip, errors.New("the account cannot sign in (disabled or without a role)"))
		a.ssoFail(c, "no_access", false)
		return
	}
	timeStr := time.Now().Format("2006-01-02 15:04:05")
	if !a.establishSession(c, user, user.Username, timeStr) {
		a.ssoFail(c, "failed", false)
		return
	}
	service.Audit.Record(service.Actor{Principal: &service.Principal{UserId: user.Id, Username: user.Username}, IP: ip}, "auth.sso_login", "user",
		strconv.Itoa(user.Id), user.Username, nil, map[string]any{"provider": p.Key}, "ok", "")
	c.Redirect(http.StatusFound, webPanelURL(c))
}
