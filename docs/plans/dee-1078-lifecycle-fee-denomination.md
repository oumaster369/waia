---
integrationIssue: DEE-1078
integrationTitle: "Lifecycle native fee and net inventory correctness"
branch: dee-1078-lifecycle-fee-denomination
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, lifecycle]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1078
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: implementing
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Verify native fee denomination, inventory conservation and immutable historical evidence."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1078 — lifecycle native fee and net inventory correctness

## Proof and bounded correction

The former FIFO recorder and pure reconstruction open gross base quantities even when the exchange withholds a base fee. Sell legs subtract native fee units from quote proceeds; dividing before allocation can also lose a fee residual. Six concrete tests first produced five failures, preserved in the local validation log.

Use the fill currency to debit net purchased inventory and sold inventory including base fees. Keep avgCost at the fill price and opening fees separately recognized exactly once, preserving the existing operational period convention. Allocate native and quote fee shares with exact decimal arithmetic and a final residual. Validate quantity and denomination before lifecycle writes; an unsupported nonzero fee cannot become a fabricated quote amount. Persist a versioned per-leg fee proof in the existing append-only lifecycle event, so the console can accept corrected new close legs without treating historical unproved base-fee legs as valid.

## Acceptance

No new execution command, Risk/Guardian decision, eligibility, financial policy, HWM, settlement, billing receipt or issued invoice change. No rewriting old lots/legs or history. User explicitly delegated the critical operational review and merge gate; this is a proven accounting implementation repair, not methodology ratification.

Prove base/quote/zero/unknown fee cases, partial and FIFO closes, no fabricated residual, exact fee conservation, persisted recorder/reconstruction parity, unsupported fee rejection before mutations, and historical reader refusal without a matching event. Run lifecycle and console tests, real Postgres regressions, lint/typecheck/build, canon, consumer graph and exact-head CI. Roll out verified main only.


CI authority review: the fee helper must depend only on decimal primitives. Its original type import traversed the order-repository type graph into alerting; use the minimal structural numeric input instead. The observation authority graph is unchanged and must pass with no non-GET closure path.
