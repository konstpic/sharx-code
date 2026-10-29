-- Migration: Add routing field to client_entities
-- A per-client client-routing profile (Happ/INCY deep link). When set, the subscription answers this
-- client with it instead of the routing configured on the subscription page.
--
-- This migration is idempotent and safe to run multiple times.

ALTER TABLE client_entities
ADD COLUMN IF NOT EXISTS routing TEXT;
