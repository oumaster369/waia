-- Postgres-only migration validation prelude (local / CI empty DB).
-- Supabase provides `auth.users`; bare Docker Postgres does not. This stub
-- exists so `db/migrations_postgres/*` FKs referencing `auth.users(id)` apply.
-- Do not use this as production auth schema.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY
);
