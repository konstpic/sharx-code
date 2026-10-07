package rbac

import "strings"

// Set is a set of permission keys with wildcard-aware lookup.
type Set map[string]struct{}

// NewSet builds a Set from stored keys. Keys that are not in the catalogue (and are not the wildcard) are dropped, so a
// permission removed from the product can never be granted by a stale role.
func NewSet(keys []string) Set {
	s := Set{}
	for _, k := range keys {
		if Valid(k) {
			s[k] = struct{}{}
		}
	}
	return s
}

// IsSuper reports whether the set holds the wildcard.
func (s Set) IsSuper() bool { _, ok := s[Wildcard]; return ok }

// Has reports whether the set grants one permission. "a|b" means any of the alternatives.
func (s Set) Has(perm string) bool {
	if strings.Contains(perm, "|") {
		for _, alt := range strings.Split(perm, "|") {
			if s.Has(alt) {
				return true
			}
		}
		return false
	}
	if s.IsSuper() {
		return true
	}
	_, ok := s[perm]
	return ok
}

// HasAll reports whether the set grants every listed permission.
func (s Set) HasAll(perms []string) bool {
	for _, p := range perms {
		if !s.Has(p) {
			return false
		}
	}
	return true
}

// Covers reports whether s grants everything other grants. It is the dominance test behind every privilege-escalation
// rule: a user may hand out, edit or manage only what their own permissions cover.
func (s Set) Covers(other Set) bool {
	if s.IsSuper() {
		return true
	}
	if other.IsSuper() {
		return false
	}
	for k := range other {
		if _, ok := s[k]; !ok {
			return false
		}
	}
	return true
}

// List returns the keys sorted.
func (s Set) List() []string {
	out := make([]string, 0, len(s))
	for k := range s {
		out = append(out, k)
	}
	sortStrings(out)
	return out
}

func sortStrings(a []string) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}
