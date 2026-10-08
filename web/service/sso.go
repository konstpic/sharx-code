package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/crypto"
	"github.com/konstpic/sharx-code/v2/web/authn"
	"github.com/konstpic/sharx-code/v2/web/rbac"
	"gorm.io/gorm"
)

// SSOService manages external identity providers and turns a verified identity into a panel user with a role.
//
// The rules, in short: an identity is (provider, subject) and nothing else; an e-mail address never identifies anybody by
// itself. A new identity is attached to an existing account only when the signed-in owner of that account asks for it, or
// when the provider is explicitly allowed to link by a *verified* e-mail address that belongs to exactly one account.
// Roles are either managed locally (an administrator assigns them) or by the provider's rules (re-evaluated at every
// sign-in); a user whose role is managed by the provider cannot be given another role by hand.
type SSOService struct {
	settings SettingService
}

// SSO is the shared instance.
var SSO = &SSOService{}

// SSOError is a refusal with a short stable code (used in redirects and the audit trail) and a message for the log.
type SSOError struct {
	Code string
	Msg  string
}

func (e *SSOError) Error() string { return e.Code + ": " + e.Msg }

func deny(code, format string, a ...any) error {
	return &SSOError{Code: code, Msg: fmt.Sprintf(format, a...)}
}

// ---------- provider configuration ----------

// Overrides are the advanced settings of a provider; zero values mean "use the preset".
type Overrides struct {
	Issuer      string            `json:"issuer,omitempty"`
	AuthURL     string            `json:"authUrl,omitempty"`
	TokenURL    string            `json:"tokenUrl,omitempty"`
	UserInfoURL string            `json:"userInfoUrl,omitempty"`
	JWKSURL     string            `json:"jwksUrl,omitempty"`
	Scopes      []string          `json:"scopes,omitempty"`
	Claims      authn.ClaimMap    `json:"claims,omitempty"`
	TrustEmail  *bool             `json:"trustEmail,omitempty"`
	TokenAuth   string            `json:"tokenAuth,omitempty"`
	PKCE        *bool             `json:"pkce,omitempty"`
	ExtraParams map[string]string `json:"extraParams,omitempty"`
	// RedirectBase overrides the public address used to build the callback URL (behind a proxy that rewrites the host).
	RedirectBase string `json:"redirectBase,omitempty"`
}

type storedConfig struct {
	Params    map[string]string `json:"params,omitempty"`
	Overrides Overrides         `json:"overrides,omitempty"`
}

// ProviderInput creates or updates a provider.
type ProviderInput struct {
	Key            string            `json:"key"`
	Name           string            `json:"name"`
	Preset         string            `json:"preset"`
	Enabled        bool              `json:"enabled"`
	ClientId       string            `json:"clientId"`
	ClientSecret   *string           `json:"clientSecret"` // nil keeps the stored secret
	Params         map[string]string `json:"params"`
	Overrides      Overrides         `json:"overrides"`
	AllowedDomains []string          `json:"allowedDomains"`
	AllowedEmails  []string          `json:"allowedEmails"`
	AllowSignup    bool              `json:"allowSignup"`
	LinkByEmail    bool              `json:"linkByEmail"`
	RoleMode       string            `json:"roleMode"`
	NoMatch        string            `json:"noMatch"`
	DefaultRoleId  *int              `json:"defaultRoleId"`
}

// ProviderView is a provider as the admin UI shows it. The secret is never included.
type ProviderView struct {
	Id             int               `json:"id"`
	Key            string            `json:"key"`
	Name           string            `json:"name"`
	Preset         string            `json:"preset"`
	Kind           string            `json:"kind"`
	Enabled        bool              `json:"enabled"`
	ClientId       string            `json:"clientId"`
	HasSecret      bool              `json:"hasSecret"`
	Params         map[string]string `json:"params"`
	Overrides      Overrides         `json:"overrides"`
	AllowedDomains []string          `json:"allowedDomains"`
	AllowedEmails  []string          `json:"allowedEmails"`
	AllowSignup    bool              `json:"allowSignup"`
	LinkByEmail    bool              `json:"linkByEmail"`
	RoleMode       string            `json:"roleMode"`
	NoMatch        string            `json:"noMatch"`
	DefaultRoleId  *int              `json:"defaultRoleId,omitempty"`
	CallbackPath   string            `json:"callbackPath"`
	Identities     int64             `json:"identities"`
	UpdatedAt      int64             `json:"updatedAt"`
}

var keyRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)

func decodeList(raw string) []string {
	var out []string
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}

func encodeList(in []string) string {
	clean := []string{}
	seen := map[string]bool{}
	for _, v := range in {
		v = strings.ToLower(strings.TrimSpace(v))
		if v != "" && !seen[v] {
			seen[v] = true
			clean = append(clean, v)
		}
	}
	b, _ := json.Marshal(clean)
	return string(b)
}

func (s *SSOService) secret() []byte {
	b, _ := s.settings.GetSecret()
	return b
}

