package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/crypto"
	"github.com/konstpic/sharx-code/v2/web/rbac"
	"github.com/konstpic/sharx-code/v2/web/session"
	"gorm.io/gorm"
)

// Errors of the access-control service. The controller maps them to HTTP statuses.
var (
	ErrForbidden = errors.New("forbidden")
	ErrNotFound  = errors.New("not found")
	ErrInvalid   = errors.New("invalid request")
	ErrConflict  = errors.New("conflict")
)

// rbacError wraps one of the sentinel errors with a message that is safe to show to the user.
type rbacError struct {
	kind error
	msg  string
}

func (e *rbacError) Error() string { return e.msg }
func (e *rbacError) Unwrap() error { return e.kind }

func forbidden(format string, a ...any) error {
	return &rbacError{ErrForbidden, fmt.Sprintf(format, a...)}
}
func invalid(format string, a ...any) error { return &rbacError{ErrInvalid, fmt.Sprintf(format, a...)} }
func conflict(format string, a ...any) error {
	return &rbacError{ErrConflict, fmt.Sprintf(format, a...)}
}
func notFound(what string) error { return &rbacError{ErrNotFound, what + " not found"} }

// advisoryLockKey serialises every access-control mutation (roles, users), so two concurrent requests cannot together
// remove the last administrator.
const advisoryLockKey = 64001

// Principal is who is making a request, with the permissions of their role as of now. It is rebuilt from the database
// (through a very short cache), never taken from the session cookie.
type Principal struct {
	UserId   int
	Username string
	Enabled  bool
	RoleId   int
	RoleName string
	Perms    rbac.Set
	Super    bool

	// MFARequired: the panel policy, the role or the user demands a second factor. MFAEnrolled: the user has one (TOTP or a
	// passkey). Required without enrolled means the account may only reach the pages where it can enrol.
	MFARequired bool
	MFAEnrolled bool

	// OrgId: the account is limited to this organization (nil: not limited).
	OrgId *int
}

// Can reports whether the principal holds a permission.
func (p *Principal) Can(perm string) bool { return p != nil && p.Enabled && p.Perms.Has(perm) }

// Actor is the identity written to the audit trail.
type Actor struct {
	Principal *Principal
	IP        string
}

type principalEntry struct {
	p   *Principal
	at  time.Time
	gen uint64
}

var rbacCache = struct {
	mu  sync.RWMutex
	m   map[int]principalEntry
	gen uint64
}{m: map[int]principalEntry{}}

// rbacCacheTTL bounds how long a change made by another process (a restored dump, a manual SQL fix) can go unnoticed.
// Changes made through this service invalidate the cache at once.
const rbacCacheTTL = 3 * time.Second

// InvalidateRBAC drops every cached principal; called after any change to users or roles.
func InvalidateRBAC() {
	rbacCache.mu.Lock()
	rbacCache.gen++
	rbacCache.m = map[int]principalEntry{}
	rbacCache.mu.Unlock()
}

// RBACService manages users, roles and the permissions derived from them.
type RBACService struct{}

// GetPrincipal loads the principal for a user id. It returns (nil, nil) when the user does not exist or was deleted.
// A disabled user is returned with Enabled=false so the caller can tell the difference when logging.
func (s *RBACService) GetPrincipal(userId int) (*Principal, error) {
	rbacCache.mu.RLock()
	e, ok := rbacCache.m[userId]
	gen := rbacCache.gen
	rbacCache.mu.RUnlock()
	if ok && e.gen == gen && time.Since(e.at) < rbacCacheTTL {
		return e.p, nil
	}
	p, err := s.loadPrincipal(userId)
	if err != nil {
		return nil, err
	}
	rbacCache.mu.Lock()
	if rbacCache.gen == gen {
		rbacCache.m[userId] = principalEntry{p: p, at: time.Now(), gen: gen}
	}
	rbacCache.mu.Unlock()
	return p, nil
}

