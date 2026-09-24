package controller

import (
	"net/http"
	"strings"
	"text/template"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
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

	user := a.userService.VerifyPassword(form.Username, form.Password)
	if user == nil {
		logger.Warningf("wrong username: \"%s\", IP: \"%s\"", safeUser, getRemoteIp(c))
		a.tgbot.UserLoginNotify(safeUser, getRemoteIp(c), timeStr, 0)
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongUsernameOrPassword"))
		return
	}

	twoFactorEnable, err := a.settingService.GetTwoFactorEnable()
	if err != nil {
		logger.Warning("two-factor setting read error:", err)
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongUsernameOrPassword"))
		return
	}

	if !twoFactorEnable {
		if !a.checkTelegramTwoFactor(c, form, safeUser, timeStr) {
			return
		}
	}

	if twoFactorEnable {
		twoFactorToken, err := a.settingService.GetTwoFactorToken()
		if err != nil || twoFactorToken == "" {
			logger.Warning("two-factor enabled but secret missing")
			pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongUsernameOrPassword"))
			return
		}

		code := strings.TrimSpace(form.TwoFactorCode)
		if code == "" {
			tgSent := false
			tgOpt, _ := a.settingService.GetTwoFactorTelegram()
			if tgOpt && a.tgbot.IsRunning() {
				otp := gotp.NewDefaultTOTP(twoFactorToken).Now()
				a.tgbot.SendTwoFactorLoginCode(safeUser, getRemoteIp(c), otp)
				tgSent = true
			}
			c.JSON(http.StatusOK, entity.Msg{
				Success: false,
				Msg:     I18nWeb(c, "pages.login.toasts.needTwoFactor"),
				Obj: map[string]any{
					"needTwoFactor": true,
					"telegramSent":  tgSent,
				},
			})
			return
		}

		if !service.VerifyTOTPCode(twoFactorToken, code) {
			logger.Warningf("wrong two-factor code for user \"%s\", IP: \"%s\"", safeUser, getRemoteIp(c))
			a.tgbot.UserLoginNotify(safeUser, getRemoteIp(c), timeStr, 0)
			pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.login.toasts.wrongTwoFactorCode"))
			return
		}
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
	logger.Infof("%s logged in successfully, Ip Address: %s\n", safeUser, getRemoteIp(c))
	a.tgbot.UserLoginNotify(safeUser, getRemoteIp(c), timeStr, 1)

	sessionMaxAge, err := a.settingService.GetSessionMaxAge()
	if err != nil {
		logger.Warning("Unable to get session's max age from DB")
	}

	session.SetMaxAge(c, sessionMaxAge*60)
	session.SetLoginUser(c, user)
	if err := sessions.Default(c).Save(); err != nil {
		logger.Warning("Unable to save session: ", err)
		return
	}

	logger.Infof("%s logged in successfully", safeUser)
	jsonMsg(c, I18nWeb(c, "pages.login.toasts.successLogin"), nil)
}

// logout handles user logout by clearing the session and redirecting to the login page.
func (a *IndexController) logout(c *gin.Context) {
	user := session.GetLoginUser(c)
	if user != nil {
		logger.Infof("%s logged out successfully", user.Username)
	}
	session.ClearSession(c)
	if err := sessions.Default(c).Save(); err != nil {
		logger.Warning("Unable to save session after clearing:", err)
	}
	c.Redirect(http.StatusFound, webBasePath(c))
}

// getTwoFactorEnable retrieves the current status of two-factor authentication.
func (a *IndexController) getTwoFactorEnable(c *gin.Context) {
	status, err := a.settingService.GetTwoFactorEnable()
	if err != nil {
		return
	}
	if !status {
		if tg, tgErr := a.settingService.GetTgTwoFactorEnable(); tgErr == nil {
			status = tg
		}
	}
	jsonObj(c, status, nil)
}
