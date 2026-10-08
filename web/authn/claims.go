package authn

import (
	"fmt"
	"strconv"
	"strings"
)

// ClaimMap says where in the identity provider's answer each attribute lives. A path is dotted ("data.user.id"); an empty
// field falls back to the OIDC standard name.
type ClaimMap struct {
	Subject       string `json:"subject,omitempty"`
	Email         string `json:"email,omitempty"`
	EmailVerified string `json:"emailVerified,omitempty"`
	Name          string `json:"name,omitempty"`
	Username      string `json:"username,omitempty"`
	Groups        string `json:"groups,omitempty"`
}

func orDefault(v, d string) string {
	if strings.TrimSpace(v) == "" {
		return d
	}
	return strings.TrimSpace(v)
}

// Identity is what the sign-in established about a person, independent of the provider.
type Identity struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	Username      string
	Groups        []string
	Claims        map[string]any // the merged claims rules may look at; never persisted
	RefreshToken  string         // when the provider issued one (offline access); the caller seals it before storing
}

// Lookup returns the value at a dotted path.
func Lookup(m map[string]any, path string) (any, bool) {
	var cur any = m
	for _, part := range strings.Split(path, ".") {
		obj, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		cur, ok = obj[part]
		if !ok {
			return nil, false
		}
	}
	return cur, cur != nil
}

func asString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		if x == float64(int64(x)) {
			return strconv.FormatInt(int64(x), 10)
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	case nil:
		return ""
	default:
		return fmt.Sprint(x)
	}
}

func asBool(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return strings.EqualFold(x, "true") || x == "1"
	case float64:
		return x == 1
	}
	return false
}

// asList accepts a JSON array, a single string, or a delimited string ("a,b c").
func asList(v any) []string {
	var out []string
	switch x := v.(type) {
	case []any:
		for _, e := range x {
			if s := strings.TrimSpace(asString(e)); s != "" {
				out = append(out, s)
			}
		}
	case string:
		for _, s := range strings.FieldsFunc(x, func(r rune) bool { return r == ',' || r == ' ' || r == ';' }) {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

// ExtractIdentity applies the claim map to the merged claims. A provider that returns no stable subject is refused by the
// caller: an identity without a subject cannot be linked safely.
func ExtractIdentity(claims map[string]any, cm ClaimMap) Identity {
	get := func(path, def string) any {
		v, _ := Lookup(claims, orDefault(path, def))
		return v
	}
	id := Identity{
		Subject:       asString(get(cm.Subject, "sub")),
		Email:         strings.TrimSpace(asString(get(cm.Email, "email"))),
		EmailVerified: asBool(get(cm.EmailVerified, "email_verified")),
		Name:          asString(get(cm.Name, "name")),
		Username:      asString(get(cm.Username, "preferred_username")),
		Groups:        asList(get(cm.Groups, "groups")),
		Claims:        claims,
	}
	return id
}