func (s *RBACService) loadPrincipal(userId int) (*Principal, error) {
	db := database.GetDB()
	var u model.User
	if err := db.Where("id = ? AND deleted_at IS NULL", userId).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	p := &Principal{UserId: u.Id, Username: u.Username, Enabled: u.Enabled, Perms: rbac.Set{}}
	if u.RoleId != nil {
		var r model.Role
		if err := db.First(&r, *u.RoleId).Error; err == nil {
			p.RoleId, p.RoleName = r.Id, r.Name
			p.Perms = rbac.NewSet(parsePerms(r.Permissions))
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	p.Super = p.Perms.IsSuper()
	if !p.Super {
		p.OrgId = u.OrgId // an administrator is never limited, whatever the column says
	}
	p.MFAEnrolled = u.TwoFactorEnabled && u.TwoFactorSecret != "" || Passkeys.HasPasskeys(u.Id)
	switch Methods.str("authMfaPolicy") {
	case "all":
		p.MFARequired = true
	case "admins":
		p.MFARequired = p.Super
	}
	if u.RequireMFA {
		p.MFARequired = true
	}
	if u.RoleId != nil {
		var req bool
		db.Raw("SELECT require_mfa FROM roles WHERE id = ?", *u.RoleId).Scan(&req)
		p.MFARequired = p.MFARequired || req
	}
	return p, nil
}

func parsePerms(raw string) []string {
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		logger.Warningf("RBAC: unreadable role permissions %q: %v", raw, err)
		return nil
	}
	return out
}

func encodePerms(perms []string) string {
	b, _ := json.Marshal(perms)
	return string(b)
}

// ---------- views ----------

// RoleView is a role as the UI shows it.
type RoleView struct {
	Id          int      `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	IsSystem    bool     `json:"isSystem"`
	Permissions []string `json:"permissions"`
	UserCount   int64    `json:"userCount"`
	CreatedAt   int64    `json:"createdAt"`
	UpdatedAt   int64    `json:"updatedAt"`
	// Manageable is true when the caller may edit or delete this role (never for system roles, nor for the caller's own).
	Manageable bool `json:"manageable"`
	// Assignable is true when the caller may give this role to a user (it grants nothing the caller does not hold).
	Assignable bool `json:"assignable"`
	// RequireMFA: everybody holding the role must have a second factor.
	RequireMFA bool `json:"requireMfa"`
}

// UserView is a user as the UI shows it. The password hash is never part of it.
type UserView struct {
	Id          int    `json:"id"`
	Username    string `json:"username"`
	Enabled     bool   `json:"enabled"`
	RoleId      int    `json:"roleId"`
	RoleName    string `json:"roleName"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
	LastLoginAt *int64 `json:"lastLoginAt,omitempty"`
	Self        bool   `json:"self"`
	TwoFactor   bool   `json:"twoFactor"`
	Email       string `json:"email,omitempty"`
	// AuthSource is "local" or the key of the single sign-on provider that created the account; RoleManaged says the role
	// is set by that provider's rules and cannot be changed by hand.
	AuthSource  string `json:"authSource"`
	RoleManaged bool   `json:"roleManaged"`
	RequireMFA  bool   `json:"requireMfa"`
	OrgId       *int   `json:"orgId,omitempty"`
	// Manageable is true when the caller may edit, disable or delete this user.
	Manageable bool `json:"manageable"`
}

func sourceOrLocal(s string) string {
	if s == "" {
		return "local"
	}
	return s
}

func roleView(r model.Role, count int64, actor *Principal) RoleView {
	perms := parsePerms(r.Permissions)
	set := rbac.NewSet(perms)
	v := RoleView{
		Id: r.Id, Name: r.Name, Description: r.Description, IsSystem: r.IsSystem, Permissions: set.List(),
		UserCount: count, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, RequireMFA: r.RequireMFA,
	}
	if actor != nil {
		v.Assignable = actor.Perms.Covers(set)
		v.Manageable = !r.IsSystem && r.Id != actor.RoleId && actor.Perms.Covers(set)
	}
	return v
}

// ListRoles returns every role with its user count.
func (s *RBACService) ListRoles(actor *Principal) ([]RoleView, error) {
	db := database.GetDB()
	var roles []model.Role
	if err := db.Order("is_system DESC, id").Find(&roles).Error; err != nil {
		return nil, err
	}
	counts := map[int]int64{}
	var rows []struct {
		RoleId int
		N      int64
	}
	if err := db.Raw("SELECT role_id, COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND role_id IS NOT NULL GROUP BY role_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		counts[r.RoleId] = r.N
	}
	out := make([]RoleView, 0, len(roles))
	for _, r := range roles {
		out = append(out, roleView(r, counts[r.Id], actor))
	}
	return out, nil
}

// AssignableRoles returns only the roles the caller may hand out (id, name, description): enough for a user form, without
// exposing the permissions of roles the caller cannot see.
func (s *RBACService) AssignableRoles(actor *Principal) ([]RoleView, error) {
	all, err := s.ListRoles(actor)
	if err != nil {
		return nil, err
	}
	out := all[:0]
	for _, r := range all {
		if r.Assignable {
			out = append(out, r)
		}
	}
	return out, nil
}

// ListUsers returns the users that are not deleted.
func (s *RBACService) ListUsers(actor *Principal) ([]UserView, error) {
	db := database.GetDB()
	var users []model.User
	if err := db.Where("deleted_at IS NULL").Order("id").Find(&users).Error; err != nil {
		return nil, err
	}
	var roles []model.Role
	db.Find(&roles)
	byID := map[int]model.Role{}
	for _, r := range roles {
		byID[r.Id] = r
	}
	out := make([]UserView, 0, len(users))
	for _, u := range users {
		v := UserView{Id: u.Id, Username: u.Username, Enabled: u.Enabled, CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt, LastLoginAt: u.LastLoginAt, TwoFactor: u.TwoFactorEnabled, Email: u.Email, AuthSource: sourceOrLocal(u.AuthSource), RoleManaged: u.RoleManaged, RequireMFA: u.RequireMFA, OrgId: u.OrgId}
		var set rbac.Set = rbac.Set{}
		if u.RoleId != nil {
			if r, ok := byID[*u.RoleId]; ok {
				v.RoleId, v.RoleName = r.Id, r.Name
				set = rbac.NewSet(parsePerms(r.Permissions))
			}
		}
		if actor != nil {
			v.Self = u.Id == actor.UserId
			v.Manageable = !v.Self && actor.Perms.Covers(set)
		}
		out = append(out, v)
	}
	return out, nil
}

// ---------- validation ----------

const (
	maxRoleName    = 100
	maxUsernameLen = 64
	minPasswordLen = 8
	maxPasswordLen = 72 // bcrypt ignores the rest
)

func cleanName(s string, max int, what string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", invalid("%s must not be empty", what)
	}
	if len([]rune(s)) > max {
		return "", invalid("%s is too long (max %d)", what, max)
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return "", invalid("%s contains control characters", what)
		}
	}
	return s, nil
}

