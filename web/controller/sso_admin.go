package controller

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"
)

// SSOAdminController serves /panel/auth: providers, role rules and linked identities. Every route is listed in
// web/rbac/routes.go (auth:read to look, auth:manage - administrators only - to change).
type SSOAdminController struct {
	indexLike *IndexController
}

// NewSSOAdminController registers the routes.
func NewSSOAdminController(g *gin.RouterGroup) *SSOAdminController {
	a := &SSOAdminController{indexLike: &IndexController{}}
	g.GET("/presets", a.presets)
	g.GET("/providers", a.providers)
	g.POST("/providers", a.createProvider)
	g.POST("/providers/:id/update", a.updateProvider)
	g.POST("/providers/:id/delete", a.deleteProvider)
	g.POST("/providers/:id/test", a.testProvider)
	g.GET("/rules", a.rules)
	g.POST("/rules", a.createRule)
	g.POST("/rules/:id/update", a.updateRule)
	g.POST("/rules/:id/delete", a.deleteRule)
	g.GET("/identities", a.allIdentities)
	g.POST("/identities/:id/unlink", a.adminUnlink)
	g.GET("/settings", a.settings)
	g.POST("/settings", a.saveSettings)
	// the signed-in user's own linked accounts
	g.GET("/my-identities", a.myIdentities)
	g.POST("/my-identities/:id/unlink", a.myUnlink)
	g.GET("/link/:key/start", a.linkStart)
	// sign-in methods and the e-mail account they depend on
	g.GET("/methods", a.methods)
	g.POST("/methods", a.saveMethods)
	g.GET("/mail", a.mailGet)
	g.POST("/mail", a.mailSave)
	g.POST("/mail/test", a.mailTest)
	// the signed-in user's own security keys
	g.GET("/passkeys", a.passkeyList)
	g.POST("/passkeys/register/begin", a.passkeyRegisterBegin)
	g.POST("/passkeys/register/finish", a.passkeyRegisterFinish)
	g.POST("/passkeys/:id/delete", a.passkeyDelete)
	g.POST("/passkeys/:id/rename", a.passkeyRename)
	return a
}

func (a *SSOAdminController) presets(c *gin.Context) {
	jsonObj(c, authn.Presets(), nil)
}

func (a *SSOAdminController) providers(c *gin.Context) {
	list, err := service.SSO.ListProviders()
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, list, nil)
}

func (a *SSOAdminController) createProvider(c *gin.Context) {
	var in service.ProviderInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "invalid request"})
		return
	}
	v, err := service.SSO.SaveProvider(actorOf(c), 0, in)
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, v, nil)
}

func (a *SSOAdminController) updateProvider(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	var in service.ProviderInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "invalid request"})
		return
	}
	v, err := service.SSO.SaveProvider(actorOf(c), id, in)
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, v, nil)
}

func (a *SSOAdminController) deleteProvider(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := service.SSO.DeleteProvider(actorOf(c), id); err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, gin.H{"id": id}, nil)
}

func (a *SSOAdminController) testProvider(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	out, err := service.SSO.Test(ctx, id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "msg": err.Error(), "obj": out})
		return
	}
	jsonObj(c, out, nil)
}

func (a *SSOAdminController) rules(c *gin.Context) {
	list, err := service.SSO.ListRules()
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, list, nil)
}

func (a *SSOAdminController) createRule(c *gin.Context) {
	var in service.RuleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "invalid request"})
		return
	}
	r, err := service.SSO.SaveRule(actorOf(c), 0, in)
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, r, nil)
}

func (a *SSOAdminController) updateRule(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	var in service.RuleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "invalid request"})
		return
	}
	r, err := service.SSO.SaveRule(actorOf(c), id, in)
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, r, nil)
}

func (a *SSOAdminController) deleteRule(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := service.SSO.DeleteRule(actorOf(c), id); err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, gin.H{"id": id}, nil)
}

func (a *SSOAdminController) allIdentities(c *gin.Context) {
	list, err := service.SSO.Identities(0)
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, list, nil)
}

func (a *SSOAdminController) adminUnlink(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := service.SSO.Unlink(actorOf(c), id, false); err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, gin.H{"id": id}, nil)
}

func (a *SSOAdminController) settings(c *gin.Context) {
	jsonObj(c, gin.H{"localLogin": service.SSO.LocalLoginEnabled()}, nil)
}

