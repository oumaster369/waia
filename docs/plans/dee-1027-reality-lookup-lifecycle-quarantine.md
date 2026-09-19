---
integrationIssue: DEE-1027
integrationTitle: "Reality lookup + lifecycle naked-PnL quarantine (no 0211)"
parentIssue: DEE-601
branch: dee-1027-reality-lookup-lifecycle-quarantine
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "PR to main after independent in-diff P1=0 P2=0 and required CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1027 — Reality lookup + lifecycle naked-PnL quarantine

Packed remaining [DEE-638](https://linear.app/deepsense/issue/DEE-638) seams
that do **not** need production `0211` and do **not** touch C3.

## Goal

Project `ClosedTradeSettlementV2` from Reality `TruthRecordV2` facts. Refuse
naked `realizedPnl` at `closeReportingPeriod`. Stop treating live fill-walk PnL
as Billing authority.

Unknown financial truth is not revenue.

## Canon check

- Step 19: Billing consumes `RealizedStrategyProfitReceiptV2`, never a naked
  caller number.
- Reporting period is scope/projection. Period `realizedPnl` may only be written
  after receipt admission.
- Order-book / fill-walk PnL is not Reality.
- No production `0211`. Receipt tables and unique index stay Human-blocked.
- Historical Simulation V2 / C3 (`DEE-903`/`904`) stay out of this batch.

## Work packages

### WP-1 — Reality lookup library

`lookupClosedTradeSettlementsFromRealityV2` consumes in-memory TruthRecords.
Fully closed buy+sell FILL groups with SETTLED fees and matching STRATEGY_REALIZED
cashflow become settlements. Incomplete remaining quantity is omitted. Unlinked
cashflow, mixed SETTLED/OBSERVED flattened fills, and org/account mismatch
refuse. No venue writes.

### WP-2 — Lifecycle close quarantine

`CloseReportingPeriodInput` requires receipt + settlements. Admission uses
`billing-period/v2:{org}:{account}:{open.periodStart}/{periodEnd}` before the
period write. Naked close → `NAKED_REALIZED_PNL_REFUSED`. Caller `realizedPnl`,
if present, must match admitted net. `closeAndMaterialize` passes the receipt
through.

### WP-3 — Reporting-bridge

`proveLiveFillReportingReadable` refuses fill-walk PnL. Missing Reality facts
throw `NAKED_REALIZED_PNL_REFUSED` before HWM bootstrap. With facts it uses WP-1
lookup + receipt, then lifecycle close.

## Acceptance

- Fully closed buy+sell FILL + SETTLED fees + matching cashflow → one
  settlement; digest replay-stable.
- Partial remaining qty is omitted; unlinked cashflow / unsettle fills / org
  mismatch refuse.
- Deposit-like unlinked inflow is not Realized Strategy Profit.
- `closeReportingPeriod` without receipt → `NAKED_REALIZED_PNL_REFUSED`; period
  stays OPEN.
- Receipt-backed close writes admitted net as period projection.
- Reporting-bridge without Reality facts refuses before HWM write.
- No production `0211`.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, targeted billing/live unit tests.

## Non-goals

- Production `0211`, receipt persistence, unique index.
- C3 hosts, `historical-simulation-v2.ts` Decision V2 cutover.
- Holdout, capital, Execution Server, observation VPS, org live-enable.
- DEE-646 remaining loop; DEE-1017.