func cleanUsername(s string) (string, error) {
	s, err := cleanName(s, maxUsernameLen, "username")
	if err != nil {
		return "", err
	}
	if strings.ContainsAny(s, " \t/\\") {
		return "", invalid("username must not contain spaces or slashes")
	}
	return s, nil
}

func checkPassword(p string) error {
	if len(p) < minPasswordLen {
		return invalid("password must be at least %d characters", minPasswordLen)
	}
	if len(p) > maxPasswordLen {
		return invalid("password must be at most %d bytes", maxPasswordLen)
	}
	return nil
}

// withLock runs fn in a transaction holding the access-control advisory lock.
func withLock(fn func(tx *gorm.DB) error) error {
	return database.GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", advisoryLockKey).Error; err != nil {
			return err
		}
		return fn(tx)
	})
}

// adminCount counts enabled, not deleted users whose role holds the wildcard, optionally ignoring one user.
func adminCount(tx *gorm.DB, exceptUser int) (int64, error) {
	var n int64
	err := tx.Raw(`SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
		WHERE u.enabled = TRUE AND u.deleted_at IS NULL AND r.permissions LIKE '%"*"%' AND u.id <> ?`, exceptUser).Scan(&n).Error
	return n, err
}

func roleIsAdmin(r model.Role) bool { return rbac.NewSet(parsePerms(r.Permissions)).IsSuper() }

// missingFrom lists what the actor may not put into a role: permissions they do not hold, and permissions only an
// administrator may grant (even if the actor somehow holds them).
func missingFrom(actor rbac.Set, want rbac.Set) []string {
	var miss []string
	for _, k := range want.List() {
		if !actor.Has(k) || (rbac.IsSuperOnly(k) && !actor.IsSuper()) {
			miss = append(miss, k)
		}
	}
	return miss
}

// ---------- roles ----------

