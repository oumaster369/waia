---
integrationIssue: DEE-1084
integrationTitle: "Isolate admin valuation from unrelated market quotes"
branch: dee-1084-admin-valuation-quote-scope
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1084
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-25T07:41:00Z"
  blockedReason: null
  nextAction: "Open the integration PR, require all exact-head CI, squash, deploy merged main and verify production financial reads."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1084 — relevant valuation evidence only

Production acceptance after both observation lookup indexes became valid returned a 37.335-second overview. Each of three accounts contained 1,676 asset rows, almost all confirmed zero. All rows, even cash-only and zero holdings, became `MONEY_PRECISION_UNSUPPORTED`: quote selection parsed the entire market catalog, including unrelated prices beyond the existing eight-decimal arithmetic contract. Per-asset valuation also repeated sorting and hashing of the full quote catalog.

## WP-1 and acceptance

Add a failing regression for an exactly representable cash balance plus unrelated tiny-price quotes and zero holdings. Limit quote input to assets whose observed balance or attributable lot actually requires valuation; USD additionally needs the existing verified FX selection. Preserve confirmed zero values, used-quote provenance, revisions, freshness/skew rules and exact decimal arithmetic. An actually held unsupported input must remain explicitly unavailable. Verify production-sized zero-filled observations and repeat canonical production reader timing; no invented latency/SLO claim.

Only the console read projection and focused regression tests are in scope. Do not modify `lib/trader/risk/numeric.ts`, decimal scale, rounding, fee/HWM/settlement, persisted observations, credentials, grants, execution/Risk/Guardian, live conditions or holdout. The user's express autonomous operational delegation covers this minimal proven read-only financial repair; no independent approval or methodology ratification is claimed.

The observed production cardinality also exposed a presentation defect: the account portfolio rendered all 1,676 catalog rows as holdings. Keep USDT and nonzero or unrecognized quantities visible; collapse only confirmed zero non-USDT rows behind an explicit accessible toggle. The API retains every source row and no amount is changed. Validate expand/collapse and preservation of unavailable nonzero evidence.

Run targeted valuation/account/quote and real-Postgres regressions, lint, typecheck, build, existing Postgres browser acceptance, canon and PR governance. Require all exact-head CI, squash to main, deploy verified main with existing environment and collectors enabled, then verify real read results and latency. Keep accepted unavailable states and source incompleteness visible.
