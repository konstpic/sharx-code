package rbac

import (
	"reflect"
	"strings"
	"testing"
)

func TestCatalogueIsConsistent(t *testing.T) {
	seen := map[string]bool{}
	for _, p := range All() {
		if !strings.Contains(p.Key, ":") || p.Key != strings.ToLower(p.Key) {
			t.Errorf("bad key %q", p.Key)
		}
		if seen[p.Key] {
			t.Errorf("duplicate %q", p.Key)
		}
		seen[p.Key] = true
		if p.Group == "" {
			t.Errorf("%q has no group", p.Key)
		}
	}
	// every resource that has any action also has a read action: Normalize relies on it
	res := map[string]bool{}
	for k := range seen {
		res[resourceOf(k)] = true
	}
	for r := range res {
		if r == "system" { // update / backup / database are independent switches, not views of one resource
			continue
		}
		if !seen[r+":read"] {
			t.Errorf("resource %q has no read permission", r)
		}
	}
	var n int
	for _, g := range Groups() {
		n += len(g.Permissions)
	}
	if n != len(All()) {
		t.Errorf("groups hold %d permissions, catalogue %d", n, len(All()))
	}
}

func TestEveryRoutePermissionExistsAndEveryPermissionIsUsed(t *testing.T) {
	used := map[string]bool{}
	for _, key := range Routes() {
		reqs, _ := routes[key]
		for _, k := range RequirementsOf(reqs) {
			if !Valid(k) || k == Wildcard {
				t.Errorf("%s requires unknown permission %q", key, k)
			}
			used[k] = true
		}
	}
	for _, p := range All() {
		if !used[p.Key] {
			t.Errorf("permission %q protects no route: either wire it or remove it from the catalogue", p.Key)
		}
	}
}

func TestSetHasWildcardAndAlternatives(t *testing.T) {
	admin := NewSet([]string{Wildcard})
	reader := NewSet([]string{ClientsRead, "bogus:permission"})
	if !admin.Has(UsersDelete) || !admin.Has("anything:new") {
		t.Error("wildcard grants everything, including permissions added later")
	}
	if !reader.Has(ClientsRead) || reader.Has(ClientsUpdate) {
		t.Error("exact match only")
	}
	if reader.Has("bogus:permission") {
		t.Error("a key outside the catalogue must be dropped, never granted")
	}
	if !reader.Has("clients:update|clients:read") || reader.Has("clients:update|clients:delete") {
		t.Error("alternatives")
	}
	if reader.Has(Wildcard) {
		t.Error("only a stored wildcard grants the wildcard")
	}
	if !reader.HasAll([]string{ClientsRead}) || reader.HasAll([]string{ClientsRead, ClientsUpdate}) {
		t.Error("HasAll")
	}
}

func TestCoversIsTheEscalationTest(t *testing.T) {
	admin := NewSet([]string{Wildcard})
	mgr := NewSet([]string{ClientsRead, ClientsUpdate, UsersRead})
	reader := NewSet([]string{ClientsRead})
	if !admin.Covers(mgr) || !admin.Covers(admin) {
		t.Error("an administrator covers every role")
	}
	if !mgr.Covers(reader) || reader.Covers(mgr) {
		t.Error("a role covers a smaller one, not a bigger one")
	}
	if mgr.Covers(admin) {
		t.Error("nobody but an administrator covers the wildcard")
	}
	if !mgr.Covers(NewSet(nil)) {
		t.Error("everything covers the empty role")
	}
}

func TestNormalize(t *testing.T) {
	got, bad := Normalize([]string{ClientsUpdate, ClientsUpdate, "nope:nope", NodesOperate})
	want := []string{ClientsRead, ClientsUpdate, NodesOperate, NodesRead}
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(bad, []string{"nope:nope"}) {
		t.Errorf("got %v bad %v, want %v", got, bad, want)
	}
	got, _ = Normalize([]string{ClientsRead, Wildcard})
	if !reflect.DeepEqual(got, []string{Wildcard}) {
		t.Errorf("the wildcard absorbs the rest: %v", got)
	}
}

func TestSuperOnlyPermissions(t *testing.T) {
	for _, k := range []string{SystemDatabase, SystemBackup, SettingsSecurity} {
		if !IsSuperOnly(k) {
			t.Errorf("%s must be grantable by administrators only", k)
		}
	}
	if IsSuperOnly(ClientsRead) || IsSuperOnly(UsersCreate) {
		t.Error("ordinary permissions are delegable")
	}
}

func TestLookup(t *testing.T) {
	if reqs, ok := Lookup("HEAD", "/panel/"); !ok || len(reqs) != 0 {
		t.Error("HEAD is looked up as GET")
	}
	if _, ok := Lookup("POST", "/panel/not-a-route"); ok {
		t.Error("unknown route must be reported as unknown (default deny)")
	}
	if reqs, _ := Lookup("POST", "/panel/client/del/:id"); !reflect.DeepEqual(reqs, []string{ClientsDelete}) {
		t.Errorf("client delete: %v", reqs)
	}
}