// RoleInput is the editable part of a role.
type RoleInput struct {
	Name        string
	Description string
	Permissions []string
	RequireMFA  bool
}

func (s *RBACService) normalizeRole(in RoleInput) (string, string, []string, error) {
	name, err := cleanName(in.Name, maxRoleName, "role name")
	if err != nil {
		return "", "", nil, err
	}
	desc := strings.TrimSpace(in.Description)
	if len(desc) > 500 {
		return "", "", nil, invalid("description is too long (max 500)")
	}
	perms, bad := rbac.Normalize(in.Permissions)
	if len(bad) > 0 {
		return "", "", nil, invalid("unknown permissions: %s", strings.Join(bad, ", "))
	}
	return name, desc, perms, nil
}

// CreateRole creates a custom role. The caller can grant only permissions they hold themselves.
func (s *RBACService) CreateRole(a Actor, in RoleInput) (*RoleView, error) {
	name, desc, perms, err := s.normalizeRole(in)
	if err != nil {
		return nil, err
	}
	if miss := missingFrom(a.Principal.Perms, rbac.NewSet(perms)); len(miss) > 0 {
		Audit.Record(a, "role.create", "role", "", name, nil, map[string]any{"permissions": perms}, "denied", "tried to grant permissions the actor does not hold: "+strings.Join(miss, ", "))
		return nil, forbidden("you cannot grant permissions you do not hold: %s", strings.Join(miss, ", "))
	}
	var created model.Role
	err = withLock(func(tx *gorm.DB) error {
		var n int64
		tx.Model(&model.Role{}).Where("LOWER(name) = LOWER(?)", name).Count(&n)
		if n > 0 {
			return conflict("a role named %q already exists", name)
		}
		now := time.Now().Unix()
		created = model.Role{Name: name, Description: desc, Permissions: encodePerms(perms), CreatedAt: now, UpdatedAt: now, RequireMFA: in.RequireMFA}
		return tx.Create(&created).Error
	})
	if err != nil {
		return nil, err
	}
	InvalidateRBAC()
	Audit.Record(a, "role.create", "role", fmt.Sprint(created.Id), name, nil, roleState(created), "ok", "")
	v := roleView(created, 0, a.Principal)
	return &v, nil
}

func roleState(r model.Role) map[string]any {
	return map[string]any{"name": r.Name, "description": r.Description, "permissions": parsePerms(r.Permissions), "requireMfa": r.RequireMFA}
}

// UpdateRole changes a custom role. Rules: system roles are immutable; a caller cannot edit their own role; the caller
// must hold every permission the role has now (otherwise they could reshape something they do not understand or
// lock others out) and every permission they add.
func (s *RBACService) UpdateRole(a Actor, id int, in RoleInput) (*RoleView, error) {
	name, desc, perms, err := s.normalizeRole(in)
	if err != nil {
		return nil, err
	}
	var before, after model.Role
	err = withLock(func(tx *gorm.DB) error {
		if err := tx.First(&before, id).Error; err != nil {
			return notFound("role")
		}
		if before.IsSystem {
			return forbidden("built-in roles cannot be modified")
		}
		if before.Id == a.Principal.RoleId {
			return forbidden("you cannot edit the role you hold yourself")
		}
		oldSet, newSet := rbac.NewSet(parsePerms(before.Permissions)), rbac.NewSet(perms)
		if !a.Principal.Perms.Covers(oldSet) {
			return forbidden("this role has permissions you do not hold, so you cannot edit it")
		}
		if miss := missingFrom(a.Principal.Perms, newSet); len(miss) > 0 {
			return forbidden("you cannot grant permissions you do not hold: %s", strings.Join(miss, ", "))
		}
		var n int64
		tx.Model(&model.Role{}).Where("LOWER(name) = LOWER(?) AND id <> ?", name, id).Count(&n)
		if n > 0 {
			return conflict("a role named %q already exists", name)
		}
		if oldSet.IsSuper() && !newSet.IsSuper() {
			// the role stops being an administrator role: someone else must still be one
			var holders int64
			tx.Model(&model.User{}).Where("role_id = ? AND enabled = TRUE AND deleted_at IS NULL", id).Count(&holders)
			if holders > 0 {
				others, err := adminCount(tx, -1)
				if err != nil {
					return err
				}
				var mine int64
				tx.Raw(`SELECT COUNT(*) FROM users WHERE role_id = ? AND enabled = TRUE AND deleted_at IS NULL`, id).Scan(&mine)
				if others-mine < 1 {
					return conflict("this would remove the last administrator")
				}
			}
		}
		if rbac.NewSet(perms).IsSuper() {
			var limited int64
			tx.Model(&model.User{}).Where("role_id = ? AND org_id IS NOT NULL AND deleted_at IS NULL", id).Count(&limited)
			if limited > 0 {
				return conflict("%d user(s) with this role are limited to an organization: an administrator role would lift the limit", limited)
			}
		}
		after = before
		after.Name, after.Description, after.Permissions, after.UpdatedAt = name, desc, encodePerms(perms), time.Now().Unix()
		after.RequireMFA = in.RequireMFA
		return tx.Model(&model.Role{}).Where("id = ?", id).Updates(map[string]any{
			"name": after.Name, "description": after.Description, "permissions": after.Permissions, "updated_at": after.UpdatedAt, "require_mfa": in.RequireMFA,
		}).Error
	})
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			Audit.Record(a, "role.update", "role", fmt.Sprint(id), before.Name, roleState(before), map[string]any{"permissions": perms}, "denied", err.Error())
		}
		return nil, err
	}
	InvalidateRBAC()
	Audit.Record(a, "role.update", "role", fmt.Sprint(id), after.Name, roleState(before), roleState(after), "ok", "")
	var n int64
	database.GetDB().Model(&model.User{}).Where("role_id = ? AND deleted_at IS NULL", id).Count(&n)
	v := roleView(after, n, a.Principal)
	return &v, nil
}

