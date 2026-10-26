-- The LDAP module (sign-in and directory sync) was removed; its settings are no longer read.
-- Idempotent: safe to run more than once.
DELETE FROM settings WHERE key LIKE 'ldap%';
