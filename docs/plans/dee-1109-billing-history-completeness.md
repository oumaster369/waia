---
integrationIssue: DEE-1109
integrationTitle: "Refuse billing calculations from truncated reporting history"
parentIssue: DEE-638
branch: dee-1109-billing-history-completeness
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, targeted-unit, build, postgres-integration, validate-canon, validate-pr-governance]
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
  nextAction: "Focused acceptance passed; independent review and root-scheduled readiness before publication."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1109 — complete history before billing calculations

## Proven defect

On main ebff133563273399ea86162cf81d5b9e5e929868, fee computation requests the
newest 200 closed periods and treats that capped page as cumulative profit.
A pure synthetic probe using the real receipt/admission, period, fee and draft
builders admits 201 distinct periods: an oldest loss of1000 followed by200
profits of1. The full history has cumulative profit−800 and fee0; the capped
path instead produces cumulative profit200, fee60 and a DRAFT for60. Human
finality remains false. This proves a library/service defect, not an affected
production invoice or validated durable Reality source.

The Billing & HWM canon requires cumulative net realized strategy profit and
recovery of past losses. Neither the fee formula nor a financial policy change
is needed. The existing period-close orchestrator already refuses a capped
history, but independent fee/draft calls do not.

## WP-1 — one bounded result

Refuse a possibly truncated list before cumulative folding, returning the
existing machine reason `BILLING_PERIOD_LIST_TRUNCATED`. The repository port
does not distinguish exactly200 rows from a truncated200-row page, so exactly
the cap is conservatively refused as well. Increasing the limit would postpone
the defect; it would not prove complete history.

Account for the current period before starting close-and-draft:199 existing
closed periods plus the newly closed period would reach the unsupported cap.
Refuse before bootstrap/open/close effects in the orchestrator and before close
or its audit in a direct lifecycle call with automatic draft materialization.
A lifecycle service without a draft hook does not calculate a fee and retains
its existing behavior. This is an early capacity precheck, not a claim that
all multi-service failures or concurrent writes are transactional.

## Acceptance

- Omitted old losses and profits cannot produce a fee or DRAFT.
- At-cap reads fail explicitly, including a target outside the returned page.
- A direct draft call refuses before invoice lookup/insert/audit.
- The199-to200 close boundary refuses before the tested close/draft effects.
- The198-to199 composed receipt→period→fee→draft chain remains valid.
- Below-cap loss recovery, decimal amounts, current HWM and finality=false are
  preserved; no issued invoice is recomputed or mutated.

Original focused regression:8 failures /3 control passes before production
changes. Port fixtures are synthetic and do not prove database concurrency,
complete payment lifecycle, durable source authenticity or financial finality.

The corrected11-case suite and nine adjacent billing/HWM/period/receipt suites
pass99 tests. A final lifecycle-only/no-draft preservation control expands the
new suite to12 passing tests. Global readiness and native Postgres validation
are not claimed by this focused acceptance.

## Validation and coordination

Run `pnpm test --run tests/unit/trader-billing-history-completeness.test.ts`
plus existing fee, period-close, HWM, draft and receipt tests. Root schedules
native Postgres history/period checks and serializes lint, typecheck, build,
canon, governance and PR preflight. All required exact-head PR CI must pass.
An independent agent reviews the defect, early refusal placement and controls.
This is engineering review, not an independent Human financial attestation.

## Boundaries

No schema, migration, CI, historical data, rate30%, HWM, threshold, settlement,
manual issuance, finality, authorization, C3 or trading change. Full durable
source/lifecycle/conversion/cross-period reuse/correction and crash acceptance
remain open under DEE-638/P08. A paginated complete-history reader and atomic
multi-service close transaction are separate work. User technical delegation
allows the correction and tested integration; it does not fabricate any Human
financial/scientific approval or authorize an actual trade.