// DeleteRole removes a custom role that nobody holds.
func (s *RBACService) DeleteRole(a Actor, id int) error {
	var r model.Role
	err := withLock(func(tx *gorm.DB) error {
		if err := tx.First(&r, id).Error; err != nil {
			return notFound("role")
		}
		if r.IsSystem {
			return forbidden("built-in roles cannot be deleted")
		}
		if r.Id == a.Principal.RoleId {
			return forbidden("you cannot delete the role you hold yourself")
		}
		if !a.Principal.Perms.Covers(rbac.NewSet(parsePerms(r.Permissions))) {
			return forbidden("this role has permissions you do not hold, so you cannot delete it")
		}
		var n int64
		tx.Model(&model.User{}).Where("role_id = ? AND deleted_at IS NULL", id).Count(&n)
		if n > 0 {
			return conflict("the role is assigned to %d user(s); change their role first", n)
		}
		return tx.Delete(&model.Role{}, id).Error
	})
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			Audit.Record(a, "role.delete", "role", fmt.Sprint(id), r.Name, roleState(r), nil, "denied", err.Error())
		}
		return err
	}
	InvalidateRBAC()
	Audit.Record(a, "role.delete", "role", fmt.Sprint(id), r.Name, roleState(r), nil, "ok", "")
	return nil
}

// ---------- users ----------

// UserInput is the data for creating a user.
type UserInput struct {
	Username string
	Password string
	RoleId   int
	Enabled  bool
}

func userState(u model.User, roleName string) map[string]any {
	return map[string]any{"username": u.Username, "role": roleName, "enabled": u.Enabled}
}

func loadRole(tx *gorm.DB, id int) (model.Role, error) {
	var r model.Role
	if err := tx.First(&r, id).Error; err != nil {
		return r, invalid("role does not exist")
	}
	return r, nil
}

