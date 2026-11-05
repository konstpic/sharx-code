-- Migration: SharX Network panel-side tables (sn_* prefix).
-- Local state of the panel as a network participant: enrollment record, own published
-- nodes, mirror of network sessions (both roles), usage mirror for reconciliation,
-- ledger mirror for UI, and an at-least-once provisioning queue towards own nodes.
-- All tables are inert unless the panel owner explicitly enables network participation.
--
-- This migration is idempotent and safe to run multiple times.

CREATE TABLE IF NOT EXISTS sn_participant (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    participant_id TEXT NOT NULL DEFAULT '',
    coordinator_url TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'disabled',
    enabled BOOLEAN NOT NULL DEFAULT false,
    tls_cert_pem TEXT NOT NULL DEFAULT '',
    tls_key_pem TEXT NOT NULL DEFAULT '',
    ca_pem TEXT NOT NULL DEFAULT '',
    signing_public_key TEXT NOT NULL DEFAULT '',
    signing_private_key TEXT NOT NULL DEFAULT '',
    risk_ack_version TEXT NOT NULL DEFAULT '',
    risk_ack_at INTEGER NOT NULL DEFAULT 0,
    enrolled_at INTEGER NOT NULL DEFAULT 0,
    last_sync_at INTEGER NOT NULL DEFAULT 0,
    sync_cursor BIGINT NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sn_shared_node (
    id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    coordinator_node_id TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    protocols TEXT NOT NULL DEFAULT '[]',
    traffic_limit_gb NUMERIC NOT NULL DEFAULT 100,
    speed_limit_mbps INTEGER NOT NULL DEFAULT 20,
    reserve_mbps INTEGER NOT NULL DEFAULT 0,
    max_sessions INTEGER NOT NULL DEFAULT 5,
    price_credits_per_gb NUMERIC NOT NULL DEFAULT 1,
    enabled BOOLEAN NOT NULL DEFAULT false,
    paused BOOLEAN NOT NULL DEFAULT false,
    risk_ack BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'draft',
    error TEXT NOT NULL DEFAULT '',
    coordinator_snapshot TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sn_shared_node_node ON sn_shared_node(node_id) WHERE status <> 'retired';

CREATE TABLE IF NOT EXISTS sn_session (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL DEFAULT '',
    coordinator_node_id TEXT NOT NULL DEFAULT '',
    peer_participant_id TEXT NOT NULL DEFAULT '',
    node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
    client_entity_id INTEGER REFERENCES client_entities(id) ON DELETE SET NULL,
    client_ref TEXT NOT NULL DEFAULT '',
    client_email TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '{}',
    protocol TEXT NOT NULL DEFAULT '',
    quota_gb NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT '',
    usage_up_bytes BIGINT NOT NULL DEFAULT 0,
    usage_down_bytes BIGINT NOT NULL DEFAULT 0,
    sync_seq BIGINT NOT NULL DEFAULT 0,
    opened_at INTEGER NOT NULL DEFAULT 0,
    closed_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sn_session_status ON sn_session(status);
CREATE INDEX IF NOT EXISTS idx_sn_session_client ON sn_session(client_entity_id);

CREATE TABLE IF NOT EXISTS sn_usage_mirror (
    session_id TEXT NOT NULL REFERENCES sn_session(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    up_bytes BIGINT NOT NULL DEFAULT 0,
    down_bytes BIGINT NOT NULL DEFAULT 0,
    cum_up_bytes BIGINT NOT NULL DEFAULT 0,
    cum_down_bytes BIGINT NOT NULL DEFAULT 0,
    reported_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS sn_ledger_mirror (
    entry_uid TEXT PRIMARY KEY,
    direction TEXT NOT NULL DEFAULT '',
    amount_credits NUMERIC NOT NULL DEFAULT 0,
    amount_bytes BIGINT NOT NULL DEFAULT 0,
    counterparty_participant_id TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '',
    ts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sn_provision_queue (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL DEFAULT '',
    node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    op TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sn_provision_queue_pending ON sn_provision_queue(status, next_attempt_at);
