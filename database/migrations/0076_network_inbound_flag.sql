-- Migration: SharX Network follow-up — network-inbound marker and consumer sync cursor.
-- sn_network marks inbounds that belong to SharX Network (excluded from normal
-- subscriptions; isolation of third-party traffic). sync_cursor_consumer is the
-- consumer-side session sync cursor.
-- This migration is idempotent and safe to run multiple times.

ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS sn_network BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sn_participant ADD COLUMN IF NOT EXISTS sync_cursor_consumer BIGINT NOT NULL DEFAULT 0;
