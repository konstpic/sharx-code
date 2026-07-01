package controller

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/crypto"
	"github.com/konstpic/sharx-code/v2/web/entity"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/skip2/go-qrcode"
	"github.com/xlzd/gotp"
)

// updateUserForm represents the form for updating user credentials.
type updateUserForm struct {
	OldUsername string `json:"oldUsername" form:"oldUsername"`
	OldPassword string `json:"oldPassword" form:"oldPassword"`
	NewUsername string `json:"newUsername" form:"newUsername"`
	NewPassword string `json:"newPassword" form:"newPassword"`
}

type twoFactorCodeForm struct {
	Code string `json:"code" form:"code"`
}

type uiPreferenceGetForm struct {
	Key string `json:"key" form:"key"`
}

type uiPreferenceSetForm struct {
	Key   string `json:"key" form:"key"`
	Value string `json:"value" form:"value"`
}

// SettingController handles settings and user management operations.
type SettingController struct {
	settingService service.SettingService
	userService    service.UserService
	panelService   service.PanelService
}

// NewSettingController creates a new SettingController and initializes its routes.
func NewSettingController(g *gin.RouterGroup) *SettingController {
	a := &SettingController{}
	a.initRouter(g)
	return a
}

// initRouter sets up the routes for settings management.
func (a *SettingController) initRouter(g *gin.RouterGroup) {
	g = g.Group("/setting")

	g.POST("/all", a.getAllSetting)
	g.POST("/defaultSettings", a.getDefaultSettings)
	g.POST("/update", a.updateSetting)
	g.POST("/updateUser", a.updateUser)
	g.POST("/restartPanel", a.restartPanel)
	g.GET("/getDefaultJsonConfig", a.getDefaultXrayConfig)
	g.GET("/grafana/dashboard", a.getGrafanaDashboard)

	g.POST("/subscriptionPageConfig/list", a.subscriptionPageConfigList)
	g.POST("/subscriptionPageConfig/get", a.subscriptionPageConfigGet)
	g.POST("/subscriptionPageConfig/save", a.subscriptionPageConfigSave)

	g.POST("/twoFactor/begin", a.beginTwoFactorSetup)
	g.POST("/twoFactor/complete", a.completeTwoFactorSetup)
	g.POST("/twoFactor/cancel", a.cancelTwoFactorSetup)
	g.POST("/ui/get", a.getUIPreference)
	g.POST("/ui/set", a.setUIPreference)
	g.POST("/generateSecretPaths", a.generateSecretPaths)
	g.POST("/saveSecretPaths", a.saveSecretPaths)
	g.GET("/secretPathsMeta", a.secretPathsMeta)

	// Initialize migration controller
	NewMigrationController(g)
}

// getAllSetting retrieves all current settings.
func (a *SettingController) getAllSetting(c *gin.Context) {
	allSetting, err := a.settingService.GetAllSetting()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.getSettings"), err)
		return
	}
	jsonObj(c, allSetting, nil)
}

// getDefaultSettings retrieves the default settings based on the host.
func (a *SettingController) getDefaultSettings(c *gin.Context) {
	result, err := a.settingService.GetDefaultSettings(c.Request.Host)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.getSettings"), err)
		return
	}
	jsonObj(c, result, nil)
}

type secretPathsBody struct {
	IncludeSub  bool   `json:"includeSub"`
	WebBasePath string `json:"webBasePath"`
	SubPath     string `json:"subPath"`
	UpdateSub   bool   `json:"updateSub"`
}

func (a *SettingController) secretPathsMeta(c *gin.Context) {
	envWeb, envSub := a.settingService.SecretPathsMeta()
	jsonObj(c, gin.H{
		"envOverridesWeb": envWeb,
		"envOverridesSub": envSub,
	}, nil)
}

// generateSecretPaths assigns random panel and optionally subscription URL prefixes.
func (a *SettingController) generateSecretPaths(c *gin.Context) {
	var body secretPathsBody
	_ = c.ShouldBindJSON(&body)
	webPath, subPath, err := a.settingService.GenerateSecretPaths(body.IncludeSub)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.secretPathsGenerateError"), err)
		return
	}
	jsonObj(c, gin.H{
		"webBasePath":     webPath,
		"subPath":         subPath,
		"requiresRestart": true,
		"subPathUpdated":  body.IncludeSub,
	}, nil)
}

