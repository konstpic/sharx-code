package controller

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/entity"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/xlzd/gotp"
)

// LoginForm represents the login request structure.
type LoginForm struct {
	Username      string `json:"username" form:"username"`
	Password      string `json:"password" form:"password"`
	TwoFactorCode string `json:"twoFactorCode" form:"twoFactorCode"`
	// a security key used as the second factor: the state the panel gave with the challenge, and the authenticator's answer
	WebauthnState    string          `json:"webauthnState" form:"webauthnState"`
	WebauthnResponse json.RawMessage `json:"webauthnResponse" form:"-"`
}

// IndexController handles the main index and login-related routes.
type IndexController struct {
	BaseController

	settingService service.SettingService
	userService    service.UserService
	tgbot          service.Tgbot

	serveLoginPage func(c *gin.Context)
}

// NewIndexController creates a new IndexController and initializes its routes.
// serveLoginPage serves the static Next.js login (GET /) when the user is not logged in.
func NewIndexController(g *gin.RouterGroup, serveLoginPage func(c *gin.Context)) *IndexController {
	a := &IndexController{serveLoginPage: serveLoginPage}
	a.initRouter(g)
	return a
}

// initRouter sets up the routes for index, login, logout, and two-factor authentication.
func (a *IndexController) initRouter(g *gin.RouterGroup) {
	// HEAD: curl -I and health checks; Gin does not use GET for HEAD
	g.HEAD("/", a.index)
	g.GET("/", a.index)
	g.HEAD("/logout", a.logout)
	g.GET("/logout", a.logout)
	// Panel menu uses basePath + "logout/" (trailing slash); redirects are disabled in web.go.
	g.HEAD("/logout/", a.logout)
	g.GET("/logout/", a.logout)

	g.POST("/login", a.login)
	g.POST("/getTwoFactorEnable", a.getTwoFactorEnable)
	a.registerSSO(g)
	a.registerAuthMethods(g)
}

// index handles the root route, redirecting logged-in users to the panel or showing the login page.
func (a *IndexController) index(c *gin.Context) {
	if session.IsLogin(c) {
		c.Redirect(http.StatusFound, webPanelURL(c))
		return
	}
	if a.serveLoginPage != nil {
		a.serveLoginPage(c)
	}
}

var (
	loginIPFails   = authn.NewLimiter(40, 15*time.Minute) // failed sign-ins per address
	loginPairFails = authn.NewLimiter(6, 15*time.Minute)  // failed sign-ins per address and account
	loginUserFails = authn.NewLimiter(30, 15*time.Minute) // failed sign-ins per account, from anywhere (slows a distributed guess)
	loginAttempts  = authn.NewLimiter(60, time.Minute)    // every attempt per address
)

// loginBlocked reports whether this address or account has failed too often lately. The answer to a blocked attempt is the
// same as to a wrong password, so it reveals nothing, and a correct password does not get through while blocked.
func loginBlocked(ip, user string) bool {
	u := strings.ToLower(user)
	return loginIPFails.Over(ip) || loginPairFails.Over(ip+"|"+u) || loginUserFails.Over(u)
}

func loginFailed(ip, user string) {
	u := strings.ToLower(user)
	loginIPFails.Hit(ip)
	loginPairFails.Hit(ip + "|" + u)
	loginUserFails.Hit(u)
}

// login handles user authentication and session creation.
func (a *IndexController) login(c *gin.Context) {
	var form LoginForm

	if err := c.ShouldBind(&form); err != nil {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.invalidFormData"))
		return
	}
	if form.Username == "" {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.emptyUsername"))
		return
	}
	if form.Password == "" {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.emptyPassword"))
		return
	}

	timeStr := time.Now().Format("2006-01-02 15:04:05")
	safeUser := template.HTMLEscapeString(form.Username)
	ip := getRemoteIp(c)

	if !loginAttempts.Allow(ip) || loginBlocked(ip, form.Username) {
		logger.Warningf("sign-in throttled for \"%s\", IP: \"%s\"", safeUser, ip)
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongUsernameOrPassword"))
		return
	}

	user := a.userService.VerifyPassword(form.Username, form.Password)
	if user == nil {
		logger.Warningf("wrong username: \"%s\", IP: \"%s\"", safeUser, ip)
		loginFailed(ip, form.Username)
		a.tgbot.UserLoginNotify(safeUser, ip, timeStr, 0)
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongUsernameOrPassword"))
		return
	}

	// A disabled or deleted account, or one without a role, gets the same answer as a wrong password: the response must not
	// reveal which usernames exist or are blocked.
	if !rbacService.CanSignIn(user) {
		logger.Warningf("sign-in refused for blocked user: \"%s\", IP: \"%s\"", safeUser, ip)
		loginFailed(ip, form.Username)
		a.tgbot.UserLoginNotify(safeUser, ip, timeStr, 0)
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongUsernameOrPassword"))
		return
	}

	// With password sign-in closed for ordinary users (single sign-on only), administrators keep it as the way back in when
	// the identity provider is down.
	if !service.SSO.LocalLoginEnabled() {
		if p, err := rbacService.GetPrincipal(user.Id); err != nil || p == nil || !p.Super {
			logger.Warningf("password sign-in refused (single sign-on only) for \"%s\", IP: \"%s\"", safeUser, ip)
			pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.passwordLoginDisabled"))
			return
		}
	}

	a.completeFirstFactor(c, user, form, safeUser, timeStr, nil)
}

