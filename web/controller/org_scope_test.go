package controller

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/web/rbac"
	"github.com/konstpic/sharx-code/v2/web/service"
)

type orgEnv struct {
	*httpEnv
	orgA, orgB    int
	gA, gB, gNone int
	cA, cB, cNone int
	scopedA       int // user limited to org A
	scopedRole    *service.RoleView
}

func (e *orgEnv) client(name string, group *int) int {
	c := &model.ClientEntity{UserId: service.PanelOwnerID(1), Name: name, UUID: "u-" + name, Enable: true, Status: "active", SubID: "s-" + name, GroupId: group}
	if err := database.GetDB().Create(c).Error; err != nil {
		e.t.Fatal(err)
	}
	return c.Id
}

func newOrgEnv(t *testing.T) *orgEnv {
	e := &orgEnv{httpEnv: newHTTPEnv(t)}
	a, err := e.svc.SaveOrg(e.admin, 0, "Acme", "")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := e.svc.SaveOrg(e.admin, 0, "Globex", "")
	e.orgA, e.orgB = a.Id, b.Id
	e.gA, e.gB, e.gNone = newGroup(t, "acme-group"), newGroup(t, "globex-group"), newGroup(t, "free-group")
	if err := e.svc.SetGroupOrg(e.admin, e.gA, &e.orgA); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SetGroupOrg(e.admin, e.gB, &e.orgB); err != nil {
		t.Fatal(err)
	}
	e.cA, e.cB, e.cNone = e.client("ca", &e.gA), e.client("cb", &e.gB), e.client("cn", nil)
	// the role is generous on purpose: the scope, not the role, must be what stops this account
	e.scopedRole = e.role(rbac.ClientsRead, rbac.ClientsUpdate, rbac.ClientsDelete, rbac.ClientsOperate, rbac.GroupsRead, rbac.GroupsUpdate, rbac.GroupsCreate,
		rbac.InboundsRead, rbac.NodesRead, rbac.DashboardRead, rbac.UsersRead)
	e.scopedA = e.user("acme-admin", e.scopedRole.Id)
	if _, err := e.svc.UpdateUser(e.admin, e.scopedA, service.UserPatch{OrgId: &e.orgA}); err != nil {
		t.Fatal(err)
	}
	return e
}

func ids(r map[string]any) []int {
	var out []int
	arr, _ := r["obj"].([]any)
	for _, x := range arr {
		m, _ := x.(map[string]any)
		out = append(out, int(m["id"].(float64)))
	}
	return out
}

func TestOrganizationScopeFiltersListsAndHidesOtherOrganizations(t *testing.T) {
	e := newOrgEnv(t)
	c := e.as(e.scopedA)
	_, groups := c.do("GET", "/panel/group/list", nil)
	if g := ids(groups); len(g) != 1 || g[0] != e.gA {
		t.Fatalf("a limited account sees only its organization's groups, got %v", g)
	}
	_, clients := c.do("GET", "/panel/client/list", nil)
	if cl := ids(clients); len(cl) != 1 || cl[0] != e.cA {
		t.Fatalf("a limited account sees only the clients in those groups, got %v", cl)
	}
	// an unlimited account with the same role keeps seeing everything: the limit belongs to the account
	free := e.user("free", e.scopedRole.Id)
	_, all := e.as(free).do("GET", "/panel/group/list", nil)
	if len(ids(all)) != 3 {
		t.Fatalf("accounts without an organization are not limited: %v", ids(all))
	}
	_, allc := e.as(free).do("GET", "/panel/client/list", nil)
	if len(ids(allc)) != 3 {
		t.Fatalf("clients: %v", ids(allc))
	}
}

