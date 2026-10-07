package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/rbac"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"
	"github.com/konstpic/sharx-code/v2/web/websocket"
)

const ctxPrincipalKey = "rbac_principal"

var rbacService = &service.RBACService{}

// currentPrincipal returns the principal that authorize() attached to the request (nil before authorization).
func currentPrincipal(c *gin.Context) *service.Principal {
	if v, ok := c.Get(ctxPrincipalKey); ok {
		if p, ok := v.(*service.Principal); ok {
			return p
		}
	}
	return nil
}

// dataUser is the user that data operations are done as: the signed-in user with the id of the panel's data owner (see
// service.PanelOwnerID). Handlers that read or write inbounds, clients, groups, hosts and other shared data use it instead of
// session.GetLoginUser, so that every user with the right permission works on the same data.
func dataUser(c *gin.Context) *model.User {
	u := session.GetLoginUser(c)
	if u == nil {
		return nil
	}
	cp := *u
	cp.Id = service.PanelOwnerID(u.Id)
	return &cp
}

// can reports whether the request's user holds a permission. Handlers use it for answers that differ by permission
// (redaction); the route-level check is done by authorize().
func can(c *gin.Context, perm string) bool { return currentPrincipal(c).Can(perm) }

// routeKeyPath returns the matched route pattern without the secret base path.
func routeKeyPath(c *gin.Context) string {
	fp := c.FullPath()
	if fp == "" {
		return ""
	}
	base := strings.TrimSuffix(webBasePath(c), "/")
	if base != "" && strings.HasPrefix(fp, base+"/") {
		fp = strings.TrimPrefix(fp, base)
	}
	return fp
}

// forbid answers 403. It never says which permission exists beyond the one that is missing.
func forbid(c *gin.Context, msg string) {
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "msg": msg})
}

// authorize is the single access-control gate of every signed-in route. It runs after the login check, re-reads the user
// and role from the database (so disabling a user or changing a role takes effect on the next request, not at the end of
// the session), and then requires the permissions the route table lists. A route without an entry is administrators only.
//
// It returns false and has already written the response when the request must stop.
func (a *BaseController) authorize(c *gin.Context, apiGroup bool) bool {
	u := session.GetLoginUser(c)
	if u == nil {
		a.rejectUnauthenticated(c, apiGroup)
		return false
	}
	p, err := rbacService.GetPrincipal(u.Id)
	if err != nil {
		logger.Warningf("rbac: cannot load user %d: %v", u.Id, err)
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"success": false, "msg": "authorization unavailable"})
		return false
	}
	if p == nil || !p.Enabled {
		// the account was disabled or deleted while the session was alive: end the session
		if p != nil {
			logger.Warningf("rbac: disabled user %q tried to use the panel", p.Username)
		}
		session.EndCurrentLoginSession(c)
		session.ClearSession(c)
		a.rejectUnauthenticated(c, apiGroup)
		return false
	}
	c.Set(ctxPrincipalKey, p)

	path := routeKeyPath(c)
	if path == "" { // NoRoute: the SPA shell for client-side routes. The page itself carries no data; its API calls are checked.
		return true
	}
	reqs, known := rbac.Lookup(c.Request.Method, path)
	if !known {
		if p.Super {
			return true
		}
		logger.Warningf("rbac: %s %s has no permission entry, denied for %q (administrators only)", c.Request.Method, path, p.Username)
		forbid(c, "Forbidden")
		return false
	}
	if !p.Perms.HasAll(reqs) {
		recordDenied(c, p, path, reqs)
		forbid(c, "Forbidden: missing permission "+firstMissing(p, reqs))
		return false
	}
	return true
}

func firstMissing(p *service.Principal, reqs []string) string {
	for _, r := range reqs {
		if !p.Perms.Has(r) {
			return r
		}
	}
	return ""
}

func (a *BaseController) rejectUnauthenticated(c *gin.Context, apiGroup bool) {
	if apiGroup {
		c.AbortWithStatus(http.StatusNotFound) // the API group hides itself from unauthenticated callers
		return
	}
	if isAjax(c) {
		pureJsonMsg(c, http.StatusUnauthorized, false, I18nWeb(c, "pages.login.loginAgain"))
	} else {
		c.Redirect(http.StatusFound, webBasePath(c))
	}
	c.Abort()
}

// wsTopicPerms is what a WebSocket client must be able to read to receive each message type.
var wsTopicPerms = map[websocket.MessageType][]string{
	websocket.MessageTypeStatus:               {rbac.DashboardRead},
	websocket.MessageTypeTraffic:              {rbac.DashboardRead},
	websocket.MessageTypeXrayState:            {rbac.DashboardRead},
	websocket.MessageTypeInbounds:             {rbac.InboundsRead},
	websocket.MessageTypeOutbounds:            {rbac.OutboundsRead},
	websocket.MessageTypeNodes:                {rbac.NodesRead},
	websocket.MessageTypeClients:              {rbac.ClientsRead},
	websocket.MessageTypeClientTrafficPerNode: {rbac.NodesRead, rbac.ClientsRead},
	websocket.MessageTypeNotification:         {},
}

