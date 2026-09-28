-- Auto-weight balancing: pools can compute member weight automatically from the node's reported
-- uplink load or from balancer-to-node ping, instead of the admin setting a fixed weight.
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS bandwidth_mbps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE balancer_pools ADD COLUMN IF NOT EXISTS weight_mode VARCHAR(16) NOT NULL DEFAULT 'manual'; -- manual | load | ping
-- Global recompute interval (seconds) for every auto-weight pool, in the settings key-value table
-- like the rest of the panel's settings (see SettingService.GetBalancerWeightIntervalSecs).
INSERT INTO settings (key, value) SELECT 'balancerWeightIntervalSecs', '30' WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'balancerWeightIntervalSecs');
