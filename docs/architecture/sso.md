# Single sign-on: OpenID Connect and OAuth 2.0

Status: **stage 1 is implemented** (this document describes it). Later stages are listed at the end with what they need.

## Where this sits in the existing panel

| Piece | Before | Now |
|---|---|---|
| Users, roles, permissions | `users`, `roles` (v2.6.0 RBAC), `resource:action` keys, server-side check of every route | unchanged; SSO only decides *which user* and *which role* |
| Sign-in | password (+ LDAP bind, + TOTP per user, + Telegram code) | the same, **plus** redirect sign-in through any configured provider |
| Session | gorilla cookie session + `login_sessions` registry | the same session is created after a successful SSO callback; revocation (`revokeAccess`) works for SSO users too |
| Audit | `audit_log` + the audit journal | SSO events are audited (`auth.*`, `sso.*`) and read like the other journals |
| Secrets | settings table | provider client secrets are sealed with AES-256-GCM (key derived from the panel secret) and never returned by the API |

The panel is a single-tenant application (one set of nodes, clients and settings), so *organizations / tenants / projects* are not a model entity yet; see "Later stages".

## Model

```
users (id, username, email, auth_source, role_id, role_managed, enabled, ...)
   │ 1
   │ n
user_identities (user_id, provider_id, subject, email, email_verified, groups, last_login_at)   UNIQUE(provider_id, subject)
   │ n
   │ 1
auth_providers (key, name, preset, enabled, client_id, client_secret(sealed), config, allowed_domains, allowed_emails,
                allow_signup, link_by_email, role_mode, no_match, default_role_id)
   │ 1
   │ n
auth_role_rules (provider_id | NULL, position, kind, claim, value, role_id, enabled)
```

* **User** – a person with a role (existing). New columns: `email`, `auth_source` (`local` or the provider key that created it), `role_managed`.
* **Identity** – an account at a provider, identified by `(provider, subject)` where *subject* is the provider's stable id (`sub`). **An e-mail address is never an identity.** A user can hold several identities, at most one per provider.
* **Provider** – configuration of one OIDC / OAuth 2.0 server. Adding a provider is a configuration task: a *preset* (a Go table entry, or the generic `oidc` / `oauth2` preset configured by hand in the UI) supplies endpoints, scopes and claim names; the engine is the same for all.
* **Role rule** – maps an attribute of the identity (group, claim, e-mail domain, exact e-mail, or "everybody") to a role. First enabled match wins (provider-specific rules before global ones, then by position).
* **Session / OAuth connection** – the panel keeps no provider tokens: the access token is used once (user info) and dropped; there is no refresh token to rotate in stage 1 (see stage 2). The session is the existing cookie session.

## Sign-in flow (authorization code + PKCE)

1. `GET /auth/sso/<key>/start` – checks the provider is enabled, runs discovery, creates a server-side flow (`state`, `nonce`, PKCE verifier, redirect URI, a random *binding* that is also written to the browser session) and redirects to the provider. 30 starts per minute per IP.
2. The person authenticates at the provider (its MFA applies).
3. `GET /auth/sso/<key>/callback?code&state` –
   * the `state` must exist, be unexpired, be used once, belong to this provider **and** match the binding in this browser's session (defeats login CSRF and fixation);
   * code exchange at the token endpoint with PKCE and client authentication (basic or post);
   * the **ID token is validated**: signature against the provider's JWKS (RS/PS/ES algorithms only – `none` and HMAC are refused, keys under 2048 bits are refused), `iss`, `aud` (and `azp` when there are several), `exp` (required), `iat`, `nonce`;
   * discovery's `issuer` must equal the configured issuer;
   * claims that are not in the ID token (groups) come from the user-info endpoint, whose `sub` must equal the ID token's;
   * the identity is resolved (below), the role decided, the session created.
4. Failures redirect to the login page with a short code (`?sso_error=no_access`) and are written to the audit trail (`auth.sso_denied`).

## Resolving the identity (account linking without takeover)

1. Known `(provider, subject)` → that user.
2. Unknown identity, **signed-in user linking** (Settings → Security → Single sign-on accounts) → attached to that user, once per provider; an identity that already belongs to somebody else is refused, never moved.
3. Unknown identity, provider has **link by e-mail** on, the e-mail is **verified**, exactly **one** account carries that address and has no identity at this provider → attached. Anything else (unverified, ambiguous, second identity) does not link.
4. Otherwise, if **self-registration** is on → a new user is created (random unusable password, role from the policy below). If it is off → refused.

Allow-lists (domains / addresses) apply to creation and linking and count only verified addresses. A disabled or deleted account stays refused whatever the provider says.

## Roles: who is the source of truth

Per provider, `role_mode`:

* `local` – administrators assign roles in *Users*. New SSO accounts get the provider's default role; the provider never changes a role afterwards.
* `idp` – the provider's rules decide, **at every sign-in**. The account is marked `role_managed`; changing its role by hand is refused (409) until an administrator presses *Manage the role locally* (detach), after which the provider stops touching it.

