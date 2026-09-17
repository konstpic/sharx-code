-- Admin-selected ("pinned") core versions for a node. Empty = follow whatever the node's
-- own /app/bin already has (no automatic override). Set whenever the admin explicitly installs
-- a specific Xray/Telemt version via the panel; used to re-assert that exact version if a
-- worker restart/image update ever leaves it running something else.

ALTER TABLE nodes ADD COLUMN IF NOT EXISTS xray_pinned_version TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS telemt_pinned_version TEXT NOT NULL DEFAULT '';
