-- Role-based access control: roles, per-user role/status, and an audit trail of access-control changes.
--
-- Compatible with the previous version: the old binary reads and writes only users(id, username, password) by column name,
-- so the new columns and tables are ignored by it. Rollback (see docs/architecture/rbac.md): deploy the old version; the
-- tables and columns can stay. Dropping them is optional:
--   DROP TABLE audit_log; ALTER TABLE users DROP COLUMN role_id, DROP COLUMN enabled, DROP COLUMN deleted_at,
--     DROP COLUMN created_at, DROP COLUMN updated_at, DROP COLUMN last_login_at; DROP TABLE roles;

CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- is_system roles are built in: they cannot be edited or deleted, not even through the API.
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    -- a stable identifier of a built-in role, independent of its display name
    system_key VARCHAR(50),
    -- JSON array of permission keys ("clients:read"), or ["*"] for everything
    permissions TEXT NOT NULL DEFAULT '[]',
    created_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_name_lower ON roles (LOWER(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_system_key ON roles (system_key) WHERE system_key IS NOT NULL;

INSERT INTO roles (name, description, is_system, system_key, permissions, created_at, updated_at)
SELECT 'Administrator', 'Full access to everything, including access control', TRUE, 'administrator', '["*"]',
       EXTRACT(EPOCH FROM NOW())::BIGINT, EXTRACT(EPOCH FROM NOW())::BIGINT
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE system_key = 'administrator');

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at BIGINT;
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users (role_id);

-- Everyone who can sign in today keeps full access: every existing user becomes an Administrator.
UPDATE users
SET role_id = (SELECT id FROM roles WHERE system_key = 'administrator'),
    created_at = CASE WHEN created_at = 0 THEN EXTRACT(EPOCH FROM NOW())::BIGINT ELSE created_at END
WHERE role_id IS NULL;

-- Usernames are unique among users that are not deleted (case-insensitive). The service enforces this too; the index is a
-- safety net and is skipped, not fatal, if legacy data already contains duplicates.
DO $rbac$
BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_active ON users (LOWER(username)) WHERE deleted_at IS NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'rbac: duplicate usernames, unique index not created';
END
$rbac$;

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    ts BIGINT NOT NULL,
    actor_id INTEGER,
    -- snapshots: the user may be renamed or deleted later, the trail must still say who acted
    actor_name VARCHAR(255) NOT NULL DEFAULT '',
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NOT NULL DEFAULT '',
    target_id VARCHAR(64) NOT NULL DEFAULT '',
    target_name VARCHAR(255) NOT NULL DEFAULT '',
    before_state TEXT,
    after_state TEXT,
    ip VARCHAR(64) NOT NULL DEFAULT '',
    -- ok, or denied (an attempt that was refused)
    result VARCHAR(16) NOT NULL DEFAULT 'ok',
    detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id);
