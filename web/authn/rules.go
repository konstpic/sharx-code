package authn

import (
	"sort"
	"strings"
)

// Rule maps an attribute of the identity to a panel role. Rules are evaluated in position order and the first enabled rule
// that matches decides (a user holds exactly one role).
type Rule struct {
	Id       int
	Position int
	Kind     string // group | claim | email_domain | email | any
	Claim    string // claim path, for kind=claim
	Value    string
	RoleId   int
	Enabled  bool
}

// Rule kinds.
const (
	RuleGroup       = "group"
	RuleClaim       = "claim"
	RuleEmailDomain = "email_domain"
	RuleEmail       = "email"
	RuleAny         = "any"
)

// ValidRuleKind reports whether k is a known kind.
func ValidRuleKind(k string) bool {
	switch k {
	case RuleGroup, RuleClaim, RuleEmailDomain, RuleEmail, RuleAny:
		return true
	}
	return false
}

// matchValue compares case-insensitively; a trailing "*" matches a prefix ("ops-*").
func matchValue(have, want string) bool {
	have, want = strings.ToLower(strings.TrimSpace(have)), strings.ToLower(strings.TrimSpace(want))
	if want == "" {
		return false
	}
	if strings.HasSuffix(want, "*") {
		return strings.HasPrefix(have, strings.TrimSuffix(want, "*"))
	}
	return have == want
}

// Matches reports whether the rule applies to the identity. Rules that rest on the e-mail address count only when the
// provider vouches for it: an unverified address is something the user typed, not something that is theirs.
func (r Rule) Matches(id Identity) bool {
	switch r.Kind {
	case RuleAny:
		return true
	case RuleGroup:
		for _, g := range id.Groups {
			if matchValue(g, r.Value) {
				return true
			}
		}
	case RuleClaim:
		v, ok := Lookup(id.Claims, r.Claim)
		if !ok {
			return false
		}
		if list := asList(v); len(list) > 0 {
			for _, e := range list {
				if matchValue(e, r.Value) {
					return true
				}
			}
			return false
		}
		return matchValue(asString(v), r.Value)
	case RuleEmailDomain:
		if !id.EmailVerified {
			return false
		}
		at := strings.LastIndex(id.Email, "@")
		return at > 0 && matchValue(id.Email[at+1:], strings.TrimPrefix(r.Value, "@"))
	case RuleEmail:
		return id.EmailVerified && strings.EqualFold(strings.TrimSpace(id.Email), strings.TrimSpace(r.Value))
	}
	return false
}

// PickRole returns the role of the first matching rule.
func PickRole(rules []Rule, id Identity) (roleID int, ruleID int, ok bool) {
	sorted := append([]Rule(nil), rules...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Position < sorted[j].Position })
	for _, r := range sorted {
		if r.Enabled && r.Matches(id) {
			return r.RoleId, r.Id, true
		}
	}
	return 0, 0, false
}

// EmailAllowed applies the allow-lists. Both empty means everyone the provider authenticates; otherwise the (verified)
// address must be in the list of addresses or in a listed domain.
func EmailAllowed(id Identity, domains, emails []string) bool {
	if len(domains) == 0 && len(emails) == 0 {
		return true
	}
	if !id.EmailVerified || id.Email == "" {
		return false
	}
	for _, e := range emails {
		if strings.EqualFold(strings.TrimSpace(e), id.Email) {
			return true
		}
	}
	at := strings.LastIndex(id.Email, "@")
	if at < 0 {
		return false
	}
	for _, d := range domains {
		if strings.EqualFold(strings.TrimPrefix(strings.TrimSpace(d), "@"), id.Email[at+1:]) {
			return true
		}
	}
	return false
}
