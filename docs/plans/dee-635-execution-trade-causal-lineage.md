---
integrationIssue: DEE-635
integrationTitle: "Execution-to-closed-trade causal lineage"
parentIssue: DEE-601
branch: dee-635-causal-lineage
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [focused-negative-tests, lifecycle-parity, tenant-isolation, typecheck, production-build, one-full-fresh-migrated-sqlite-suite, independent-exact-head-review, authoritative-postgres-and-dee-653]
approvalGates: [ratified-dee-635-contract, exact-head-independent-review, dee-653-exact-head-admission]
authoritativeBase: 446eb88c8e8ca70525b9d591275883721d08dba1
state: frozen
provenance:
  createdFrom: ratified-dee-635-build
  authoritativeBase: 446eb88c8e8ca70525b9d591275883721d08dba1
  admissionAudit: "Fresh DEE-624 merge base, Linear ownership/dependency audit, and frozen admission preceded semantic implementation."
---

# DEE-635 — Execution-to-closed-trade causal lineage

## Frozen contract

Introduce one versioned, content-addressed opening-lineage envelope that references the exact canonical causal lineage, Forecast V2, Decision V2 and Risk V2 authority consumed by the first exposure-increasing order. The envelope is frozen on first capital action and propagated byte-identically through order, fills, lots, trades and closed trades.

The implementation stores immutable references/digests, not mutable upstream objects. Missing, malformed, cross-tenant, Decision/Risk-mismatched or retrospectively resolved authority fails closed before exposure increase. Close/protective actions preserve the opening envelope and append outcome/cost facts without rewriting intent.

## Owned surfaces

- `lib/trader/execution/**`
- `lib/trader/lifecycle/**`
- exact additive Decision V2 / RiskAllowance V2 projection fields required to pass already-sealed Forecast and canonical-lineage identities into Execution V2
- additive lifecycle persistence/schema and migrations required for exact parity
- Admin operator and tenant-scoped read-only causal-lineage observability
- focused unit/integration/PostgreSQL tests
- this plan and execution manifest

## Forbidden changes

- scientific formulas, Forecast V2 construction, Decision V2 economics, Risk V2 sizing/permission policy
- accounting/PnL/HWM semantics
- holdout, production/live enablement or capital gates

## Authorized scope expansion

The controller authorized this additive expansion after implementation proved that Execution V2 currently carries Decision/Risk identities but not the already-sealed Forecast V2 or canonical causal-lineage identities. The only permitted upstream change is exact pass-through of existing IDs/digests into RiskAllowance/ExecutionPlan contracts. Retrospective lookup, reconstructed intent and invented references remain forbidden. Operator Admin and tenant user observability must remain separate, read-only and tenant-scoped.

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
