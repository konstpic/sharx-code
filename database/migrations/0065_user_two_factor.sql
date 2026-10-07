-- Per-user two-factor authentication (TOTP). Until now one secret in the settings table guarded the whole panel.
--
-- Compatible with the previous version: the old binary ignores these columns and keeps reading the panel-wide
-- twoFactorEnable/twoFactorToken settings, which this migration deliberately leaves in place. Rollback: deploy the old
-- version (the settings still hold the secret that was copied); the columns can stay or be dropped:
--   ALTER TABLE users DROP COLUMN two_factor_enabled, DROP COLUMN two_factor_secret;

ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT NOT NULL DEFAULT '';

-- The existing panel-wide secret protected the (so far only kind of) administrators: carry it over to every existing user
-- that has no secret of its own yet, so nobody silently loses 2FA when the panel is upgraded. Idempotent.
UPDATE users SET two_factor_enabled = TRUE, two_factor_secret = (SELECT value FROM settings WHERE key = 'twoFactorToken' LIMIT 1)
WHERE two_factor_secret = ''
  AND EXISTS (SELECT 1 FROM settings WHERE key = 'twoFactorEnable' AND value = 'true')
  AND COALESCE((SELECT value FROM settings WHERE key = 'twoFactorToken' LIMIT 1), '') <> '';
