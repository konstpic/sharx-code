package authn

import (
	"fmt"
	"sort"
	"strings"
)

// Preset is a ready-made provider definition. Adding a provider that speaks standard OIDC / OAuth 2.0 means adding an entry
// here (or, without a release, configuring the generic "oidc" / "oauth2" presets by hand in the admin UI).
type Preset struct {
	Id     string  `json:"id"`
	Name   string  `json:"name"`
	Kind   string  `json:"kind"`
	Params []Param `json:"params"` // what the admin has to supply
	Notes  string  `json:"notes,omitempty"`
	Groups bool    `json:"groups"` // the provider can deliver group membership
	Stage  int     `json:"stage"`  // 1 = usable now; 2 = needs a dedicated adapter that is not built yet
	build  func(p map[string]string) Config
}

// Param is one value the admin enters for a preset.
type Param struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Example  string `json:"example,omitempty"`
	Optional bool   `json:"optional,omitempty"`
}

func trim(s string) string { return strings.TrimRight(strings.TrimSpace(s), "/") }

func oidc(issuer string, scopes ...string) Config {
	return Config{Kind: "oidc", Issuer: issuer, Scopes: scopes, PKCE: true, TokenAuth: "basic"}
}

var presets = []Preset{
	{Id: "oidc", Name: "OpenID Connect (manual)", Kind: "oidc", Groups: true, Stage: 1,
		Params: []Param{{Key: "issuer", Label: "Issuer URL", Example: "https://idp.example.com/realms/main"}},
		Notes:  "Any OpenID Connect provider. Endpoints come from discovery; override them in the advanced settings.",
		build:  func(p map[string]string) Config { return oidc(trim(p["issuer"]), "openid", "profile", "email") }},
	{Id: "oauth2", Name: "OAuth 2.0 (manual)", Kind: "oauth2", Stage: 1,
		Params: []Param{
			{Key: "authUrl", Label: "Authorization endpoint"}, {Key: "tokenUrl", Label: "Token endpoint"}, {Key: "userInfoUrl", Label: "User info endpoint"},
		},
		Notes: "A provider without OpenID Connect. Set the claim mapping so that a stable user id is found in the user info answer.",
		build: func(p map[string]string) Config {
			return Config{Kind: "oauth2", AuthURL: trim(p["authUrl"]), TokenURL: trim(p["tokenUrl"]), UserInfoURL: trim(p["userInfoUrl"]), PKCE: true, TokenAuth: "post",
				Claims: ClaimMap{Subject: "id", Username: "login", Name: "name", Email: "email"}}
		}},
	{Id: "authentik", Name: "Authentik", Kind: "oidc", Groups: true, Stage: 1,
		Params: []Param{{Key: "baseUrl", Label: "Authentik URL", Example: "https://auth.example.com"}, {Key: "slug", Label: "Application slug", Example: "sharx"}},
		Notes:  "Groups arrive in the `groups` claim of the default profile scope.",
		build: func(p map[string]string) Config {
			return oidc(fmt.Sprintf("%s/application/o/%s/", trim(p["baseUrl"]), trim(p["slug"])), "openid", "profile", "email")
		}},
	{Id: "keycloak", Name: "Keycloak", Kind: "oidc", Groups: true, Stage: 1,
		Params: []Param{{Key: "baseUrl", Label: "Keycloak URL", Example: "https://sso.example.com"}, {Key: "realm", Label: "Realm", Example: "main"}},
		Notes:  "Add a Group Membership mapper (claim name `groups`) to the client; realm roles are in `realm_access.roles`.",
		build: func(p map[string]string) Config {
			return oidc(fmt.Sprintf("%s/realms/%s", trim(p["baseUrl"]), trim(p["realm"])), "openid", "profile", "email")
		}},
	{Id: "auth0", Name: "Auth0", Kind: "oidc", Groups: true, Stage: 1,
		Params: []Param{{Key: "domain", Label: "Auth0 domain", Example: "tenant.eu.auth0.com"}},
		Notes:  "Put roles/groups into a namespaced custom claim with an Action, then set it as the group claim.",
		build: func(p map[string]string) Config {
			return oidc("https://"+trim(p["domain"])+"/", "openid", "profile", "email")
		}},
	{Id: "okta", Name: "Okta", Kind: "oidc", Groups: true, Stage: 1,
		Params: []Param{{Key: "domain", Label: "Okta domain", Example: "dev-123456.okta.com"}, {Key: "authServer", Label: "Authorization server", Example: "default", Optional: true}},
		Notes:  "Add a Groups claim to the authorization server (filter by regex) and request the `groups` scope.",
		build: func(p map[string]string) Config {
			iss := "https://" + trim(p["domain"])
			if s := trim(p["authServer"]); s != "" {
				iss += "/oauth2/" + s
			}
			return oidc(iss, "openid", "profile", "email", "groups")
		}},
	{Id: "google", Name: "Google", Kind: "oidc", Stage: 1,
		build: func(p map[string]string) Config {
			return oidc("https://accounts.google.com", "openid", "profile", "email")
		},
		Notes: "Google verifies e-mail addresses; use the allowed domains list to restrict a Workspace."},
	{Id: "microsoft", Name: "Microsoft / Entra ID (Azure AD)", Kind: "oidc", Groups: true, Stage: 1,
		Params: []Param{{Key: "tenant", Label: "Directory (tenant) ID", Example: "00000000-0000-0000-0000-000000000000"}},
		Notes:  "Use the tenant id, not `common`: the issuer must be exact. Add the optional `groups` claim in the app's token configuration.",
		build: func(p map[string]string) Config {
			return oidc("https://login.microsoftonline.com/"+trim(p["tenant"])+"/v2.0", "openid", "profile", "email")
		}},
	{Id: "gitlab", Name: "GitLab", Kind: "oidc", Groups: true, Stage: 1,
		Params: []Param{{Key: "baseUrl", Label: "GitLab URL", Example: "https://gitlab.com", Optional: true}},
		Notes:  "Group membership is in the `groups` claim (`groups_direct` for direct groups).",
		build: func(p map[string]string) Config {
			b := trim(p["baseUrl"])
			if b == "" {
				b = "https://gitlab.com"
			}
			return oidc(b, "openid", "profile", "email")
		}},
	{Id: "linkedin", Name: "LinkedIn", Kind: "oidc", Stage: 1,
		build: func(p map[string]string) Config {
			return oidc("https://www.linkedin.com/oauth", "openid", "profile", "email")
		}},
	{Id: "github", Name: "GitHub", Kind: "oauth2", Stage: 1,
		Notes: "OAuth 2.0 only. Only the primary, verified e-mail is trusted.",
		build: func(p map[string]string) Config {
			return Config{Kind: "oauth2", AuthURL: "https://github.com/login/oauth/authorize", TokenURL: "https://github.com/login/oauth/access_token",
				UserInfoURL: "https://api.github.com/user", EmailsURL: "https://api.github.com/user/emails", Scopes: []string{"read:user", "user:email"},
				PKCE: true, TokenAuth: "post", Claims: ClaimMap{Subject: "id", Username: "login", Name: "name", Email: "email"}}
		}},
	{Id: "discord", Name: "Discord", Kind: "oauth2", Stage: 1,
		build: func(p map[string]string) Config {
			return Config{Kind: "oauth2", AuthURL: "https://discord.com/oauth2/authorize", TokenURL: "https://discord.com/api/oauth2/token",
				UserInfoURL: "https://discord.com/api/users/@me", Scopes: []string{"identify", "email"}, PKCE: true, TokenAuth: "post",
				Claims: ClaimMap{Subject: "id", Username: "username", Name: "global_name", Email: "email", EmailVerified: "verified"}}
		}},
	{Id: "facebook", Name: "Facebook", Kind: "oauth2", Stage: 1,
		Notes: "Facebook does not say whether an e-mail is verified, so it is never used to link accounts.",
		build: func(p map[string]string) Config {
			return Config{Kind: "oauth2", AuthURL: "https://www.facebook.com/v19.0/dialog/oauth", TokenURL: "https://graph.facebook.com/v19.0/oauth/access_token",
				UserInfoURL: "https://graph.facebook.com/me?fields=id,name,email", Scopes: []string{"email", "public_profile"}, PKCE: false, TokenAuth: "post",
				Claims: ClaimMap{Subject: "id", Name: "name", Email: "email"}}
		}},
	{Id: "yandex", Name: "Yandex ID", Kind: "oauth2", Stage: 1,
		Notes: "OAuth 2.0. Yandex returns only verified addresses; enable \"trust e-mail\".",
		build: func(p map[string]string) Config {
			return Config{Kind: "oauth2", AuthURL: "https://oauth.yandex.ru/authorize", TokenURL: "https://oauth.yandex.ru/token",
				UserInfoURL: "https://login.yandex.ru/info?format=json", Scopes: []string{"login:email", "login:info"}, PKCE: true, TokenAuth: "post",
				Claims: ClaimMap{Subject: "id", Username: "login", Name: "real_name", Email: "default_email"}, TrustEmail: true}
		}},
	{Id: "vk", Name: "VK ID", Kind: "vk", Stage: 1,
		Notes: "OAuth 2.1 with PKCE on id.vk.com. Client ID is the app id; the secret is not used for the code exchange. Register the redirect URI in the VK ID app.",
		build: func(p map[string]string) Config {
			return Config{Kind: "vk", AuthURL: "https://id.vk.com/authorize", TokenURL: "https://id.vk.com/oauth2/auth", UserInfoURL: "https://id.vk.com/oauth2/user_info",
				Scopes: []string{"email"}, PKCE: true, Claims: ClaimMap{Subject: "user_id", Email: "email", Name: "name", Username: "user_id"}}
		}},
	{Id: "apple", Name: "Sign in with Apple", Kind: "oidc", Stage: 1,
		Params: []Param{{Key: "teamId", Label: "Apple Team ID", Example: "ABCDE12345"}, {Key: "keyId", Label: "Key ID of the Sign in with Apple key", Example: "K1L2M3N4O5"}},
		Notes:  "Client ID is the Services ID; the client secret field takes the contents of the .p8 private key (a short-lived JWT is signed from it). The e-mail may be an Apple relay address. Apple sends the name only the first time.",
		build: func(p map[string]string) Config {
			return Config{Kind: "oidc", Issuer: "https://appleid.apple.com", Scopes: []string{"name", "email"}, PKCE: false, TokenAuth: "post",
				ExtraParams: map[string]string{"response_mode": "form_post"}}
		}},
	{Id: "telegram", Name: "Telegram Login", Kind: "telegram", Stage: 1,
		Notes: "Client ID is the bot's username (without @), the client secret is the bot token. Set the panel's domain with /setdomain in @BotFather. Telegram gives no e-mail, so e-mail rules and linking do not apply.",
		build: func(p map[string]string) Config { return Config{Kind: "telegram"} }},
}

// Presets lists the known providers.
func Presets() []Preset {
	out := append([]Preset(nil), presets...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].Stage < out[j].Stage })
	return out
}

// PresetByID finds a preset.
func PresetByID(id string) (Preset, bool) {
	for _, p := range presets {
		if p.Id == id {
			return p, true
		}
	}
	return Preset{}, false
}

// BuildConfig produces the endpoint configuration of a preset from the admin's parameters.
func BuildConfig(preset string, params map[string]string) (Config, error) {
	p, ok := PresetByID(preset)
	if !ok {
		return Config{}, fmt.Errorf("unknown provider type %q", preset)
	}
	if p.Stage != 1 {
		return Config{}, fmt.Errorf("%s is not available yet", p.Name)
	}
	for _, pr := range p.Params {
		if !pr.Optional && strings.TrimSpace(params[pr.Key]) == "" {
			return Config{}, fmt.Errorf("%s is required", pr.Label)
		}
	}
	return p.build(params), nil
}