// CreateUser creates a user. The caller can give only a role whose permissions they all hold.
func (s *RBACService) CreateUser(a Actor, in UserInput) (*UserView, error) {
	username, err := cleanUsername(in.Username)
	if err != nil {
		return nil, err
	}
	if err := checkPassword(in.Password); err != nil {
		return nil, err
	}
	hash, err := crypto.HashPasswordAsBcrypt(in.Password)
	if err != nil {
		return nil, err
	}
	var created model.User
	var role model.Role
	err = withLock(func(tx *gorm.DB) error {
		if role, err = loadRole(tx, in.RoleId); err != nil {
			return err
		}
		if miss := missingFrom(a.Principal.Perms, rbac.NewSet(parsePerms(role.Permissions))); len(miss) > 0 {
			return forbidden("you cannot assign the role %q: it grants permissions you do not hold (%s)", role.Name, strings.Join(miss, ", "))
		}
		var n int64
		tx.Model(&model.User{}).Where("LOWER(username) = LOWER(?) AND deleted_at IS NULL", username).Count(&n)
		if n > 0 {
			return conflict("a user named %q already exists", username)
		}
		now := time.Now().Unix()
		rid := role.Id
		created = model.User{Username: username, Password: hash, RoleId: &rid, Enabled: in.Enabled, CreatedAt: now, UpdatedAt: now}
		// An explicit column list writes Enabled=false as well; with the column default (TRUE) GORM would otherwise skip
		// the zero value and a user created disabled would come out enabled.
		return tx.Select("Username", "Password", "RoleId", "Enabled", "CreatedAt", "UpdatedAt").Create(&created).Error
	})
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			Audit.Record(a, "user.create", "user", "", username, nil, map[string]any{"roleId": in.RoleId}, "denied", err.Error())
		}
		return nil, err
	}
	InvalidateRBAC()
	Audit.Record(a, "user.create", "user", fmt.Sprint(created.Id), username, nil, userState(created, role.Name), "ok", "")
	return &UserView{Id: created.Id, Username: created.Username, Enabled: created.Enabled, RoleId: role.Id, RoleName: role.Name, CreatedAt: created.CreatedAt, UpdatedAt: created.UpdatedAt}, nil
}

// UserPatch is a partial update of a user; nil fields are left alone.
type UserPatch struct {
	Username *string
	RoleId   *int
	Enabled  *bool
	Email    *string
	// DetachRole releases a user whose role was managed by single sign-on to local role management. It cannot be undone
	// from here; the user would have to be recreated by the identity provider.
	DetachRole *bool
	// RequireMFA makes a second factor mandatory for this user (true) or leaves it to the role and the panel policy (false).
	RequireMFA *bool
	// OrgId limits the account to an organization; ClearOrg lifts the limit.
	OrgId    *int
	ClearOrg bool
}

