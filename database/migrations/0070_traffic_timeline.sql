-- Preserve existing traffic counters. Only add a timeline and initial snapshots.
CREATE TABLE IF NOT EXISTS traffic_history_origins (
    kind VARCHAR(8) NOT NULL,
    entity_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL DEFAULT -1,
    up BIGINT NOT NULL DEFAULT 0,
    down BIGINT NOT NULL DEFAULT 0,
    started_at BIGINT NOT NULL,
    PRIMARY KEY (kind, entity_id, node_id)
);
CREATE TABLE IF NOT EXISTS traffic_history_buckets (
    kind VARCHAR(8) NOT NULL,
    entity_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL DEFAULT -1,
    resolution INTEGER NOT NULL,
    bucket BIGINT NOT NULL,
    up BIGINT NOT NULL DEFAULT 0,
    down BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, entity_id, node_id, resolution, bucket)
);
CREATE INDEX IF NOT EXISTS idx_traffic_history_range ON traffic_history_buckets (kind, entity_id, resolution, bucket);
CREATE INDEX IF NOT EXISTS idx_traffic_history_retention ON traffic_history_buckets (resolution, bucket);
CREATE TABLE IF NOT EXISTS traffic_history_coverage (
    kind VARCHAR(8) NOT NULL,
    entity_id INTEGER NOT NULL,
    resolution INTEGER NOT NULL,
    bucket BIGINT NOT NULL,
    PRIMARY KEY (kind, entity_id, resolution, bucket)
);
CREATE INDEX IF NOT EXISTS idx_traffic_history_coverage_retention ON traffic_history_coverage (resolution,bucket);
INSERT INTO traffic_history_origins (kind,entity_id,node_id,up,down,started_at)
SELECT 'client',id,-1,up,down,(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)*1000)::BIGINT FROM client_entities
ON CONFLICT DO NOTHING;
INSERT INTO traffic_history_origins (kind,entity_id,node_id,up,down,started_at)
SELECT 'client',client_id,node_id,down,up,(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)*1000)::BIGINT FROM client_node_traffics
ON CONFLICT DO NOTHING;
INSERT INTO traffic_history_origins (kind,entity_id,node_id,up,down,started_at)
SELECT 'node',id,-1,up,down,(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)*1000)::BIGINT FROM nodes
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS traffic_history_imports (
    import_key VARCHAR(64) PRIMARY KEY,
    applied_at BIGINT NOT NULL
);
