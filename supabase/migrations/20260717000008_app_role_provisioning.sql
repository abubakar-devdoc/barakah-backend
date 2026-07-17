-- Migration: 20260717000008_app_role_provisioning.sql
--
-- Provisions the restricted application role used by Express.
-- IMPORTANT:
--   1. Do NOT use the postgres / owner role for application queries.
--   2. barakah_app must NOT have BYPASSRLS.
--   3. Set the password outside of committed SQL (see README).
--
-- After applying migrations as a privileged role, run (example):
--   ALTER ROLE barakah_app PASSWORD 'your-strong-password';
--   Then point DATABASE_URL at barakah_app.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barakah_app') THEN
    CREATE ROLE barakah_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO barakah_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO barakah_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO barakah_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO barakah_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO barakah_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO barakah_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO barakah_app;

-- Prevent app role from mutating audit history
REVOKE UPDATE, DELETE ON public.audit_logs FROM barakah_app;

COMMENT ON ROLE barakah_app IS
  'Barakah Express API role. No BYPASSRLS. Request identity via SET LOCAL / set_config(app.*, true).';
