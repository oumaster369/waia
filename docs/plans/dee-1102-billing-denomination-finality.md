---
integrationIssue: DEE-1102
integrationTitle: "Reject unconverted billing facts and implicit finality"
branch: dee-1102-billing-denomination-finality
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1102
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
  nextAction: "Verify fail-closed financial evidence boundary; integrate after DEE-1101."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1102 — preserve billing denomination and manual finality

P08 follow-up to DEE-638/DEE-1027. Base main e9d65bd7. Two independent negative audit probes found that lookupClosedTradeSettlementsFromRealityV2 ignores feeAsset and cashflow asset; a BTC fee or BTC cashflow was treated as the number in the existing USDT fixture. The canonical BillingPolicyV2 currency is USD. A reporting helper also automatically passed realizedFillFinality:true. These are library defects, not proof that an incorrect production invoice was issued.

## Result

Before constructing any settlement, require native cashflow denomination and every admitted closed-settlement nonzero cost denomination to equal the unchanged canonical billing currency. The input contract contains no versioned conversion receipt, so other denominations fail with LOOKUP_CASHFLOW_CONVERSION_EVIDENCE_REQUIRED or LOOKUP_COST_CONVERSION_EVIDENCE_REQUIRED. USDT, USDC and other stablecoins are not implicitly USD. A known exact zero cost does not need a currency conversion because it is not admitted into the cost set. Open-position fees do not enter the closed-settlement cost set and cannot block a separate supported closed group; this is covered by a dedicated mixed open/closed regression.

The reporting bridge passes realizedFillFinality:false. Running a diagnostic/read helper never proves operator attestation. Existing fee computation/manual issuance remain responsible for finality. No rate, HWM formula, threshold, currency policy, settlement stablecoin-par rule or invoice changes.

## Acceptance

- Nonzero BTC/USDT/USDC/unknown costs reject before HWM/period/fee writes.
- BTC/USDT/USDC/unknown cashflows reject without conversion authority.
- Exact zero fee remains zero; native USD synthetic facts retain decimal arithmetic and stable receipt digest.
- Proof execution passes no affirmative finality attestation.
- Existing manual issuance, fee/HWM, billing idempotency and rollback tests remain green.

The previous positive lookup fixtures implicitly treated USDT as the policy currency. They now explicitly use native USD synthetic facts for pure arithmetic tests; they are not venue/lifecycle admission proof. Reproductions first failed eight denomination cases, pre-write denial and finality. A separate fixture precision-string assertion was corrected to the existing decimal comparator; no product rounding changed.

## Validation

pnpm lint, typecheck, build, targeted billing/lookup/live tests, both consumer graph validators, validate:canon, validate:pr-governance and exact-head PR CI. Actual isolated PostgreSQL parity checks use the existing guarded profile127.0.0.1:54329/waia_validate for HWM/reporting/settlement, and the separate55525 profile for issue retry because that test intentionally refuses54329. No production data, keys or venue requests.

## Boundaries and remaining work

This is a minimal fail-closed repair, not a conversion implementation or completion of DEE-638. Versioned conversion evidence and dimensional receipt contracts remain P08 work. Do not invent rates, rewrite old receipts or infer USDT/USD parity. Direct receipt builder/source admission, durable lifecycle attribution and receipt persistence still require separate acceptance. The existing lookup groups by venueOrderId; tests sharing one buy/sell order ID do not establish correct real cross-order lifecycle attribution. Keep that gap open rather than grouping unrelated orders by symbol/account.

The running C3 producer is unaffected. No live trading enable, actual invoice issue, strategy promotion or financial action. Integration is serialized after queued1098–1101 with fresh combined-tree validation. Self-review under the user's explicit technical delegation is not independent/Human or scientific attestation; existing final gates remain open.

## Local evidence — 2026-09-25

78 targeted tests/7files PASS, including18 lookup/bridge tests.8 actual PostgreSQL tests/6files PASS using their correct separate profiles; none skipped in the acceptance runs. Lint0errors/324existingwarnings, typecheck/build/canon/governance and both consumer graphs PASS. No graph inventory/content digest changes. This does not close conversion/lifecycle/runtime acceptance or imply production deployment.
