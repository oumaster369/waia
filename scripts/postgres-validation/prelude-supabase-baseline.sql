-- DEE-1020: Supabase-class platform baseline for disposable migration-verification fixtures.
--
-- `prelude-auth-stub.sql` reproduces a *bare* PostgreSQL cluster: the migration authority is the
-- bootstrap superuser, `public` carries only its stock ACL, and no default privileges exist. The
-- approved WAIA production target is not that cluster class. It is a managed Supabase project where
--
--   * the migration authority is a NOSUPERUSER role holding CREATEROLE/CREATEDB/BYPASSRLS and
--     owning the database (so it reaches `public` through `pg_database_owner`);
--   * `anon`, `authenticated` and `service_role` exist and hold explicit `public` USAGE;
--   * `ALTER DEFAULT PRIVILEGES` gives those three principals a fixed structural privilege set on
--     every newly created relation, and withholds PostgreSQL's stock PUBLIC EXECUTE on functions.
--
-- Those differences are properties of the *cluster class*, not of one project: any Supabase project
-- provisioned by the same platform bootstrap produces them. Encoding them here — rather than
-- special-casing a project id, hostname or database instance — is what lets the H2/post-H2 catalog
-- verifiers be proved against both cluster classes from one deterministic, auditable definition.
--
-- Apply order: `prelude-auth-stub.sql`, then this file, as a cluster superuser, into a database
-- OWNED BY `waia_platform_authority`. The migrations are then applied *as* that role.
--
-- VALIDATION-ONLY — never apply to production. `waia_platform_authority` is created NOLOGIN here;
-- only the disposable local harness may grant it a transient loopback password.
-- Idempotent: safe to re-run against an already-prepared validation database.

-- 1. The third platform principal. `prelude-auth-stub.sql` already creates `anon`/`authenticated`.
--    `service_role` carries BYPASSRLS on Supabase, which is exactly why the corrected verifiers
--    must keep every read/write privilege class for it inside the frozen digest.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waia_platform_authority') THEN
    CREATE ROLE waia_platform_authority
      NOLOGIN NOSUPERUSER CREATEDB CREATEROLE NOREPLICATION BYPASSRLS;
  END IF;
END
$$;

-- 2. Explicit `public` USAGE for the platform principals and for the migration authority itself.
--    USAGE alone conveys no object access; it is the prerequisite Supabase's data APIs require.
--    CREATE is deliberately NOT granted: the corrected verifiers keep schema CREATE digest-pinned.
GRANT USAGE ON SCHEMA public TO waia_platform_authority, anon, authenticated, service_role;

-- 3. Default privileges for objects created by the migration authority in `public`, byte-equivalent
--    to the approved production target:
--      relations  postgres=arwdDxtm  anon/authenticated/service_role=Dxtm
--      functions  postgres=X                     (no stock PUBLIC EXECUTE)
--      sequences  postgres=rwU       anon/authenticated/service_role=w
--    `Dxtm` = TRUNCATE, REFERENCES, TRIGGER, MAINTAIN — structural/destructive classes only, never
--    SELECT/INSERT/UPDATE/DELETE. That distinction is the whole basis of the canonical projection.
ALTER DEFAULT PRIVILEGES FOR ROLE waia_platform_authority IN SCHEMA public
  GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated, service_role;
-- The function entry is reproduced through GRANT-then-REVOKE because a bare REVOKE against an
-- absent entry is a no-op. It is deliberately kept even though it is provably inert: PostgreSQL
-- still stores `proacl = NULL` for functions created under it, so PUBLIC retains EXECUTE in BOTH
-- cluster classes. That is why function EXECUTE posture needs no canonical normalization, and why
-- `CATALOG_0209_FUNCTIONS`' `proacl IS NULL` assertion is portable exactly as merged.
ALTER DEFAULT PRIVILEGES FOR ROLE waia_platform_authority IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE waia_platform_authority IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE waia_platform_authority IN SCHEMA public
  GRANT UPDATE ON SEQUENCES TO anon, authenticated, service_role;

-- 4. Role-creation lineage. PostgreSQL 16+ automatically grants a newly created role back to a
--    NOSUPERUSER CREATEROLE creator `WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`, so on the approved
--    target every WAIA role carries exactly one such management-only membership for the migration
--    authority. A bare cluster whose authority is the bootstrap superuser has no equivalent row.
--    `waia_historical_runner` predates this fixture and is created by `prelude-auth-stub.sql`, so
--    reproduce the same lineage explicitly — migration 0199 issues `ALTER ROLE` against it and
--    therefore requires the authority to hold ADMIN OPTION exactly as it does in production.
--    INHERIT FALSE and SET FALSE mean this membership conveys no usable privilege whatsoever.
GRANT waia_historical_runner TO waia_platform_authority WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;

-- 5. The stub `auth.users` created by `prelude-auth-stub.sql` is owned by the superuser that ran it.
--    On Supabase the migration authority can read `auth.users` for its FK targets, so mirror that.
GRANT USAGE ON SCHEMA auth TO waia_platform_authority;
GRANT REFERENCES, SELECT ON auth.users TO waia_platform_authority;
