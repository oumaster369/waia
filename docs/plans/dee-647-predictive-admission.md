---
integrationIssue: DEE-647
integrationTitle: "Deterministic Predictive Admission Boundary"
parentIssue: DEE-601
branch: dee-647-predictive-admission
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [focused-negative-tests, typecheck, production-build, one-full-fresh-migrated-sqlite-suite, independent-exact-head-review, authoritative-postgres-and-dee-653]
approvalGates: [ratified-dee-627-canon, exact-head-independent-review, dee-653-exact-head-admission]
includedIssues: [DEE-647, DEE-749, DEE-750]
state:
  status: in-progress
  currentWorkPackage: DEE-749
  completedWorkPackages: []
  remainingWorkPackages: [DEE-749, DEE-750]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Implement the frozen admission contracts, compatibility firewall, and evidence suite."
provenance:
  createdFrom: ratified-dee-647-build
  authoritativeBase: b62f8e6432a62227902007b4e97f8bf746360822
  admissionAudit: "Fresh origin/main, Linear duplicate/ownership/dependency audit, and complete producer/consumer/replay/persistence/test/inventory/plan audit passed before implementation writes."
---

# DEE-647 — Deterministic Predictive Admission Boundary

## Frozen API and invariants

1. `MarketStateSnapshotV2` is a content-addressed manifest of causally consumed upstream identities; it never recomputes regime, confidence, strategy, economics, risk, or actionability.
2. `PredictiveAdmissionReceiptV1` is deterministic for one purpose, PIT snapshot, exact Forecast contract binding, and exact DEE-631 scientific-admission receipt.
3. The only mathematical predictor is `anchorRealizedVol20m_1m`; `HypothesisAssessment` is applicability-only.
4. Missing or mismatched scientific admission/package/input-contract/spec/artifact, insufficient ISG, invalid PIT/integrity, incompatible package/state/profile/target/horizon/representation, or failed applicability is `NOT_ADMITTED`.
5. `RESEARCH_ONLY` is a branded non-capital result and cannot be consumed as admitted runtime Forecast input.
6. Runtime posture is an independent upper bound. `NO_NEW_RISK` and `CLOSE_ONLY` may admit position reassessment but never new opportunity; `HALT` admits nothing.
7. Legacy `MsvEnvelope` is explicitly compatibility/telemetry-only. No new Predictive Admission type imports Decision, Risk, Execution, holdout, live, or capital surfaces.

## Admitted surfaces

- `lib/trader/intelligence/predictive-admission/**`
- bounded `lib/trader/intelligence/cde-v0.ts` compatibility declaration only
- `tests/unit/trader-predictive-admission-v1.test.ts`
- `tests/unit/trader-predictive-admission-consumer-inventory-v1.test.ts`
- this plan and adjacent Integration Train manifest

## Acceptance

- Deterministic historical/paper/live-equivalent replay, causal sensitivity, and unrelated-input invariance pass.
- Every fail-closed mismatch and posture monotonicity case passes.
- Static consumer inventory proves the new authority has no capital consumer edge.
- Focused tests, typecheck/build, one fresh SQLite full suite, exact-head review, authoritative CI/PostgreSQL and DEE-653 pass before squash merge.
