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

## Postgres connection role (DEE-225 R3)

`DATABASE_URL_POSTGRES` must use a **privileged service role** (table owner /
`postgres` superuser on Supabase), **not** Supabase JWT `authenticated` or `anon`
roles. Migration `0004_audit_logs_rls.sql` denies those JWT roles direct access to
`audit_logs`; the app service layer still inserts audit rows via Drizzle.

| Target | Role in connection URI |
|--------|------------------------|
| Local Docker validate | `waia_validate` |
| Supabase (staging/prod) | `postgres` via transaction pooler (`postgres.<ref>@…pooler…:6543/postgres`) |

Full operator guidance: [`docs/waia-core/WAIA-CORE-M1-DEPLOYMENT-RUNBOOK.md`](../docs/waia-core/WAIA-CORE-M1-DEPLOYMENT-RUNBOOK.md) §1 (Postgres connection role). Cross-ref: [ADR-0007](../docs/adr/0007-targeted-rls-strategy.md).

## Boundaries

- Do not change UI in the same issue unless the Linear card explicitly spans both (prefer split issues).
- Auth schema changes may need `security` review — see [`docs/security-dee52-auth-review.md`](../docs/security-dee52-auth-review.md).

## AI-TRADER schema namespace (AT-E1 / DEE-193)

Trader-owned tables use the `trader_*` prefix and **must** carry `organization_id` referencing Core `organizations` (see [`docs/ai-trader/AI-TRADER-INTEGRATION.md`](../docs/ai-trader/AI-TRADER-INTEGRATION.md) §1.3).

| Migration | Table | Purpose |
|-----------|-------|---------|
| SQLite `0008_trader_org_scaffolding` | `trader_org_profiles` | Org-scoped module anchor (1:1 per organization) |
| Postgres `0005_trader_org_scaffolding` | `trader_org_profiles` | Same |
| SQLite `0009_exchange_credentials` | `exchange_credentials` | Org-scoped encrypted credential storage (schema only in DEE-233) |
| Postgres `0006_exchange_credentials` | `exchange_credentials` | Same |
| Postgres `0007_exchange_credentials_rls` | `exchange_credentials` RLS | ADR-0007 deny authenticated/anon |
| SQLite `0011_trader_risk_limits` | `trader_risk_limits` | Org-scoped risk limit configuration (DEE-239) |
| Postgres `0010_trader_risk_limits` | `trader_risk_limits` | Same |
| Postgres `0011_trader_risk_limits_rls` | `trader_risk_limits` RLS | ADR-0007 deny authenticated/anon |
| SQLite `0012_trader_kill_switches` | `trader_kill_switches` | Kill switch state (platform + org scope; DEE-206A) |
| Postgres `0012_trader_kill_switches` | `trader_kill_switches` | Same |
| Postgres `0013_trader_kill_switches_rls` | `trader_kill_switches` RLS | ADR-0007 deny authenticated/anon |
| SQLite `0013_trader_orders` | `trader_orders`, `trader_order_events`, `trader_fills` | Order domain schema (DEE-247) |
| Postgres `0014_trader_orders` | `trader_orders`, `trader_order_events`, `trader_fills` | Same |
| Postgres `0015_trader_orders_rls` | order tables RLS | ADR-0007 deny authenticated/anon |
| SQLite `0015_trader_mi_source_provenance` | `trader_mi_source`, `trader_mi_source_trust` | MI Layer-0 source registry + append-only trust (DEE-279) |
| Postgres `0018_trader_mi_source_provenance` | `trader_mi_source`, `trader_mi_source_trust` | Same |
| Postgres `0019_trader_mi_source_provenance_rls` | MI source tables RLS | ADR-0007 deny authenticated/anon |
| SQLite `0016_trader_mi_observation` | `trader_mi_observation` | MI Layer-1 PIT observations + MSV persistence (DEE-281) |
| Postgres `0020_trader_mi_observation` | `trader_mi_observation` | Same |
| Postgres `0021_trader_mi_observation_rls` | MI observation RLS | ADR-0007 deny authenticated/anon |
| SQLite `0017_trader_mi_measurement` | `trader_mi_measurement` | MI Layer-2 versioned transform-definition registry (DEE-282) |
| Postgres `0022_trader_mi_measurement` | `trader_mi_measurement` | Same |
| Postgres `0023_trader_mi_measurement_rls` | MI measurement RLS | ADR-0007 deny authenticated/anon |

**Runtime provisioning is deferred** — `ensureTraderOrgProfile*` lives in `lib/trader/provisioning/` for library/tests only until AT-E2+ wires a call site. Audit writes go through `lib/trader/audit/write.ts` into Core `audit_logs`.

**Production apply:** targeted SQL only on `waia-prod` (no blind `pnpm db:migrate:postgres` — see WAIA Core M1 runbook).

## Validation

```bash
pnpm db:migrate && pnpm test --run
# Postgres path when in scope:
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```