When no rule matches (`no_match`): `deny` (default, deny-by-default), `default` (default role) or `keep`.

Revocation: if a managed user's rules no longer match and the policy is `deny`, the role is **removed**, all their sessions and API tokens end, and sign-in is refused – the effect of removing someone from a group in the provider. Safeguards: the last enabled administrator is never demoted or revoked by the provider (the attempt is audited as denied); an unconditional rule ("everybody") cannot grant an administrator role; rules based on e-mail require a verified address.

Managing providers and rules needs `auth:manage`, which only administrators can hold or grant (like the LDAP settings): whoever can write a rule can make anybody an administrator.

## Where role changes in the provider take effect

| Event in the provider | Effect in the panel |
|---|---|
| user's groups change | next sign-in (the role is re-evaluated) |
| user removed from every mapped group | next sign-in: role revoked, sessions ended |
| user deactivated in the provider | **not detected** until they try to sign in again; their open session lives until it expires (`Session max age`). Keep that short when the provider is the source of truth, or disable the user in the panel |
| webhook / SCIM push | **not in stage 1** (see stage 2) |

## Other security properties

* Client secrets: sealed at rest, write-only through the API, never in the audit trail (only "secret set").
* Provider URLs must be `https` (plain `http` only for loopback, for development).
* Calls to providers: 12 s timeout, 1 MiB response cap, no https→http redirects.
* Public endpoints (`/auth/providers`, `/auth/sso/*`) are rate limited per IP; the provider list shows only key and name.
* Cookies: the session cookie is HttpOnly, SameSite=Lax (needed for the redirect back from the provider); sign-in state never lives in a cookie – only the opaque binding value does.
* CORS: the panel does not enable cross-origin access; the flow is plain browser redirects.
* MFA: sign-in through a provider relies on the provider's own MFA. The panel's local TOTP applies to password sign-in. Password sign-in can be closed for non-administrators (*Allow password sign-in for everybody* off); administrators keep it as the way back in when the provider is down.
* Every event is audited: `auth.sso_login`, `auth.sso_signup`, `auth.sso_denied`, `auth.role_sync`, `auth.role_revoke`, `auth.identity_link`, `auth.identity_unlink`, `sso.provider_*`, `sso.rule_*`, `sso.local_login`.

## Redirect URIs

The redirect URI is `<panel address><base path>auth/sso/<key>/callback`, for example `https://panel.example.com:2053/auth/sso/authentik/callback`, or with a secret path `https://panel.example.com/x7k2/auth/sso/authentik/callback`. The provider form shows it (and has a copy button). It must be registered at the provider **exactly**. If the panel is behind a proxy that hides the real address, set *Public address of the panel* under Advanced.

| Provider | key (default) | Redirect URI |
|---|---|---|
| Authentik | `authentik` | `…/auth/sso/authentik/callback` |
| Keycloak | `keycloak` | `…/auth/sso/keycloak/callback` |
| Google | `google` | `…/auth/sso/google/callback` |
| Microsoft / Entra ID | `microsoft` | `…/auth/sso/microsoft/callback` |
| GitHub | `github` | `…/auth/sso/github/callback` |
| GitLab | `gitlab` | `…/auth/sso/gitlab/callback` |
| Auth0 / Okta / LinkedIn / Discord / Facebook / Yandex ID | preset id | `…/auth/sso/<key>/callback` |
| any OIDC / OAuth 2.0 | whatever you choose | `…/auth/sso/<key>/callback` |

## Setting up Authentik

1. In Authentik create a **Provider → OAuth2/OpenID Provider**:
   * Client type **Confidential**; copy the client ID and secret.
   * **Redirect URIs/Origins (RegEx)**: the panel's callback URI, matched strictly (escape dots, anchor it: `^https://panel\.example\.com:2053/auth/sso/authentik/callback$`).
   * **Subject mode**: *Based on the User's hashed ID* (the default). Do not choose an e-mail or username based mode: the subject must never change or be reassignable, it is the identity.
   * **Scopes**: `openid`, `email`, `profile` (the default *profile* mapping carries the `groups` claim).
   * Choose a signing key (RS256).
2. Create an **Application** with a slug (for example `sharx`) and bind the provider; restrict who may open it with a group policy.
3. Create groups, for example `sharx-admins`, `sharx-operators`, `sharx-viewers`.
4. In the panel: **Users & roles → Single sign-on → Add provider → Authentik**: Authentik URL (`https://auth.example.com`), slug, client ID, secret. Press the flask icon to check discovery and keys.
5. Choose *Who sets the role → The provider*, *When no rule matches → Refuse access*, and add rules:

   | When | Value | Role |
   |---|---|---|
   | group | `sharx-admins` | Administrator |
   | group | `sharx-operators` | Operator (custom role) |
   | group | `sharx-viewers` | Viewer (custom role) |

   Order matters: put the most privileged first, because the first match decides.
