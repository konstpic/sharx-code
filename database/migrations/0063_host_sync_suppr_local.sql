-- Same tombstone mechanism as 0061, extended to "local" (panel fallback) hosts: an operator may
-- delete one, and it stays gone until genuinely needed again (see ensureLocalHost), not recreated
-- on a timer the way placement/pool hosts used to be.
CREATE UNIQUE INDEX IF NOT EXISTS uq_host_sync_suppr_local ON host_sync_suppressions(inbound_id) WHERE kind = 'local';
