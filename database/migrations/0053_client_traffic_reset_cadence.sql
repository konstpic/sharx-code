-- Migration: calendar-aligned automatic traffic reset per client.
-- traffic_reset_cadence: '' (off, default) | 'daily' | 'weekly' | 'monthly'.
-- traffic_reset_day: cadence-dependent anchor — ignored for daily; 0-6 (Sun-Sat) for weekly;
-- 1-31 for monthly. A month shorter than the picked day (e.g. 31 in April, or 29-31 in
-- February) resets on that month's last day instead — clamped, not skipped, so the client
-- never gets an extra period of traffic for free.
-- last_traffic_reset_time: ms epoch of the last automatic reset, so the job does not reset a
-- client twice within the same day if it runs more than once.
ALTER TABLE client_entities ADD COLUMN IF NOT EXISTS traffic_reset_cadence VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE client_entities ADD COLUMN IF NOT EXISTS traffic_reset_day INT NOT NULL DEFAULT 0;
ALTER TABLE client_entities ADD COLUMN IF NOT EXISTS last_traffic_reset_time BIGINT NOT NULL DEFAULT 0;
