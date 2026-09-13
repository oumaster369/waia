---
integrationIssue: DEE-955
integrationTitle: "Historical observation of unsettled modeled orders"
branch: dee-955-unsettled-observation
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build, e2e, postgres]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Finish local review and freeze exact source; publication remains separately blocked."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-955 — checkpoint-bound unsettled order observation

## Context and scope

The completed original80-cycle local suite leaves an ACCEPTED BUY at its final
permitted bar. Replay completion is not execution settlement. Expose this existing
state in the shared Admin/tenant historical view, without modifying simulation.

## Implementation contract

Read the existing MODELED_EXCHANGE durable snapshot through the resume snapshot
link for the exact same org/account/run/committed cycle, alongside accounting.
Use the actual snapshot validator and its open-order/checkpoint identity binding.
Project only orderId, symbol, side, state, quantity, filledQuantity,
remainingQuantity and cancellation-pending status. No raw OrderRow, credentials,
private exchange identifiers or mutable later-cycle lookup is exposed.

Add the list to each cycle/history and show the current list in the shared UI.
When replay is COMPLETED with nonempty pending orders, explicitly show that
replay ended with unsettled modeled execution. Missing or invalid snapshot must
refuse rather than emit a false empty list. The checkpoint already seals this
state, so its existing event identity remains the change boundary.

## Acceptance and validation

- Unit regressions: empty/accepted/partial/cancel-pending projections; invalid,
  missing or cross-scope snapshots refuse; allowlisted fields only.
- Existing route/stream tenant isolation unchanged; shared UI renders pending
  states and completed-extent warning without claiming live readiness.
- Read-only genuine completed35/80 local PG fixtures show respectively zero/one
  pending order, same Admin/tenant/poll projections, no data mutation.
- Targeted unit/UI tests, TypeScript, lint, build and suitable browser fixture.

## Boundaries

No migration, auth/RLS change, trading logic, new bars, forced settlement,
publication, merge or deployment. Separate local branch from verified main
b5c17263465fc525dd46eab8c8a076b1abde1a69; no cumulative publication or Integration
Train claim. Preserve original experiments and the validated a27b4587 checkout.

## Local validation evidence — 2026-09-07

45 targeted unit tests and one real PostgreSQL rollback-fixture test passed.
Three browser scenarios passed with their production Next build: admission
refusal, paired Admin/tenant updates/polling, and unknown-org refusal. The paired
scenario checks the completed/unsettled warning on both surfaces; mobile layout
was visually reviewed. Full type checking and scoped lint passed.

Read-only projection of the preserved genuine local 35/80-cycle execution databases
passed full Admin/tenant/poll payload parity (excluding only observation wall time),
other-org isolation, and stream disposal. The 35-cycle fixture has zero pending
orders; the 80-cycle fixture has exactly one ACCEPTED BUY of 0.01, filled 0,
remaining 0.01, whose ID matches the scoped canonical persisted order. The actual
full-graph source is separately frozen a27b4587; these checks exercise this new
read-model source on its persisted results, not a new full-graph run.

Failures retained: first browser setup lacked the local SQLite directory;
the PostgreSQL fixture double-encoded its snapshot-digest JSON parameter and was
corrected using explicit text-to-jsonb binding. Neither required weakening the
product validation. A separate diagnostic initially assumed scale-8 formatting
instead of the stored short decimal strings; only that diagnostic was corrected.

These proofs are local. Browser fixtures and real-PG transport checks are separate;
they do not establish authenticated PostgreSQL-backed production observation,
full-corpus qualification, adaptive learning, or live account readiness.