// completeFirstFactor runs what follows a correct first factor (password or e-mail link): the Telegram step, the person's own
// second factor (authenticator code, recovery code or security key), and finally the session. onSuccess runs after every check
// has passed and just before the session starts (the e-mail link is used up there, not earlier, so a mistyped code does not
// burn it); it returns false to stop.
func (a *IndexController) completeFirstFactor(c *gin.Context, user *model.User, form LoginForm, safeUser, timeStr string, onSuccess func() bool) {
	ip := getRemoteIp(c)
	twoFactorEnable, twoFactorToken := service.UserTwoFactor(user.Id)
	keys := service.Methods.Config().Passkeys && service.Passkeys.HasPasskeys(user.Id)

	if !twoFactorEnable && !keys {
		if !a.checkTelegramTwoFactor(c, form, safeUser, timeStr) {
			return
		}
	}

	if twoFactorEnable || keys {
		code := strings.TrimSpace(form.TwoFactorCode)
		switch {
		case form.WebauthnState != "" && len(form.WebauthnResponse) > 0:
			wa, err := a.webauthnFor(c)
			if err != nil || service.Passkeys.FinishSecondFactor(wa, user.Id, form.WebauthnState, form.WebauthnResponse) != nil {
				logger.Warningf("wrong security key for user \"%s\", IP: \"%s\"", safeUser, ip)
				loginFailed(ip, user.Username)
				a.tgbot.UserLoginNotify(safeUser, ip, timeStr, 0)
				pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongTwoFactorCode"))
				return
			}
		case code == "":
			tgSent := false
			tgOpt, _ := a.settingService.GetTwoFactorTelegram()
			if twoFactorEnable && tgOpt && a.tgbot.IsRunning() {
				otp := gotp.NewDefaultTOTP(twoFactorToken).Now()
				a.tgbot.SendTwoFactorLoginCode(safeUser, ip, otp)
				tgSent = true
			}
			obj := map[string]any{"needTwoFactor": true, "telegramSent": tgSent, "totp": twoFactorEnable, "recovery": twoFactorEnable && service.RemainingRecoveryCodes(user.Id) > 0}
			if keys {
				if wa, err := a.webauthnFor(c); err == nil {
					if opts, sid, err := service.Passkeys.BeginSecondFactor(wa, user.Id); err == nil {
						obj["webauthn"] = map[string]any{"state": sid, "options": opts}
					}
				}
			}
			c.JSON(http.StatusOK, entity.Msg{Success: false, Msg: I18nWeb(c, "pages.login.toasts.needTwoFactor"), Obj: obj})
			return
		default:
			ok := false
			if twoFactorEnable {
				if service.LooksLikeRecoveryCode(code) {
					ok = service.UseRecoveryCode(user.Id, code)
					if ok {
						service.Audit.Record(service.Actor{Principal: &service.Principal{UserId: user.Id, Username: user.Username}, IP: ip}, "auth.recovery_code_used", "user",
							strconv.Itoa(user.Id), user.Username, nil, map[string]any{"remaining": service.RemainingRecoveryCodes(user.Id)}, "ok", "")
					}
				} else {
					ok = service.VerifyTOTPCode(twoFactorToken, code)
				}
			}
			if !ok {
				logger.Warningf("wrong two-factor code for user \"%s\", IP: \"%s\"", safeUser, ip)
				loginFailed(ip, user.Username)
				a.tgbot.UserLoginNotify(safeUser, ip, timeStr, 0)
				pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongTwoFactorCode"))
				return
			}
		}
	}

	if onSuccess != nil && !onSuccess() {
		return
	}
	a.finishLoginSuccess(c, user, safeUser, timeStr)
}