// UpdateUser changes a user's name, role or status. Rules: the caller cannot change their own role or status; the target's
// current role must be covered by the caller; the new role must be covered too; the last administrator can be neither
// demoted nor disabled.
func (s *RBACService) UpdateUser(a Actor, id int, patch UserPatch) (*UserView, error) {
	var before, after model.User
	var beforeRole, afterRole model.Role
	err := withLock(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND deleted_at IS NULL", id).First(&before).Error; err != nil {
			return notFound("user")
		}
		self := id == a.Principal.UserId
		if before.RoleId != nil {
			beforeRole, _ = loadRole(tx, *before.RoleId)
		}
		if !self && !a.Principal.Perms.Covers(rbac.NewSet(parsePerms(beforeRole.Permissions))) {
			return forbidden("this user has more permissions than you, so you cannot change them")
		}
		after = before
		afterRole = beforeRole
		upd := map[string]any{"updated_at": time.Now().Unix()}
		if patch.Username != nil {
			name, err := cleanUsername(*patch.Username)
			if err != nil {
				return err
			}
			var n int64
			tx.Model(&model.User{}).Where("LOWER(username) = LOWER(?) AND deleted_at IS NULL AND id <> ?", name, id).Count(&n)
			if n > 0 {
				return conflict("a user named %q already exists", name)
			}
			after.Username = name
			upd["username"] = name
		}
		if patch.RoleId != nil && (before.RoleId == nil || *patch.RoleId != *before.RoleId) {
			if self {
				return forbidden("you cannot change your own role")
			}
			if before.RoleManaged {
				return conflict("the role of this user comes from single sign-on (%s); detach the user from it first", before.AuthSource)
			}
			nr, err := loadRole(tx, *patch.RoleId)
			if err != nil {
				return err
			}
			if miss := missingFrom(a.Principal.Perms, rbac.NewSet(parsePerms(nr.Permissions))); len(miss) > 0 {
				return forbidden("you cannot assign the role %q: it grants permissions you do not hold (%s)", nr.Name, strings.Join(miss, ", "))
			}
			afterRole = nr
			rid := nr.Id
			after.RoleId = &rid
			upd["role_id"] = nr.Id
		}
		if patch.Email != nil {
			e := strings.ToLower(strings.TrimSpace(*patch.Email))
			if len(e) > 254 || (e != "" && !strings.Contains(e, "@")) {
				return invalid("the e-mail address is not valid")
			}
			after.Email = e
			upd["email"] = e
		}
		if patch.OrgId != nil || patch.ClearOrg {
			if patch.ClearOrg {
				after.OrgId = nil
				upd["org_id"] = nil
			} else {
				var n int64
				tx.Model(&model.Organization{}).Where("id = ?", *patch.OrgId).Count(&n)
				if n == 0 {
					return invalid("organization does not exist")
				}
				after.OrgId = patch.OrgId
				upd["org_id"] = *patch.OrgId
			}
		}
		if patch.RequireMFA != nil && *patch.RequireMFA != before.RequireMFA {
			after.RequireMFA = *patch.RequireMFA
			upd["require_mfa"] = *patch.RequireMFA
		}
		if patch.DetachRole != nil && *patch.DetachRole && before.RoleManaged {
			after.RoleManaged = false
			upd["role_managed"] = false
		}
		if patch.Enabled != nil && *patch.Enabled != before.Enabled {
			if self {
				return forbidden("you cannot disable your own account")
			}
			after.Enabled = *patch.Enabled
			upd["enabled"] = *patch.Enabled
		}
		if after.OrgId != nil && roleIsAdmin(afterRole) {
			return invalid("an administrator cannot be limited to an organization")
		}
		wasAdmin := before.Enabled && roleIsAdmin(beforeRole)
		willBeAdmin := after.Enabled && roleIsAdmin(afterRole)
		if wasAdmin && !willBeAdmin {
			if n, err := adminCount(tx, id); err != nil {
				return err
			} else if n < 1 {
				return conflict("this would remove the last administrator")
			}
		}
		return tx.Model(&model.User{}).Where("id = ?", id).Updates(upd).Error
	})
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			Audit.Record(a, "user.update", "user", fmt.Sprint(id), before.Username, userState(before, beforeRole.Name), map[string]any{"patch": patchState(patch)}, "denied", err.Error())
		}
		return nil, err
	}
	InvalidateRBAC()
	if patch.Enabled != nil && !after.Enabled {
		revokeAccess(id) // a disabled user must not keep working sessions or API tokens
	}
	action := "user.update"
	switch {
	case patch.Enabled != nil && before.Enabled != after.Enabled && !after.Enabled:
		action = "user.disable"
	case patch.Enabled != nil && before.Enabled != after.Enabled:
		action = "user.enable"
	case patch.RoleId != nil && before.RoleId != nil && after.RoleId != nil && *before.RoleId != *after.RoleId:
		action = "user.role_change"
	}
	Audit.Record(a, action, "user", fmt.Sprint(id), after.Username, userState(before, beforeRole.Name), userState(after, afterRole.Name), "ok", "")
	v := UserView{Id: after.Id, Username: after.Username, Enabled: after.Enabled, RoleId: afterRole.Id, RoleName: afterRole.Name, CreatedAt: after.CreatedAt, UpdatedAt: time.Now().Unix(), LastLoginAt: after.LastLoginAt}
	return &v, nil
}

func patchState(p UserPatch) map[string]any {
	m := map[string]any{}
	if p.Username != nil {
		m["username"] = *p.Username
	}
	if p.RoleId != nil {
		m["roleId"] = *p.RoleId
	}
	if p.Enabled != nil {
		m["enabled"] = *p.Enabled
	}
	return m
}

// SetUserPassword sets a new password for another user (an administrative reset). The user's sessions and API tokens end,
// so whoever knew the old password is out.
func (s *RBACService) SetUserPassword(a Actor, id int, password string) error {
	if err := checkPassword(password); err != nil {
		return err
	}
	hash, err := crypto.HashPasswordAsBcrypt(password)
	if err != nil {
		return err
	}
	var target model.User
	err = withLock(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND deleted_at IS NULL", id).First(&target).Error; err != nil {
			return notFound("user")
		}
		if id == a.Principal.UserId {
			return forbidden("change your own password in the account settings")
		}
		var r model.Role
		if target.RoleId != nil {
			r, _ = loadRole(tx, *target.RoleId)
		}
		if !a.Principal.Perms.Covers(rbac.NewSet(parsePerms(r.Permissions))) {
			return forbidden("this user has more permissions than you, so you cannot change their password")
		}
		return tx.Model(&model.User{}).Where("id = ?", id).Updates(map[string]any{"password": hash, "updated_at": time.Now().Unix()}).Error
	})
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			Audit.Record(a, "user.password_reset", "user", fmt.Sprint(id), target.Username, nil, nil, "denied", err.Error())
		}
		return err
	}
	revokeAccess(id)
	Audit.Record(a, "user.password_reset", "user", fmt.Sprint(id), target.Username, nil, nil, "ok", "")
	return nil
}

