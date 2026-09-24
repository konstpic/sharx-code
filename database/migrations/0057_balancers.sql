-- Edge load balancers (HAProxy / nginx stream) in front of nodes. See docs/architecture/balancer.md.
CREATE TABLE IF NOT EXISTS balancers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL DEFAULT '',
    address VARCHAR(255) NOT NULL DEFAULT '',
    api_address VARCHAR(255) NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '',
    engine VARCHAR(16) NOT NULL DEFAULT 'haproxy',
    enable BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(16) NOT NULL DEFAULT 'unknown',
    last_check BIGINT NOT NULL DEFAULT 0,
    response_time BIGINT NOT NULL DEFAULT 0,
    agent_version VARCHAR(64) NOT NULL DEFAULT '',
    engine_version VARCHAR(64) NOT NULL DEFAULT '',
    config_hash VARCHAR(64) NOT NULL DEFAULT '',
    applied_hash VARCHAR(64) NOT NULL DEFAULT '',
    last_applied_at BIGINT NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS balancer_pools (
    id SERIAL PRIMARY KEY,
    balancer_id INTEGER NOT NULL REFERENCES balancers(id) ON DELETE CASCADE,
    inbound_id INTEGER NOT NULL REFERENCES inbounds(id) ON DELETE CASCADE,
    listen_port INTEGER NOT NULL DEFAULT 0,
    algorithm VARCHAR(16) NOT NULL DEFAULT 'roundrobin',
    proxy_protocol BOOLEAN NOT NULL DEFAULT FALSE,
    health_check BOOLEAN NOT NULL DEFAULT TRUE,
    sub_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sub_mode VARCHAR(16) NOT NULL DEFAULT 'prepend',
    auto_members BOOLEAN NOT NULL DEFAULT TRUE,
    enable BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_balancer_pool_inbound UNIQUE (balancer_id, inbound_id)
);
CREATE INDEX IF NOT EXISTS idx_balancer_pools_inbound ON balancer_pools(inbound_id);

CREATE TABLE IF NOT EXISTS balancer_pool_members (
    id SERIAL PRIMARY KEY,
    pool_id INTEGER NOT NULL REFERENCES balancer_pools(id) ON DELETE CASCADE,
    node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    weight INTEGER NOT NULL DEFAULT 1,
    backup BOOLEAN NOT NULL DEFAULT FALSE,
    enable BOOLEAN NOT NULL DEFAULT TRUE,
    address_override VARCHAR(255) NOT NULL DEFAULT '',
    port_override INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_balancer_pool_member UNIQUE (pool_id, node_id)
);

CREATE OR REPLACE FUNCTION set_balancers_sort_order() RETURNS trigger AS $$
BEGIN
    IF NEW.sort_order = 0 THEN
        SELECT COALESCE(MAX(sort_order), 0) + 1 INTO NEW.sort_order FROM balancers;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_balancers_sort_order ON balancers;
CREATE TRIGGER trg_balancers_sort_order BEFORE INSERT ON balancers
    FOR EACH ROW EXECUTE FUNCTION set_balancers_sort_order();
