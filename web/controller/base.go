// Package controller provides HTTP request handlers and controllers for the SharX web management panel.
// It handles routing, authentication, and API endpoints for managing Xray inbounds, settings, and more.
package controller

import (
	"net/http"
	"strings"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/locale"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"

	"github.com/gin-gonic/gin"
)

// BaseController provides common functionality for all controllers, including authentication checks.
type BaseController struct{}

// webBasePath returns a path-absolute base URL prefix, always with a trailing slash (e.g. "/" or "/xui/").
// Never returns empty — a missing/empty context value is treated as "/".
func webBasePath(c *gin.Context) string {
	p := c.GetString("base_path")
	if p == "" {
		return "/"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	if !strings.HasSuffix(p, "/") {
		p += "/"
	}
	return p
}

// webPanelURL returns the path to the React panel shell (e.g. "/panel/").
func webPanelURL(c *gin.Context) string {
	return webBasePath(c) + "panel/"
}

func isPublicSubscriptionPagePath(path string) bool {
	path = strings.TrimSuffix(path, "/")
	return strings.HasSuffix(path, "/panel/sub")
}

// checkLogin is a middleware that verifies user authentication and handles unauthorized access.
func (a *BaseController) checkLogin(c *gin.Context) {
	if isPublicSubscriptionPagePath(c.Request.URL.Path) {
		c.Next()
		return
	}
	TryAttachAPITokenFromBearer(c)
	if !session.IsLogin(c) {
		if isAjax(c) {
			pureJsonMsg(c, http.StatusUnauthorized, false, I18nWeb(c, "pages.login.loginAgain"))
		} else {
			c.Redirect(http.StatusFound, webBasePath(c))
		}
		c.Abort()
	} else {
		if u := session.GetLoginUser(c); u != nil {
			maxAge, err := (&service.SettingService{}).GetSessionMaxAge()
			if err != nil || maxAge <= 0 {
				maxAge = 360
			}
			session.EnsureRegistered(c, u.Id, maxAge*60, getRemoteIp(c))
		}
		c.Next()
	}
}

// I18nWeb retrieves an internationalized message for the web interface based on the current locale.
func I18nWeb(c *gin.Context, name string, params ...string) string {
	anyfunc, funcExists := c.Get("I18n")
	if !funcExists {
		logger.Warning("I18n function not exists in gin context!")
		return ""
	}
	i18nFunc, _ := anyfunc.(func(i18nType locale.I18nType, key string, keyParams ...string) string)
	msg := i18nFunc(locale.Web, name, params...)
	return msg
}
