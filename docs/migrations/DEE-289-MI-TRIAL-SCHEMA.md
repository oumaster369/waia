# DEE-289 — Market Intelligence Trial Registration schema

**Linear:** DEE-289 (LD-5a.2b)  
**Risk tier:** T2 (additive schema, org-scoped, RLS; additive FK on `trader_mi_evidence`)  
**Doctrine:** `docs/ai-trader/AI-TRADER-HYPOTHESIS-EVIDENCE-LEDGER.md` §5.2 (Ratified)

> **Naming note:** `DEE-289-MI-EVIDENCE-SCHEMA.md` in this folder is a pre-existing
> mislabel — that tracker documents LD-5a.2a (Evidence Record), which shipped as Linear
> **DEE-288**. DEE-289 is this Trial Registration slice. The mislabel is left untouched
> here to avoid scope creep; cosmetic rename can be handled in a separate housekeeping PR.

## Summary

Adds Layer-5a Market Intelligence **Trial Registration** — the second Evidence Ledger
record type. An immutable pre-registration that an evaluation attempt occurred against a
specific hypothesis version. Activates the `trial_registration_ref` seam reserved by
LD-5a.2a.

| Table | Mutability | Purpose |
|-------|------------|---------|
| `trader_mi_trial` | **Append-only** | Org-scoped, version-pinned pre-registrations of evaluation attempts against a hypothesis version (PIT stamps; no outcome/score/budget) |

Records only **that an attempt occurred** — no outcome, success/failure, budget, or score.

## Migrations

| Backend | File | Purpose |
|---------|------|---------|
| SQLite | `db/migrations/0021_trader_mi_trial.sql` | Table, indexes, CHECK (`ingest_time >= event_time`), append-only triggers, **Evidence→Trial guard trigger** |
| Postgres | `db/migrations_postgres/0031_trader_mi_trial.sql` | Table, composite FKs (org + hypothesis), indexes, CHECK, mutation-block triggers, **Evidence→Trial composite FK ALTER** |
| Postgres | `db/migrations_postgres/0032_trader_mi_trial_rls.sql` | RLS deny `authenticated`/`anon` |

**Ordering (O4):** the trial table is created before the `trader_mi_evidence`
referential link is added, in both engines.

## Invariants (locked — grooming + hostile review R1/R2)

- **Hypothesis pin only:** `{ hypothesisId, hypothesisDefinitionDigest }` + denormalized `hypothesisKey`; composite FK enforced. **No** `required_nulls_json`, **no** `falsification_conditions_json` — these are sealed transitively in the hypothesis digest and **resolved at read time** (`getTrialPinnedClaim`), never snapshotted (**R1**).
- **Integrity (R2):** **no** `integrity_status` column. Integrity is a **derived read-model** value (`getTrialIntegrity` → constant `valid`). A ledger-backed derivation (invalidation events + reason taxonomy) is deferred to **LD-5a.2c** (doctrine Open Q #6).
- **No `trial_kind`** in this slice (deferred, O2).
- **content_digest:** pure fact fingerprint binding the hypothesis pin + `research_program` + PIT stamps + registrar; **`seq` and derived integrity excluded**.
- **research_program (O1):** nullable free-text grouping hint — no enum, **no grouping/uniqueness index**.
- **Identity:** stable `id`, composite unique `(id, organization_id)`. No version/key/revision/supersedes — trials are immutable attempts.
- **Ordering:** per-`(org, hypothesisKey)` monotonic `seq`; service retries on unique-violation.
- **Append-only:** mutation-block triggers on both backends; org DELETE CASCADE is the sanctioned destruction exception.
- **Evidence → Trial link:** `trader_mi_evidence.trial_registration_ref` stays **nullable**; direction locked Trial(1)→Evidence(N); Trial never mutates Evidence.
  - Postgres: live composite FK `(trial_registration_ref, organization_id) → trader_mi_trial(id, organization_id)` (MATCH SIMPLE — unenforced while ref is NULL).
  - SQLite: cannot `ALTER ADD CONSTRAINT`, so a `BEFORE INSERT` guard trigger enforces the same in-org referential invariant without rebuilding the evidence keystone.
  - Service: `recordEvidence` accepts an optional `trialRegistrationRef` and validates it resolves in-org before insert; `evidence.content_digest` embeds the surrogate trial UUID when linked (O3).
- **RLS:** defense-in-depth deny policies; primary isolation is app-layer org scoping.
- **Audit:** `trader.mi_trial.registered` on entity `trader.mi_trial`.

## Golden fixture

`tests/unit/trader-mi-trial-serialize.test.ts` pins digest `0da15e03d5fc71e8479856d7f8d35b81b50ac0a70e687e63ab18b196aaf357c4`.

## Validation

```bash
pnpm db:migrate && pnpm test --run tests/unit/trader-mi-trial*.test.ts
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```
