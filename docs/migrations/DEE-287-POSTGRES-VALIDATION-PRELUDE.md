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

## Second defect uncovered: FK-before-unique-index ordering (Postgres-only)

Once the prelude fix let validation advance past `0004`, a **previously-masked**
Postgres-only migration defect surfaced at `0018`:

```
PostgresError: there is no unique constraint matching given keys for referenced table "trader_mi_source_trust"
```

Drizzle emits `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` **before** the
`CREATE UNIQUE INDEX` that backs the referenced columns. For **cross-table** FKs this
is fine (the referenced table's unique index already exists from an earlier statement),
but for a **composite self-reference** (and a child→parent composite FK in the same
file) the backing `(id, organization_id)` unique index did not yet exist when the FK
was added. Postgres requires the referenced unique index/constraint to exist first.

Affected files (all append-only MI registries with `revision_of` self-references):

| Migration | FK(s) fixed |
|-----------|-------------|
| `0018_trader_mi_source_provenance` | `trader_mi_source_trust` self-FK |
| `0020_trader_mi_observation` | `trader_mi_observation` self-FK |
| `0022_trader_mi_measurement` | `trader_mi_measurement` self-FK |
| `0024_trader_mi_pattern` | `trader_mi_pattern` self-FK + `trader_mi_pattern_lifecycle`→parent FK |
| `0026_trader_mi_hypothesis` | `trader_mi_hypothesis` self-FK + `trader_mi_hypothesis_lifecycle`→parent FK |

**Fix:** in each file, move the `CREATE UNIQUE INDEX "<table>_id_organization_unique"`
statement to **before** the first FK that references it. This is a pure statement
**reordering** — the final schema is byte-identical; no columns, indexes, constraints,
or RLS changed.

**Why edit merged migrations in place (vs. a new migration):** these migrations have
**never** applied successfully on any Postgres environment (validation always failed at
`0004` first), so no environment has them recorded as complete — in-place correction is
safe and reproducible. A new corrective migration cannot help, because `drizzle-kit
migrate` runs files in order and fails at `0018` long before any later migration. SQLite
migrations are unaffected (separate files; SQLite does not require the referenced index
to pre-exist) and remain green in default CI.

Detection of the full blast radius (and a zero-remaining guard) was done by scanning every
`db/migrations_postgres/*.sql` for composite FKs whose backing unique index is created
later in the same file.

## Deferred (out of scope for DEE-287): opt-in integration-suite fixture parity

With migration-apply restored, the `postgres-integration` workflow ran the opt-in
`WAIA_PG_INTEGRATION=1` suite (`tests/integration/postgres-*.test.ts`) for the first time
and surfaced **pre-existing, DEE-287-unrelated** test-fixture parity failures (twin
persistence, twin engine, reasoning, runtime coherence, order/kill-switch/reconciliation
parity). Confirmed root causes, none related to the prelude or the migration reorder:

- **Non-canonical UUID literals** — fixtures use SQLite-tolerant ids like
  `00000000-0000-4000-8000-00000000105co` / `...247g1` / 14-char tail segments; Postgres
  `uuid` rejects them (`invalid input syntax for type uuid`).
- **Missing `auth.users` seed** — tests insert `public.users` without the matching
  `auth.users` row, hitting `users_id_fk_auth_users`.
- **`text = uuid` comparisons** — loose typing works on SQLite, fails on Postgres
  (`operator does not exist: text = uuid`).

These are genuine test-quality gaps that only ever surface against real Postgres. Because
DEE-287 is scoped to **migration validation** (and explicitly excludes product/test parity
work), the gating workflow runs **migrate + smoke** only; the parity suite is **not** gated
here. Recommend a dedicated follow-up issue ("Postgres integration-test fixture parity")
to fix the fixtures and then re-enable the suite in CI.

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
