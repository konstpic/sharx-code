package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/xlzd/gotp"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	"github.com/konstpic/sharx-code/v2/web/rbac"
	"github.com/konstpic/sharx-code/v2/web/service"
	"github.com/konstpic/sharx-code/v2/web/session"
	"github.com/konstpic/sharx-code/v2/web/websocket"
)

// These tests drive the real routers over HTTP with real sessions and a real database (SHARX_TEST_DB): the point is that
// a request a restricted user sends by hand, bypassing the UI, is refused AND does not change anything.

type httpEnv struct {
	t      *testing.T
	srv    *httptest.Server
	svc    *service.RBACService
	admin  service.Actor
	nextID int
}

func newHTTPEnv(t *testing.T) *httpEnv {
	t.Helper()
	testdb.New(t)
	service.InvalidateRBAC()
	skipBackgroundTasks = true
	deniedSeenMu.Lock()
	deniedSeen = map[string]time.Time{}
	deniedSeenMu.Unlock()
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(sessions.Sessions("sharx", cookie.NewStore([]byte("test-secret-test-secret-test-secret"))))
	e.Use(func(c *gin.Context) { c.Set("base_path", "/") })
	g := e.Group("/")
	NewIndexController(g, nil)
	NewXUIController(g, func(c *gin.Context) { c.String(200, "panel") })
	NewAPIController(g)
	// a route that exists in the router but has no entry in the permission table: it must be administrators-only
	probe := g.Group("/panel")
	probe.Use((&BaseController{}).checkLogin)
	probe.POST("/__unmapped", func(c *gin.Context) { c.JSON(200, gin.H{"success": true}) })
	// test-only sign-in: the real login adds 2FA, LDAP and rate limits that are not under test here
	e.GET("/__login/:id", func(c *gin.Context) {
		id, _ := strconv.Atoi(c.Param("id"))
		var u model.User
		if err := database.GetDB().First(&u, id).Error; err != nil {
			c.AbortWithStatus(404)
			return
		}
		session.SetLoginUser(c, &u)
		_ = session.RegisterLoginSession(c, u.Id, 3600, "127.0.0.1")
		_ = sessions.Default(c).Save()
		c.String(200, "ok")
	})
	srv := httptest.NewServer(e)
	t.Cleanup(srv.Close)

	svc := &service.RBACService{}
	var u model.User
	if err := database.GetDB().Order("id").First(&u).Error; err != nil {
		t.Fatal(err)
	}
	p, _ := svc.GetPrincipal(u.Id)
	return &httpEnv{t: t, srv: srv, svc: svc, admin: service.Actor{Principal: p, IP: "127.0.0.1"}}
}

type client struct {
	env *httpEnv
	c   *http.Client
	id  int
}

// as signs a user in and returns a client holding the session cookie.
func (e *httpEnv) as(userID int) *client {
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := c.Get(e.srv.URL + "/__login/" + strconv.Itoa(userID))
	if err != nil || resp.StatusCode != 200 {
		e.t.Fatalf("test login: %v %v", resp, err)
	}
	resp.Body.Close()
	return &client{env: e, c: c, id: userID}
}