func providerView(p model.AuthProvider, identities int64) ProviderView {
	var sc storedConfig
	_ = json.Unmarshal([]byte(p.Config), &sc)
	kind := "oidc"
	if pr, ok := authn.PresetByID(p.Preset); ok {
		kind = pr.Kind
	}
	return ProviderView{
		Id: p.Id, Key: p.Key, Name: p.Name, Preset: p.Preset, Kind: kind, Enabled: p.Enabled, ClientId: p.ClientId, HasSecret: p.ClientSecret != "",
		Params: sc.Params, Overrides: sc.Overrides, AllowedDomains: decodeList(p.AllowedDomains), AllowedEmails: decodeList(p.AllowedEmails),
		AllowSignup: p.AllowSignup, LinkByEmail: p.LinkByEmail, RoleMode: p.RoleMode, NoMatch: p.NoMatch, DefaultRoleId: p.DefaultRoleId,
		CallbackPath: "auth/sso/" + p.Key + "/callback", Identities: identities, UpdatedAt: p.UpdatedAt,
	}
}

// allowedURL accepts https, and http only for loopback (development, tests).
func allowedURL(raw string) error {
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return fmt.Errorf("%q is not a valid URL", raw)
	}
	if u.Scheme == "https" {
		return nil
	}
	if u.Scheme == "http" {
		h := u.Hostname()
		if h == "localhost" || net.ParseIP(h) != nil && net.ParseIP(h).IsLoopback() {
			return nil
		}
	}
	return fmt.Errorf("%q must use https", raw)
}

// buildConfig merges the preset, the parameters and the overrides into an engine configuration.
func buildConfig(preset string, sc storedConfig) (authn.Config, error) {
	cfg, err := authn.BuildConfig(preset, sc.Params)
	if err != nil {
		return cfg, err
	}
	o := sc.Overrides
	set := func(dst *string, v string) {
		if strings.TrimSpace(v) != "" {
			*dst = strings.TrimSpace(v)
		}
	}
	set(&cfg.Issuer, o.Issuer)
	set(&cfg.AuthURL, o.AuthURL)
	set(&cfg.TokenURL, o.TokenURL)
	set(&cfg.UserInfoURL, o.UserInfoURL)
	set(&cfg.JWKSURL, o.JWKSURL)
	set(&cfg.TokenAuth, o.TokenAuth)
	if len(o.Scopes) > 0 {
		cfg.Scopes = o.Scopes
	}
	if o.TrustEmail != nil {
		cfg.TrustEmail = *o.TrustEmail
	}
	if o.PKCE != nil {
		cfg.PKCE = *o.PKCE
	}
	set(&cfg.Claims.Subject, o.Claims.Subject)
	set(&cfg.Claims.Email, o.Claims.Email)
	set(&cfg.Claims.EmailVerified, o.Claims.EmailVerified)
	set(&cfg.Claims.Name, o.Claims.Name)
	set(&cfg.Claims.Username, o.Claims.Username)
	set(&cfg.Claims.Groups, o.Claims.Groups)
	if len(o.ExtraParams) > 0 {
		cfg.ExtraParams = o.ExtraParams
	}
	for _, u := range []string{cfg.Issuer, cfg.AuthURL, cfg.TokenURL, cfg.UserInfoURL, cfg.JWKSURL} {
		if err := allowedURL(u); err != nil {
			return cfg, err
		}
	}
	if cfg.Kind == "oidc" && cfg.Issuer == "" {
		return cfg, errors.New("the issuer URL is required")
	}
	if cfg.Kind == "oauth2" && (cfg.AuthURL == "" || cfg.TokenURL == "" || cfg.UserInfoURL == "") {
		return cfg, errors.New("authorization, token and user info endpoints are required")
	}
	return cfg, nil
}

func (s *SSOService) validate(in *ProviderInput) error {
	in.Key = strings.ToLower(strings.TrimSpace(in.Key))
	if !keyRe.MatchString(in.Key) {
		return invalid("the key must be 1-40 characters: lowercase letters, digits and dashes")
	}
	name, err := cleanName(in.Name, 100, "name")
	if err != nil {
		return err
	}
	in.Name = name
	if in.RoleMode == "" {
		in.RoleMode = "local"
	}
	if in.NoMatch == "" {
		in.NoMatch = "deny"
	}
	if in.RoleMode != "local" && in.RoleMode != "idp" {
		return invalid("role mode must be local or idp")
	}
	if in.NoMatch != "deny" && in.NoMatch != "default" && in.NoMatch != "keep" {
		return invalid("no-match behaviour must be deny, default or keep")
	}
	pr, ok := authn.PresetByID(in.Preset)
	if !ok || pr.Stage != 1 {
		return invalid("unknown or unavailable provider type %q", in.Preset)
	}
	return nil
}

func (s *SSOService) roleExists(tx *gorm.DB, id int) (model.Role, error) {
	var r model.Role
	if err := tx.First(&r, id).Error; err != nil {
		return r, invalid("role %d does not exist", id)
	}
	return r, nil
}

