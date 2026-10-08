package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/konstpic/sharx-code/v2/web/service"
)

// Resource scope. An account that belongs to an organization (Principal.OrgId) is limited to the client groups of that
// organization and the clients in them. This is enforced here, once, for every request, and it is deny-by-default: a limited
// account can use only the routes listed below, whatever its role permits; everything else answers 403. The table says how
// each allowed route is checked:
//
//	kindGroupID   - :id is a client group; it must belong to the organization (otherwise 404, like a missing group)
//	kindClientID  - :id is a client; it must be in a group of the organization
//	kindClientParam - :clientId is a client, same rule
//	kindListClients / kindListGroups - the answer is filtered to the organization's clients / groups
//
// What is deliberately *not* here, because it would reach outside the organization: creating or editing a client (it carries
// inbound and bundle ids that are shared), creating or deleting groups, assigning or removing clients of a group, assigning
// inbounds or bundles to a group, anything on nodes, inbounds, settings, access control. Administrators do those for the
// organization.
const (
	kindGroupID     = "group"
	kindClientID    = "client"
	kindClientParam = "clientParam"
	kindListClients = "listClients"
	kindListGroups  = "listGroups"
	kindOwn         = "own" // the account's own pages and data: no resource check needed
)

var scopedRoutes = map[string]string{
	"GET /panel/client/list":                kindListClients,
	"GET /panel/client/get/:id":             kindClientID,
	"GET /panel/client/links/:id":           kindClientID,
	"GET /panel/client/sessions/:id":        kindClientID,
	"GET /panel/client/hwid/list/:clientId": kindClientParam,
	"POST /panel/client/del/:id":            kindClientID,
	"POST /panel/client/resetTraffic/:id":   kindClientID,
	"POST /panel/client/clearHwid/:id":      kindClientID,
	"POST /panel/client/sessions/drop/:id":  kindClientID,
	"POST /panel/client/sessions/block/:id": kindClientID,

	"GET /panel/group/list":                      kindListGroups,
	"GET /panel/group/get/:id":                   kindGroupID,
	"GET /panel/group/:id/clients":               kindGroupID,
	"GET /panel/group/:id/effectiveSettings":     kindGroupID,
	"POST /panel/group/update/:id":               kindGroupID,
	"POST /panel/group/:id/bulk/resetTraffic":    kindGroupID,
	"POST /panel/group/:id/bulk/clearHwid":       kindGroupID,
	"POST /panel/group/:id/bulk/delete":          kindGroupID,
	"POST /panel/group/:id/bulk/enable":          kindGroupID,
	"POST /panel/group/:id/bulk/setHwidLimit":    kindGroupID,
	"POST /panel/group/:id/bulk/setExpiry":       kindGroupID,
	"POST /panel/group/:id/bulk/setTrafficLimit": kindGroupID,
	"POST /panel/group/:id/bulk/setIPLimit":      kindGroupID,
}

// ownRoutes are what every signed-in account may use; they carry no panel data of an organization.
func ownRoute(method, path string) bool {
	if mfaEnrollmentRoute(method, path) {
		return true
	}
	switch method + " " + path {
	case "POST /panel/setting/updateUser", "POST /panel/setting/sessions/list", "POST /panel/setting/sessions/revoke", "POST /panel/setting/sessions/revokeOthers",
		"GET /panel/api/tokens/list", "POST /panel/api/tokens/create", "POST /panel/api/tokens/revoke", "GET /panel/", "POST /panel/setting/twoFactor/disable",
		"GET /panel/auth/my-identities", "POST /panel/auth/my-identities/:id/unlink", "GET /panel/auth/link/:key/start", "GET /panel/api/api-docs/markdown":
		return true
	}
	return false
}

func scopeNotFound(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"success": false, "msg": "not found"})
}

// scopeAllows applies the organization limit. It returns false after writing the answer.
func scopeAllows(c *gin.Context, p *service.Principal, method, path string) bool {
	if p.OrgId == nil {
		return true
	}
	if ownRoute(method, path) {
		return true
	}
	kind, ok := scopedRoutes[method+" "+path]
	if !ok {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "code": "org_scope",
			"msg": "This account is limited to its organization and cannot use this function"})
		return false
	}
	org := *p.OrgId
	idParam := func(name string) (int, bool) {
		n, err := strconv.Atoi(c.Param(name))
		return n, err == nil
	}
	switch kind {
	case kindGroupID:
		n, good := idParam("id")
		if !good || !service.GroupInOrg(org, n) {
			scopeNotFound(c)
			return false
		}
	case kindClientID:
		n, good := idParam("id")
		if !good || !service.ClientInOrg(org, n) {
			scopeNotFound(c)
			return false
		}
	case kindClientParam:
		n, good := idParam("clientId")
		if !good || !service.ClientInOrg(org, n) {
			scopeNotFound(c)
			return false
		}
	case kindListClients, kindListGroups:
		c.Set("scope_kind", kind)
		c.Set("scope_org", org)
		c.Writer = &scopeWriter{ResponseWriter: c.Writer}
	}
	return true
}

// scopeWriter holds the answer of a list endpoint back so it can be filtered to the organization.
type scopeWriter struct {
	gin.ResponseWriter
	buf    bytes.Buffer
	status int
}

func (w *scopeWriter) Write(b []byte) (int, error)       { return w.buf.Write(b) }
func (w *scopeWriter) WriteString(s string) (int, error) { return w.buf.WriteString(s) }
func (w *scopeWriter) WriteHeader(code int)              { w.status = code }

// scopeFinish runs after the handler: it filters a held list answer and sends it.
func scopeFinish(c *gin.Context) {
	w, ok := c.Writer.(*scopeWriter)
	if !ok {
		return
	}
	c.Writer = w.ResponseWriter
	if w.status != 0 {
		w.ResponseWriter.WriteHeader(w.status)
	}
	body := w.buf.Bytes()
	var env struct {
		Success bool              `json:"success"`
		Msg     string            `json:"msg"`
		Obj     []json.RawMessage `json:"obj"`
	}
	kind, _ := c.Get("scope_kind")
	orgV, _ := c.Get("scope_org")
	org, _ := orgV.(int)
	if json.Unmarshal(body, &env) != nil || !env.Success {
		_, _ = w.ResponseWriter.Write(body) // an error answer carries no data
		return
	}
	allowed := map[int]bool{}
	for _, id := range service.OrgGroupIDs(org) {
		allowed[id] = true
	}
	kept := make([]json.RawMessage, 0, len(env.Obj))
	for _, raw := range env.Obj {
		var item struct {
			Id      int  `json:"id"`
			GroupId *int `json:"groupId"`
		}
		if json.Unmarshal(raw, &item) != nil {
			continue
		}
		switch kind {
		case kindListGroups:
			if allowed[item.Id] {
				kept = append(kept, raw)
			}
		case kindListClients:
			if item.GroupId != nil && allowed[*item.GroupId] {
				kept = append(kept, raw)
			}
		}
	}
	out, _ := json.Marshal(map[string]any{"success": true, "msg": env.Msg, "obj": kept})
	_, _ = w.ResponseWriter.Write(out)
}
