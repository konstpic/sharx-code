-- Single sign-on, stage 2: keep sessions in step with the identity provider (refresh tokens, webhook) and per-provider settings
-- for the adapters that need them.
--
-- Compatible with the previous version (new columns are ignored by it). Optional cleanup:
--   ALTER TABLE auth_providers DROP COLUMN resync, DROP COLUMN resync_minutes, DROP COLUMN webhook_secret;
--   ALTER TABLE user_identities DROP COLUMN refresh_token, DROP COLUMN refreshed_at, DROP COLUMN resync_error;

-- re-check the person at the provider on a schedule (needs a refresh token: the offline_access scope)
ALTER TABLE auth_providers ADD COLUMN IF NOT EXISTS resync BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE auth_providers ADD COLUMN IF NOT EXISTS resync_minutes INTEGER NOT NULL DEFAULT 15;
-- shared secret of the provider's webhook (sealed); empty = the webhook is off
ALTER TABLE auth_providers ADD COLUMN IF NOT EXISTS webhook_secret TEXT NOT NULL DEFAULT '';

-- the provider's refresh token, sealed with AES-GCM; replaced on every use (rotation)
ALTER TABLE user_identities ADD COLUMN IF NOT EXISTS refresh_token TEXT NOT NULL DEFAULT '';
ALTER TABLE user_identities ADD COLUMN IF NOT EXISTS refreshed_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_identities ADD COLUMN IF NOT EXISTS resync_error TEXT NOT NULL DEFAULT '';
