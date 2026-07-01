-- Migration: monthly traffic reset day for nodes (0 = disabled, 1-31 = day of month)
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS traffic_reset_day INT NOT NULL DEFAULT 0;