// wsAllow builds the per-message check of a WebSocket client. It asks the (cached) principal each time, so a role change
// or a disabled account stops the data at once. An unknown message type is not delivered: new push topics must be listed.
func wsAllow(userID int) func(websocket.MessageType) bool {
	return func(t websocket.MessageType) bool {
		reqs, ok := wsTopicPerms[t]
		if !ok {
			return false
		}
		p, err := rbacService.GetPrincipal(userID)
		if err != nil || p == nil || !p.Enabled {
			return false
		}
		return p.Perms.HasAll(reqs)
	}
}

// ---------- endpoints ----------

// RBACController serves /panel/rbac: the caller's own permissions, users, roles and the audit trail. Every route is
// listed in web/rbac/routes.go; the checks here are the rules that depend on the data (who may touch whom).
type RBACController struct{}

// NewRBACController registers the routes.
func NewRBACController(g *gin.RouterGroup) *RBACController {
	a := &RBACController{}
	g.GET("/me", a.me)
	g.GET("/permissions", a.permissions)
	g.GET("/assignable-roles", a.assignableRoles)
	g.GET("/roles", a.listRoles)
	g.POST("/roles", a.createRole)
	g.POST("/roles/:id/update", a.updateRole)
	g.POST("/roles/:id/delete", a.deleteRole)
	g.GET("/users", a.listUsers)
	g.POST("/users", a.createUser)
	g.POST("/users/:id/update", a.updateUser)
	g.POST("/users/:id/password", a.setPassword)
	g.POST("/users/:id/two-factor/reset", a.resetTwoFactor)
	g.POST("/users/:id/delete", a.deleteUser)
	g.GET("/audit", a.audit)
	return a
}

func actorOf(c *gin.Context) service.Actor {
	return service.Actor{Principal: currentPrincipal(c), IP: getRemoteIp(c)}
}

// rbacFail maps a service error to an HTTP response: 403 for refusals (the UI shows the message), 404, 409, 400, or 500.
func rbacFail(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	msg := "internal error"
	switch {
	case errors.Is(err, service.ErrForbidden):
		status, msg = http.StatusForbidden, err.Error()
	case errors.Is(err, service.ErrNotFound):
		status, msg = http.StatusNotFound, err.Error()
	case errors.Is(err, service.ErrConflict):
		status, msg = http.StatusConflict, err.Error()
	case errors.Is(err, service.ErrInvalid):
		status, msg = http.StatusBadRequest, err.Error()
	default:
		logger.Warningf("rbac: %v", err)
	}
	c.JSON(status, gin.H{"success": false, "msg": msg})
}

func pathID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "invalid id"})
		return 0, false
	}
	return id, true
}

// me tells the UI who is signed in and what they may do. The UI uses it to hide what would be refused; the backend
// enforces regardless.
func (a *RBACController) me(c *gin.Context) {
	p := currentPrincipal(c)
	jsonObj(c, gin.H{
		"userId":      p.UserId,
		"username":    p.Username,
		"roleId":      p.RoleId,
		"roleName":    p.RoleName,
		"super":       p.Super,
		"twoFactor":   twoFactorOn(p.UserId),
		"permissions": p.Perms.List(),
	}, nil)
}

func (a *RBACController) permissions(c *gin.Context) {
	jsonObj(c, gin.H{"groups": rbac.Groups()}, nil)
}

func (a *RBACController) assignableRoles(c *gin.Context) {
	roles, err := rbacService.AssignableRoles(currentPrincipal(c))
	if err != nil {
		rbacFail(c, err)
		return
	}
	// only what a user form needs: no permission lists of roles the caller may not otherwise see
	out := make([]gin.H, 0, len(roles))
	for _, r := range roles {
		out = append(out, gin.H{"id": r.Id, "name": r.Name, "description": r.Description})
	}
	jsonObj(c, out, nil)
}

func (a *RBACController) listRoles(c *gin.Context) {
	roles, err := rbacService.ListRoles(currentPrincipal(c))
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, roles, nil)
}

type roleBody struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
}

func (a *RBACController) createRole(c *gin.Context) {
	var b roleBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "invalid request"})
		return
	}
	r, err := rbacService.CreateRole(actorOf(c), service.RoleInput{Name: b.Name, Description: b.Description, Permissions: b.Permissions})
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, r, nil)
}

