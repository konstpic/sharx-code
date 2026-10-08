-- Single sign-on: external identity providers (OIDC / OAuth 2.0), linked identities, role-mapping rules.
--
-- Compatible with the previous version: the old binary ignores the new tables and the new users columns. Rollback: deploy the
-- previous version. Optional cleanup:
--   DROP TABLE auth_role_rules; DROP TABLE user_identities; DROP TABLE auth_providers;
--   ALTER TABLE users DROP COLUMN email, DROP COLUMN auth_source, DROP COLUMN role_managed;

CREATE TABLE IF NOT EXISTS auth_providers (
    id SERIAL PRIMARY KEY,
    -- URL-safe identifier used in redirect URIs: /auth/sso/<key>/callback
    key VARCHAR(64) NOT NULL,
    name VARCHAR(100) NOT NULL,
    -- preset id (authentik, google, github, ... or "oidc" / "oauth2" for a manual setup)
    preset VARCHAR(32) NOT NULL DEFAULT 'oidc',
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    client_id TEXT NOT NULL DEFAULT '',
    -- sealed with AES-GCM (enc:v1:...), never returned by the API
    client_secret TEXT NOT NULL DEFAULT '',
    -- JSON: issuer, endpoints, scopes, PKCE, claim mapping
    config TEXT NOT NULL DEFAULT '{}',
    allowed_domains TEXT NOT NULL DEFAULT '[]',
    allowed_emails TEXT NOT NULL DEFAULT '[]',
    -- may a person who has no account create one by signing in?
    allow_signup BOOLEAN NOT NULL DEFAULT FALSE,
    -- may a verified e-mail link a sign-in to an existing local account? (off by default: account takeover risk)
    link_by_email BOOLEAN NOT NULL DEFAULT FALSE,
    -- who owns the role: 'local' (panel administrators) or 'idp' (rules below, re-applied at every sign-in)
    role_mode VARCHAR(8) NOT NULL DEFAULT 'local',
    -- when no rule matches: 'deny', 'default' (default_role_id) or 'keep' (leave the current role)
    no_match VARCHAR(8) NOT NULL DEFAULT 'deny',
    default_role_id INTEGER,
    created_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_providers_key ON auth_providers (LOWER(key));

CREATE TABLE IF NOT EXISTS user_identities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    provider_id INTEGER NOT NULL,
    -- the provider's stable user id (the "sub" claim); the e-mail is never an identity
    subject TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    display_name TEXT NOT NULL DEFAULT '',
    -- groups seen at the last sign-in (JSON array), for the admin view
    groups TEXT NOT NULL DEFAULT '[]',
    created_at BIGINT NOT NULL DEFAULT 0,
    last_login_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_identities_subject ON user_identities (provider_id, subject);
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities (user_id);

CREATE TABLE IF NOT EXISTS auth_role_rules (
    id SERIAL PRIMARY KEY,
    -- NULL = applies to every provider
    provider_id INTEGER,
    -- lower position wins
    position INTEGER NOT NULL DEFAULT 0,
    -- group | claim | email_domain | email | any
    kind VARCHAR(16) NOT NULL,
    claim TEXT NOT NULL DEFAULT '',
    value TEXT NOT NULL DEFAULT '',
    role_id INTEGER NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_auth_role_rules_provider ON auth_role_rules (provider_id, position);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
-- 'local' or the key of the provider that created the account
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_source VARCHAR(64) NOT NULL DEFAULT 'local';
-- the role is set by the identity provider's rules; panel administrators cannot change it by hand
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_managed BOOLEAN NOT NULL DEFAULT FALSE;
