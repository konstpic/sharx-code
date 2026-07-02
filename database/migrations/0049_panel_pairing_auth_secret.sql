-- Persistent symmetric auth secret for panel↔node JWT/HMAC (independent of TLS certs).
ALTER TABLE panel_pairing ADD COLUMN auth_secret TEXT NOT NULL DEFAULT '';