func (a *RBACController) updateRole(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	var b roleBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "invalid request"})
		return
	}
	r, err := rbacService.UpdateRole(actorOf(c), id, service.RoleInput{Name: b.Name, Description: b.Description, Permissions: b.Permissions})
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, r, nil)
}

func (a *RBACController) deleteRole(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := rbacService.DeleteRole(actorOf(c), id); err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, gin.H{"id": id}, nil)
}

func (a *RBACController) listUsers(c *gin.Context) {
	users, err := rbacService.ListUsers(currentPrincipal(c))
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, users, nil)
}

type userCreateBody struct {
	Username string `json:"username"`
	Password string `json:"password"`
	RoleId   int    `json:"roleId"`
	Enabled  *bool  `json:"enabled"`
}

func (a *RBACController) createUser(c *gin.Context) {
	var b userCreateBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "invalid request"})
		return
	}
	enabled := true
	if b.Enabled != nil {
		enabled = *b.Enabled
	}
	u, err := rbacService.CreateUser(actorOf(c), service.UserInput{Username: b.Username, Password: b.Password, RoleId: b.RoleId, Enabled: enabled})
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, u, nil)
}

type userUpdateBody struct {
	Username *string `json:"username"`
	RoleId   *int    `json:"roleId"`
	Enabled  *bool   `json:"enabled"`
}

func (a *RBACController) updateUser(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	var b userUpdateBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "invalid request"})
		return
	}
	u, err := rbacService.UpdateUser(actorOf(c), id, service.UserPatch{Username: b.Username, RoleId: b.RoleId, Enabled: b.Enabled})
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, u, nil)
}

func (a *RBACController) setPassword(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	var b struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "msg": "invalid request"})
		return
	}
	if err := rbacService.SetUserPassword(actorOf(c), id, b.Password); err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, gin.H{"id": id}, nil)
}

func (a *RBACController) resetTwoFactor(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := rbacService.ResetUserTwoFactor(actorOf(c), id); err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, gin.H{"id": id}, nil)
}

func (a *RBACController) deleteUser(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := rbacService.DeleteUser(actorOf(c), id); err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, gin.H{"id": id}, nil)
}

func (a *RBACController) audit(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	before, _ := strconv.ParseInt(c.Query("before"), 10, 64)
	rows, err := service.Audit.List(service.AuditQuery{
		Limit: limit, BeforeID: before, Action: c.Query("action"), TargetType: c.Query("targetType"), Result: c.Query("result"),
	})
	if err != nil {
		rbacFail(c, err)
		return
	}
	jsonObj(c, rows, nil)
}

// wsVariant says how much of a redactable message (inbounds) this user's role may see.
func wsVariant(userID int) func(websocket.MessageType) uint8 {
	return func(websocket.MessageType) uint8 {
		p, err := rbacService.GetPrincipal(userID)
		if err != nil || p == nil || !p.Enabled {
			return 0
		}
		var v uint8
		if p.Perms.Has(rbac.ClientsRead) {
			v |= websocket.VariantClients
		}
		if p.Perms.Has(rbac.InboundsUpdate) {
			v |= websocket.VariantSecrets
		}
		return v
	}
}

func init() {
	// the inbounds push carries every inbound with its clients and keys: each socket gets the parts its role may see
	websocket.RegisterRedactor(websocket.MessageTypeInbounds, func(payload any, variant uint8) any {
		list, ok := payload.([]*model.Inbound)
		if !ok {
			return nil // an unexpected payload is not forwarded to partial viewers
		}
		return service.RedactInbounds(list, variant&websocket.VariantClients != 0, variant&websocket.VariantSecrets != 0)
	})
}

func twoFactorOn(userID int) bool {
	on, _ := service.UserTwoFactor(userID)
	return on
}

var (
	deniedSeen   = map[string]time.Time{}
	deniedSeenMu sync.Mutex
)

// recordDenied puts a refused API call into the audit trail. The same user repeating the same call (a page polling an
// endpoint it may not read) is recorded once per five minutes, so the trail stays readable.
func recordDenied(c *gin.Context, p *service.Principal, path string, reqs []string) {
	key := fmt.Sprintf("%d|%s %s", p.UserId, c.Request.Method, path)
	now := time.Now()
	deniedSeenMu.Lock()
	if t, ok := deniedSeen[key]; ok && now.Sub(t) < 5*time.Minute {
		deniedSeenMu.Unlock()
		return
	}
	if len(deniedSeen) > 5000 {
		deniedSeen = map[string]time.Time{}
	}
	deniedSeen[key] = now
	deniedSeenMu.Unlock()
	service.Audit.Record(service.Actor{Principal: p, IP: getRemoteIp(c)}, "access.denied", "request", "", c.Request.Method+" "+path,
		nil, nil, "denied", "needs "+strings.Join(reqs, " + "))
}
