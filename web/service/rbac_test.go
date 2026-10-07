package service

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
	"github.com/konstpic/sharx-code/v2/web/rbac"
)

// These tests need PostgreSQL: set SHARX_TEST_DB (see database/testdb); without it they are skipped.

type rbacEnv struct {
	t     *testing.T
	svc   *RBACService
	admin Actor
}

func setupRBAC(t *testing.T) *rbacEnv {
	t.Helper()
	testdb.New(t)
	InvalidateRBAC()
	svc := &RBACService{}
	var u model.User
	if err := database.GetDB().Where("deleted_at IS NULL").Order("id").First(&u).Error; err != nil {
		t.Fatalf("default administrator missing: %v", err)
	}
	p, err := svc.GetPrincipal(u.Id)
	if err != nil || p == nil {
		t.Fatalf("principal: %v %v", p, err)
	}
	return &rbacEnv{t: t, svc: svc, admin: Actor{Principal: p, IP: "10.0.0.1"}}
}

func (e *rbacEnv) role(perms ...string) *RoleView {
	e.t.Helper()
	r, err := e.svc.CreateRole(e.admin, RoleInput{Name: "role-" + strings.Join(perms, "+") + time.Now().Format("150405.000000"), Permissions: perms})
	if err != nil {
		e.t.Fatalf("create role %v: %v", perms, err)
	}
	return r
}

func (e *rbacEnv) user(name string, roleID int) *UserView {
	e.t.Helper()
	u, err := e.svc.CreateUser(e.admin, UserInput{Username: name, Password: "correct-horse-1", RoleId: roleID, Enabled: true})
	if err != nil {
		e.t.Fatalf("create user %s: %v", name, err)
	}
	return u
}

func (e *rbacEnv) actor(userID int) Actor {
	e.t.Helper()
	InvalidateRBAC()
	p, err := e.svc.GetPrincipal(userID)
	if err != nil || p == nil {
		e.t.Fatalf("principal %d: %v", userID, err)
	}
	return Actor{Principal: p, IP: "10.0.0.2"}
}

func wantErr(t *testing.T, err error, kind error, what string) {
	t.Helper()
	if !errors.Is(err, kind) {
		t.Fatalf("%s: want %v, got %v", what, kind, err)
	}
}

func TestMigrationGivesExistingUsersFullAccess(t *testing.T) {
	e := setupRBAC(t)
	if !e.admin.Principal.Super || e.admin.Principal.RoleName != "Administrator" {
		t.Fatalf("default user must be an Administrator: %+v", e.admin.Principal)
	}
	db := database.GetDB()
	// roles written by an old binary after the migration (no role) and a database that lost its administrator
	db.Exec("UPDATE users SET role_id = NULL")
	database.EnsureAdminAccess()
	InvalidateRBAC()
	p, _ := e.svc.GetPrincipal(e.admin.Principal.UserId)
	if !p.Super {
		t.Fatal("a user without a role must be restored as Administrator, never left locked out")
	}
	db.Exec("UPDATE users SET enabled = FALSE")
	database.EnsureAdminAccess()
	InvalidateRBAC()
	p, _ = e.svc.GetPrincipal(e.admin.Principal.UserId)
	if !p.Enabled || !p.Super {
		t.Fatal("when no administrator can sign in, the first user is restored")
	}
}

func TestRoleCreationAndValidation(t *testing.T) {
	e := setupRBAC(t)
	r, err := e.svc.CreateRole(e.admin, RoleInput{Name: "Support", Description: "d", Permissions: []string{rbac.ClientsUpdate}})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Permissions) != 2 || r.Permissions[0] != rbac.ClientsRead { // update implies read
		t.Fatalf("read must be added to update: %v", r.Permissions)
	}
	_, err = e.svc.CreateRole(e.admin, RoleInput{Name: "SUPPORT"})
	wantErr(t, err, ErrConflict, "duplicate role name (case-insensitive)")
	_, err = e.svc.CreateRole(e.admin, RoleInput{Name: "  "})
	wantErr(t, err, ErrInvalid, "empty name")
	_, err = e.svc.CreateRole(e.admin, RoleInput{Name: "Bad", Permissions: []string{"clients:fly"}})
	wantErr(t, err, ErrInvalid, "unknown permission")
}