func (a *SettingController) saveSecretPaths(c *gin.Context) {
	var body secretPathsBody
	if err := c.ShouldBindJSON(&body); err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.secretPathsSaveError"), err)
		return
	}
	if strings.TrimSpace(body.WebBasePath) == "" {
		jsonMsg(c, I18nWeb(c, "pages.settings.secretPathsSaveError"), fmt.Errorf("webBasePath is required"))
		return
	}
	webPath, subPath, err := a.settingService.SaveSecretPaths(body.WebBasePath, body.SubPath, body.UpdateSub)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.secretPathsSaveError"), err)
		return
	}
	jsonObj(c, gin.H{
		"webBasePath":     webPath,
		"subPath":         subPath,
		"requiresRestart": true,
		"subPathUpdated":  body.UpdateSub,
	}, nil)
}

// updateSetting updates all settings with the provided data.
func (a *SettingController) updateSetting(c *gin.Context) {
	allSetting := &entity.AllSetting{}
	err := c.ShouldBind(allSetting)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.modifySettings"), err)
		return
	}
	err = a.settingService.UpdateAllSetting(allSetting)
	jsonMsg(c, I18nWeb(c, "pages.settings.toasts.modifySettings"), err)
}

// updateUser updates the current user's username and password.
func (a *SettingController) updateUser(c *gin.Context) {
	form := &updateUserForm{}
	err := c.ShouldBind(form)
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.modifySettings"), err)
		return
	}
	user := session.GetLoginUser(c)
	if user.Username != form.OldUsername || !crypto.CheckPasswordHash(user.Password, form.OldPassword) {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.modifyUserError"), errors.New(I18nWeb(c, "pages.settings.toasts.originalUserPassIncorrect")))
		return
	}
	if form.NewUsername == "" || form.NewPassword == "" {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.modifyUserError"), errors.New(I18nWeb(c, "pages.settings.toasts.userPassMustBeNotEmpty")))
		return
	}
	err = a.userService.UpdateUser(user.Id, form.NewUsername, form.NewPassword)
	if err == nil {
		user.Username = form.NewUsername
		user.Password, _ = crypto.HashPasswordAsBcrypt(form.NewPassword)
		session.SetLoginUser(c, user)
		tgbot := service.Tgbot{}
		if tgbot.IsRunning() {
			detail := fmt.Sprintf("<b>User:</b> %s → %s\n", form.OldUsername, form.NewUsername)
			tgbot.NotifyPanelAction("Panel admin login changed", detail, getRemoteIp(c))
		}
	}
	jsonMsg(c, I18nWeb(c, "pages.settings.toasts.modifyUser"), err)
}

// restartPanel performs a full process restart (not just an in-process SIGHUP reload).
// In Docker it sends SIGTERM to PID 1 so the container supervisor restarts the binary.
// On bare-metal (systemd Restart=always / supervisor) os.Exit(0) is used as fallback.
func (a *SettingController) restartPanel(c *gin.Context) {
	err := a.panelService.RestartContainer(time.Second * 3)
	if err == nil {
		tgbot := service.Tgbot{}
		if tgbot.IsRunning() {
			tgbot.NotifyPanelAction("Panel process restart requested", "The service will exit and come back in a few seconds.\n", getRemoteIp(c))
		}
	}
	jsonMsg(c, I18nWeb(c, "pages.settings.restartPanelSuccess"), err)
}

// getDefaultXrayConfig retrieves the default Xray configuration.
func (a *SettingController) getDefaultXrayConfig(c *gin.Context) {
	defaultJsonConfig, err := a.settingService.GetDefaultXrayConfig()
	if err != nil {
		jsonMsg(c, I18nWeb(c, "pages.settings.toasts.getSettings"), err)
		return
	}
	jsonObj(c, defaultJsonConfig, nil)
}

