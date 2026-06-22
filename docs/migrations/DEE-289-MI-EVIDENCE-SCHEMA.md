# DEE-289 — Market Intelligence Evidence Record schema

**Linear:** DEE-289 (LD-5a.2a)  
**Risk tier:** T2 (additive schema, org-scoped, RLS)  
**Doctrine:** `docs/ai-trader/AI-TRADER-HYPOTHESIS-EVIDENCE-LEDGER.md` (Ratified)

## Summary

Adds Layer-5a Market Intelligence **Evidence Record** — the keystone append-only fact spine of the Evidence Ledger:

| Table | Mutability | Purpose |
|-------|------------|---------|
| `trader_mi_evidence` | **Append-only** | Org-scoped, version-pinned evidence entries (`FOR`/`AGAINST`/`NEUTRAL`) bearing on a specific hypothesis version with observation + measurement pins and PIT stamps |

Evidence is a **typed link only** — no free-form payload column. Measured values live in pinned observation revisions upstream.

## Migrations

| Backend | File | Purpose |
|---------|------|---------|
| SQLite | `db/migrations/0020_trader_mi_evidence.sql` | Table, indexes, CHECK (`ingest_time >= event_time`), append-only triggers |
| Postgres | `db/migrations_postgres/0029_trader_mi_evidence.sql` | Enums `mi_evidence_direction` + `mi_evidence_kind`, table, indexes, CHECK, mutation-block triggers |
| Postgres | `db/migrations_postgres/0030_trader_mi_evidence_rls.sql` | RLS deny `authenticated`/`anon` |

## Invariants (locked — hostile review R1–R5)

- **Observation pin:** `{ observationId }` — version-exact by immutable row PK (R1).
- **Measurement pin:** `{ measurementKey, measurementDefinitionDigest }` — same as hypothesis registry.
- **Hypothesis pin:** `{ hypothesisId, hypothesisDefinitionDigest }` + denormalized `hypothesisKey`; composite FK enforced.
- **content_digest:** pure fact fingerprint; **`seq` excluded** (R2); reserved nullable refs included in canonical input (always NULL in 5a.2a).
- **No payload:** closed typed input schema; no `evidence_json` (R3).
- **Reserved seams (NULL in 5a.2a):** `null_comparator_ref` (LD-5b), `regime_context_ref` (LD-5c), `trial_registration_ref` (Evidence → Trial, LD-5a.2b FK deferred).
- **Ordering:** per-`(org, hypothesisKey)` monotonic `seq`; service retries on unique-violation (O1).
- **Append-only:** mutation-block triggers on both backends; org DELETE CASCADE is the sanctioned destruction exception (O3).
- **RLS:** defense-in-depth deny policies; primary isolation is app-layer org scoping (O4).
- **Audit:** `trader.mi_evidence.recorded` on entity `trader.mi_evidence`.

## Golden fixture

`tests/unit/trader-mi-evidence-serialize.test.ts` pins digest `99f8a8c364a8b0792c13e3bbf2353d6a6b51076dac1dbef220890ae6507aa99b`.

## Validation

```bash
pnpm db:migrate && pnpm test --run tests/unit/trader-mi-evidence*.test.ts
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```
