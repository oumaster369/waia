# DEE-286 — Market Intelligence Hypothesis Lifecycle (LD-5a.1b)

**Linear:** DEE-286 (LD-5a.1b)  
**Risk tier:** T2 (additive Postgres enum extension; org-scoped; existing RLS)  
**Doctrine:** `docs/ai-trader/AI-TRADER-HYPOTHESIS-EVIDENCE-LEDGER.md` §7 (Lifecycle Model)

## Summary

Extends the DEE-285 Hypothesis Registry with **human-recorded lifecycle transitions** validated against the ratified doctrine §7 transition matrix. Current state remains derived from the append-only `trader_mi_hypothesis_lifecycle` ledger (max-`seq` row); no mutable lifecycle column is added.

## Lifecycle states (frozen)

`PROPOSED` → `VALIDATING` → `VALIDATED` → `DECAYING` → `RETIRED` | `QUARANTINED`

Allowed transitions (exactly 7):

| From | To |
|------|-----|
| PROPOSED | VALIDATING |
| VALIDATING | VALIDATED, QUARANTINED |
| VALIDATED | DECAYING, QUARANTINED |
| DECAYING | VALIDATED, RETIRED |

Terminal: `RETIRED`, `QUARANTINED` (no outgoing transitions).

## Governance

- **Machine researches; human promotes** — all transitions require `actorType ∈ {user, admin}` and non-empty `recordedBy`.
- No automatic, scheduled, or derived transitions in this slice.
- Initial `PROPOSED` bootstrap remains owned by LD-5a.1a (`registerHypothesis`).

## Migrations

| Backend | File | Purpose |
|---------|------|---------|
| SQLite | *(none)* | `lifecycle_state` is plain `text`; vocabulary enforced in app layer |
| Postgres | `db/migrations_postgres/0028_trader_mi_hypothesis_lifecycle_states.sql` | `ALTER TYPE mi_hypothesis_lifecycle_state ADD VALUE` for 5 new states |

## Service surface

- `transitionHypothesisLifecycle(context, input)` — matrix-validated append (`seq = latest + 1`)
- `getHypothesisWithCurrentState(context, hypothesisKey)` — derived read model
- Existing reads unchanged: `getCurrentLifecycleState`, `listLifecycleEvents`

## Audit vocabulary

`trader.mi_hypothesis.lifecycle_transitioned` over entity type `trader.mi_hypothesis_lifecycle`, metadata `{ fromState, toState, seq, rationale, hypothesisKey, hypothesisId }`.

## Rollback

Postgres: enum values cannot be removed without type recreation; rollback = document-only (no rows use new states until transitions occur). SQLite: no DDL change.

## Validation

```bash
pnpm db:migrate && pnpm test --run tests/unit/trader-mi-hypothesis*.test.ts
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
```
