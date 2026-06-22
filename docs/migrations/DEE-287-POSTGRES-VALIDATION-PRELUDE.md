# DEE-287 — Restore Postgres validation (auth prelude roles + postgres-integration workflow)

**Linear:** DEE-287
**Type:** Infra remediation (no schema change, no Market Intelligence product behavior change)
**Risk tier:** T1 (validation-only tooling; production runtime untouched)
**Remediates:** DEE-285 / DEE-286 Postgres validation waiver root cause

## Problem

Postgres validation (`pnpm db:postgres:bootstrap`, `pnpm db:smoke:postgres`, and the
`postgres-integration` GitHub Actions workflow) failed at migration
`0004_audit_logs_rls.sql` against bare `postgres:16-alpine`:

```
PostgresError: role "authenticated" does not exist   (code 42704)
```

RLS migrations from `0004` onward use `CREATE POLICY ... TO authenticated, anon`. Supabase
provides those roles; bare Docker Postgres does not. The previous auth prelude only stubbed
`auth.users`, so every migration from `0004` (including `0028` and any future LD-5a.2 DDL) was
unreachable. Validation was waived for DEE-285 and DEE-286.

**Evidence:** <https://github.com/oumaster369/waia/actions/runs/27962622262>

## Fix (minimal, validation-only)

1. **`scripts/postgres-validation/prelude-auth-stub.sql`** — add idempotent NOLOGIN role stubs
   for `authenticated` and `anon` (no grants, cannot connect, hold no privileges), alongside the
   existing `auth.users` stub. Guarded via `pg_roles` so re-runs are safe.
2. **`scripts/postgres-validation/apply-auth-prelude.ts`** — now reads and executes the `.sql`
   file verbatim (simple query protocol) instead of inlining a divergent copy. The SQL file is the
   **single source of truth**, which removes the drift class that caused the gap. Localhost host
   guard retained.
3. **`.github/workflows/postgres-integration.yml`** — keep `workflow_dispatch`; add a
   **path-filtered `pull_request` trigger** (`db/migrations_postgres/**`, `db/schema.postgres.ts`,
   `scripts/postgres-validation/**`, `drizzle.postgres.config.ts`) so migration-bearing PRs validate
   the full apply path automatically. Added a `db:smoke:postgres` step after migrate.

## Security posture

- Role stubs are `NOLOGIN` with **no** `GRANT`s → cannot authenticate, hold no privileges.
- Host guard (`127.0.0.1` / `localhost` / `::1`) prevents the prelude from touching remote/prod DBs.
- No production runtime code, no `db/client.ts`, no RLS strategy, and no schema changed.
- Production Supabase auth/role configuration is **out of scope** (real roles exist there already).

## Validation

```bash
# Local (requires Docker):
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres

# Repo-wide:
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build

# CI: postgres-integration auto-runs on this PR (touches scripts/postgres-validation/** + workflow);
# also dispatchable via `gh workflow run postgres-integration --ref <branch>`.
```

## Acceptance

- `postgres-integration` applies all migrations from empty DB through the latest journal entry (incl. `0028`).
- The `0004_audit_logs_rls` failure is gone.
- No production behavior changed; no security posture weakened.