func TestPrivilegeEscalationThroughRoles(t *testing.T) {
	e := setupRBAC(t)
	delegate := e.role(rbac.RolesCreate, rbac.RolesUpdate, rbac.RolesDelete, rbac.UsersCreate, rbac.UsersUpdate, rbac.ClientsRead)
	du := e.user("delegate", delegate.Id)
	a := e.actor(du.Id)

	// granting a permission the caller does not hold
	_, err := e.svc.CreateRole(a, RoleInput{Name: "x", Permissions: []string{rbac.ClientsDelete}})
	wantErr(t, err, ErrForbidden, "create role with a permission the caller lacks")
	_, err = e.svc.CreateRole(a, RoleInput{Name: "y", Permissions: []string{rbac.Wildcard}})
	wantErr(t, err, ErrForbidden, "create a wildcard role")
	// granting what the caller holds is fine
	ok, err := e.svc.CreateRole(a, RoleInput{Name: "viewer", Permissions: []string{rbac.ClientsRead}})
	if err != nil {
		t.Fatalf("a caller may hand out what they hold: %v", err)
	}
	// permissions only administrators may delegate, even when the caller can manage roles
	_, err = e.svc.CreateRole(a, RoleInput{Name: "z", Permissions: []string{rbac.SystemBackup}})
	wantErr(t, err, ErrForbidden, "super-only permission")
	// raising an existing role beyond the caller
	_, err = e.svc.UpdateRole(a, ok.Id, RoleInput{Name: "viewer", Permissions: []string{rbac.ClientsRead, rbac.NodesDelete}})
	wantErr(t, err, ErrForbidden, "add a permission the caller lacks")
	// editing the role the caller holds, and the built-in role
	_, err = e.svc.UpdateRole(a, delegate.Id, RoleInput{Name: delegate.Name, Permissions: delegate.Permissions})
	wantErr(t, err, ErrForbidden, "edit own role")
	var adminRole model.Role
	database.GetDB().Where("system_key = 'administrator'").First(&adminRole)
	_, err = e.svc.UpdateRole(e.admin, adminRole.Id, RoleInput{Name: "Root", Permissions: []string{rbac.ClientsRead}})
	wantErr(t, err, ErrForbidden, "even an administrator cannot edit the built-in role")
	wantErr(t, e.svc.DeleteRole(e.admin, adminRole.Id), ErrForbidden, "delete the built-in role")
	// a role bigger than the caller cannot be edited or deleted by them
	big := e.role(rbac.ClientsRead, rbac.NodesDelete)
	_, err = e.svc.UpdateRole(a, big.Id, RoleInput{Name: "smaller", Permissions: []string{rbac.ClientsRead}})
	wantErr(t, err, ErrForbidden, "edit a role with permissions the caller lacks")
	wantErr(t, e.svc.DeleteRole(a, big.Id), ErrForbidden, "delete a bigger role")
	// the denied attempts are in the audit trail
	rows, _ := Audit.List(AuditQuery{Result: "denied", Limit: 50})
	if len(rows) < 5 {
		t.Fatalf("denied attempts must be audited, got %d", len(rows))
	}
}

