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
| Postgres `0152_trader_mi_pit_trust_as_of_v1` | `trader_mi_source_trust`, `trader_mi_observation`, `trader_mi_trust_as_of_receipt_v1` | DEE-654 Split A: nullable three-time compatibility + append-only trust-as-of receipt; no SQLite counterpart |
| Postgres `0153_trader_mi_raw_capture_v1` | `trader_mi_raw_storage_binding_v1`, `trader_mi_raw_capture_receipt_v1`, `trader_mi_raw_validation_receipt_v1` | DEE-656: references/receipts only; append-only, tenant-scoped, deny RLS; no raw bytes or production storage/defaults |
| Postgres `0158_treasury_category_budget_history` / `0159_*_rls` | `treasury_categories`, `treasury_category_budget_history` | DEE-671: category group text, server-owned effective-month limits, legacy seed and deny RLS; `0157` is reserved by AI-TRADER PR #477 |
| Postgres `0163_treasury_fund_allocation_evidence` / `0164_*_rls` | `treasury_fund_allocation_evidence` | DEE-690: immutable, idempotent virtual Operating/Development Fund allocation evidence with exact same-org authorities, append-only guards and deny RLS; no custody movement or transaction rewrite |
| Postgres `0165_treasury_finance_assistant_confirmations` / `0166_*_rls` | `treasury_finance_assistant_confirmations` | DEE-705: single-use, append-only receipts for Human-confirmed Finance Assistant writes; digests only, deny RLS, no prompt or financial values |
| Postgres `0171_treasury_contribution_payment_intents` / `0172_*_rls` | `treasury_contribution_payment_intents`, `treasury_balance_checkpoints`, attribution public-link columns | DEE-731: immutable, expiring exact-USDT support instructions plus append-only Human-confirmed balance authority; deterministic identity matching only, no automatic transaction verification; guarded lifecycle and deny RLS. Follows merged AI-TRADER migrations `0169`/`0170`. |
| SQLite `0017_trader_mi_measurement` | `trader_mi_measurement` | MI Layer-2 versioned transform-definition registry (DEE-282) |
| Postgres `0022_trader_mi_measurement` | `trader_mi_measurement` | Same |
| Postgres `0023_trader_mi_measurement_rls` | MI measurement RLS | ADR-0007 deny authenticated/anon |
| SQLite `0018_trader_mi_pattern` | `trader_mi_pattern`, `trader_mi_pattern_lifecycle` | MI Layer-4 recurring-structure registry + ACTIVE/ARCHIVED lifecycle ledger (DEE-283) |
| Postgres `0024_trader_mi_pattern` | `trader_mi_pattern`, `trader_mi_pattern_lifecycle` | Same |
| Postgres `0025_trader_mi_pattern_rls` | MI pattern + lifecycle RLS | ADR-0007 deny authenticated/anon |
| SQLite `0019_trader_mi_hypothesis` | `trader_mi_hypothesis`, `trader_mi_hypothesis_lifecycle` | MI Layer-5a hypothesis registry + PROPOSED lifecycle bootstrap (DEE-285) |
| Postgres `0026_trader_mi_hypothesis` | `trader_mi_hypothesis`, `trader_mi_hypothesis_lifecycle` | Same |
| Postgres `0027_trader_mi_hypothesis_rls` | MI hypothesis + lifecycle RLS | ADR-0007 deny authenticated/anon |
| Postgres `0028_trader_mi_hypothesis_lifecycle_states` | `mi_hypothesis_lifecycle_state` enum extension | LD-5a.1b doctrine §7 states (DEE-286) |
| SQLite `0020_trader_mi_evidence` | `trader_mi_evidence` | MI Layer-5a Evidence Record spine (DEE-288) |
| Postgres `0029_trader_mi_evidence` | `trader_mi_evidence` | Same |
| Postgres `0030_trader_mi_evidence_rls` | MI evidence RLS | ADR-0007 deny authenticated/anon |
| SQLite `0021_trader_mi_trial` | `trader_mi_trial` (+ `trader_mi_evidence` guard trigger) | MI Layer-5a Trial Registration + Evidence→Trial link (DEE-289 / LD-5a.2b) |
| Postgres `0031_trader_mi_trial` | `trader_mi_trial` (+ `trader_mi_evidence` composite FK) | Same |
| Postgres `0032_trader_mi_trial_rls` | `trader_mi_trial` RLS | ADR-0007 deny authenticated/anon |
| SQLite `0022_trader_mi_trial_integrity` | `trader_mi_trial_integrity_event` | MI Layer-5a Trial Integrity invalidation ledger (DEE-291 / LD-5a.2c) |
| Postgres `0033_trader_mi_trial_integrity` | `trader_mi_trial_integrity_event` | Same |
| Postgres `0034_trader_mi_trial_integrity_rls` | `trader_mi_trial_integrity_event` RLS | ADR-0007 deny authenticated/anon |
| SQLite `0023_trader_mi_confidence_judgment` | `trader_mi_confidence_judgment` | MI Layer-5a Confidence Judgment ledger (DEE-293 / LD-5a.3a) |
| Postgres `0035_trader_mi_confidence_judgment` | `trader_mi_confidence_judgment` | Same |
| Postgres `0036_trader_mi_confidence_judgment_rls` | `trader_mi_confidence_judgment` RLS | ADR-0007 deny authenticated/anon |
| SQLite `0024_trader_reporting_periods` | `trader_reporting_periods` | Billing reporting period valued-input record (DEE-305) |
| Postgres `0037_trader_reporting_periods` | `trader_reporting_periods` | Same |
| Postgres `0038_trader_reporting_periods_rls` | `trader_reporting_periods` RLS | ADR-0007 deny authenticated/anon |
| SQLite `0025_trader_hwm_ledger` | `trader_hwm_ledger` | Per-account HWM append-only ledger (DEE-307) |
| Postgres `0039_trader_hwm_ledger` | `trader_hwm_ledger` | Same |
| Postgres `0040_trader_hwm_ledger_rls` | `trader_hwm_ledger` RLS | ADR-0007 deny authenticated/anon |
| SQLite `0026_trader_invoices` | `trader_invoices` | Immutable draft invoice commitment record (DEE-310 / AT-E11 S5) |
| SQLite `0027_trader_invoice_issuance` | `trader_invoices`, `trader_hwm_ledger` | Invoice issuance workflow columns + HWM ratchet guard (DEE-311 / AT-E11 S6) |
| Postgres `0041_trader_invoices` | `trader_invoices` | Same |
| Postgres `0042_trader_invoices_rls` | `trader_invoices` RLS | ADR-0007 deny authenticated/anon |
| Postgres `0043_trader_invoice_status_issued` | `invoice_status` enum | Add ISSUED value (isolated migration) |
| Postgres `0044_trader_invoice_issuance` | `trader_invoices`, `trader_hwm_ledger` | Issuance workflow columns + HWM ratchet guard (DEE-311 / AT-E11 S6) |
| SQLite `0028_payments` | `payment_events`, `payments` | Core crypto payment ledger + projection (DEE-312 / AT-E12 S1) |
| Postgres `0045_payments` | `payment_events`, `payments` | Same |
| Postgres `0046_payments_rls` | `payment_events`, `payments` RLS | Append-only trigger on events + ADR-0007 deny authenticated/anon |
| SQLite `0029_payment_address_registry` | `payment_wallets`, `payment_address_events`, `payment_addresses` | Core payment address registry schema (DEE-315 / AT-E12 S2-A) |
| Postgres `0047_payment_address_registry` | `payment_wallets`, `payment_address_events`, `payment_addresses` | Same |
| Postgres `0048_payment_address_registry_rls` | payment address registry tables RLS | Append-only trigger on events + ADR-0007 deny authenticated/anon |
| SQLite `0030_payment_watcher_checkpoints` | `payment_watcher_checkpoints` | Core payment watcher cursor (DEE-321 / AT-E12 S3-A) |
| Postgres `0049_payment_watcher_checkpoints` | `payment_watcher_checkpoints` | Same |
| Postgres `0050_payment_watcher_checkpoints_rls` | `payment_watcher_checkpoints` RLS | ADR-0007 deny authenticated/anon |
| SQLite `0031_trader_settlement` | `trader_settlements`, `trader_settlement_applications`, `trader_account_status`, `trader_account_status_events` | Settlement engine schema (DEE-322 / AT-E12 S3-B) |
| Postgres `0051_trader_invoice_status_settlement` | `invoice_status` enum | Add PAID value (isolated migration) |
| Postgres `0052_trader_settlement` | settlement + account status tables | Same as SQLite 0031 |
| Postgres `0053_trader_settlement_rls` | settlement tables RLS | Append-only triggers + ADR-0007 deny authenticated/anon |
| SQLite `0032_trader_settlement_reconciliation` | reconciliation cases/events + application columns | Settlement exception reconciliation schema (DEE-325 / AT-E12 S3-C-A) |
| SQLite `0033_trader_reconciliation_workflow` | case `current_decision_id`, application `decision_id`, unique settlement application | Operator workflow schema (AT-E12 S3-C-B) |
| Postgres `0056_trader_reconciliation_workflow` | resolution type enum, same columns/constraints | Operator workflow schema (AT-E12 S3-C-B) |
| Postgres `0054_trader_settlement_reconciliation` | reconciliation cases/events + application columns | Same as SQLite 0032 |
| Postgres `0055_trader_settlement_reconciliation_rls` | reconciliation tables RLS | Append-only trigger on events + ADR-0007 deny authenticated/anon |

