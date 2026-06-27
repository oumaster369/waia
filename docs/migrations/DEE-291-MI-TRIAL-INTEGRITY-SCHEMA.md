# DEE-291 — Market Intelligence Trial Integrity Invalidation Ledger schema

**Linear:** DEE-291 (LD-5a.2c)  
**Risk tier:** T2 (additive schema, org-scoped, RLS; derived read-model only)  
**Doctrine:** `docs/ai-trader/AI-TRADER-HYPOTHESIS-EVIDENCE-LEDGER.md` §5.2.1 (DEE-290)

## Summary

Adds Layer-5a **Trial Integrity Invalidation Ledger** — append-only invalidation events
that replace the DEE-289 derived-integrity stub with a ledger-backed fold
(latest-transition-wins). Integrity remains **derived**; no `integrity_status` column on
`trial` or `evidence`.

| Table | Mutability | Purpose |
|-------|------------|---------|
| `trader_mi_trial_integrity_event` | **Append-only** | Org-scoped invalidation (and future reinstatement) events per trial |

## Migrations

| Backend | File | Purpose |
|---------|------|---------|
| SQLite | `db/migrations/0022_trader_mi_trial_integrity.sql` | Table, indexes, CHECK (PIT + conditional reason), append-only triggers |
| Postgres | `db/migrations_postgres/0033_trader_mi_trial_integrity.sql` | Enums, table, composite FK to trial, CHECK, mutation-block triggers |
| Postgres | `db/migrations_postgres/0034_trader_mi_trial_integrity_rls.sql` | RLS deny `authenticated`/`anon` |

## Invariants (locked — DEE-290 / DEE-291 grooming)

- **Not a fifth Evidence Ledger record type** — derivation substrate for trial integrity only.
- **No mutation** of `trader_mi_trial` or `trader_mi_evidence`.
- **Event types:** MVP `invalidated`; enum reserves `reinstated` (no write path in this slice).
- **Reason taxonomy (exactly four):** `look_ahead_contamination`, `pre_registration_breach`, `computation_defect`, `provenance_gap`.
- **Fold:** latest event by `seq` wins; no events ⇒ `valid`.
- **Derived API:** `getTrialIntegrity` → `{ status, reasonCode, since, latestEventId } | null`; `listTrialIntegrityEvents` → full stream.
- **content_digest:** binds `schemaVersion`, `organizationId`, `trialId`, `eventType`, `reasonCode`, `rationale`, `causeRef`, `eventTime`, `ingestTime`, `recordedBy`; excludes `seq` and derived state.
- **Ordering:** per-`(org, trial_id)` monotonic `seq`; service retries on unique-violation.
- **Append-only:** mutation-block triggers on both backends.
- **RLS:** defense-in-depth deny policies.
- **Audit:** `trader.mi_trial_integrity.invalidated` on entity `trader.mi_trial_integrity`.

## Golden fixture

`tests/unit/trader-mi-trial-integrity-serialize.test.ts` pins digest `83e7b10542afaada8d3b043afcd75d3dd18e6ea278ce1e1a5181174df4662983`.

## Validation

```bash
pnpm db:migrate && pnpm test --run tests/unit/trader-mi-trial-integrity*.test.ts
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```
