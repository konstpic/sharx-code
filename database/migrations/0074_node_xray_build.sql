-- Migration: Add xray_build to nodes
-- The Xray release a worker reports as installed (for example "26.10.29" or "26.10.29-sharx.1"), "bundled" for the
-- binary shipped in the worker image, or empty when the worker does not report it. It lets the panel tell the SharX
-- fork from the stock core, which share a version number.
--
-- This migration is idempotent and safe to run multiple times.

ALTER TABLE nodes
ADD COLUMN IF NOT EXISTS xray_build TEXT DEFAULT '';
