-- Per inbound↔node: short server description for INCY/Happ share-link fragments (#name?serverDescription=base64).
ALTER TABLE inbound_node_mappings ADD COLUMN IF NOT EXISTS server_description VARCHAR(30) NOT NULL DEFAULT '';
