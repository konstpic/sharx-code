-- Bundles: an ordered set of hosts a client gets; access is derived from the hosts' inbounds.
-- See docs/architecture/bundles.md. Additive only: nothing here changes how the panel behaves until the automatic
-- conversion has verified itself and switched (setting bundlesEnabled).

-- Self-heal installs whose balancer_pools lost its primary key. This normally can't happen from
-- a fresh install, but a DB restored from a dump made without pg_dump (the panel's GORM-based
-- export fallback, used when pg_dump is unavailable) recreates tables from information_schema
-- columns only, silently dropping every primary key, unique index and FK. Without this, the
-- ALTER TABLE below fails with "no unique constraint matching given keys for referenced table"
-- the moment such a database reaches this migration. Checked on the id column specifically: a
-- table can have an unrelated unique constraint (e.g. uq_balancer_pool_inbound below) and still
-- be missing id's own primary key.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'balancer_pools')
       AND NOT EXISTS (
           SELECT 1 FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
           WHERE c.conrelid = 'public.balancer_pools'::regclass
             AND c.contype IN ('p', 'u')
             AND cardinality(c.conkey) = 1
             AND a.attname = 'id'
       ) THEN
        RAISE NOTICE 'Repairing balancer_pools: missing primary key (restored from an incomplete dump)';
        ALTER TABLE balancer_pools ADD PRIMARY KEY (id);
    END IF;
END $$;

-- Hosts become the unit of delivery. Existing rows keep kind = 'legacy' and stay exactly as they were.
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'legacy';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS inbound_id INTEGER NULL REFERENCES inbounds(id) ON DELETE CASCADE;
-- No cascade on node and pool: deleting a node must not silently take clients' access with it. The host sync removes
-- orphaned managed hosts and keeps access (see web/service/host_sync.go).
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS node_id INTEGER NULL REFERENCES nodes(id) ON DELETE SET NULL;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS pool_id INTEGER NULL REFERENCES balancer_pools(id) ON DELETE SET NULL;
-- Re-assert these three FKs even when their column already existed: "ADD COLUMN IF NOT EXISTS
-- ... REFERENCES" only attaches the constraint while creating the column, so on a database where
-- the column survived a corrupted restore (above) but its FK didn't, the ALTER TABLE lines just
-- above silently do nothing -- this is what actually leaves pool_id permanently unconstrained
-- once the referenced table's primary key is repaired.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.hosts'::regclass AND conname = 'hosts_inbound_id_fkey') THEN
        ALTER TABLE hosts ADD CONSTRAINT hosts_inbound_id_fkey FOREIGN KEY (inbound_id) REFERENCES inbounds(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.hosts'::regclass AND conname = 'hosts_node_id_fkey') THEN
        ALTER TABLE hosts ADD CONSTRAINT hosts_node_id_fkey FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.hosts'::regclass AND conname = 'hosts_pool_id_fkey') THEN
        ALTER TABLE hosts ADD CONSTRAINT hosts_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES balancer_pools(id) ON DELETE SET NULL;
    END IF;
END $$;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'manual';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS customized BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS remark_suffix TEXT NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS server_description TEXT NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_hosts_inbound ON hosts(inbound_id);
-- One managed host per placement / pool.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hosts_placement ON hosts(inbound_id, node_id) WHERE kind = 'placement';
CREATE UNIQUE INDEX IF NOT EXISTS uq_hosts_pool ON hosts(pool_id) WHERE kind = 'pool';
-- One 'local' host per inbound: the inbound served by the panel itself (address resolved per request).
CREATE UNIQUE INDEX IF NOT EXISTS uq_hosts_local ON hosts(inbound_id) WHERE kind = 'local';

CREATE TABLE IF NOT EXISTS bundles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 0,
    name VARCHAR(255) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    enable BOOLEAN NOT NULL DEFAULT TRUE,
    auto BOOLEAN NOT NULL DEFAULT FALSE,
    auto_key VARCHAR(64) NOT NULL DEFAULT '',
    follow_placements BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bundles_auto_key ON bundles(auto_key) WHERE auto_key <> '';

CREATE TABLE IF NOT EXISTS bundle_hosts (
    id SERIAL PRIMARY KEY,
    bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
    host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_bundle_host UNIQUE (bundle_id, host_id)
);
CREATE INDEX IF NOT EXISTS idx_bundle_hosts_host ON bundle_hosts(host_id);

CREATE TABLE IF NOT EXISTS client_bundles (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES client_entities(id) ON DELETE CASCADE,
    bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_client_bundle UNIQUE (client_id, bundle_id)
);
CREATE INDEX IF NOT EXISTS idx_client_bundles_bundle ON client_bundles(bundle_id);