// getGrafanaDashboard returns the Grafana dashboard JSON file for download.
func (a *SettingController) getGrafanaDashboard(c *gin.Context) {
	dashboardJSON, err := a.settingService.GetGrafanaDashboard()
	if err != nil {
		jsonMsg(c, "Failed to load Grafana dashboard", err)
		return
	}
	c.Header("Content-Type", "application/json")
	c.Header("Content-Disposition", "attachment; filename=sharx-grafana-dashboard.json")
	c.String(http.StatusOK, dashboardJSON)
}

func (a *SettingController) beginTwoFactorSetup(c *gin.Context) {
	user := session.GetLoginUser(c)
	if user == nil {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.settings.security.twoFactorBeginUnauthorized"))
		return
	}
	secret := gotp.RandomSecret(20)
	if secret == "" {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.settings.security.twoFactorBeginError"))
		return
	}
	session.SetPendingTwoFactorSecret(c, secret)
	if err := sessions.Default(c).Save(); err != nil {
		logger.Warning("2FA begin session save:", err)
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.settings.security.twoFactorBeginError"))
		return
	}
	totp := gotp.NewDefaultTOTP(secret)
	uri := totp.ProvisioningUri(user.Username, "SharX Panel")
	png, err := qrcode.Encode(uri, qrcode.Medium, 256)
	if err != nil {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.settings.security.twoFactorBeginError"))
		return
	}
	jsonObj(c, map[string]any{
		"secret":          secret,
		"provisioningUri": uri,
		"qrPngBase64":     base64.StdEncoding.EncodeToString(png),
	}, nil)
}

func (a *SettingController) completeTwoFactorSetup(c *gin.Context) {
	form := &twoFactorCodeForm{}
	if err := c.ShouldBind(form); err != nil {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.settings.security.twoFactorCompleteError"))
		return
	}
	secret := session.GetPendingTwoFactorSecret(c)
	if secret == "" {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.settings.security.twoFactorCompleteError"))
		return
	}
	if !service.VerifyTOTPCode(secret, form.Code) {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.settings.security.twoFactorModalError"))
		return
	}
	if err := a.settingService.SetTwoFactorToken(secret); err != nil {
		logger.Warning("SetTwoFactorToken:", err)
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.settings.security.twoFactorCompleteError"))
		return
	}
	if err := a.settingService.SetTwoFactorEnable(true); err != nil {
		logger.Warning("SetTwoFactorEnable:", err)
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "pages.settings.security.twoFactorCompleteError"))
		return
	}
	session.ClearPendingTwoFactorSecret(c)
	if err := sessions.Default(c).Save(); err != nil {
		logger.Warning("session save after 2FA setup:", err)
	}
	jsonMsg(c, I18nWeb(c, "pages.settings.security.twoFactorModalSetSuccess"), nil)
}

func (a *SettingController) cancelTwoFactorSetup(c *gin.Context) {
	session.ClearPendingTwoFactorSecret(c)
	if err := sessions.Default(c).Save(); err != nil {
		logger.Warning("session save after 2FA cancel:", err)
	}
	jsonMsg(c, "", nil)
}

func (a *SettingController) getUIPreference(c *gin.Context) {
	form := &uiPreferenceGetForm{}
	if err := c.ShouldBind(form); err != nil {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "fail"))
		return
	}
	userId := 0
	if user := session.GetLoginUser(c); user != nil {
		userId = user.Id
	}
	v, err := a.settingService.GetUIPreferenceForUser(userId, form.Key)
	if err != nil {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "fail"))
		return
	}
	jsonObj(c, map[string]string{"key": form.Key, "value": v}, nil)
}

func (a *SettingController) setUIPreference(c *gin.Context) {
	form := &uiPreferenceSetForm{}
	if err := c.ShouldBind(form); err != nil {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "fail"))
		return
	}
	userId := 0
	if user := session.GetLoginUser(c); user != nil {
		userId = user.Id
	}
	err := a.settingService.SetUIPreferenceForUser(userId, form.Key, form.Value)
	if err != nil {
		pureJsonMsg(c, http.StatusOK, false, I18nWeb(c, "fail"))
		return
	}
	jsonMsg(c, "", nil)
}
