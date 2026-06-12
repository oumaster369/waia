# db/ — schema, migrations, persistence

**Execution label:** `backend` · **Risk:** schema changes are typically T2+

## Stack

- Drizzle ORM with SQLite (local MVP) and Postgres configs (`drizzle.config.ts`, `drizzle.postgres.config.ts`).
- Generate: `pnpm db:generate` / `pnpm db:generate:postgres`
- Migrate: `pnpm db:migrate` / `pnpm db:migrate:postgres`

## Migration authoring — hand-authored convention (intentional deviation)

> **Apply path = `drizzle-kit migrate`, NOT `drizzle-kit generate`.**

Since `0003` (SQLite) / `0001` (Postgres) migrations in this repo are **hand-authored** SQL.
`drizzle-kit migrate` applies them by reading only `meta/_journal.json` + the `.sql` files;
it does **not** read the per-migration snapshot JSONs. This is deliberate because several
migrations contain objects Drizzle's schema diff cannot express — e.g. partial indexes,
`audit_logs` append-only triggers (`0007` SQLite), and `audit_logs` RLS policies +
mutation-blocking trigger (`0004` Postgres).

**Consequence (documented deviation):** `meta/*_snapshot.json` files exist only through
SQLite `0002` / Postgres `0002`. Snapshots after that are intentionally absent. The
migration **history is consistent** (every `_journal.json` entry has a matching `.sql`
file and vice-versa); only the optional `generate`-time snapshots are skipped.

**To author a new migration safely:**

1. Edit `db/schema.ts` and/or `db/schema.postgres.ts`.
2. Hand-write the next numbered SQL file in `db/migrations/` (or `db/migrations_postgres/`),
   using `--> statement-breakpoint` between statements.
3. Add a matching entry to the relevant `meta/_journal.json` (next `idx`, monotonically
   increasing `when`, `tag` = file name without `.sql`).
4. Validate with `pnpm db:migrate` against a throwaway DB.

**Do NOT run `pnpm db:generate` blindly.** Because the latest snapshot lags current schema,
`generate` would emit a spurious "catch-up" migration. If you ever need to re-baseline the
snapshot chain, do it in a dedicated, reviewed migration-tooling issue — not inline with a
feature change.

## Rules

- **Additive migrations preferred** — avoid destructive changes without explicit issue scope and rollback plan.
- Never commit `.data/` SQLite files or local DB artifacts.
- Follow [`docs/waia-governance/MIGRATION-GOVERNANCE.md`](../docs/waia-governance/MIGRATION-GOVERNANCE.md) and update trackers when runtime semantics change.
- Postgres rollout discipline: [`docs/adr/0002-staged-postgres-runtime-rollout-discipline.md`](../docs/adr/0002-staged-postgres-runtime-rollout-discipline.md).

## Boundaries

- Do not change UI in the same issue unless the Linear card explicitly spans both (prefer split issues).
- Auth schema changes may need `security` review — see [`docs/security-dee52-auth-review.md`](../docs/security-dee52-auth-review.md).

## Validation

```bash
pnpm db:migrate && pnpm test --run
# Postgres path when in scope:
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```
