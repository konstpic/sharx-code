// Package rbac is the role-based access control model of the panel: the catalogue of permissions, how a set of
// permissions is evaluated, and which permissions every authenticated HTTP route requires.
//
// The model is user -> role -> permissions. A permission is "resource:action". The catalogue in this file is the single
// source of truth: roles store permission keys as strings, the backend validates them against the catalogue on write, and
// the UI renders the role editor from it. A key that is stored but no longer in the catalogue (a downgrade, a removed
// feature) is ignored at evaluation time, never granted.
package rbac

import "sort"

// Wildcard grants every permission, including ones added in future versions. It is held only by the built-in
// Administrator role (and by custom roles an administrator explicitly gives it).
const Wildcard = "*"

// Permission keys. The naming is resource:action; "read" is the base action of a resource and every other action of a
// resource implies it (see Normalize).
const (
	DashboardRead = "dashboard:read"
	LogsRead      = "logs:read"

	InboundsRead   = "inbounds:read"
	InboundsCreate = "inbounds:create"
	InboundsUpdate = "inbounds:update"
	InboundsDelete = "inbounds:delete"

	ClientsRead    = "clients:read"
	ClientsCreate  = "clients:create"
	ClientsUpdate  = "clients:update"
	ClientsDelete  = "clients:delete"
	ClientsOperate = "clients:operate"

	GroupsRead   = "groups:read"
	GroupsCreate = "groups:create"
	GroupsUpdate = "groups:update"
	GroupsDelete = "groups:delete"

	BundlesRead   = "bundles:read"
	BundlesCreate = "bundles:create"
	BundlesUpdate = "bundles:update"
	BundlesDelete = "bundles:delete"

	HostsRead   = "hosts:read"
	HostsCreate = "hosts:create"
	HostsUpdate = "hosts:update"
	HostsDelete = "hosts:delete"

	OutboundsRead   = "outbounds:read"
	OutboundsCreate = "outbounds:create"
	OutboundsUpdate = "outbounds:update"
	OutboundsDelete = "outbounds:delete"

	NodesRead    = "nodes:read"
	NodesCreate  = "nodes:create"
	NodesUpdate  = "nodes:update"
	NodesDelete  = "nodes:delete"
	NodesOperate = "nodes:operate"
	NodesSecret  = "nodes:secret"

	BalancersRead    = "balancers:read"
	BalancersCreate  = "balancers:create"
	BalancersUpdate  = "balancers:update"
	BalancersDelete  = "balancers:delete"
	BalancersOperate = "balancers:operate"

	XrayRead    = "xray:read"
	XrayUpdate  = "xray:update"
	XrayOperate = "xray:operate"

	SettingsRead     = "settings:read"
	SettingsUpdate   = "settings:update"
	SettingsSecurity = "settings:security"

	SystemUpdate   = "system:update"
	SystemBackup   = "system:backup"
	SystemDatabase = "system:database"

	UsersRead   = "users:read"
	UsersCreate = "users:create"
	UsersUpdate = "users:update"
	UsersDelete = "users:delete"

	RolesRead   = "roles:read"
	RolesCreate = "roles:create"
	RolesUpdate = "roles:update"
	RolesDelete = "roles:delete"

	AuditRead = "audit:read"
)

// Permission describes one entry of the catalogue.
type Permission struct {
	Key string `json:"key"`
	// Group is the functional section the permission belongs to (the UI groups checkboxes by it).
	Group string `json:"group"`
	// Sensitive marks permissions that expose secrets or can take over the panel; the UI flags them.
	Sensitive bool `json:"sensitive,omitempty"`
}

// Group is a functional section of the panel with its permissions in display order.
type Group struct {
	ID          string       `json:"id"`
	Permissions []Permission `json:"permissions"`
}

func p(key, group string, sensitive bool) Permission {
	return Permission{Key: key, Group: group, Sensitive: sensitive}
}