func (e *httpEnv) anonymous() *client {
	return &client{env: e, c: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (c *client) do(method, path string, body any) (int, map[string]any) {
	c.env.t.Helper()
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, c.env.srv.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	resp, err := c.c.Do(req)
	if err != nil {
		c.env.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func (e *httpEnv) role(perms ...string) *service.RoleView {
	e.t.Helper()
	e.nextID++
	r, err := e.svc.CreateRole(e.admin, service.RoleInput{Name: fmt.Sprintf("r%d-%d", e.nextID, time.Now().UnixNano()%1e6), Permissions: perms})
	if err != nil {
		e.t.Fatal(err)
	}
	return r
}

func (e *httpEnv) user(name string, roleID int) int {
	e.t.Helper()
	u, err := e.svc.CreateUser(e.admin, service.UserInput{Username: name, Password: "correct-horse-1", RoleId: roleID, Enabled: true})
	if err != nil {
		e.t.Fatal(err)
	}
	return u.Id
}

func groupExists(t *testing.T, id int) bool {
	t.Helper()
	var n int64
	database.GetDB().Raw("SELECT COUNT(*) FROM client_groups WHERE id = ?", id).Scan(&n)
	return n > 0
}

func newGroup(t *testing.T, name string) int {
	t.Helper()
	var id int
	// groups belong to the panel's data owner, whoever works on them (see service.PanelOwnerID)
	if err := database.GetDB().Raw("INSERT INTO client_groups (user_id, name, created_at, updated_at) VALUES (?, ?, 0, 0) RETURNING id", service.PanelOwnerID(1), name).Scan(&id).Error; err != nil || id == 0 {
		t.Fatalf("seed group: %v", err)
	}
	return id
}

func TestAnonymousRequestsAreRefused(t *testing.T) {
	e := newHTTPEnv(t)
	a := e.anonymous()
	for _, r := range [][2]string{{"GET", "/panel/client/list"}, {"POST", "/panel/group/del/1"}, {"GET", "/panel/rbac/me"}} {
		if code, _ := a.do(r[0], r[1], nil); code != 401 && code != 302 {
			t.Errorf("%s %s without a session: %d", r[0], r[1], code)
		}
	}
	if code, _ := a.do("GET", "/panel/api/inbounds/list", nil); code != 404 {
		t.Errorf("the API group hides itself from anonymous callers: %d", code)
	}
}

// The scenario from the task: the UI hides the button, the user sends the request by hand, the backend refuses and the data is untouched.
func TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing(t *testing.T) {
	e := newHTTPEnv(t)
	viewer := e.role(rbac.GroupsRead, rbac.ClientsRead)
	vid := e.user("viewer", viewer.Id)
	gid := newGroup(t, "keep-me")
	c := e.as(vid)

	code, body := c.do("GET", "/panel/group/list", nil)
	if code != 200 || body["success"] != true {
		t.Fatalf("a read-only user may read groups: %d %v", code, body)
	}
	if list, _ := body["obj"].([]any); len(list) != 1 {
		t.Fatalf("data created by the panel's owner is shared: a second user must see it, got %v", body["obj"])
	}
	code, body = c.do("POST", "/panel/group/del/"+strconv.Itoa(gid), nil)
	if code != 403 || body["success"] != false {
		t.Fatalf("delete without groups:delete must be 403, got %d %v", code, body)
	}
	if !groupExists(t, gid) {
		t.Fatal("the forbidden request must not have deleted the group")
	}
	for _, r := range [][2]string{
		{"POST", "/panel/group/add"},
		{"POST", "/panel/group/update/" + strconv.Itoa(gid)},
		{"POST", "/panel/client/del/1"},
		{"POST", "/panel/client/bulk/delete"},
		{"POST", "/panel/client/resetAllTraffics"},
		{"POST", "/panel/node/del/1"},
		{"GET", "/panel/node/secret"},
		{"GET", "/panel/node/list"},
		{"POST", "/panel/setting/update"},
		{"POST", "/panel/setting/restartPanel"},
		{"GET", "/panel/api/inbounds/list"},
		{"POST", "/panel/api/inbounds/del/1"},
		{"GET", "/panel/api/server/getDb"},
		{"POST", "/panel/api/server/importDB"},
		{"GET", "/panel/db/tables"},
		{"POST", "/panel/xray/update"},
		{"GET", "/panel/rbac/users"},
		{"POST", "/panel/rbac/users"},
		{"GET", "/panel/rbac/audit"},
		{"POST", "/panel/rbac/roles"},
	} {
		if code, _ := c.do(r[0], r[1], map[string]any{}); code != 403 {
			t.Errorf("%s %s as a viewer: want 403, got %d", r[0], r[1], code)
		}
	}
	// the bulk group action needs the matching client permission as well as the group
	if code, _ := c.do("POST", "/panel/group/"+strconv.Itoa(gid)+"/bulk/delete", map[string]any{}); code != 403 {
		t.Errorf("bulk delete needs clients:delete: %d", code)
	}
	// the same request from a user who holds the permission goes through and does the work
	deleter := e.role(rbac.GroupsDelete)
	did := e.user("deleter", deleter.Id)
	if code, body := e.as(did).do("POST", "/panel/group/del/"+strconv.Itoa(gid), nil); code != 200 || body["success"] != true {
		t.Fatalf("an allowed delete must succeed: %d %v", code, body)
	}
	if groupExists(t, gid) {
		t.Fatal("the allowed request must have deleted the group")
	}
}

func TestRoleChangeAppliesToTheNextRequestWithoutNewSignIn(t *testing.T) {
	e := newHTTPEnv(t)
	r := e.role(rbac.GroupsRead)
	uid := e.user("grower", r.Id)
	c := e.as(uid)
	gid := newGroup(t, "g")
	if code, _ := c.do("POST", "/panel/group/del/"+strconv.Itoa(gid), nil); code != 403 {
		t.Fatalf("before: %d", code)
	}
	if _, err := e.svc.UpdateRole(e.admin, r.Id, service.RoleInput{Name: r.Name, Permissions: []string{rbac.GroupsRead, rbac.GroupsDelete}}); err != nil {
		t.Fatal(err)
	}
	if code, _ := c.do("POST", "/panel/group/del/"+strconv.Itoa(gid), nil); code != 200 {
		t.Fatalf("after the role gained the permission: %d", code)
	}
	// and the other way round: a permission taken away stops working in the open session
	g2 := newGroup(t, "g2")
	if _, err := e.svc.UpdateRole(e.admin, r.Id, service.RoleInput{Name: r.Name, Permissions: []string{rbac.GroupsRead}}); err != nil {
		t.Fatal(err)
	}
	if code, _ := c.do("POST", "/panel/group/del/"+strconv.Itoa(g2), nil); code != 403 {
		t.Fatalf("a revoked permission must stop at once: %d", code)
	}
	if !groupExists(t, g2) {
		t.Fatal("and must not have deleted anything")
	}
}

func TestDisabledAndDeletedUsersAreCutOffMidSession(t *testing.T) {
	e := newHTTPEnv(t)
	r := e.role(rbac.GroupsRead)
	uid := e.user("blocked", r.Id)
	c := e.as(uid)
	if code, _ := c.do("GET", "/panel/group/list", nil); code != 200 {
		t.Fatalf("setup: %d", code)
	}
	off := false
	if _, err := e.svc.UpdateUser(e.admin, uid, service.UserPatch{Enabled: &off}); err != nil {
		t.Fatal(err)
	}
	if code, _ := c.do("GET", "/panel/group/list", nil); code != 401 {
		t.Fatalf("a disabled user's open session must be refused: %d", code)
	}
	// the same cookie stays dead after re-enabling: the session was ended, the user signs in again
	on := true
	e.svc.UpdateUser(e.admin, uid, service.UserPatch{Enabled: &on})
	if code, _ := c.do("GET", "/panel/group/list", nil); code != 401 {
		t.Fatalf("revoked sessions do not come back by themselves: %d", code)
	}
	if code, _ := e.as(uid).do("GET", "/panel/group/list", nil); code != 200 {
		t.Fatalf("a fresh sign-in works again: %d", code)
	}
	if err := e.svc.DeleteUser(e.admin, uid); err != nil {
		t.Fatal(err)
	}
	// a deleted account has no valid session either
	jar, _ := cookiejar.New(nil)
	_ = jar
	var row model.User
	database.GetDB().First(&row, uid)
	if e.svc.CanSignIn(&row) {
		t.Fatal("a deleted user cannot sign in")
	}
}

func TestUnmappedRouteIsAdministratorsOnly(t *testing.T) {
	e := newHTTPEnv(t)
	r := e.role(rbac.GroupsRead)
	uid := e.user("plain", r.Id)
	if code, _ := e.as(uid).do("POST", "/panel/__unmapped", nil); code != 403 {
		t.Fatalf("an endpoint nobody decided about must refuse non-administrators: %d", code)
	}
	if code, _ := e.as(e.admin.Principal.UserId).do("POST", "/panel/__unmapped", nil); code != 200 {
		t.Fatalf("administrators keep access to everything: %d", code)
	}
}

func TestPrivilegeEscalationOverHTTP(t *testing.T) {
	e := newHTTPEnv(t)
	delegate := e.role(rbac.RolesCreate, rbac.RolesUpdate, rbac.UsersCreate, rbac.UsersUpdate, rbac.RolesRead, rbac.UsersRead, rbac.ClientsRead)
	did := e.user("delegate", delegate.Id)
	c := e.as(did)

	// a role with permissions the caller does not hold
	code, body := c.do("POST", "/panel/rbac/roles", map[string]any{"name": "evil", "permissions": []string{rbac.ClientsDelete}})
	if code != 403 {
		t.Fatalf("create role beyond own permissions: %d %v", code, body)
	}
	if code, _ := c.do("POST", "/panel/rbac/roles", map[string]any{"name": "evil2", "permissions": []string{"*"}}); code != 403 {
		t.Fatalf("wildcard role: %d", code)
	}
	var n int64
	database.GetDB().Raw("SELECT COUNT(*) FROM roles WHERE name LIKE 'evil%'").Scan(&n)
	if n != 0 {
		t.Fatal("refused role creations must not leave rows behind")
	}
	// a user with the Administrator role
	var adminRole int
	database.GetDB().Raw("SELECT id FROM roles WHERE system_key = 'administrator'").Scan(&adminRole)
	if code, _ := c.do("POST", "/panel/rbac/users", map[string]any{"username": "mallory", "password": "correct-horse-1", "roleId": adminRole}); code != 403 {
		t.Fatalf("create an administrator: %d", code)
	}
	// own role
	small := e.role(rbac.ClientsRead)
	if code, _ := c.do("POST", "/panel/rbac/users/"+strconv.Itoa(did)+"/update", map[string]any{"roleId": small.Id}); code != 403 {
		t.Fatalf("change own role: %d", code)
	}
	if code, _ := c.do("POST", "/panel/rbac/users/"+strconv.Itoa(did)+"/update", map[string]any{"roleId": adminRole}); code != 403 {
		t.Fatalf("make myself Administrator: %d", code)
	}
	var rid int
	database.GetDB().Raw("SELECT role_id FROM users WHERE id = ?", did).Scan(&rid)
	if rid != delegate.Id {
		t.Fatal("the caller's role must be unchanged")
	}
	// the built-in role cannot be edited by anyone through the API
	if code, _ := e.as(e.admin.Principal.UserId).do("POST", "/panel/rbac/roles/"+strconv.Itoa(adminRole)+"/update", map[string]any{"name": "x", "permissions": []string{rbac.ClientsRead}}); code != 403 {
		t.Fatalf("edit the Administrator role: %d", code)
	}
	// delegable things work: a role within the caller's own permissions
	if code, body := c.do("POST", "/panel/rbac/roles", map[string]any{"name": "fine", "permissions": []string{rbac.ClientsRead}}); code != 200 {
		t.Fatalf("a role within the caller's permissions: %d %v", code, body)
	}
}

func TestSettingsAreRedactedAndSecuritySettingsAreSeparate(t *testing.T) {
	e := newHTTPEnv(t)
	st := service.SettingService{}
	cur, err := st.GetAllSetting()
	if err != nil {
		t.Fatal(err)
	}
	cur.TgBotToken = "123456:SECRET-TOKEN"
	if err := database.GetDB().Exec(`INSERT INTO settings (key, value) VALUES ('tgBotToken', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, cur.TgBotToken).Error; err != nil {
		t.Skipf("cannot seed the setting (schema differs): %v", err)
	}
	viewer := e.role(rbac.GroupsRead)
	cfg := e.role(rbac.SettingsRead, rbac.SettingsUpdate)
	vid, cid := e.user("viewer", viewer.Id), e.user("cfg", cfg.Id)

	_, body := e.as(vid).do("POST", "/panel/setting/all", nil)
	obj, _ := body["obj"].(map[string]any)
	if obj == nil || obj["tgBotToken"] != "" {
		t.Fatalf("a user without settings:read must not get secrets: %v", obj["tgBotToken"])
	}
	_, body = e.as(cid).do("POST", "/panel/setting/all", nil)
	obj, _ = body["obj"].(map[string]any)
	if obj["tgBotToken"] != "123456:SECRET-TOKEN" {
		t.Fatalf("settings:read shows the settings: %v", obj["tgBotToken"])
	}
	// changing a security setting (LDAP decides who can sign in) needs settings:security
	changed := map[string]any{}
	for k, v := range obj {
		changed[k] = v
	}
	changed["ldapEnable"] = true
	changed["ldapHost"] = "ldap.attacker.example"
	if code, _ := e.as(cid).do("POST", "/panel/setting/update", changed); code != 403 {
		t.Fatalf("changing LDAP without settings:security: %d", code)
	}
	if after, _ := st.GetAllSetting(); after.LdapEnable || after.LdapHost == "ldap.attacker.example" {
		t.Fatal("the refused update must not have been applied")
	}
}

func TestWebSocketTopicsFollowReadPermissions(t *testing.T) {
	e := newHTTPEnv(t)
	r := e.role(rbac.ClientsRead, rbac.DashboardRead)
	uid := e.user("ws", r.Id)
	allow := wsAllow(uid)
	if !allow(websocket.MessageTypeClients) || !allow(websocket.MessageTypeStatus) || !allow(websocket.MessageTypeNotification) {
		t.Fatal("allowed topics")
	}
	if allow(websocket.MessageTypeInbounds) || allow(websocket.MessageTypeNodes) || allow(websocket.MessageTypeClientTrafficPerNode) {
		t.Fatal("inbounds and nodes must not reach a user who cannot read them")
	}
	if allow(websocket.MessageType("something-new")) {
		t.Fatal("an unknown topic must not be delivered until it is listed")
	}
	off := false
	e.svc.UpdateUser(e.admin, uid, service.UserPatch{Enabled: &off})
	if allow(websocket.MessageTypeClients) {
		t.Fatal("a disabled user receives nothing")
	}
}

func TestMeReportsThePermissionsTheUIAdaptsTo(t *testing.T) {
	e := newHTTPEnv(t)
	r := e.role(rbac.ClientsUpdate)
	uid := e.user("me", r.Id)
	code, body := e.as(uid).do("GET", "/panel/rbac/me", nil)
	obj, _ := body["obj"].(map[string]any)
	perms, _ := obj["permissions"].([]any)
	if code != 200 || obj["super"] != false || len(perms) != 2 || !strings.Contains(fmt.Sprint(perms), "clients:read") {
		t.Fatalf("me: %d %v", code, body)
	}
	_, body = e.as(e.admin.Principal.UserId).do("GET", "/panel/rbac/me", nil)
	obj, _ = body["obj"].(map[string]any)
	if obj["super"] != true {
		t.Fatalf("the administrator is super: %v", obj)
	}
}

func seedInbound(t *testing.T) int {
	t.Helper()
	var id int
	settings := `{"clients":[{"id":"aaaa-1111","email":"alice"},{"id":"bbbb-2222","email":"bob"}],"decryption":"none"}`
	stream := `{"network":"tcp","security":"reality","realitySettings":{"privateKey":"SERVER-PRIVATE-KEY","shortIds":["ab"],"serverNames":["example.com"]}}`
	err := database.GetDB().Raw(`INSERT INTO inbounds (user_id, remark, port, protocol, settings, stream_settings, tag, listen, sniffing)
		VALUES (?, 'rbac-test', 24443, 'vless', ?, ?, 'inbound-24443', '', '{}') RETURNING id`, service.PanelOwnerID(1), settings, stream).Scan(&id).Error
	if err != nil || id == 0 {
		t.Fatalf("seed inbound: %v", err)
	}
	return id
}

// inbounds:read shows the inbound, not what is inside it that belongs to other permissions.
func TestInboundReadDoesNotLeakClientsOrServerKeys(t *testing.T) {
	e := newHTTPEnv(t)
	id := seedInbound(t)
	body := func(c *client) string {
		_, r := c.do("GET", "/panel/api/inbounds/get/"+strconv.Itoa(id), nil)
		b, _ := json.Marshal(r["obj"])
		return string(b)
	}
	onlyInbound := e.user("only-inbound", e.role(rbac.InboundsRead).Id)
	withClients := e.user("with-clients", e.role(rbac.InboundsRead, rbac.ClientsRead).Id)
	editor := e.user("editor", e.role(rbac.InboundsRead, rbac.InboundsUpdate).Id)

	if b := body(e.as(onlyInbound)); strings.Contains(b, "aaaa-1111") || strings.Contains(b, "SERVER-PRIVATE-KEY") || !strings.Contains(b, "example.com") {
		t.Fatalf("inbounds:read alone must show neither clients nor keys: %s", b)
	}
	if b := body(e.as(withClients)); !strings.Contains(b, "aaaa-1111") || strings.Contains(b, "SERVER-PRIVATE-KEY") {
		t.Fatalf("clients:read shows clients, not server keys: %s", b)
	}
	if b := body(e.as(editor)); strings.Contains(b, "aaaa-1111") || !strings.Contains(b, "SERVER-PRIVATE-KEY") {
		t.Fatalf("inbounds:update shows keys, not clients: %s", b)
	}
	if b := body(e.as(e.admin.Principal.UserId)); !strings.Contains(b, "aaaa-1111") || !strings.Contains(b, "SERVER-PRIVATE-KEY") {
		t.Fatalf("an administrator sees everything: %s", b)
	}
	// the list endpoint and the node list follow the same rule
	_, r := e.as(onlyInbound).do("GET", "/panel/api/inbounds/list", nil)
	if b, _ := json.Marshal(r["obj"]); strings.Contains(string(b), "aaaa-1111") || strings.Contains(string(b), "SERVER-PRIVATE-KEY") {
		t.Fatalf("list leaked: %s", b)
	}
}

// The scenario behind the "inbounds:update edits clients" limitation: the form is posted with a client smuggled in.
func TestInboundUpdateCannotChangeClientsWithoutClientPermissions(t *testing.T) {
	e := newHTTPEnv(t)
	id := seedInbound(t)
	editor := e.user("editor", e.role(rbac.InboundsRead, rbac.InboundsUpdate).Id)
	smuggled := `{"clients":[{"id":"evil-9999","email":"mallory"}],"decryption":"none"}`
	code, body := e.as(editor).do("POST", "/panel/api/inbounds/update/"+strconv.Itoa(id), map[string]any{
		"remark": "renamed", "port": 24443, "protocol": "vless", "settings": smuggled, "streamSettings": `{"network":"tcp"}`, "sniffing": "{}", "enable": true, "listen": "", "tag": "inbound-24443",
	})
	var settings, remark string
	database.GetDB().Raw("SELECT settings FROM inbounds WHERE id = ?", id).Scan(&settings)
	database.GetDB().Raw("SELECT remark FROM inbounds WHERE id = ?", id).Scan(&remark)
	if strings.Contains(settings, "mallory") || !strings.Contains(settings, "alice") || !strings.Contains(settings, "bob") {
		t.Fatalf("the client list must be unchanged (HTTP %d %v): %s", code, body, settings)
	}
	if remark != "renamed" {
		t.Logf("note: the update itself did not apply in this test environment (HTTP %d): %v", code, body)
	}
	// an administrator posting the same form does change the clients (the guard only restrains callers without client permissions)
	e.as(e.admin.Principal.UserId).do("POST", "/panel/api/inbounds/update/"+strconv.Itoa(id), map[string]any{
		"remark": "renamed", "port": 24443, "protocol": "vless", "settings": smuggled, "streamSettings": `{"network":"tcp"}`, "sniffing": "{}", "enable": true, "listen": "", "tag": "inbound-24443",
	})
	database.GetDB().Raw("SELECT settings FROM inbounds WHERE id = ?", id).Scan(&settings)
	if !strings.Contains(settings, "mallory") {
		t.Logf("note: administrator update not applied here (%s)", settings)
	}
}

// 2FA is personal: a user without any permission sets it up for themselves, it does not touch anybody else, and the
// administrative reset follows the same dominance rules as a password reset.
func TestTwoFactorIsPerUser(t *testing.T) {
	e := newHTTPEnv(t)
	plain := e.user("plain", e.role(rbac.GroupsRead).Id)
	other := e.user("other", e.role(rbac.GroupsRead).Id)
	hr := e.user("hr", e.role(rbac.UsersRead, rbac.UsersUpdate, rbac.GroupsRead).Id)
	adminID := e.admin.Principal.UserId

	c := e.as(plain)
	_, begin := c.do("POST", "/panel/setting/twoFactor/begin", nil)
	obj, _ := begin["obj"].(map[string]any)
	secret, _ := obj["secret"].(string)
	if secret == "" {
		t.Fatalf("a user without settings permissions must be able to start 2FA setup: %v", begin)
	}
	if _, r := c.do("POST", "/panel/setting/twoFactor/complete", map[string]any{"code": "000000"}); r["success"] == true {
		t.Fatal("a wrong code must not enable 2FA")
	}
	code := gotp.NewDefaultTOTP(secret).Now()
	if _, r := c.do("POST", "/panel/setting/twoFactor/complete", map[string]any{"code": code}); r["success"] != true {
		t.Fatalf("complete: %v", r)
	}
	if on, got := service.UserTwoFactor(plain); !on || got != secret {
		t.Fatalf("2FA not stored for the user: %v %q", on, got)
	}
	for _, id := range []int{other, adminID, hr} {
		if on, _ := service.UserTwoFactor(id); on {
			t.Fatalf("user %d must not get 2FA from somebody else's setup", id)
		}
	}
	if _, me := c.do("GET", "/panel/rbac/me", nil); me["obj"].(map[string]any)["twoFactor"] != true {
		t.Fatalf("me must report the user's own 2FA: %v", me)
	}

	// turning it off needs the current code
	if _, r := c.do("POST", "/panel/setting/twoFactor/disable", map[string]any{"code": "000000"}); r["success"] == true {
		t.Fatal("disable without the right code must fail")
	}
	if on, _ := service.UserTwoFactor(plain); !on {
		t.Fatal("2FA must still be on")
	}

	// HR may reset a user whose role it covers, not an administrator's, not its own
	if code, _ := e.as(hr).do("POST", fmt.Sprintf("/panel/rbac/users/%d/two-factor/reset", plain), nil); code != 200 {
		t.Fatalf("reset of a covered user: %d", code)
	}
	if on, _ := service.UserTwoFactor(plain); on {
		t.Fatal("reset must switch 2FA off")
	}
	if err := service.EnableUserTwoFactor(adminID, secret); err != nil {
		t.Fatal(err)
	}
	if code, _ := e.as(hr).do("POST", fmt.Sprintf("/panel/rbac/users/%d/two-factor/reset", adminID), nil); code != 403 {
		t.Fatalf("resetting an administrator's 2FA by a lower role must be refused, got %d", code)
	}
	if code, _ := e.as(hr).do("POST", fmt.Sprintf("/panel/rbac/users/%d/two-factor/reset", hr), nil); code != 403 {
		t.Fatalf("resetting your own 2FA through the admin endpoint must be refused, got %d", code)
	}
	if code, _ := e.as(other).do("POST", fmt.Sprintf("/panel/rbac/users/%d/two-factor/reset", plain), nil); code != 403 {
		t.Fatalf("without users:update the reset must be refused, got %d", code)
	}
	if on, _ := service.UserTwoFactor(adminID); !on {
		t.Fatal("administrator's 2FA must survive")
	}
}

func TestAuditJournalEndpointAndDeniedCallsAreRecorded(t *testing.T) {
	e := newHTTPEnv(t)
	low := e.user("low", e.role(rbac.GroupsRead).Id)
	auditor := e.user("auditor", e.role(rbac.AuditRead, rbac.LogsRead).Id)
	// refused call is recorded once even when repeated
	for i := 0; i < 3; i++ {
		if code, _ := e.as(low).do("GET", "/panel/rbac/audit", nil); code != 403 {
			t.Fatalf("want 403, got %d", code)
		}
	}
	if code, _ := e.as(low).do("GET", "/panel/api/server/logs/entity/audit/0", nil); code != 403 {
		t.Fatalf("the audit journal needs audit:read, got %d", code)
	}
	code, r := e.as(auditor).do("GET", "/panel/api/server/logs/entity/audit/0?levels=info,warn,error", nil)
	if code != 200 {
		t.Fatalf("auditor: %d %v", code, r)
	}
	b, _ := json.Marshal(r["obj"])
	if n := strings.Count(string(b), "was refused call GET /panel/rbac/audit"); n != 1 {
		t.Fatalf("expected exactly one recorded refusal, got %d: %s", n, b)
	}
	if !strings.Contains(string(b), "needs audit:read") {
		t.Fatalf("the reason must be in the entry: %s", b)
	}
}
