-- Postgres-only migration validation prelude (local / CI empty DB).
--
-- Supabase provides the `auth` schema AND the `authenticated` / `anon` database
-- roles; bare Docker Postgres (postgres:16-alpine) provides neither. These stubs
-- exist ONLY so that `db/migrations_postgres/*` apply cleanly against a
-- disposable validation database:
--   * `auth.users`               — referenced by FK in 0001_auth_users_fk.sql
--   * `authenticated` / `anon`   — referenced by RLS policies (`... TO authenticated, anon`)
--                                  from 0004_audit_logs_rls.sql onward
--
-- VALIDATION-ONLY — never apply to production / Supabase:
--   * roles are NOLOGIN with NO grants → they cannot connect and hold no privileges,
--     so they cannot be confused with real Supabase auth roles.
--   * `auth.users` is an empty id-only table, not the real Supabase auth schema.
--
-- Idempotent: safe to re-run against an already-prepared validation DB.

-- 1. Supabase-compatible role stubs (NOLOGIN, no privileges).
--    Postgres has no `CREATE ROLE IF NOT EXISTS`; guard via pg_roles.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END
$$;

-- 2. Minimal `auth.users` so migration FKs referencing `auth.users(id)` resolve.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY
);
