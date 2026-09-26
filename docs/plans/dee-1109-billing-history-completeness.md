---
integrationIssue: DEE-1109
integrationTitle: "Reject incomplete billing history and invalid Reality truth"
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
  currentWorkPackage: WP-2
  completedWorkPackages: [WP-1]
  remainingWorkPackages: [WP-2]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "WP-2 focused tests passed; independently review and repeat readiness for the changed PR head."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1109 — billing input completeness and integrity

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

Root integration acceptance adds a thirteenth regression with no existing OPEN
period or HWM, proving refusal before either would be created. All13 new cases
pass. Lint (zero errors), final typecheck, build, canon, governance and both
consumer validators pass. Four native Postgres suites actually ran: period
lifecycle, HWM ledger, invoice issuance and console billing idempotency;4 tests
pass with no skips. These are adjacent valid-path integration checks, not native
proof of the200-row boundary or full financial-source qualification. Independent
review passed on the production commit and the test-only follow-up without
findings. The full unit suite and applicable checks remain required in PR CI.
These WP-1 results preceded the WP-2 extension; they do not accept its changed
PR head. Existing PR checks must run again against the final combined commit.

## WP-2 — validate supplied Reality truth before billing lookup

Independent probes on the same production base found that the exported lookup
accepts a caller-supplied cashflow changed from1 to1000 under its original truth
ID and content digest. The existing `validateTruthRecordV2` returns false, yet
the lookup builds a new internally sealed settlement/receipt and assessment
with net1000 and fee300. Persisted Reality's `mapTruth` already validates content;
this defect is specifically the supplied-array boundary that bypasses that
loader. The only found production helper caller currently omits canonical
profit and refuses; no affected production invoice is established.

Apply the existing Reality validator to every supplied truth record before
reading its scope, markers, assertion or digest, including records the financial
projection would otherwise ignore. Invalid content produces the stable
`LOOKUP_INVALID_TRUTH_RECORD` reason before HWM or reporting effects. Do not
repair or reseal invalid content. Correctly sealed scope, currency, provisional
fill and attribution-marker errors retain their existing behavior.

Acceptance covers cash, fee, denomination, direction, side, quantity, finality,
truth ID, content digest, schema, source ID/digest/native identity and invalid
runtime assertion edits. Valid JSON replay, reversed input order and output
digests remain unchanged. A real reporting-bridge negative proves rejection
before HWM read/bootstrap, period operations or fee computation.

Original regression:18 failures /6 valid controls passed before the guard.
Corrected24 cases plus six adjacent receipt, history, lookup and period suites
pass107 tests across7 files. Independent before/after pure-builder probes retain
the same valid settlement/receipt digests and economics; corrupted truth now
refuses. The broader lifecycle/caller strategy/frontier behavior is intentionally
unchanged and is not accepted as source authority by this test.

The same-order synthetic buy/sell group is only a content-integrity fixture.
Real distinct entry/exit lifecycle binding, persisted active Reality frontier,
supersession/cashflow provenance, source conversion and finality remain open.
Checking a self-consistent hash is not source authentication. No new matching,
allocation, source-admission or settlement/finality rule is introduced.

## Validation and coordination

Run `pnpm test --run tests/unit/trader-billing-history-completeness.test.ts`
and `pnpm test --run tests/unit/trader-billing-reality-truth-integrity.test.ts`
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