func TestPrivilegeEscalationThroughUsers(t *testing.T) {
	e := setupRBAC(t)
	hr := e.role(rbac.UsersCreate, rbac.UsersUpdate, rbac.UsersDelete, rbac.ClientsRead)
	small := e.role(rbac.ClientsRead)
	hru := e.user("hr", hr.Id)
	a := e.actor(hru.Id)

	var adminRoleID int
	database.GetDB().Raw("SELECT id FROM roles WHERE system_key='administrator'").Scan(&adminRoleID)
	// create a user with a role bigger than the caller's
	_, err := e.svc.CreateUser(a, UserInput{Username: "boss", Password: "correct-horse-1", RoleId: adminRoleID, Enabled: true})
	wantErr(t, err, ErrForbidden, "assign the Administrator role")
	bigRole := e.role(rbac.ClientsRead, rbac.NodesDelete)
	_, err = e.svc.CreateUser(a, UserInput{Username: "boss2", Password: "correct-horse-1", RoleId: bigRole.Id, Enabled: true})
	wantErr(t, err, ErrForbidden, "assign a role with permissions the caller lacks")
	// but the caller can create users with roles within their own permissions
	low, err := e.svc.CreateUser(a, UserInput{Username: "intern", Password: "correct-horse-1", RoleId: small.Id, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	// self-escalation: own role, own status
	_, err = e.svc.UpdateUser(a, hru.Id, UserPatch{RoleId: &small.Id})
	wantErr(t, err, ErrForbidden, "change own role")
	_, err = e.svc.UpdateUser(a, hru.Id, UserPatch{RoleId: &adminRoleID})
	wantErr(t, err, ErrForbidden, "make myself Administrator")
	off := false
	_, err = e.svc.UpdateUser(a, hru.Id, UserPatch{Enabled: &off})
	wantErr(t, err, ErrForbidden, "disable myself")
	wantErr(t, e.svc.DeleteUser(a, hru.Id), ErrForbidden, "delete myself")
	// touching an administrator
	adminID := e.admin.Principal.UserId
	_, err = e.svc.UpdateUser(a, adminID, UserPatch{Enabled: &off})
	wantErr(t, err, ErrForbidden, "disable an administrator")
	wantErr(t, e.svc.DeleteUser(a, adminID), ErrForbidden, "delete an administrator")
	wantErr(t, e.svc.SetUserPassword(a, adminID, "new-password-1"), ErrForbidden, "reset an administrator's password")
	// promoting a user beyond the caller
	_, err = e.svc.UpdateUser(a, low.Id, UserPatch{RoleId: &adminRoleID})
	wantErr(t, err, ErrForbidden, "promote to Administrator")
	// within limits it works
	if _, err := e.svc.UpdateUser(a, low.Id, UserPatch{RoleId: &hr.Id}); err != nil {
		t.Fatalf("promote within the caller's own permissions: %v", err)
	}
}

func TestLastAdministratorIsProtected(t *testing.T) {
	e := setupRBAC(t)
	var adminRoleID int
	database.GetDB().Raw("SELECT id FROM roles WHERE system_key='administrator'").Scan(&adminRoleID)
	small := e.role(rbac.ClientsRead)
	second := e.user("second-admin", adminRoleID)
	first := e.admin.Principal.UserId

	off := false
	if _, err := e.svc.UpdateUser(e.admin, second.Id, UserPatch{Enabled: &off}); err != nil {
		t.Fatalf("with two administrators one can be disabled: %v", err)
	}
	// now the only enabled administrator is the caller; another (disabled) one must not count
	on := true
	e.svc.UpdateUser(e.admin, second.Id, UserPatch{Enabled: &on})
	secondActor := e.actor(second.Id)
	if _, err := e.svc.UpdateUser(secondActor, first, UserPatch{Enabled: &off}); err != nil {
		t.Fatalf("disabling the first while the second remains: %v", err)
	}
	// the second is now the last enabled administrator; the (disabled) first cannot act, so use a fresh third admin
	third := e.user("third-admin", adminRoleID)
	thirdActor := e.actor(third.Id)
	if _, err := e.svc.UpdateUser(thirdActor, second.Id, UserPatch{Enabled: &off}); err != nil {
		t.Fatalf("second may go while third remains: %v", err)
	}
	// third is the last enabled administrator: nobody can disable, demote or delete them
	// (the actor must be another administrator; re-enable the first as the actor)
	e.svc.UpdateUser(thirdActor, first, UserPatch{Enabled: &on})
	firstActor := e.actor(first)
	e.svc.UpdateUser(firstActor, first, UserPatch{}) // no-op
	// now first and third are admins; disable first (allowed), then try to remove third via first? first is disabled, so
	// instead demote third with a role change while first is the only other administrator
	if _, err := e.svc.UpdateUser(firstActor, third.Id, UserPatch{RoleId: &small.Id}); err != nil {
		t.Fatalf("demoting one of two administrators: %v", err)
	}
	// first is now the last enabled administrator: a second administrator, created for the purpose, tries to remove them
	fourth := e.user("fourth-admin", adminRoleID)
	fourthActor := e.actor(fourth.Id)
	if _, err := e.svc.UpdateUser(fourthActor, first, UserPatch{RoleId: &small.Id}); err != nil {
		t.Fatalf("two administrators remain (first, fourth): %v", err)
	}
	// fourth is the last one: removing them must fail whoever tries (the actor is fourth itself or a non-admin)
	wantErr(t, e.svc.DeleteUser(e.admin, fourth.Id), ErrConflict, "delete the last administrator")
	if _, err := e.svc.UpdateUser(e.admin, fourth.Id, UserPatch{Enabled: &off}); !errors.Is(err, ErrConflict) {
		t.Fatalf("disable the last administrator: %v", err)
	}
	if _, err := e.svc.UpdateUser(e.admin, fourth.Id, UserPatch{RoleId: &small.Id}); !errors.Is(err, ErrConflict) {
		t.Fatalf("demote the last administrator: %v", err)
	}
}

func TestDisabledUserLosesEverythingAtOnce(t *testing.T) {
	e := setupRBAC(t)
	role := e.role(rbac.ClientsRead)
	u := e.user("temp", role.Id)
	db := database.GetDB()
	db.Create(&model.LoginSession{Id: "sess-1", UserId: u.Id, ExpiresAt: time.Now().Add(time.Hour).Unix(), CreatedAt: time.Now().Unix(), LastSeenAt: time.Now().Unix()})
	db.Create(&model.APIToken{UserId: u.Id, Jti: "jti-1", Name: "t", CreatedAt: time.Now().Unix()})

	p, _ := e.svc.GetPrincipal(u.Id)
	if !p.Can(rbac.ClientsRead) {
		t.Fatal("an enabled user holds their role's permissions")
	}
	off := false
	if _, err := e.svc.UpdateUser(e.admin, u.Id, UserPatch{Enabled: &off}); err != nil {
		t.Fatal(err)
	}
	p, _ = e.svc.GetPrincipal(u.Id) // cache invalidated by the change, no waiting for the TTL
	if p.Enabled || p.Can(rbac.ClientsRead) {
		t.Fatal("a disabled user must hold no permissions immediately")
	}
	var revoked struct{ N int64 }
	db.Raw("SELECT COUNT(*) AS n FROM login_sessions WHERE user_id = ? AND revoked_at IS NULL", u.Id).Scan(&revoked)
	if revoked.N != 0 {
		t.Fatal("browser sessions of a disabled user must be revoked")
	}
	db.Raw("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL", u.Id).Scan(&revoked)
	if revoked.N != 0 {
		t.Fatal("API tokens of a disabled user must be revoked")
	}
	var row model.User
	db.First(&row, u.Id)
	if e.svc.CanSignIn(&row) {
		t.Fatal("a disabled user cannot sign in")
	}
	on := true
	e.svc.UpdateUser(e.admin, u.Id, UserPatch{Enabled: &on})
	db.First(&row, u.Id)
	if !e.svc.CanSignIn(&row) {
		t.Fatal("re-enabled")
	}
}

func TestRoleChangeTakesEffectImmediately(t *testing.T) {
	e := setupRBAC(t)
	role := e.role(rbac.ClientsRead, rbac.ClientsDelete)
	u := e.user("worker", role.Id)
	p, _ := e.svc.GetPrincipal(u.Id)
	if !p.Can(rbac.ClientsDelete) {
		t.Fatal("setup")
	}
	if _, err := e.svc.UpdateRole(e.admin, role.Id, RoleInput{Name: role.Name, Permissions: []string{rbac.ClientsRead}}); err != nil {
		t.Fatal(err)
	}
	p, _ = e.svc.GetPrincipal(u.Id)
	if p.Can(rbac.ClientsDelete) || !p.Can(rbac.ClientsRead) {
		t.Fatalf("permissions removed from a role must stop working at once: %v", p.Perms.List())
	}
	other := e.role(rbac.NodesRead)
	e.svc.UpdateUser(e.admin, u.Id, UserPatch{RoleId: &other.Id})
	p, _ = e.svc.GetPrincipal(u.Id)
	if p.Can(rbac.ClientsRead) || !p.Can(rbac.NodesRead) || p.RoleId != other.Id {
		t.Fatalf("a changed role applies at once: %+v", p)
	}
}

func TestDeletedUserKeepsTheAuditTrailAndFreesTheName(t *testing.T) {
	e := setupRBAC(t)
	role := e.role(rbac.UsersCreate, rbac.UsersRead, rbac.ClientsRead)
	u := e.user("ghost", role.Id)
	ghost := e.actor(u.Id)
	// the user does something audited, then is deleted
	if _, err := e.svc.CreateUser(ghost, UserInput{Username: "made-by-ghost", Password: "correct-horse-1", RoleId: e.role(rbac.ClientsRead).Id, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.DeleteUser(e.admin, u.Id); err != nil {
		t.Fatal(err)
	}
	var raw model.User
	if err := database.GetDB().First(&raw, u.Id).Error; err != nil || raw.DeletedAt == nil || raw.Enabled {
		t.Fatalf("the row must stay, marked deleted and disabled: %v %+v", err, raw)
	}
	users, _ := e.svc.ListUsers(e.admin.Principal)
	for _, x := range users {
		if x.Id == u.Id {
			t.Fatal("deleted users are not listed")
		}
	}
	if p, _ := e.svc.GetPrincipal(u.Id); p != nil {
		t.Fatal("a deleted user has no principal")
	}
	rows, _ := Audit.List(AuditQuery{Action: "user.create"})
	found := false
	for _, r := range rows {
		if r.ActorName == "ghost" && r.TargetName == "made-by-ghost" && r.ActorId != nil && *r.ActorId == u.Id {
			found = true
		}
	}
	if !found {
		t.Fatal("what the deleted user did must stay attributable to them")
	}
	if _, err := e.svc.CreateUser(e.admin, UserInput{Username: "ghost", Password: "correct-horse-1", RoleId: role.Id, Enabled: true}); err != nil {
		t.Fatalf("the username is free again: %v", err)
	}
}

func TestAuditRecordsBeforeAndAfterAndNeverPasswords(t *testing.T) {
	e := setupRBAC(t)
	role := e.role(rbac.ClientsRead)
	u := e.user("audited", role.Id)
	newRole := e.role(rbac.NodesRead)
	if _, err := e.svc.UpdateUser(e.admin, u.Id, UserPatch{RoleId: &newRole.Id}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.UpdateRole(e.admin, newRole.Id, RoleInput{Name: newRole.Name, Permissions: []string{rbac.NodesRead, rbac.NodesOperate}}); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SetUserPassword(e.admin, u.Id, "another-password-2"); err != nil {
		t.Fatal(err)
	}
	all, _ := Audit.List(AuditQuery{Limit: 200})
	has := map[string]model.AuditLog{}
	for _, r := range all {
		has[r.Action] = r
		if strings.Contains(r.Before+r.After+r.Detail, "password") && r.Action != "user.password_reset" {
			t.Errorf("%s leaked a password field: %s %s", r.Action, r.Before, r.After)
		}
		if strings.Contains(r.Before+r.After, "correct-horse") || strings.Contains(r.Before+r.After, "another-password") {
			t.Fatalf("a password value is in the audit trail: %+v", r)
		}
		if r.ActorName != e.admin.Principal.Username || r.IP != "10.0.0.1" {
			t.Errorf("%s: actor/ip not recorded: %+v", r.Action, r)
		}
	}
	rc := has["user.role_change"]
	var b, a map[string]any
	json.Unmarshal([]byte(rc.Before), &b)
	json.Unmarshal([]byte(rc.After), &a)
	if b["role"] != role.Name || a["role"] != newRole.Name {
		t.Fatalf("role change must carry old and new role: %v -> %v", b, a)
	}
	ru := has["role.update"]
	if !strings.Contains(ru.Before, "nodes:read") || !strings.Contains(ru.After, "nodes:operate") {
		t.Fatalf("role update must carry old and new permissions: %s -> %s", ru.Before, ru.After)
	}
	for _, act := range []string{"user.create", "role.create", "user.password_reset"} {
		if _, ok := has[act]; !ok {
			t.Errorf("missing audit entry %s", act)
		}
	}
}

func TestUserValidation(t *testing.T) {
	e := setupRBAC(t)
	role := e.role(rbac.ClientsRead)
	mk := func(name, pass string) error {
		_, err := e.svc.CreateUser(e.admin, UserInput{Username: name, Password: pass, RoleId: role.Id, Enabled: true})
		return err
	}
	wantErr(t, mk("short", "1234567"), ErrInvalid, "short password")
	wantErr(t, mk("with space", "correct-horse-1"), ErrInvalid, "space in username")
	wantErr(t, mk("   ", "correct-horse-1"), ErrInvalid, "blank username")
	wantErr(t, mk(strings.Repeat("a", 65), "correct-horse-1"), ErrInvalid, "long username")
	if err := mk("Alice", "correct-horse-1"); err != nil {
		t.Fatal(err)
	}
	wantErr(t, mk("alice", "correct-horse-1"), ErrConflict, "case-insensitive duplicate")
	_, err := e.svc.CreateUser(e.admin, UserInput{Username: "norole", Password: "correct-horse-1", RoleId: 99999, Enabled: true})
	wantErr(t, err, ErrInvalid, "unknown role")
	// created disabled stays disabled (the column default is TRUE: a regression check)
	d, err := e.svc.CreateUser(e.admin, UserInput{Username: "off", Password: "correct-horse-1", RoleId: role.Id, Enabled: false})
	if err != nil {
		t.Fatal(err)
	}
	var row model.User
	database.GetDB().First(&row, d.Id)
	if row.Enabled {
		t.Fatal("a user created disabled must be stored disabled")
	}
	// the password is stored hashed
	if row.Password == "correct-horse-1" || !strings.HasPrefix(row.Password, "$2") {
		t.Fatal("password must be a bcrypt hash")
	}
}

func TestRoleDeleteRules(t *testing.T) {
	e := setupRBAC(t)
	r := e.role(rbac.ClientsRead)
	u := e.user("holder", r.Id)
	wantErr(t, e.svc.DeleteRole(e.admin, r.Id), ErrConflict, "role in use")
	if err := e.svc.DeleteUser(e.admin, u.Id); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.DeleteRole(e.admin, r.Id); err != nil {
		t.Fatalf("a role nobody holds can go: %v", err)
	}
	wantErr(t, e.svc.DeleteRole(e.admin, r.Id), ErrNotFound, "already gone")
}

func TestAuditReadsLikeAJournalAndFollowsRetention(t *testing.T) {
	e := setupRBAC(t)
	role := e.role(rbac.GroupsRead)
	if _, err := e.svc.CreateUser(e.admin, UserInput{Username: "journal-user", Password: "Journal-pass-1", RoleId: role.Id, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	entries := auditEntries(0, 0, 100)
	if len(entries) == 0 {
		t.Fatal("no journal entries")
	}
	var msg string
	for _, x := range entries {
		if strings.Contains(x.Message, "created user") {
			msg = x.Message
		}
	}
	for _, want := range []string{e.admin.Principal.Username, `created user "journal-user"`, `with role`, "result=ok"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("message %q lacks %q", msg, want)
		}
	}
	// a refusal reads as a refusal and is a warning
	lv, _, m := DescribeAudit(model.AuditLog{ActorName: "bob", Action: "role.update", TargetName: "X", Result: "denied", Detail: "no"})
	if lv != "warn" || !strings.Contains(m, "tried to") || !strings.Contains(m, "refused") || !strings.Contains(m, "result=refused") {
		t.Fatalf("denied: %s %s", lv, m)
	}
	// retention
	old := time.Now().Add(-40 * 24 * time.Hour).UnixMilli()
	database.GetDB().Create(&model.AuditLog{Ts: old, Action: "user.delete", Result: "ok"})
	n, err := PurgeAuditOlderThan(14)
	if err != nil || n != 1 {
		t.Fatalf("purge removed %d, %v", n, err)
	}
	if len(auditEntries(0, 0, 100)) != len(entries) {
		t.Fatal("recent entries must stay")
	}
}
