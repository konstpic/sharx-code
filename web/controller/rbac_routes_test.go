package controller

import (
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/konstpic/sharx-code/v2/web/rbac"
)

// authRoutes builds the real routers (without background jobs) and returns the authenticated routes as "METHOD /path".
func authRoutes(t *testing.T) map[string]bool {
	t.Helper()
	skipBackgroundTasks = true
	gin.SetMode(gin.TestMode)
	e := gin.New()
	g := e.Group("/")
	NewIndexController(g, nil)
	NewXUIController(g, nil)
	NewAPIController(g)
	out := map[string]bool{}
	for _, r := range e.Routes() {
		if r.Method == "HEAD" {
			continue // looked up as GET
		}
		out[r.Method+" "+r.Path] = true
	}
	return out
}

// publicRoutes are registered next to the signed-in routes but authenticate themselves (sign-in, HMAC from nodes, the
// public subscription page). They are deliberately not in the permission table.
var publicRoutes = map[string]bool{
	"GET /": true, "GET /logout": true, "GET /logout/": true, "POST /login": true, "POST /getTwoFactorEnable": true,
	// single sign-on: the browser comes back from the identity provider without a session; state, nonce, PKCE and the
	// binding cookie are checked inside the handlers
	"GET /auth/providers": true, "GET /auth/sso/:key/start": true, "GET /auth/sso/:key/callback": true,
	"POST /auth/sso/:key/callback": true, "GET /auth/sso/:key/begin": true, "POST /auth/sso/:key/webhook": true,
	"GET /auth/methods": true, "POST /auth/magic/request": true, "POST /auth/magic/verify": true, "POST /auth/register": true, "POST /auth/register/confirm": true,
	"POST /auth/password/forgot": true, "POST /auth/password/reset": true, "POST /auth/passkey/login/begin": true, "POST /auth/passkey/login/finish": true,
	"POST /panel/api/node/push-logs": true, "POST /panel/api/node/push-geo": true, "POST /panel/api/node/pull-xray-config": true,
	"GET /panel/api/public/appMeta": true, "GET /panel/api/public/subscription": true,
}

// TestEveryAuthenticatedRouteHasAPermissionEntry is the guard against an unprotected endpoint: a route added without a
// decision fails here, and a stale entry for a removed route fails too.
func TestEveryAuthenticatedRouteHasAPermissionEntry(t *testing.T) {
	routes := authRoutes(t)
	var missing, stale []string
	for key := range routes {
		if publicRoutes[key] {
			continue
		}
		method, path, _ := strings.Cut(key, " ")
		if _, ok := rbac.Lookup(method, path); !ok {
			missing = append(missing, key)
		}
	}
	for _, key := range rbac.Routes() {
		if !routes[key] {
			stale = append(stale, key)
		}
	}
	sort.Strings(missing)
	sort.Strings(stale)
	if len(missing) > 0 {
		t.Errorf("routes without a permission entry in web/rbac/routes.go (they would be administrators-only):\n  %s", strings.Join(missing, "\n  "))
	}
	if len(stale) > 0 {
		t.Errorf("permission entries without a route:\n  %s", strings.Join(stale, "\n  "))
	}
}

// TestEveryWebSocketTopicIsListed makes sure a new push topic cannot reach users who may not read its data.
func TestEveryWebSocketTopicIsListed(t *testing.T) {
	for typ := range wsTopicPerms {
		for _, p := range wsTopicPerms[typ] {
			if !rbac.Valid(p) {
				t.Errorf("topic %s requires unknown permission %s", typ, p)
			}
		}
	}
}
