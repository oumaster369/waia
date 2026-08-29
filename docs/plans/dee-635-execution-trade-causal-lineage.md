---
issue: DEE-635
branch: dee-635-causal-lineage
riskTier: T3
authoritativeBase: 446eb88c8e8ca70525b9d591275883721d08dba1
status: admitted
---

# DEE-635 — Execution-to-closed-trade causal lineage

## Frozen contract

Introduce one versioned, content-addressed opening-lineage envelope that references the exact canonical causal lineage, Forecast V2, Decision V2 and Risk V2 authority consumed by the first exposure-increasing order. The envelope is frozen on first capital action and propagated byte-identically through order, fills, lots, trades and closed trades.

The implementation stores immutable references/digests, not mutable upstream objects. Missing, malformed, cross-tenant, Decision/Risk-mismatched or retrospectively resolved authority fails closed before exposure increase. Close/protective actions preserve the opening envelope and append outcome/cost facts without rewriting intent.

## Owned surfaces

- `lib/trader/execution/**`
- `lib/trader/lifecycle/**`
- additive lifecycle persistence/schema and migrations required for exact parity
- focused unit/integration/PostgreSQL tests
- this plan and execution manifest

## Forbidden changes

- scientific formulas, Forecast V2 construction, Decision V2 economics, Risk V2 sizing/permission policy
- accounting/PnL/HWM semantics
- holdout, production/live enablement or capital gates

## Ordered implementation

1. Freeze the canonical opening-lineage V1 schema, canonical serialization/digest and adversarial validation.
2. Require and cross-bind the exact Decision V2/Risk V2/Forecast/canonical-causal references at exposure-increasing submission.
3. Persist the envelope on order/fill and preserve it across retry, restart and reconciliation.
4. Propagate it byte-identically through FIFO lot/trade/closed-trade lifecycle, including partial and multi-fill paths.
5. Close SQLite/PostgreSQL parity, source-revision mutation, mismatch, immutability and deterministic-digest proofs.

## Acceptance

- A closed trade resolves backward to exact PIT evidence and forward to calibration without legacy signal reconstruction.
- Opening lineage is immutable across open, partial fill, close, restart and reconciliation.
- Missing or mismatched required capital lineage blocks new exposure before connector submission.
- Multi-fill and close paths preserve one byte-identical opening digest.
- Focused, full fresh-migrated SQLite, PostgreSQL, exact-head independent review, authoritative CI and DEE-653 all pass before squash merge.