**Runtime provisioning:** `ensureTraderOrgProfile*` is wired at runtime via `lib/trader/runtime-provisioning.ts` (`ensureTraderRuntimeForUser`), invoked from the trader access gate when the `trader` entitlement is present. Audit writes go through `lib/trader/audit/write.ts` into Core `audit_logs`.

**Postgres-only (MVP Execution Freeze — ADR-0017):** new AI-TRADER modules, migrations, repositories, and integration tests target Postgres only. Do not add new SQLite migrations or SQLite adapters for new trader features until Post-MVP (DEE-85).

**Production apply:** targeted SQL only on `waia-prod` (no blind `pnpm db:migrate:postgres` — see WAIA Core M1 runbook).

## Validation

```bash
pnpm db:migrate && pnpm test --run
# Postgres path when in scope:
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```

**Migration-bearing PRs (`db/migrations_postgres/**`)** auto-trigger the path-filtered
[`postgres-integration`](../.github/workflows/postgres-integration.yml) workflow, which applies every
migration from an empty DB and runs `db:smoke:postgres`. The validation prelude
([`scripts/postgres-validation/prelude-auth-stub.sql`](../scripts/postgres-validation/prelude-auth-stub.sql))
creates NOLOGIN `authenticated`/`anon` role stubs + `auth.users` so RLS migrations (`0004+`) apply on
bare Postgres — validation-only, never production (DEE-287). If you cannot run Postgres locally
(no Docker), rely on this workflow rather than waiving Postgres validation.
