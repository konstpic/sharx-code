-- Sign-in methods (stage 3): one-time e-mail tokens (magic link, registration confirmation, password reset), passkeys,
-- recovery codes, and "MFA required" flags on roles and users.
--
-- Compatible with the previous version (new tables and columns are ignored by it). Optional cleanup:
--   DROP TABLE auth_tokens; DROP TABLE user_passkeys; DROP TABLE user_recovery_codes;
--   ALTER TABLE roles DROP COLUMN require_mfa; ALTER TABLE users DROP COLUMN require_mfa;

-- One-time tokens sent by e-mail. Only a hash of the token is stored: a copy of the database cannot be used to sign in.
CREATE TABLE IF NOT EXISTS auth_tokens (
    id SERIAL PRIMARY KEY,
    -- magic | reset | signup
    kind VARCHAR(16) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    user_id INTEGER,
    email TEXT NOT NULL DEFAULT '',
    -- JSON for kind=signup: what the account will be created with (the password is already hashed)
    payload TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL DEFAULT 0,
    expires_at BIGINT NOT NULL DEFAULT 0,
    used_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_tokens_hash ON auth_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_email ON auth_tokens (kind, LOWER(email), created_at);

CREATE TABLE IF NOT EXISTS user_passkeys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL DEFAULT '',
    -- WebAuthn credential id (base64url) and the whole credential as JSON (public key, sign counter, flags, transports)
    credential_id VARCHAR(512) NOT NULL,
    credential TEXT NOT NULL,
    created_at BIGINT NOT NULL DEFAULT 0,
    last_used_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_passkeys_credential ON user_passkeys (credential_id);
CREATE INDEX IF NOT EXISTS idx_user_passkeys_user ON user_passkeys (user_id);

CREATE TABLE IF NOT EXISTS user_recovery_codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    code_hash VARCHAR(64) NOT NULL,
    created_at BIGINT NOT NULL DEFAULT 0,
    used_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_user_recovery_codes_user ON user_recovery_codes (user_id);

ALTER TABLE roles ADD COLUMN IF NOT EXISTS require_mfa BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS require_mfa BOOLEAN NOT NULL DEFAULT FALSE;
