-- When an operator deletes an auto-managed host (kind = placement or pool), host_sync.go used to recreate it on
-- the very next reconcile (every 30s, or on any mutation), because it only looks at the current inbound/node/pool
-- facts and has no memory of "an operator explicitly removed the host for this one". This table is that memory:
-- one row per (inbound, node) or pool that must NOT get an auto-created host again. Rows are identified by the
-- referenced entity's id, so they naturally stop mattering once that inbound/node/pool is itself deleted (cascade).
CREATE TABLE IF NOT EXISTS host_sync_suppressions (
    id SERIAL PRIMARY KEY,
    kind VARCHAR(16) NOT NULL, -- 'placement' | 'pool'
    inbound_id INTEGER NULL REFERENCES inbounds(id) ON DELETE CASCADE,
    node_id INTEGER NULL REFERENCES nodes(id) ON DELETE CASCADE,
    pool_id INTEGER NULL REFERENCES balancer_pools(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_host_sync_suppr_placement ON host_sync_suppressions(inbound_id, node_id) WHERE kind = 'placement';
CREATE UNIQUE INDEX IF NOT EXISTS uq_host_sync_suppr_pool ON host_sync_suppressions(pool_id) WHERE kind = 'pool';