func TestOrganizationScopeOnRoutesAddressedByID(t *testing.T) {
	e := newOrgEnv(t)
	c := e.as(e.scopedA)
	get := func(path string) int { code, _ := c.do("GET", path, nil); return code }
	post := func(path string) int { code, _ := c.do("POST", path, map[string]any{}); return code }

	if get(fmt.Sprintf("/panel/client/get/%d", e.cA)) != 200 {
		t.Fatal("own client readable")
	}
	for _, id := range []int{e.cB, e.cNone} {
		if code := get(fmt.Sprintf("/panel/client/get/%d", id)); code != 404 {
			t.Fatalf("a client outside the organization must look like it does not exist, got %d", code)
		}
		if code := get(fmt.Sprintf("/panel/client/links/%d", id)); code != 404 {
			t.Fatalf("share links of another organization's client: %d", code)
		}
		if code := post(fmt.Sprintf("/panel/client/resetTraffic/%d", id)); code != 404 {
			t.Fatalf("reset traffic: %d", code)
		}
		if code := post(fmt.Sprintf("/panel/client/del/%d", id)); code != 404 {
			t.Fatalf("delete: %d", code)
		}
		if code := get(fmt.Sprintf("/panel/client/hwid/list/%d", id)); code != 404 {
			t.Fatalf("hwid list: %d", code)
		}
	}
	var n int64
	database.GetDB().Model(&model.ClientEntity{}).Where("id IN ?", []int{e.cB, e.cNone}).Count(&n)
	if n != 2 {
		t.Fatal("nothing outside the organization may be deleted")
	}
	// groups
	for _, id := range []int{e.gB, e.gNone} {
		for _, p := range []string{"/panel/group/get/%d", "/panel/group/%d/clients", "/panel/group/%d/effectiveSettings"} {
			if code := get(fmt.Sprintf(p, id)); code != 404 {
				t.Fatalf(p+": %d", id, code)
			}
		}
		for _, p := range []string{"/panel/group/update/%d", "/panel/group/%d/bulk/delete", "/panel/group/%d/bulk/resetTraffic", "/panel/group/%d/bulk/enable"} {
			if code := post(fmt.Sprintf(p, id)); code != 404 {
				t.Fatalf(p+": %d", id, code)
			}
		}
	}
	database.GetDB().Model(&model.ClientEntity{}).Where("id IN ?", []int{e.cB, e.cNone}).Count(&n)
	if n != 2 {
		t.Fatal("a bulk delete on a foreign group must not delete its clients")
	}
	if get(fmt.Sprintf("/panel/group/%d/clients", e.gA)) != 200 || post(fmt.Sprintf("/panel/group/%d/bulk/resetTraffic", e.gA)) == 404 {
		t.Fatal("the organization's own group works")
	}
}

func TestOrganizationScopeIsDenyByDefault(t *testing.T) {
	e := newOrgEnv(t)
	c := e.as(e.scopedA)
	// functions that would reach outside the organization are closed whatever the role says
	closed := [][2]string{
		{"GET", "/panel/api/inbounds/list"}, {"GET", "/panel/node/list"}, {"GET", "/panel/rbac/users"}, {"GET", "/panel/rbac/roles"}, {"GET", "/panel/rbac/orgs"},
		{"POST", "/panel/client/add"}, {"POST", fmt.Sprintf("/panel/client/update/%d", e.cA)}, {"POST", "/panel/client/bulk/delete"}, {"POST", "/panel/client/resetAllTraffics"},
		{"POST", "/panel/group/add"}, {"POST", fmt.Sprintf("/panel/group/del/%d", e.gA)}, {"POST", fmt.Sprintf("/panel/group/%d/assignClients", e.gA)},
		{"POST", fmt.Sprintf("/panel/group/%d/bulk/assignInbounds", e.gA)}, {"POST", fmt.Sprintf("/panel/group/%d/org", e.gA)},
		{"GET", "/panel/api/server/status"}, {"POST", "/panel/setting/update"}, {"GET", "/panel/auth/providers"},
	}
	for _, rq := range closed {
		code, body := c.do(rq[0], rq[1], map[string]any{})
		if code != 403 {
			t.Fatalf("%s %s must be closed to a limited account, got %d %v", rq[0], rq[1], code, body)
		}
	}
	code, body := c.do("GET", "/panel/api/inbounds/list", nil)
	if body["code"] != "org_scope" || code != 403 {
		t.Fatalf("the refusal says why: %v", body)
	}
	// its own account stays usable
	if code, _ := c.do("GET", "/panel/rbac/me", nil); code != 200 {
		t.Fatal("me")
	}
	_, me := c.do("GET", "/panel/rbac/me", nil)
	if me["obj"].(map[string]any)["scoped"] != true {
		t.Fatalf("the UI is told the account is limited: %v", me)
	}
}

