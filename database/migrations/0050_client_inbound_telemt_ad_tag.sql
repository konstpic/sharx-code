-- Per-mapping ad tag for Telemt (MTProto) inbounds; 32 hex chars, nullable.
ALTER TABLE client_inbound_mappings ADD COLUMN IF NOT EXISTS telemt_ad_tag VARCHAR(32) NULL;
