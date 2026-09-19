---
integrationIssue: DEE-638
integrationTitle: "Build Closed-Trade Accounting → Billing V2 Realized-Profit/HWM Authority Boundary"
parentIssue: DEE-601
branch: dee-638-closed-trade-billing
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
  onMerge: In Progress
state:
  status: in-progress
  currentWorkPackage: WP-4
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4]
  remainingWorkPackages: [WP-5]
  prNumber: 610
  prUrl: https://github.com/oumaster369/waia/pull/610
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Library spine merged in #610. Orchestrator cutover is DEE-1023. Remaining on DEE-638: Reality lookup, receipt persistence, unique index, lifecycle naked-close quarantine."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-638 — Closed-trade settlement and Billing V2 profit/HWM receipts

## Goal

Prove one fail-closed commercial chain:

`Reality TruthRecords → ClosedTradeSettlementV2 → RealizedStrategyProfitReceiptV2 →
BillingAssessmentV2 → BillingHwmEventV2 / InvoiceBasisReceiptV2 (DRAFT basis only)`.

Unknown financial truth is not revenue. Billing never authors Reality, never BUY/SELL, and never
uses equity, unrealized marks, or deposits as a fee base. Fee = 30% of net new Realized Strategy
Profit above Billing HWM. Trading losses never lower Billing HWM.

This batch adds the library spine. It does not rewrite `billing-period-close-orchestrator`.

## Canon check

- Step 19 is already ratified: performance fee is 30% of net new realized strategy profit above
  Billing HWM. This issue does not reopen realized-vs-equity.
- `CloseAndMaterializeInput.realizedPnl` remains a naked caller number on the existing
  orchestrator. V2 builders refuse that seam. Cutover is WP-5.
- Risk HWM / `equityHwm` cannot populate Billing HWM.
- Invoice basis is DRAFT only. ISSUED / collection stay behind the Human manual gate.

## Work packages

### WP-1 — ClosedTradeSettlementV2

Content-addressed settlement that requires Reality truth-record digests, a fully closed lifecycle,
org/account/symbol scope, and cashflow + admitted cost facts. Partial or incomplete lifecycle
refuses. `capitalAuthority` is `NONE`. No venue writes.

### WP-2 — RealizedStrategyProfitReceiptV2

Receipt pins the exact settlement digest set and carries gross, admitted costs, and net realized
strategy profit. Deposits, withdrawals, unrealized marks, and naked caller PnL are refused as
profit.

### WP-3 — BillingPolicyV2 + BillingAssessmentV2

Frozen policy rate `0.30` is versioned and not a free caller parameter. Assessment consumes the
receipt plus prior Billing HWM. `BillableProfit = max(0, cumulative - priorHWM)`.
`PerformanceFee = BillableProfit × 0.30`. HWM never decreases on trading losses. Duplicate receipt
replay is deterministic.

### WP-4 — InvoiceBasisReceiptV2 + consumer inventory

DRAFT basis only; not ISSUED or collection authority. Billing V2 modules must not import
execution/live/connector `placeOrder`.

### WP-5 — Orchestrator cutover (DEE-1023)

Do not rewrite `billing-period-close-orchestrator` in the DEE-638 library-spine
batch. The cutover lives on [DEE-1023](https://linear.app/deepsense/issue/DEE-1023)
and `docs/plans/dee-1023-billing-period-close-receipt.md`.

## Non-goals

- No production `0211`, H2/post-H2, C3, observation host, live-enable, capital, or Execution Server.
- Do not wire billing restriction into Risk/Execution (DEE-774).
- No paper/billing orchestrator rewrite in the DEE-638 library-spine PR.
- No DRAFT → ISSUED automation and no collection/payment authority.