// DeleteUser deletes a user in the only way that is safe for the audit trail and for things that point at the user: the row
// stays (marked deleted, disabled, name freed), their sessions and tokens end. Nothing that references the user breaks.
func (s *RBACService) DeleteUser(a Actor, id int) error {
	var target model.User
	var role model.Role
	err := withLock(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND deleted_at IS NULL", id).First(&target).Error; err != nil {
			return notFound("user")
		}
		if id == a.Principal.UserId {
			return forbidden("you cannot delete your own account")
		}
		if target.RoleId != nil {
			role, _ = loadRole(tx, *target.RoleId)
		}
		if !a.Principal.Perms.Covers(rbac.NewSet(parsePerms(role.Permissions))) {
			return forbidden("this user has more permissions than you, so you cannot delete them")
		}
		if target.Enabled && roleIsAdmin(role) {
			if n, err := adminCount(tx, id); err != nil {
				return err
			} else if n < 1 {
				return conflict("this would remove the last administrator")
			}
		}
		now := time.Now().Unix()
		return tx.Model(&model.User{}).Where("id = ?", id).Updates(map[string]any{
			"deleted_at": now, "enabled": false, "updated_at": now,
			"username": fmt.Sprintf("%s~deleted~%d", target.Username, id), // frees the name for a new user
		}).Error
	})
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			Audit.Record(a, "user.delete", "user", fmt.Sprint(id), target.Username, userState(target, role.Name), nil, "denied", err.Error())
		}
		return err
	}
	InvalidateRBAC()
	revokeAccess(id)
	Audit.Record(a, "user.delete", "user", fmt.Sprint(id), target.Username, userState(target, role.Name), nil, "ok", "")
	return nil
}

// revokeAccess ends every browser session and API token of a user.
func revokeAccess(userId int) {
	session.RevokeOtherLoginSessions(userId, "")
	database.GetDB().Model(&model.APIToken{}).Where("user_id = ? AND revoked_at IS NULL", userId).Update("revoked_at", time.Now().Unix())
}

// MarkLogin records a successful sign-in.
func (s *RBACService) MarkLogin(userId int) {
	database.GetDB().Model(&model.User{}).Where("id = ?", userId).Update("last_login_at", time.Now().Unix())
}

// CanSignIn reports whether the user may start a session: they exist, are enabled, not deleted, and hold a role.
func (s *RBACService) CanSignIn(u *model.User) bool {
	if u == nil || !u.Enabled || u.DeletedAt != nil || u.RoleId == nil {
		return false
	}
	var n int64
	database.GetDB().Model(&model.Role{}).Where("id = ?", *u.RoleId).Count(&n)
	return n > 0
}

// ---------- shared data ownership ----------

var ownerCache = struct {
	mu sync.Mutex
	id int
	at time.Time
}{}

// PanelOwnerID is the user id that owns the panel's data. The panel stores inbounds, clients, groups, hosts and the like
// with a user_id column, and every service filters by it, which made sense with one administrator. With roles, several
// users work on the same data according to their permissions, so every data operation is done on behalf of the owner (the
// first user, who created the existing data) and nobody sees an empty panel because the data belongs to someone else.
// Per-user things (password, sessions, API tokens, UI preferences) still use the real user id.
func PanelOwnerID(fallback int) int {
	ownerCache.mu.Lock()
	defer ownerCache.mu.Unlock()
	if ownerCache.id != 0 && time.Since(ownerCache.at) < time.Minute {
		return ownerCache.id
	}
	var id int
	if err := database.GetDB().Raw("SELECT COALESCE(MIN(id), 0) FROM users").Scan(&id).Error; err != nil || id == 0 {
		return fallback
	}
	ownerCache.id, ownerCache.at = id, time.Now()
	return id
}