6. Tick *Create an account at the first sign-in* if anybody in those groups may enter without an account being prepared. Otherwise create the user first and link it (Settings → Security → *Single sign-on accounts*), or turn on *link by verified e-mail* **only** if Authentik does not let users edit their own e-mail (its default e-mail scope reports `email_verified: true`).
7. Migrating existing administrators: create the Authentik provider with *local* roles, have each administrator link their own account from Settings, and only then close password sign-in for non-administrators.

## Setting up other providers

Every provider needs a Client ID and secret and the redirect URI above. What differs:

* **Keycloak** – URL + realm. Add a *Group Membership* mapper (token claim name `groups`, full path off) to the client; realm roles are in `realm_access.roles` (a *claim* rule: claim `realm_access.roles`, value `sharx-admin`).
* **Google** – *APIs & Services → Credentials → OAuth client (Web)*. No groups. Restrict to a Workspace with *Allowed e-mail domains*.
* **Microsoft / Entra ID** – register an app, redirect type *Web*; use the **tenant id** (not `common`, the issuer must be exact). Add the optional `groups` claim in *Token configuration* (group object ids).
* **GitHub** – OAuth App (not GitHub App). OAuth 2.0 only; the primary verified e-mail is used. Subject is the numeric user id.
* **GitLab** – Application with scopes `openid profile email`; self-hosted: set the URL. `groups` claim lists group paths.
* **Auth0** – domain; put roles into a namespaced claim with an Action and set *Claim with groups* to it under Advanced.
* **Okta** – domain (+ authorization server, e.g. `default`); add a *Groups* claim to the authorization server.
* **LinkedIn** – *Sign In with LinkedIn using OpenID Connect* product. No groups.
* **Discord / Facebook** – OAuth 2.0 identity only; Facebook does not say whether an e-mail is verified, so it never links or satisfies allow-lists.
* **Yandex ID** – OAuth 2.0; scopes `login:email login:info`; addresses are verified.
* **Any OpenID Connect provider** – preset *OpenID Connect (manual)*: issuer URL; endpoints come from discovery, or override them under Advanced.
* **Any OAuth 2.0 provider** – preset *OAuth 2.0 (manual)*: authorization, token and user-info endpoints; map the claims (user id, e-mail, username, groups) to the JSON field names of the user-info answer.

## Claim and role mapping examples

Keycloak realm roles → panel roles:

```
kind=claim  claim=realm_access.roles  value=sharx-admin     → Administrator
kind=claim  claim=realm_access.roles  value=sharx-support   → Support
```

Company domain gets a read-only role, one named person is an administrator (rules are ordered):

```
1  kind=email         value=ann@corp.example               → Administrator
2  kind=email_domain  value=corp.example                   → Viewer
```

Prefix match for team groups:

```
kind=group  value=sharx-ops-*   → Operator
```

## Tests

`web/authn` (fake OpenID provider: full flow, PKCE enforced by the provider, every ID-token failure mode, `none`/HS256 refusal, discovery issuer check, sealing, single-use state, rules, presets); `web/service/sso_test.go` (first sign-in with role from rules, signup off/on, deny-by-default, demotion and revocation at the next sign-in, last administrator, "everybody → administrator" refused, managed role locked and detach, local-role mode, account-takeover attempts through e-mail linking, several identities per user, allow-lists, disabled users, audit); `web/controller/sso_http_test.go` (whole flow over HTTP with a session, forged / replayed / foreign-browser callbacks, provider-initiated errors, linking flow, only administrators manage providers and no role can be given `auth:manage`, secrets never in responses, password sign-in switch); `database/rbac_migration_test.go` (migration on an existing database, idempotent, old binary still works).

## Later stages

* **Stage 2 – providers that need their own adapter and token lifecycle.** Sign in with Apple (JWT client secret, `form_post`), VK ID (POST user info, device id), Telegram Login (signed widget payload). Refresh-token based re-sync (`offline_access`, rotation on every use, revocation on use after rotation) so a role removal or deactivation in the provider takes effect without a new sign-in; an Authentik webhook / SCIM endpoint (HMAC-signed) for push changes and deactivation.
* **Stage 3 – other methods.** E-mail + password with self-registration and e-mail confirmation, magic links (needs SMTP), passkeys / WebAuthn and hardware keys (`go-webauthn`), recovery codes, MFA policy (required for an organization, a role or a user).
* **Stage 4 – scopes of authority.** Groups, organizations / tenants / projects as entities, resource-level permissions (for example per node or per client group) on top of the existing `resource:action` model; the route table and `Principal` already centralize the check, so this extends them rather than replacing them.

Rollback: deploy the previous version. The new tables and columns are ignored by it; accounts created through SSO have an unusable random password and so cannot sign in with the old version until an administrator sets one. Optional cleanup is in `database/migrations/0066_sso.sql`.
