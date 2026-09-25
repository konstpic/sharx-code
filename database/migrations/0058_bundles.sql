-- Bundles: an ordered set of hosts a client gets; access is derived from the hosts' inbounds.
-- See docs/architecture/bundles.md. Additive only: nothing here changes how the panel behaves until the automatic
-- conversion has verified itself and switched (setting bundlesEnabled).

-- Hosts become the unit of delivery. Existing rows keep kind = 'legacy' and stay exactly as they were.
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'legacy';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS inbound_id INTEGER NULL REFERENCES inbounds(id) ON DELETE CASCADE;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS node_id INTEGER NULL REFERENCES nodes(id) ON DELETE CASCADE;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS pool_id INTEGER NULL REFERENCES balancer_pools(id) ON DELETE CASCADE;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'manual';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS customized BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS remark_suffix TEXT NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS server_description TEXT NOT NULL DEFAULT '';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_hosts_inbound ON hosts(inbound_id);
-- One managed host per placement / pool.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hosts_placement ON hosts(inbound_id, node_id) WHERE kind = 'placement';
CREATE UNIQUE INDEX IF NOT EXISTS uq_hosts_pool ON hosts(pool_id) WHERE kind = 'pool';

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