// checkTelegramTwoFactor enforces the Telegram one-time-code step. It returns true when the login may
// proceed (feature off, or a valid code was submitted) and has already written the response otherwise.
func (a *IndexController) checkTelegramTwoFactor(c *gin.Context, form LoginForm, safeUser, timeStr string) bool {
	enabled, err := a.settingService.GetTgTwoFactorEnable()
	if err != nil {
		logger.Warning("telegram two-factor setting read error:", err)
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongUsernameOrPassword"))
		return false
	}
	if !enabled {
		return true
	}
	store := service.TgLoginCodes()
	now := time.Now()

	if code := strings.TrimSpace(form.TwoFactorCode); code != "" {
		if store.Verify(form.Username, code, now) {
			return true
		}
		logger.Warningf("wrong telegram two-factor code for user \"%s\", IP: \"%s\"", safeUser, getRemoteIp(c))
		a.tgbot.UserLoginNotify(safeUser, getRemoteIp(c), timeStr, 0)
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongTwoFactorCode"))
		return false
	}

	if !a.tgbot.CanSendLoginCode() {
		logger.Warning("telegram two-factor is enabled but the Telegram bot is not running or has no admin chat")
		pureJsonMsg(c, http.StatusOK, false, "Telegram 2FA is enabled but the Telegram bot is unavailable")
		return false
	}
	otp, wait, err := store.Issue(form.Username, now)
	if err != nil {
		logger.Warning("telegram two-factor code generation failed:", err)
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongUsernameOrPassword"))
		return false
	}
	sent := otp != ""
	if sent {
		a.tgbot.SendTwoFactorLoginCode(safeUser, getRemoteIp(c), otp)
	}
	c.JSON(http.StatusOK, entity.Msg{
		Success: false,
		Msg:     I18nWeb(c, "pages.login.toasts.needTwoFactor"),
		Obj: map[string]any{
			"needTwoFactor": true,
			"telegramSent":  sent,
			"resendIn":      wait,
		},
	})
	return false
}

func (a *IndexController) finishLoginSuccess(c *gin.Context, user *model.User, safeUser, timeStr string) {
	if !a.establishSession(c, user, safeUser, timeStr, false) {
		return
	}
	jsonMsg(c, I18nWeb(c, "pages.login.toasts.successLogin"), nil)
}

// establishSession starts the login session for an authenticated user (password, 2FA or single sign-on alike).
func (a *IndexController) establishSession(c *gin.Context, user *model.User, safeUser, timeStr string, mfaExempt bool) bool {
	rbacService.MarkLogin(user.Id)
	logger.Infof("%s logged in successfully, Ip Address: %s\n", safeUser, getRemoteIp(c))
	a.tgbot.UserLoginNotify(safeUser, getRemoteIp(c), timeStr, 1)

	sessionMaxAge, err := a.settingService.GetSessionMaxAge()
	if err != nil {
		logger.Warning("Unable to get session's max age from DB")
	}

	session.EndCurrentLoginSession(c)
	session.SetMaxAge(c, sessionMaxAge*60)
	session.SetLoginUser(c, user)
	session.SetMFAExempt(c, mfaExempt)
	if err := session.RegisterLoginSession(c, user.Id, sessionMaxAge*60, getRemoteIp(c)); err != nil {
		logger.Warning("Unable to register login session:", err)
	}
	if err := sessions.Default(c).Save(); err != nil {
		logger.Warning("Unable to save session: ", err)
		return false
	}

	logger.Infof("%s logged in successfully", safeUser)
	return true
}

// logout handles user logout by clearing the session and redirecting to the login page.
func (a *IndexController) logout(c *gin.Context) {
	user := session.GetLoginUser(c)
	if user != nil {
		logger.Infof("%s logged out successfully", user.Username)
	}
	session.EndCurrentLoginSession(c)
	session.ClearSession(c)
	if err := sessions.Default(c).Save(); err != nil {
		logger.Warning("Unable to save session after clearing:", err)
	}
	c.Redirect(http.StatusFound, webBasePath(c))
}

// getTwoFactorEnable retrieves the current status of two-factor authentication.
func (a *IndexController) getTwoFactorEnable(c *gin.Context) {
	// 2FA is per user now, and this endpoint is public: it must not tell a visitor which accounts use it. Only the
	// panel-wide Telegram step is reported.
	status, err := a.settingService.GetTgTwoFactorEnable()
	if err != nil {
		return
	}
	jsonObj(c, status, nil)
}
