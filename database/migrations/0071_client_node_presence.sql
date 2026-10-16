-- Persistent per-node presence of clients ("last connection node").
-- Keyed by client_id (not by name): the Xray email == client_entities.name, but ids survive
-- name collisions across users and cascade cleanly. Rows are removed only together with the client or the node.
CREATE TABLE IF NOT EXISTS client_node_presence (
    client_id     INTEGER NOT NULL REFERENCES client_entities(id) ON DELETE CASCADE,
    node_id       INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    first_seen_at BIGINT NOT NULL DEFAULT 0,
    last_seen_at  BIGINT NOT NULL DEFAULT 0,
    sessions      BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT uq_client_node_presence_pair PRIMARY KEY (client_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_client_node_presence_node_id ON client_node_presence(node_id);
CREATE INDEX IF NOT EXISTS idx_client_node_presence_last_seen ON client_node_presence(last_seen_at);
