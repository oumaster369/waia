---
integrationIssue: DEE-1013
integrationTitle: "Complete manifest-bound historical finalization"
branch: dee-1013-manifest-bound-historical-finalization
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, linear, github-pr]
executionLabel: backend
requiredValidation: [lint, typecheck, build, unit-targeted, postgres-integration-existing-harness, canon, pr-governance, authoritative-pr-ci]
approvalGates: [human-scope-authorization, integration-ready, human-squash-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-15T11:18:00Z"
  blockedReason: null
  nextAction: "Open one PR to main and stop at Human squash-merge; do not merge from this lane."
provenance:
  createdFrom: chat
  gapRegistry: GAP-B
  supersedes: null
---

# DEE-1013 — manifest-bound historical finalization

## Authority and boundary

Human authorized this independent implementation lane on exact base
`0c85b5485c1f85553a776dfab548025cc387bdea`. It closes GAP-B only: replace the
intentional `GENERIC_OPERATOR_LAUNCH_NOT_THIS_ISSUE` refusal with the positive
O/P/R manifest-bound finalization path.

Legacy/refusal compatibility behavior may remain. The positive finalization path
loads executable/finalizer application code only from the verified R namespace
in the DEE-1011 O/P/R binding. Release
`90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67` may appear only as the preserved O
evidence release and must never be treated as the executable finalizer R
release.

This batch does not execute C1/C2/C3, connect to `waia-org0-exec`, mutate P2 or
any forensic/operator/AI-TWIN worktree, apply migrations, change Forecast or
scientific law, bootstrap, launch a consumer, assemble terminal receipts, or
alter H5/H-OBS.

## Work packages

### WP-1 — verified O/P/R finalizer composition

- Reuse `historical-release-binding-v1.mjs` unchanged.
- Require explicit
  `finalize-only --release-binding --binding-digest --proposal-id --proposal-digest`.
- Load allowlisted finalizer APIs from verified R only.
- Discover exactly one persisted authenticated Human ratification bound to the
  exact CLI proposal, with action
  `RATIFY_FOUR_SURFACE_WF_PREDICTIVE_FOR_HISTORICAL_SIMULATION_ONLY`.
- Complete every identity check before the first scientific/database write.

### WP-2 — adversarial and PostgreSQL proof

- Prove exact binding, frozen R API, proposal/ratification, strict resolver,
  bounded result, and stop-after-finalization.
- Refuse wrong digest/release/tree/evidence, proposal/ratification/org/run
  mismatch, missing resolver, builder fallback, checkout substitution, mixed
  identities, and finalizer source mismatch.
- Reuse the existing disposable PostgreSQL finalizer integration harness.
  Synthetic tests may supplement, not replace, that evidence.

### WP-3 — validation and handoff

- Canonical plan/runbook, targeted tests, lint, typecheck, build,
  `validate:canon`, `validate:pr-governance`, one PR to `main`, stop at Human
  squash-merge.

## Impact contract

- `R_IMPACT=NONE`: R is read and verified as a frozen API/evidence identity;
  evaluator/bootstrap/finalization mathematics are unchanged.
- `P2_IMPACT=NONE`: no producer execution or state mutation.
- `SCIENTIFIC_PROTOCOL_IMPACT=NONE`: operator composition and fail-closed
  identity verification only.
- `MIGRATION_IMPACT=NONE`: no schema or journal change.
