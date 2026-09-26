---
integrationIssue: DEE-1103
integrationTitle: "Verify complete billing settlement and policy content"
branch: dee-1103-billing-content-integrity
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1103
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
  nextAction: "Verify serialized content admission; publish one bounded fix."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1103 — billing content integrity

P08 follow-up to DEE-638 on main1bbdb2ab. A pure synthetic reproduction showed that `assertClosedTradeSettlementV2` accepts a copied settlement with changed derived totals and its original digest. Receipt construction then sums those supplied totals; assessment and period admission accept the resulting resealed receipt. A cashflow of100 with a changed net of1000000 therefore produced a synthetic fee300000. This is not evidence that a production invoice was affected.

The assertion rebuilt primitive inputs but did not hash the received object body. The canonical policy assertion checked its claimed canonical digest and explicit rate/version, but not other supplied fields: a changed currency was accepted under the original digest. The assessment rate is already hardcoded to the ratified constant; this defect does not prove caller-selected rates were charged.

## Result

Keep deterministic reconstruction and additionally verify the complete supplied body against its claimed digest. Apply the same whole-body check to the canonical policy, retaining existing rate/version error codes. Builders, valid serialized values, financial rules, digests and storage schemas remain unchanged. Resealing inconsistent settlement totals is still rejected by reconstruction; merely hashing supplied fields would not suffice.

## Acceptance

- Modified totals, fact indexes, versions and authority fields under an old settlement digest are rejected.
- Resealed totals inconsistent with primitive facts are rejected.
- Modified canonical policy metadata and resealed noncanonical policies are rejected.
- Receipt construction, assessment and period admission reject the altered evidence; orchestration rejects before HWM, reporting-period or draft writes.
- Valid JSON roundtrips retain identical receipt digest and the known100 gross minus2 cost gives98 net,29.4 fee and98 HWM.

## Validation

The initial independent pure reproduction is followed by25 adversarial/positive unit cases:20 failed before the fix,25 passed after. Existing billing arithmetic and SQLite orchestration tests retain their previous behavior. Run targeted native PostgreSQL HWM/reporting/idempotency acceptance on the existing isolated profiles, plus lint/typecheck/build, canon/governance, both authority graphs and exact-head PR CI. Full unit suite remains authoritative in PR CI.

## Boundaries and Human gate

Minimal implementation correction under explicit user technical delegation. Self-review is not independent/Human, financial-finality or scientific attestation. No rate, HWM, threshold, settlement denomination, manual issuance rule, ADR, invoice, live state or C3 change. No historical data rewrite.

Content hashes are integrity evidence, not proof of durable Reality origin or financial finality. Caller-authored internally consistent evidence, true cross-order lifecycle attribution, versioned conversion, correction/recovery and persisted source authority remain open under DEE-638. Actual issuance and trading remain operator actions behind their existing gates.

## Local evidence — 2026-09-26

62 targeted tests/5files PASS, including25 integrity cases and existing arithmetic, receipt, lookup, orchestration and ownership regressions. Four actual PostgreSQL tests/4files PASS (HWM, reporting, console idempotency on isolated54329; issue-retry on isolated55525), zero skipped acceptance tests. Lint0errors/324 existing warnings, typecheck/build, canon/governance and both authority graphs PASS. Graph content seals unchanged. Exact-head PR CI remains the integration gate; no production deployment or financial readiness claimed by local validation.
