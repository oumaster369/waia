---
integrationIssue: DEE-637
integrationTitle: "Runtime Authority V2 startup, recovery and posture"
parentIssue: DEE-601
branch: dee-637-runtime-authority-v2
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [focused-negative-tests, restart-recovery-parity, tenant-isolation, typecheck, production-build, one-full-fresh-migrated-sqlite-suite, independent-exact-head-review, authoritative-postgres-and-dee-653]
approvalGates: [ratified-dee-637-contract, exact-head-independent-review, dee-653-exact-head-admission]
authoritativeBase: 0d6e15db0c3d176b63b4f80e95690ad1c83534e8
state: admitted
provenance:
  createdFrom: post-dee-636-merge-admission
  authoritativeBase: 0d6e15db0c3d176b63b4f80e95690ad1c83534e8
  admissionAudit: "The branch and frozen contract were created from the exact DEE-636 squash merge before semantic implementation."
---

# DEE-637 — Runtime Authority V2 startup, recovery and posture

## Frozen contract

Runtime Authority V2 determines whether one concrete runtime instance may participate in the capital-effect path at a trusted adjudication time. Its output is an immutable, content-addressed, tenant-scoped `RuntimeAuthorityAssessmentV2` with one of four monotonically restrictive postures:

`FULL_ANALYSIS_AND_NEW_RISK | NO_NEW_RISK | CLOSE_ONLY | HALT`.

Startup and recovery fail closed. Before `FULL_ANALYSIS_AND_NEW_RISK`, the runtime must prove canonical Reality rebuild, resolved execution uncertainty, Guardian coverage for every open lot, no expired/unvalidated allowance, exact release and promotion identity, credential readiness without secret disclosure, persistence readiness, and a valid exclusive control lease. Missing, stale, mismatched, cross-tenant or ambiguous proof can only preserve or reduce authority.

Runtime Authority never invents a trade, Decision, allowance, execution effect, fill or Reality fact. It does not grant production/live enablement or capital authority by itself; it is an additional upper bound consumed by already-admitted Decision, Risk and Execution gates.

## Owned surfaces

- additive `lib/trader/runtime-authority/v2/**`
- additive persistence for immutable assessments and exclusive lease/epoch evidence
- exact read-only bindings to Reality V2, Guardian V2, Risk allowance, execution uncertainty, release/promotion, credential and persistence readiness
- separate Admin and tenant read-only posture/reason projections
- focused SQLite/PostgreSQL, restart, concurrency, idempotency and tenant-isolation tests
- this plan and execution manifest

## Forbidden changes

- Decision economics, Risk sizing/permission, Execution connector or venue behavior
- Guardian recommendation/protective-mandate semantics
- credential secret storage or disclosure
- scientific formulas, accounting/PnL/HWM, billing or holdout semantics
- production deployment, live enablement, real capital or bypass of existing gates
- treating heartbeat, process liveness or deployment success as authority

## Ordered implementation

1. Freeze posture lattice, canonical assessment bytes/digest and deterministic reason precedence.
2. Bind startup/recovery assessment to exact tenant, runtime/release identity, Reality frontier and trusted adjudication time.
3. Require resolved execution uncertainty and complete Guardian coverage for every canonically open lot.
4. Require allowance expiry/revalidation, credential/persistence readiness, promotion/enable identity and exclusive control lease evidence.
5. Persist assessments and lease epochs append-only with restart/replay/concurrency and tenant isolation.
6. Expose separate read-only Admin and tenant projections; introduce no action control.

## Acceptance

- The same canonical evidence yields the same assessment id/digest and posture; any consumed mutation changes identity or fails closed.
- Authority never rises from stale/missing/ambiguous evidence and never exceeds any stricter upstream posture.
- Unresolved execution effect, incomplete Reality rebuild or missing Guardian coverage prevents new-risk authority.
- Expired allowance, release/promotion/credential/persistence mismatch or invalid lease prevents new-risk authority.
- Concurrent runtimes cannot both hold the same tenant control epoch; restart/replay is deterministic and append-only.
- SQLite/PostgreSQL, tenant isolation, full fresh suite, exact-head review, authoritative CI and DEE-653 pass before merge.

## Execution Server boundary

All contract, persistence, deterministic startup/recovery, failure-injection and observability work is local/CI-capable. A paid Execution Server is not required for this implementation slice. It becomes required only for the later concrete deployed startup/recovery rehearsal and observable historical test through both Admin Console and tenant cabinet; provisioning must wait until those local and CI gates are complete.
