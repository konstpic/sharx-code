-- Organizations (tenants): a named set of users and client groups. An account that belongs to an organization can see and act
-- only on the client groups of that organization and on the clients in them (resource-level scope).
--
-- Compatible with the previous version (the new columns are ignored by it, and every existing user and group stays unscoped).
-- Optional cleanup:
--   ALTER TABLE users DROP COLUMN org_id; ALTER TABLE client_groups DROP COLUMN org_id; DROP TABLE organizations;

CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_name_lower ON organizations (LOWER(name));

ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id INTEGER;
ALTER TABLE client_groups ADD COLUMN IF NOT EXISTS org_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_client_groups_org ON client_groups (org_id);