// ListProviders returns every provider for the admin UI.
func (s *SSOService) ListProviders() ([]ProviderView, error) {
	var rows []model.AuthProvider
	if err := database.GetDB().Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	counts := map[int]int64{}
	var cs []struct {
		ProviderId int
		N          int64
	}
	database.GetDB().Raw("SELECT provider_id, COUNT(*) AS n FROM user_identities GROUP BY provider_id").Scan(&cs)
	for _, c := range cs {
		counts[c.ProviderId] = c.N
	}
	out := make([]ProviderView, 0, len(rows))
	for _, r := range rows {
		out = append(out, providerView(r, counts[r.Id]))
	}
	return out, nil
}

// SaveProvider creates (id 0) or updates a provider. Only an administrator reaches it (route permission auth:manage).
func (s *SSOService) SaveProvider(a Actor, id int, in ProviderInput) (*ProviderView, error) {
	if err := s.validate(&in); err != nil {
		return nil, err
	}
	sc := storedConfig{Params: in.Params, Overrides: in.Overrides}
	if _, err := buildConfig(in.Preset, sc); err != nil {
		return nil, invalid("%v", err)
	}
	var saved model.AuthProvider
	var before model.AuthProvider
	err := withLock(func(tx *gorm.DB) error {
		var n int64
		q := tx.Model(&model.AuthProvider{}).Where("LOWER(key) = ?", in.Key)
		if id != 0 {
			q = q.Where("id <> ?", id)
		}
		q.Count(&n)
		if n > 0 {
			return conflict("a provider with the key %q already exists", in.Key)
		}
		if in.DefaultRoleId != nil {
			if _, err := s.roleExists(tx, *in.DefaultRoleId); err != nil {
				return err
			}
		}
		if in.NoMatch == "default" && in.DefaultRoleId == nil {
			return invalid("choose the default role")
		}
		if id != 0 {
			if err := tx.First(&before, id).Error; err != nil {
				return notFound("provider")
			}
			saved = before
		}
		saved.Key, saved.Name, saved.Preset, saved.Enabled = in.Key, in.Name, in.Preset, in.Enabled
		saved.ClientId = strings.TrimSpace(in.ClientId)
		saved.AllowedDomains, saved.AllowedEmails = encodeList(in.AllowedDomains), encodeList(in.AllowedEmails)
		saved.AllowSignup, saved.LinkByEmail = in.AllowSignup, in.LinkByEmail
		saved.RoleMode, saved.NoMatch, saved.DefaultRoleId = in.RoleMode, in.NoMatch, in.DefaultRoleId
		cb, _ := json.Marshal(sc)
		saved.Config = string(cb)
		if in.ClientSecret != nil {
			sealed, err := authn.Seal(s.secret(), *in.ClientSecret)
			if err != nil {
				return err
			}
			saved.ClientSecret = sealed
		}
		if saved.Enabled && saved.ClientId == "" {
			return invalid("the client ID is required to enable a provider")
		}
		now := time.Now().Unix()
		saved.UpdatedAt = now
		if id == 0 {
			saved.CreatedAt = now
			return tx.Create(&saved).Error
		}
		return tx.Save(&saved).Error
	})
	if err != nil {
		return nil, err
	}
	dropClient(saved.Id)
	action := "sso.provider_update"
	if id == 0 {
		action = "sso.provider_create"
	}
	Audit.Record(a, action, "provider", fmt.Sprint(saved.Id), saved.Name, providerAudit(before), providerAudit(saved), "ok", "")
	v := providerView(saved, 0)
	return &v, nil
}

// providerAudit is what the trail keeps of a provider: never the secret.
func providerAudit(p model.AuthProvider) map[string]any {
	if p.Id == 0 {
		return nil
	}
	return map[string]any{"key": p.Key, "preset": p.Preset, "enabled": p.Enabled, "clientId": p.ClientId, "signup": p.AllowSignup, "linkByEmail": p.LinkByEmail, "roleMode": p.RoleMode, "noMatch": p.NoMatch, "secretSet": p.ClientSecret != ""}
}