// catalogue lists every permission, grouped and ordered the way the UI shows them.
var catalogue = []Permission{
	p(DashboardRead, "overview", false),
	p(LogsRead, "overview", false),

	p(InboundsRead, "inbounds", true), // inbound settings contain client credentials
	p(InboundsCreate, "inbounds", false),
	p(InboundsUpdate, "inbounds", false),
	p(InboundsDelete, "inbounds", false),

	p(ClientsRead, "clients", true), // share links and subscription credentials
	p(ClientsCreate, "clients", false),
	p(ClientsUpdate, "clients", false),
	p(ClientsDelete, "clients", false),
	p(ClientsOperate, "clients", false), // reset traffic, HWID, drop/block sessions

	p(GroupsRead, "groups", false),
	p(GroupsCreate, "groups", false),
	p(GroupsUpdate, "groups", false),
	p(GroupsDelete, "groups", false),

	p(BundlesRead, "subscriptions", false),
	p(BundlesCreate, "subscriptions", false),
	p(BundlesUpdate, "subscriptions", false),
	p(BundlesDelete, "subscriptions", false),
	p(HostsRead, "subscriptions", false),
	p(HostsCreate, "subscriptions", false),
	p(HostsUpdate, "subscriptions", false),
	p(HostsDelete, "subscriptions", false),

	p(NodesRead, "infrastructure", false),
	p(NodesCreate, "infrastructure", true), // SSH provisioning takes server credentials
	p(NodesUpdate, "infrastructure", false),
	p(NodesDelete, "infrastructure", false),
	p(NodesOperate, "infrastructure", false),
	p(NodesSecret, "infrastructure", true), // the pairing secret lets a server join the panel
	p(BalancersRead, "infrastructure", false),
	p(BalancersCreate, "infrastructure", true),
	p(BalancersUpdate, "infrastructure", false),
	p(BalancersDelete, "infrastructure", false),
	p(BalancersOperate, "infrastructure", false),

	p(XrayRead, "xray", false),
	p(XrayUpdate, "xray", false),
	p(XrayOperate, "xray", false),
	p(OutboundsRead, "xray", false),
	p(OutboundsCreate, "xray", false),
	p(OutboundsUpdate, "xray", false),
	p(OutboundsDelete, "xray", false),

	p(SettingsRead, "settings", true), // tokens and secrets in the panel settings
	p(SettingsUpdate, "settings", false),
	p(SettingsSecurity, "settings", true), // LDAP, 2FA, Telegram bot, panel address and TLS, secret paths

	p(SystemUpdate, "system", true),   // update or restart the panel
	p(SystemBackup, "system", true),   // export or import the whole database
	p(SystemDatabase, "system", true), // raw database access

	p(UsersRead, "access", false),
	p(UsersCreate, "access", true),
	p(UsersUpdate, "access", true),
	p(UsersDelete, "access", true),
	p(RolesRead, "access", false),
	p(RolesCreate, "access", true),
	p(RolesUpdate, "access", true),
	p(RolesDelete, "access", true),
	p(AuditRead, "access", false),
}

var byKey = func() map[string]Permission {
	m := make(map[string]Permission, len(catalogue))
	for _, x := range catalogue {
		m[x.Key] = x
	}
	return m
}()

// All returns the catalogue in display order.
func All() []Permission { return append([]Permission(nil), catalogue...) }

// Groups returns the catalogue grouped by section, in display order.
func Groups() []Group {
	var out []Group
	idx := map[string]int{}
	for _, x := range catalogue {
		i, ok := idx[x.Group]
		if !ok {
			i = len(out)
			idx[x.Group] = i
			out = append(out, Group{ID: x.Group})
		}
		out[i].Permissions = append(out[i].Permissions, x)
	}
	return out
}

// Valid reports whether key is a catalogue permission or the wildcard.
func Valid(key string) bool {
	if key == Wildcard {
		return true
	}
	_, ok := byKey[key]
	return ok
}

// IsSensitive reports whether the catalogue flags key as sensitive.
func IsSensitive(key string) bool { return byKey[key].Sensitive }

// resourceOf returns "clients" for "clients:update".
func resourceOf(key string) string {
	for i := 0; i < len(key); i++ {
		if key[i] == ':' {
			return key[:i]
		}
	}
	return key
}

// superOnly lists permissions that are equivalent to full control of the panel: whoever holds them can sign in as anyone
// (LDAP and 2FA settings), read or replace the whole database (backup, raw tables). Only an administrator may put them into
// a role, so a delegated "manage roles" permission can never mint a second administrator by the back door.
var superOnly = map[string]bool{SettingsSecurity: true, SystemBackup: true, SystemDatabase: true}

// IsSuperOnly reports whether only an administrator may grant the permission.
func IsSuperOnly(key string) bool { return superOnly[key] }

// Normalize validates a permission list for storage: unknown keys are an error (returned in bad), duplicates are dropped,
// and every resource that is granted any action also gets its "read" action (a role that may edit clients but not see them
// would be useless and confusing). The result is sorted for stable storage and comparison.
func Normalize(keys []string) (clean []string, bad []string) {
	set := map[string]bool{}
	for _, k := range keys {
		if !Valid(k) {
			bad = append(bad, k)
			continue
		}
		set[k] = true
	}
	if set[Wildcard] {
		return []string{Wildcard}, bad
	}
	for k := range set {
		r := resourceOf(k) + ":read"
		if _, ok := byKey[r]; ok {
			set[r] = true
		}
	}
	for k := range set {
		clean = append(clean, k)
	}
	sort.Strings(clean)
	return clean, bad
}