func (a *SSOAdminController) saveSettings(c *gin.Context) {
	var b struct {
		LocalLogin bool `json:"localLogin"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "invalid request"})
		return
	}
	if err := service.SSO.SetLocalLogin(actorOf(c), b.LocalLogin); err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, gin.H{"localLogin": b.LocalLogin}, nil)
}

func (a *SSOAdminController) myIdentities(c *gin.Context) {
	u := session.GetLoginUser(c)
	if u == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false})
		return
	}
	list, err := service.SSO.Identities(u.Id)
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, list, nil)
}

func (a *SSOAdminController) myUnlink(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := service.SSO.Unlink(actorOf(c), id, true); err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, gin.H{"id": id}, nil)
}

// linkStart sends the signed-in user to the provider to add an identity to their own account.
func (a *SSOAdminController) linkStart(c *gin.Context) {
	u := session.GetLoginUser(c)
	if u == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false})
		return
	}
	a.indexLike.startFlow(c, c.Param("key"), u.Id)
}

var _ = strconv.Itoa

func (a *SSOAdminController) methods(c *gin.Context) { jsonObj(c, service.Methods.View(), nil) }

func (a *SSOAdminController) saveMethods(c *gin.Context) {
	var in service.MethodsConfig
	if !bodyOf(c, &in) {
		return
	}
	v, err := service.Methods.Save(actorOf(c), in)
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, v, nil)
}

func (a *SSOAdminController) mailGet(c *gin.Context) { jsonObj(c, service.Mail.Get(), nil) }

func (a *SSOAdminController) mailSave(c *gin.Context) {
	var in service.MailInput
	if !bodyOf(c, &in) {
		return
	}
	v, err := service.Mail.Save(actorOf(c), in)
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, v, nil)
}

// mailTest sends a test message with the stored account; success marks the account verified.
func (a *SSOAdminController) mailTest(c *gin.Context) {
	var b struct {
		To string `json:"to"`
	}
	if !bodyOf(c, &b) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 40*time.Second)
	defer cancel()
	if err := service.Mail.SendTest(ctx, actorOf(c), strings.TrimSpace(b.To)); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "msg": err.Error()})
		return
	}
	jsonObj(c, service.Mail.Get(), nil)
}

func (a *SSOAdminController) passkeyList(c *gin.Context) {
	u := session.GetLoginUser(c)
	if u == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false})
		return
	}
	jsonObj(c, gin.H{"keys": service.Passkeys.List(u.Id), "enabled": service.Methods.Config().Passkeys}, nil)
}

func (a *SSOAdminController) passkeyRegisterBegin(c *gin.Context) {
	u := session.GetLoginUser(c)
	if u == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false})
		return
	}
	if !service.Methods.Config().Passkeys {
		c.JSON(http.StatusConflict, gin.H{"success": false, "msg": "security keys are not enabled by the administrator"})
		return
	}
	wa, err := webauthnForRequest(c)
	if err != nil {
		rbacFail(c, err)
		return
	}
	opts, sid, err := service.Passkeys.BeginRegistration(wa, u.Id)
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, gin.H{"state": sid, "options": opts}, nil)
}

func (a *SSOAdminController) passkeyRegisterFinish(c *gin.Context) {
	u := session.GetLoginUser(c)
	if u == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false})
		return
	}
	var b struct {
		State    string          `json:"state"`
		Name     string          `json:"name"`
		Response json.RawMessage `json:"response"`
	}
	if !bodyOf(c, &b) {
		return
	}
	wa, err := webauthnForRequest(c)
	if err != nil {
		rbacFail(c, err)
		return
	}
	v, err := service.Passkeys.FinishRegistration(wa, u.Id, b.State, b.Name, b.Response)
	if err != nil {
		if errors.Is(err, service.ErrPasskey) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": err.Error()})
			return
		}
		rbacFail(c, err)
		return
	}
	service.InvalidateRBAC()
	service.Audit.Record(actorOf(c), "auth.passkey_add", "user", strconv.Itoa(u.Id), u.Username, nil, map[string]any{"name": v.Name}, "ok", "")
	jsonObj(c, v, nil)
}

func (a *SSOAdminController) passkeyDelete(c *gin.Context) {
	u := session.GetLoginUser(c)
	id, ok := pathID(c)
	if u == nil || !ok {
		return
	}
	if err := service.Passkeys.Delete(u.Id, id); err != nil {
		rbacFail(c, err)
		return
	}
	service.InvalidateRBAC()
	service.Audit.Record(actorOf(c), "auth.passkey_remove", "user", strconv.Itoa(u.Id), u.Username, nil, nil, "ok", "")
	jsonObj(c, gin.H{"id": id}, nil)
}

func (a *SSOAdminController) passkeyRename(c *gin.Context) {
	u := session.GetLoginUser(c)
	id, ok := pathID(c)
	if u == nil || !ok {
		return
	}
	var b struct {
		Name string `json:"name"`
	}
	if !bodyOf(c, &b) {
		return
	}
	if err := service.Passkeys.Rename(u.Id, id, b.Name); err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, gin.H{"id": id}, nil)
}