func TestOrganizationScopeDoesNotReachWebSocketData(t *testing.T) {
	e := newOrgEnv(t)
	allow := wsAllow(e.scopedA)
	for topic := range wsTopicPerms {
		if allow(topic) {
			t.Fatalf("live panel-wide data (%v) must not reach a limited account", topic)
		}
	}
	free := e.user("freews", e.role(rbac.ClientsRead, rbac.DashboardRead, rbac.InboundsRead, rbac.NodesRead).Id)
	n := 0
	for topic := range wsTopicPerms {
		if wsAllow(free)(topic) {
			n++
		}
	}
	if n == 0 {
		t.Fatal("an unlimited account still gets live data")
	}
}

func TestOrganizationManagementRulesAndAdministratorsAreNeverLimited(t *testing.T) {
	e := newHTTPEnv(t)
	o, _ := e.svc.SaveOrg(e.admin, 0, "Org", "")
	if _, err := e.svc.SaveOrg(e.admin, 0, "org", ""); err == nil {
		t.Fatal("organization names are unique")
	}
	// an administrator cannot be limited, and a role cannot become an administrator under a limited user
	if _, err := e.svc.UpdateUser(e.admin, e.admin.Principal.UserId, service.UserPatch{OrgId: &o.Id}); err == nil {
		t.Fatal("an administrator cannot be limited to an organization")
	}
	r := e.role(rbac.ClientsRead)
	u := e.user("lim", r.Id)
	if _, err := e.svc.UpdateUser(e.admin, u, service.UserPatch{OrgId: &o.Id}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.UpdateRole(e.admin, r.Id, service.RoleInput{Name: r.Name, Permissions: []string{"*"}}); err == nil {
		t.Fatal("making the role an administrator would silently lift the limit")
	}
	var adminRole model.Role
	database.GetDB().Where("system_key = 'administrator'").First(&adminRole)
	if _, err := e.svc.UpdateUser(e.admin, u, service.UserPatch{RoleId: &adminRole.Id}); err == nil {
		t.Fatal("a limited user cannot be given the administrator role")
	}
	// an organization with members cannot be deleted
	if err := e.svc.DeleteOrg(e.admin, o.Id); err == nil {
		t.Fatal("not empty")
	}
	if _, err := e.svc.UpdateUser(e.admin, u, service.UserPatch{ClearOrg: true}); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.DeleteOrg(e.admin, o.Id); err != nil {
		t.Fatalf("empty organizations can be removed: %v", err)
	}
	// who may manage them
	reader := e.user("orgreader", e.role(rbac.OrgsRead).Id)
	if code, _ := e.as(reader).do("GET", "/panel/rbac/orgs", nil); code != 200 {
		t.Fatal("orgs:read lists")
	}
	if code, _ := e.as(reader).do("POST", "/panel/rbac/orgs", map[string]any{"name": "x"}); code != 403 {
		t.Fatal("orgs:create needed")
	}
	// a group created through the API cannot claim an organization on its own
	gid := newGroup(t, "g")
	_ = gid
	creator := e.user("groupmaker", e.role(rbac.GroupsRead, rbac.GroupsCreate).Id)
	b, _ := json.Marshal(map[string]any{"name": "sneaky", "orgId": 1})
	_ = b
	code, body := e.as(creator).do("POST", "/panel/group/add", map[string]any{"name": "sneaky", "orgId": 1})
	if code != 200 {
		t.Fatalf("create: %d %v", code, body)
	}
	var g model.ClientGroup
	database.GetDB().Where("name = ?", "sneaky").First(&g)
	if g.OrgId != nil {
		t.Fatal("a group is handed to an organization only through the dedicated endpoint (orgs:update)")
	}
	_ = strings.ToLower
}
