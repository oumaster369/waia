# DEE-293 — Market Intelligence Confidence Judgment Ledger schema

**Linear:** DEE-293 (LD-5a.3a)  
**Risk tier:** T2 (additive schema, org-scoped, RLS; derived read-model only)  
**Doctrine:** `docs/ai-trader/AI-TRADER-HYPOTHESIS-EVIDENCE-LEDGER.md` §5.2.2 (DEE-292 v1.2)

## Summary

Adds Layer-5a **Confidence Judgment** — Evidence Ledger record type #3 — plus derived
**Eligibility** and **Signals** (never stored; recomputed at read time).

| Table | Mutability | Purpose |
|-------|------------|---------|
| `trader_mi_confidence_judgment` | **Append-only** | Org-scoped confidence judgments pinned to hypothesis version |

## Migrations

| Backend | File | Purpose |
|---------|------|---------|
| SQLite | `db/migrations/0023_trader_mi_confidence_judgment.sql` | Table, indexes, CHECK (PIT + asserted/withdrawal field rules), append-only triggers |
| Postgres | `db/migrations_postgres/0035_trader_mi_confidence_judgment.sql` | Table, composite FK to hypothesis version, CHECK, mutation-block triggers |
| Postgres | `db/migrations_postgres/0036_trader_mi_confidence_judgment_rls.sql` | RLS deny `authenticated`/`anon` |

## Invariants (locked — DEE-292 / DEE-293)

- **Confidence scale:** `mi-confidence-scale-v1` — `speculative`, `tentative`, `supported`, `strong`, `compelling` stored as TEXT (no pgEnum).
- **Judgment kind:** `asserted` | `insufficiency_attested`; withdrawal maps to eligibility `WITHDRAWN`, never `NO_JUDGMENT`.
- **Derived eligibility:** version-scoped; lifecycle gate claim-scoped (`created_at <= T`); closed five-reason set only.
- **Replay visibility:** `ingest_time <= T` for judgments; never `event_time <= T` as visibility filter.
- **Citations:** same-org, `direction == FOR`, same `hypothesisDefinitionDigest`; `evidenceContentDigest` captured at authoring.
- **Derivation version:** every derived result emits `mi-confidence-derivation-v1`.
- **content_digest (F17):** binds `schemaVersion`, `organizationId`, `hypothesisKey`, `hypothesisDefinitionDigest`, `confidenceScaleVersion`, `level`, `bandLow`, `bandHigh`, `judgmentKind`, `reviewHorizonAt`, `forCitations[]`, `eventTime`, `ingestTime`, `recordedBy`; excludes `seq`, `id`, `createdAt`, derived state.
- **Human authorship:** `recordConfidenceJudgment` requires `actorType` `user` or `admin`.
- **Append-only:** mutation-block triggers on both backends.
- **RLS:** defense-in-depth deny policies.
- **Audit:** `trader.mi_confidence_judgment.recorded` on entity `trader.mi_confidence_judgment`.

## Golden fixture

`tests/unit/trader-mi-confidence-judgment-serialize.test.ts` pins digest `63f761fbf7f49e93d4e5f8e86ae9039cbfabb0ffdfd26f59102daaed1a7d097b`.

## Validation

```bash
pnpm db:migrate && pnpm test --run tests/unit/trader-mi-confidence-judgment*.test.ts
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```
