-- Locally stored templates (inbounds / Xray core configs) for quick deployment; independent of the cloud gallery.
CREATE TABLE IF NOT EXISTS local_templates (
    id SERIAL PRIMARY KEY,
    kind VARCHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    content TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    source_cloud_id VARCHAR(64) NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_templates_kind ON local_templates(kind);
