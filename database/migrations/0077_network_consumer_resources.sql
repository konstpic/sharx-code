-- SharX Network consumer resources: rented node -> immutable inbound -> fixed host -> bundle.
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS sn_network_role TEXT NOT NULL DEFAULT '';
UPDATE inbounds SET sn_network_role = 'provider' WHERE sn_network = TRUE AND sn_network_role = '';
ALTER TABLE sn_session ADD COLUMN IF NOT EXISTS inbound_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_sn_session_inbound_id ON sn_session(inbound_id);
ALTER TABLE sn_participant ADD COLUMN IF NOT EXISTS ledger_cursor BIGINT NOT NULL DEFAULT 0;