// DeleteProvider removes a provider with its rules and the identities that came from it. Accounts stay; one that was
// created by the provider and has no other way in simply cannot sign in until an administrator sets a password.
func (s *SSOService) DeleteProvider(a Actor, id int) error {
	var p model.AuthProvider
	err := withLock(func(tx *gorm.DB) error {
		if err := tx.First(&p, id).Error; err != nil {
			return notFound("provider")
		}
		if err := tx.Where("provider_id = ?", id).Delete(&model.AuthRoleRule{}).Error; err != nil {
			return err
		}
		if err := tx.Where("provider_id = ?", id).Delete(&model.UserIdentity{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.AuthProvider{}, id).Error
	})
	if err != nil {
		return err
	}
	dropClient(id)
	Audit.Record(a, "sso.provider_delete", "provider", fmt.Sprint(id), p.Name, providerAudit(p), nil, "ok", "")
	return nil
}

// PublicProvider is what the login page needs.
type PublicProvider struct {
	Key    string `json:"key"`
	Name   string `json:"name"`
	Preset string `json:"preset"`
}

// PublicProviders lists enabled, complete providers for the login page.
func (s *SSOService) PublicProviders() []PublicProvider {
	var rows []model.AuthProvider
	database.GetDB().Where("enabled = TRUE AND client_id <> ''").Order("id").Find(&rows)
	out := make([]PublicProvider, 0, len(rows))
	for _, r := range rows {
		out = append(out, PublicProvider{Key: r.Key, Name: r.Name, Preset: r.Preset})
	}
	return out
}

// LocalLoginEnabled reports whether the password form is open to everybody. When off, only administrators may still use it
// (the way back in when the identity provider is down).
func (s *SSOService) LocalLoginEnabled() bool {
	v, err := s.settings.getBool("ssoLocalLogin")
	return err != nil || v
}

// SetLocalLogin switches the password form for non-administrators.
func (s *SSOService) SetLocalLogin(a Actor, on bool) error {
	if err := s.settings.setBool("ssoLocalLogin", on); err != nil {
		return err
	}
	Audit.Record(a, "sso.local_login", "setting", "", "password sign-in for non-administrators", nil, map[string]any{"enabled": on}, "ok", "")
	return nil
}

// ---------- engine clients ----------

type cachedClient struct {
	updated int64
	p       *authn.Provider
}

var (
	clientMu    sync.Mutex
	clientCache = map[int]cachedClient{}
)

func dropClient(id int) {
	clientMu.Lock()
	delete(clientCache, id)
	clientMu.Unlock()
}

// ProviderByKey loads an enabled provider.
func (s *SSOService) ProviderByKey(key string) (*model.AuthProvider, error) {
	var p model.AuthProvider
	if err := database.GetDB().Where("LOWER(key) = LOWER(?) AND enabled = TRUE", key).First(&p).Error; err != nil {
		return nil, deny("unknown_provider", "no enabled provider %q", key)
	}
	return &p, nil
}

// Client returns the engine client for a provider (cached until the provider changes, so discovery and keys are reused).
func (s *SSOService) Client(p *model.AuthProvider) (*authn.Provider, error) {
	clientMu.Lock()
	defer clientMu.Unlock()
	if c, ok := clientCache[p.Id]; ok && c.updated == p.UpdatedAt {
		return c.p, nil
	}
	var sc storedConfig
	_ = json.Unmarshal([]byte(p.Config), &sc)
	cfg, err := buildConfig(p.Preset, sc)
	if err != nil {
		return nil, err
	}
	cfg.ClientID = p.ClientId
	secret, err := authn.Open(s.secret(), p.ClientSecret)
	if err != nil {
		return nil, err
	}
	cfg.ClientSecret = secret
	c := authn.New(cfg)
	clientCache[p.Id] = cachedClient{updated: p.UpdatedAt, p: c}
	return c, nil
}

// Test checks that the provider can be reached and its metadata is consistent (discovery and key set).
func (s *SSOService) Test(ctx context.Context, id int) (map[string]any, error) {
	var p model.AuthProvider
	if err := database.GetDB().First(&p, id).Error; err != nil {
		return nil, notFound("provider")
	}
	c, err := s.Client(&p)
	if err != nil {
		return nil, err
	}
	if err := c.Discover(ctx); err != nil {
		return nil, err
	}
	out := map[string]any{"authUrl": c.Cfg.AuthURL, "tokenUrl": c.Cfg.TokenURL, "userInfoUrl": c.Cfg.UserInfoURL, "jwksUrl": c.Cfg.JWKSURL, "issuer": c.Cfg.Issuer}
	if c.Cfg.JWKSURL != "" {
		if _, err := authn.SharedKeys.Key(ctx, c.Cfg.JWKSURL, ""); err != nil && !strings.Contains(err.Error(), "unknown signing key") {
			return out, fmt.Errorf("signing keys: %w", err)
		}
	}
	return out, nil
}

// ---------- role rules ----------

// RuleInput creates or updates a rule.
type RuleInput struct {
	ProviderId *int   `json:"providerId"`
	Position   int    `json:"position"`
	Kind       string `json:"kind"`
	Claim      string `json:"claim"`
	Value      string `json:"value"`
	RoleId     int    `json:"roleId"`
	Enabled    bool   `json:"enabled"`
}

// RuleView is a rule with its role's name.
type RuleView struct {
	model.AuthRoleRule
	RoleName string `json:"roleName"`
}

// ListRules returns all rules ordered the way they are evaluated.
func (s *SSOService) ListRules() ([]RuleView, error) {
	var rows []model.AuthRoleRule
	if err := database.GetDB().Order("(provider_id IS NULL), provider_id, position, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	names := map[int]string{}
	var roles []model.Role
	database.GetDB().Find(&roles)
	for _, r := range roles {
		names[r.Id] = r.Name
	}
	out := make([]RuleView, 0, len(rows))
	for _, r := range rows {
		out = append(out, RuleView{AuthRoleRule: r, RoleName: names[r.RoleId]})
	}
	return out, nil
}

func (s *SSOService) validateRule(tx *gorm.DB, in *RuleInput) (model.Role, error) {
	var role model.Role
	if !authn.ValidRuleKind(in.Kind) {
		return role, invalid("unknown rule kind %q", in.Kind)
	}
	in.Value, in.Claim = strings.TrimSpace(in.Value), strings.TrimSpace(in.Claim)
	if in.Kind != authn.RuleAny && in.Value == "" {
		return role, invalid("the value is required")
	}
	if in.Kind == authn.RuleClaim && in.Claim == "" {
		return role, invalid("the claim name is required")
	}
	if len(in.Value) > 300 || len(in.Claim) > 200 {
		return role, invalid("the value is too long")
	}
	if in.ProviderId != nil {
		var n int64
		tx.Model(&model.AuthProvider{}).Where("id = ?", *in.ProviderId).Count(&n)
		if n == 0 {
			return role, invalid("provider does not exist")
		}
	}
	role, err := s.roleExists(tx, in.RoleId)
	if err != nil {
		return role, err
	}
	// "everybody the provider authenticates" must never be an administrator
	if in.Kind == authn.RuleAny && roleIsAdmin(role) {
		return role, invalid("a rule without a condition cannot grant the administrator role")
	}
	return role, nil
}

// SaveRule creates (id 0) or updates a rule.
func (s *SSOService) SaveRule(a Actor, id int, in RuleInput) (*model.AuthRoleRule, error) {
	var rule, before model.AuthRoleRule
	var role model.Role
	err := withLock(func(tx *gorm.DB) error {
		var err error
		if role, err = s.validateRule(tx, &in); err != nil {
			return err
		}
		if id != 0 {
			if err := tx.First(&before, id).Error; err != nil {
				return notFound("rule")
			}
			rule = before
		}
		rule.ProviderId, rule.Position, rule.Kind, rule.Claim, rule.Value = in.ProviderId, in.Position, in.Kind, in.Claim, in.Value
		rule.RoleId, rule.Enabled = in.RoleId, in.Enabled
		if id == 0 {
			rule.CreatedAt = time.Now().Unix()
			return tx.Select("*").Create(&rule).Error
		}
		return tx.Save(&rule).Error
	})
	if err != nil {
		return nil, err
	}
	action := "sso.rule_update"
	if id == 0 {
		action = "sso.rule_create"
	}
	Audit.Record(a, action, "rule", fmt.Sprint(rule.Id), ruleLabel(rule, role.Name), ruleState(before), ruleState(rule), "ok", "")
	return &rule, nil
}

func ruleLabel(r model.AuthRoleRule, role string) string {
	what := r.Kind + " " + r.Value
	if r.Kind == authn.RuleClaim {
		what = "claim " + r.Claim + " = " + r.Value
	}
	if r.Kind == authn.RuleAny {
		what = "any"
	}
	return what + " -> " + role
}

func ruleState(r model.AuthRoleRule) map[string]any {
	if r.Id == 0 {
		return nil
	}
	return map[string]any{"kind": r.Kind, "claim": r.Claim, "value": r.Value, "roleId": r.RoleId, "enabled": r.Enabled, "position": r.Position}
}

// DeleteRule removes a rule.
func (s *SSOService) DeleteRule(a Actor, id int) error {
	var r model.AuthRoleRule
	if err := database.GetDB().First(&r, id).Error; err != nil {
		return notFound("rule")
	}
	if err := database.GetDB().Delete(&model.AuthRoleRule{}, id).Error; err != nil {
		return err
	}
	var role model.Role
	database.GetDB().First(&role, r.RoleId)
	Audit.Record(a, "sso.rule_delete", "rule", fmt.Sprint(id), ruleLabel(r, role.Name), ruleState(r), nil, "ok", "")
	return nil
}

func (s *SSOService) rulesFor(tx *gorm.DB, providerID int) []authn.Rule {
	var rows []model.AuthRoleRule
	tx.Where("enabled = TRUE AND (provider_id IS NULL OR provider_id = ?)", providerID).
		Order("(provider_id IS NULL), position, id").Find(&rows)
	out := make([]authn.Rule, 0, len(rows))
	for _, r := range rows {
		out = append(out, authn.Rule{Id: r.Id, Position: len(out), Kind: r.Kind, Claim: r.Claim, Value: r.Value, RoleId: r.RoleId, Enabled: true})
	}
	return out
}

// ---------- identities ----------

// IdentityView is a linked account for the UI.
type IdentityView struct {
	Id          int      `json:"id"`
	UserId      int      `json:"userId"`
	Username    string   `json:"username,omitempty"`
	ProviderKey string   `json:"providerKey"`
	Provider    string   `json:"provider"`
	Email       string   `json:"email"`
	DisplayName string   `json:"displayName"`
	Groups      []string `json:"groups"`
	CreatedAt   int64    `json:"createdAt"`
	LastLoginAt int64    `json:"lastLoginAt"`
}

// Identities lists linked accounts: of one user, or all when userID is 0.
func (s *SSOService) Identities(userID int) ([]IdentityView, error) {
	var rows []struct {
		model.UserIdentity
		ProviderKey  string
		ProviderName string
		Username     string
	}
	q := database.GetDB().Table("user_identities i").
		Select("i.*, p.key AS provider_key, p.name AS provider_name, u.username AS username").
		Joins("LEFT JOIN auth_providers p ON p.id = i.provider_id").Joins("LEFT JOIN users u ON u.id = i.user_id").Order("i.id")
	if userID != 0 {
		q = q.Where("i.user_id = ?", userID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]IdentityView, 0, len(rows))
	for _, r := range rows {
		out = append(out, IdentityView{Id: r.Id, UserId: r.UserId, Username: r.Username, ProviderKey: r.ProviderKey, Provider: r.ProviderName, Email: r.Email,
			DisplayName: r.DisplayName, Groups: decodeList(r.Groups), CreatedAt: r.CreatedAt, LastLoginAt: r.LastLoginAt})
	}
	return out, nil
}

// Unlink removes an identity. The owner may remove their own unless it is the only way into an account that has no usable
// password; an administrator may remove anyone's.
func (s *SSOService) Unlink(a Actor, identityID int, own bool) error {
	var id model.UserIdentity
	var u model.User
	err := withLock(func(tx *gorm.DB) error {
		if err := tx.First(&id, identityID).Error; err != nil {
			return notFound("identity")
		}
		if own && id.UserId != a.Principal.UserId {
			return forbidden("this account is linked to somebody else")
		}
		tx.First(&u, id.UserId)
		if own && u.AuthSource != "" && u.AuthSource != "local" {
			var n int64
			tx.Model(&model.UserIdentity{}).Where("user_id = ?", u.Id).Count(&n)
			if n <= 1 {
				return conflict("this is the only way to sign in to this account")
			}
		}
		return tx.Delete(&model.UserIdentity{}, identityID).Error
	})
	if err != nil {
		return err
	}
	Audit.Record(a, "auth.identity_unlink", "user", fmt.Sprint(u.Id), u.Username, map[string]any{"providerId": id.ProviderId, "subject": id.Subject}, nil, "ok", "")
	return nil
}

// ---------- sign-in ----------

func (s *SSOService) actorFor(u *model.User, ip string) Actor {
	if u == nil {
		return Actor{IP: ip}
	}
	return Actor{Principal: &Principal{UserId: u.Id, Username: u.Username}, IP: ip}
}

// RecordDenied writes a refused sign-in to the audit trail.
func (s *SSOService) RecordDenied(p *model.AuthProvider, id *authn.Identity, ip string, err error) {
	who, target := "", ""
	if id != nil {
		who = id.Email
		if who == "" {
			who = id.Username
		}
	}
	if p != nil {
		target = p.Name
	}
	Audit.Record(Actor{IP: ip}, "auth.sso_denied", "provider", "", target, nil, map[string]any{"identity": who}, "denied", err.Error())
}

var nonNameChars = regexp.MustCompile(`[\s/\\]+`)

func sanitizeName(s string) string {
	s = nonNameChars.ReplaceAllString(strings.TrimSpace(s), "_")
	var b strings.Builder
	for _, r := range s {
		if r >= 32 && r != 127 {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if r := []rune(out); len(r) > maxUsernameLen-6 {
		out = string(r[:maxUsernameLen-6])
	}
	return out
}

func (s *SSOService) freeUsername(tx *gorm.DB, id authn.Identity) string {
	cands := []string{id.Username}
	if at := strings.Index(id.Email, "@"); at > 0 {
		cands = append(cands, id.Email[:at])
	}
	cands = append(cands, id.Name, "sso-"+authn.Random(4))
	for _, c := range cands {
		base := sanitizeName(c)
		if base == "" {
			continue
		}
		for i := 0; i < 50; i++ {
			name := base
			if i > 0 {
				name = fmt.Sprintf("%s-%d", base, i+1)
			}
			var n int64
			tx.Model(&model.User{}).Where("LOWER(username) = LOWER(?) AND deleted_at IS NULL", name).Count(&n)
			if n == 0 {
				return name
			}
		}
	}
	return "sso-" + authn.Random(8)
}

// decideRole applies the provider's role policy. It returns the role to assign, or nil to leave the current role, or a
// denial. cur is the user's current role (nil for a new user).
func (s *SSOService) decideRole(tx *gorm.DB, p *model.AuthProvider, id authn.Identity, cur *int) (assign *int, err error) {
	if p.RoleMode != "idp" {
		if cur != nil {
			return nil, nil
		}
		if p.DefaultRoleId == nil {
			return nil, deny("no_role", "provider %s has no default role for new users", p.Key)
		}
		return p.DefaultRoleId, nil
	}
	roleID, _, ok := authn.PickRole(s.rulesFor(tx, p.Id), id)
	if ok {
		if _, e := s.roleExists(tx, roleID); e != nil {
			return nil, deny("no_role", "the role of the matching rule no longer exists")
		}
		return &roleID, nil
	}
	switch p.NoMatch {
	case "default":
		if p.DefaultRoleId != nil {
			return p.DefaultRoleId, nil
		}
	case "keep":
		if cur != nil {
			return nil, nil
		}
		if p.DefaultRoleId != nil {
			return p.DefaultRoleId, nil
		}
	}
	return nil, deny("no_access", "no role rule matches this account")
}

// SignIn turns a verified identity into a signed-in user. linkUserID is non-zero when a signed-in user is linking a new
// identity instead of signing in.
func (s *SSOService) SignIn(p *model.AuthProvider, id authn.Identity, ip string, linkUserID int) (*model.User, error) {
	if !authn.EmailAllowed(id, decodeList(p.AllowedDomains), decodeList(p.AllowedEmails)) {
		return nil, deny("not_allowed", "the e-mail address is not on the allow list")
	}
	var user model.User
	var events []func()
	var denial error // a refusal that must still commit what it changed (a revoked role)
	err := withLock(func(tx *gorm.DB) error {
		now := time.Now().Unix()
		var ident model.UserIdentity
		found := tx.Where("provider_id = ? AND subject = ?", p.Id, id.Subject).First(&ident).Error == nil

		// ----- linking a new identity to the signed-in user -----
		if linkUserID != 0 {
			if found {
				if ident.UserId == linkUserID {
					return nil
				}
				return deny("already_linked", "this account is already linked to another user")
			}
			if err := tx.Where("id = ? AND deleted_at IS NULL AND enabled = TRUE", linkUserID).First(&user).Error; err != nil {
				return deny("no_account", "the account to link to no longer exists")
			}
			var n int64
			tx.Model(&model.UserIdentity{}).Where("user_id = ? AND provider_id = ?", user.Id, p.Id).Count(&n)
			if n > 0 {
				return deny("already_linked", "this user already has an account at this provider")
			}
			if err := tx.Create(&model.UserIdentity{UserId: user.Id, ProviderId: p.Id, Subject: id.Subject, Email: id.Email, EmailVerified: id.EmailVerified,
				DisplayName: id.Name, Groups: encodeGroups(id.Groups), CreatedAt: now, LastLoginAt: now}).Error; err != nil {
				return err
			}
			events = append(events, func() {
				Audit.Record(s.actorFor(&user, ip), "auth.identity_link", "user", fmt.Sprint(user.Id), user.Username, nil, map[string]any{"provider": p.Key, "email": id.Email}, "ok", "")
			})
			return nil
		}

		isNew := false
		if found {
			if err := tx.Where("id = ? AND deleted_at IS NULL", ident.UserId).First(&user).Error; err != nil {
				return deny("no_account", "the linked account no longer exists")
			}
		} else {
			// an unknown identity: find an account it may attach to, or create one
			if p.LinkByEmail && id.EmailVerified && id.Email != "" {
				var matches []model.User
				tx.Where("LOWER(email) = LOWER(?) AND deleted_at IS NULL", id.Email).Limit(2).Find(&matches)
				if len(matches) == 1 {
					var n int64
					tx.Model(&model.UserIdentity{}).Where("user_id = ? AND provider_id = ?", matches[0].Id, p.Id).Count(&n)
					if n == 0 {
						user = matches[0]
					}
				}
			}
			if user.Id == 0 {
				if !p.AllowSignup {
					return deny("no_account", "no account is linked to this identity and self-registration is off")
				}
				isNew = true
			}
		}
		if user.Id != 0 && (!user.Enabled || user.DeletedAt != nil) {
			return deny("disabled", "the account is disabled")
		}

		// ----- role -----
		var assign *int
		var roleErr error
		managed := user.RoleManaged
		if isNew {
			assign, roleErr = s.decideRole(tx, p, id, nil)
			if roleErr != nil {
				return roleErr
			}
			managed = p.RoleMode == "idp"
		} else if !found && user.Id != 0 {
			// attached by verified e-mail: the provider becomes the source of the role when it is configured to be
			assign, roleErr = s.decideRole(tx, p, id, user.RoleId)
			if roleErr != nil {
				return roleErr
			}
			managed = p.RoleMode == "idp"
		} else if managed && p.RoleMode == "idp" {
			assign, roleErr = s.decideRole(tx, p, id, user.RoleId)
		}

		var beforeRole, afterRole model.Role
		if user.RoleId != nil {
			tx.First(&beforeRole, *user.RoleId)
		}
		if roleErr != nil {
			// the provider no longer grants this user any role: revoke it (unless that would lock everybody out)
			var se *SSOError
			if errors.As(roleErr, &se) && se.Code == "no_access" && user.RoleId != nil {
				if user.Enabled && roleIsAdmin(beforeRole) {
					if n, _ := adminCount(tx, user.Id); n < 1 {
						events = append(events, func() {
							Audit.Record(s.actorFor(&user, ip), "auth.role_sync", "user", fmt.Sprint(user.Id), user.Username, nil, nil, "denied", "the provider no longer grants a role, but this is the last administrator: role kept")
						})
						roleErr = nil
					}
				}
				if roleErr != nil {
					if err := tx.Model(&model.User{}).Where("id = ?", user.Id).Updates(map[string]any{"role_id": nil, "updated_at": now}).Error; err != nil {
						return err
					}
					uid, uname, old := user.Id, user.Username, beforeRole.Name
					events = append(events, func() {
						InvalidateRBAC()
						revokeAccess(uid)
						Audit.Record(s.actorFor(&model.User{Id: uid, Username: uname}, ip), "auth.role_revoke", "user", fmt.Sprint(uid), uname, map[string]any{"role": old}, map[string]any{"role": nil}, "ok", "no role rule matches any more")
					})
					denial = roleErr
					return nil
				}
			} else {
				return roleErr
			}
		}
		if assign != nil && (user.RoleId == nil || *assign != *user.RoleId) {
			if err := tx.First(&afterRole, *assign).Error; err != nil {
				return deny("no_role", "role does not exist")
			}
			if user.Id != 0 && user.Enabled && roleIsAdmin(beforeRole) && !roleIsAdmin(afterRole) {
				if n, _ := adminCount(tx, user.Id); n < 1 {
					events = append(events, func() {
						Audit.Record(s.actorFor(&user, ip), "auth.role_sync", "user", fmt.Sprint(user.Id), user.Username, nil, nil, "denied", "this would demote the last administrator: role kept")
					})
					assign = nil
				}
			}
		}

		// ----- write -----
		if isNew {
			hash, err := crypto.HashPasswordAsBcrypt(authn.Random(32))
			if err != nil {
				return err
			}
			rid := *assign
			user = model.User{Username: s.freeUsername(tx, id), Password: hash, RoleId: &rid, Enabled: true, CreatedAt: now, UpdatedAt: now,
				Email: strings.ToLower(id.Email), AuthSource: p.Key, RoleManaged: managed}
			if err := tx.Select("Username", "Password", "RoleId", "Enabled", "CreatedAt", "UpdatedAt", "Email", "AuthSource", "RoleManaged").Create(&user).Error; err != nil {
				return err
			}
			if err := tx.Create(&model.UserIdentity{UserId: user.Id, ProviderId: p.Id, Subject: id.Subject, Email: id.Email, EmailVerified: id.EmailVerified,
				DisplayName: id.Name, Groups: encodeGroups(id.Groups), CreatedAt: now, LastLoginAt: now}).Error; err != nil {
				return err
			}
			role := afterRole
			events = append(events, func() {
				Audit.Record(s.actorFor(&user, ip), "auth.sso_signup", "user", fmt.Sprint(user.Id), user.Username, nil, map[string]any{"provider": p.Key, "role": role.Name, "email": id.Email}, "ok", "")
			})
			return nil
		}
		upd := map[string]any{"updated_at": now}
		if id.Email != "" && id.EmailVerified && user.Email == "" {
			upd["email"] = strings.ToLower(id.Email)
		}
		if assign != nil && (user.RoleId == nil || *assign != *user.RoleId) {
			upd["role_id"] = *assign
		}
		if managed != user.RoleManaged {
			upd["role_managed"] = managed
		}
		if user.AuthSource == "" && !found {
			// stays local: the account existed before the provider did
		}
		if err := tx.Model(&model.User{}).Where("id = ?", user.Id).Updates(upd).Error; err != nil {
			return err
		}
		if found {
			tx.Model(&model.UserIdentity{}).Where("id = ?", ident.Id).Updates(map[string]any{"email": id.Email, "email_verified": id.EmailVerified,
				"display_name": id.Name, "groups": encodeGroups(id.Groups), "last_login_at": now})
		} else if err := tx.Create(&model.UserIdentity{UserId: user.Id, ProviderId: p.Id, Subject: id.Subject, Email: id.Email, EmailVerified: id.EmailVerified,
			DisplayName: id.Name, Groups: encodeGroups(id.Groups), CreatedAt: now, LastLoginAt: now}).Error; err != nil {
			return err
		}
		if v, ok := upd["role_id"]; ok {
			newID := v.(int)
			uid, uname, old := user.Id, user.Username, beforeRole.Name
			newName := afterRole.Name
			events = append(events, func() {
				InvalidateRBAC()
				Audit.Record(s.actorFor(&model.User{Id: uid, Username: uname}, ip), "auth.role_sync", "user", fmt.Sprint(uid), uname,
					map[string]any{"role": old}, map[string]any{"role": newName, "roleId": newID, "groups": id.Groups}, "ok", "role changed by "+p.Key)
			})
			rid := newID
			user.RoleId = &rid
		}
		if !found {
			events = append(events, func() {
				Audit.Record(s.actorFor(&user, ip), "auth.identity_link", "user", fmt.Sprint(user.Id), user.Username, nil, map[string]any{"provider": p.Key, "by": "verified e-mail"}, "ok", "")
			})
		}
		return nil
	})
	for _, ev := range events {
		ev()
	}
	if err != nil {
		return nil, err
	}
	if denial != nil {
		return nil, denial
	}
	logger.WithComponent("audit").Infof("sso sign-in %s via %s", user.Username, p.Key)
	return &user, nil
}

func encodeGroups(g []string) string {
	if g == nil {
		g = []string{}
	}
	if len(g) > 200 {
		g = g[:200]
	}
	b, _ := json.Marshal(g)
	return string(b)
}

var _ = rbac.Wildcard

// RedirectBase is the pinned public address of the panel for this provider's callback URL, if the admin set one.
func (s *SSOService) RedirectBase(p *model.AuthProvider) string {
	var sc storedConfig
	_ = json.Unmarshal([]byte(p.Config), &sc)
	return sc.Overrides.RedirectBase
}
