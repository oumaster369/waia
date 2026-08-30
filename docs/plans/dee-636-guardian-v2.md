---
integrationIssue: DEE-636
integrationTitle: "Guardian V2 open-position thesis reassessment"
parentIssue: DEE-601
branch: dee-636-guardian-v2
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [focused-negative-tests, lifecycle-parity, tenant-isolation, typecheck, production-build, one-full-fresh-migrated-sqlite-suite, independent-exact-head-review, authoritative-postgres-and-dee-653]
approvalGates: [ratified-dee-636-contract, exact-head-independent-review, dee-653-exact-head-admission]
authoritativeBase: d6e09ffa3d1b93180910148c51d8c5cd6ce344cf
state: local-validation
provenance:
  createdFrom: post-dee-635-merge-admission
  authoritativeBase: d6e09ffa3d1b93180910148c51d8c5cd6ce344cf
  admissionAudit: "The branch and frozen contract were created from the exact DEE-635 squash merge before semantic implementation."
---

# DEE-636 — Guardian V2 open-position thesis reassessment

## Frozen contract

Guardian V2 continuously reassesses every canonically open position against a pinned Reality frontier and fresh, qualified evidence. Each run emits one immutable, content-addressed `GuardianAssessmentV2` per tenant, open position/lot and reassessment frontier. The assessment records the exact opening causal-lineage digest from DEE-635, Reality identity/frontier, evidence identity, information-sufficiency profile and a bounded recommendation.

The ordinary change path remains `Reality + fresh evidence → GuardianAssessmentV2 → Decision V2 → Risk V2 → Execution V2 → Reality`. Guardian is not a second discretionary Trader and has no direct capital-effect authority. It may recommend hold or exposure reduction, but must never increase exposure, reverse, average down, manufacture an open position from order status, or bypass Decision/Risk/Execution.

The only narrow exception is a previously Decision-sealed `ProtectiveActionMandateV2` whose exact deterministic trigger is satisfied by canonical Reality. That exception still flows through Risk and Execution, is reduction-only, and fails closed on missing/mismatched/stale mandate, trigger, lineage, tenant or Reality identity.

This slice executes only `REDUCE_PARTIAL` and `CLOSE_FULL`. `TIGHTEN_PROTECTION` is a sealed recommendation/mandate value but is deliberately non-executable: the authority and pipeline fail closed with `GUARDIAN_PROTECTIVE_TIGHTEN_REQUIRES_DEDICATED_EXECUTOR` until a separately admitted executor can prove that a venue-side protection change cannot add, reverse or amplify exposure. No Admin or tenant action control is introduced here.

Loss of `NEW_OPPORTUNITY` information sufficiency does not by itself blind an open-position reassessment. Guardian uses the separately versioned `OPEN_POSITION_REASSESSMENT` sufficiency profile and records its exact result.

## Owned surfaces

- new additive `lib/trader/guardian/v2/**` authority
- exact read-only bindings to canonical Reality, DEE-635 opening lineage and qualified evidence
- additive persistence/schema required for immutable assessments and deterministic replay
- Decision V2 input projection for ordinary Guardian recommendations
- reduction-only protective-mandate validation before Risk V2
- separate Admin operator and tenant-scoped read-only observability projections (library read models only; no UI/API surface is claimed in this slice)
- focused unit/integration/PostgreSQL tests
- this plan and execution manifest

## Forbidden changes

- legacy Guardian semantics except explicit adapters into the new V2 boundary
- Forecast/Decision economics, Risk sizing/permission policy or Execution connector behavior
- scientific formulas, accounting/PnL/HWM semantics
- holdout, production/live enablement or capital gates
- any direct order submission or exposure-increasing Guardian action

## Ordered implementation

1. Freeze `GuardianAssessmentV2`, canonical serialization/digest and fail-closed validation.
2. Bind each assessment to an existing tenant-scoped canonically open position/lot, its immutable DEE-635 opening lineage, exact Reality frontier and qualified evidence.
3. Implement deterministic idempotent assessment persistence, replay/restart parity and tenant isolation.
4. Project ordinary recommendations into Decision V2 without direct Risk/Execution access.
5. Add the narrow, Decision-sealed, deterministic and reduction-only protective mandate validator; keep `TIGHTEN_PROTECTION` fail-closed pending a dedicated executor.
6. Expose separate Admin and tenant read-only assessment/coverage projections without introducing action controls.

## Acceptance

- Every canonically open position has deterministic Guardian coverage at the admitted Reality frontier.
- Same canonical input bytes yield the same assessment id/digest; mutation changes the digest and mismatches fail closed.
- Missing/cross-tenant/stale Reality, evidence, opening lineage or protective mandate blocks action.
- Guardian cannot increase/reverse/average down or submit directly to a connector.
- Ordinary changes re-enter Decision V2; protective actions remain reduction-only and still pass Risk V2 and Execution V2.
- `TIGHTEN_PROTECTION` remains non-executable and visibly blocked by contract/read-model status until a separately admitted executor exists.
- SQLite/PostgreSQL, restart/replay, tenant isolation, full fresh suite, exact-head review, authoritative CI and DEE-653 pass before merge.
