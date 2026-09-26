---
integrationIssue: DEE-1114
integrationTitle: "Reject punctuation-only decimal inputs"
parentIssue: DEE-638
branch: dee-1114-decimal-input-syntax
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: integration-readiness
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Obtain accepted-base delta review; controller completes final integration readiness and exact-head CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1114 — Require a digit in decimal input

## Confirmed defect and bounded correction

M01 C06 / completion-plan D26, independently reproduced on accepted main
`55bcefa4128b716915574971a0a7f28c4f4b12f9`: `normalizeDecimalString` permits both
integer and fractional parts to be empty. Consequently `.` and `-.` (including
outer whitespace) become zero. The actual offline settlement builder accepts
these values as remaining quantity, a cost or cashflow and canonicalizes them.
This violates numeric syntax; it is not a change to the financial methodology.

Require at least one digit across the integer/fractional components before their
existing normalization and BigInt conversion. Preserve `.1`, `1.`, negative
values, signed zero, surrounding whitespace, eight-decimal precision and all
current arithmetic/truncation behavior. Do not add coercion, `Number` conversion,
leading-plus, exponent, hexadecimal, locale or Unicode digit syntax.

## WP-1 — Primitive correction and downstream refusal proof

Production change is limited to `lib/trader/risk/numeric.ts`.

- `trader-risk-numeric.test.ts`: digitless refusals, valid representations,
  negative zero, large exact values, precision bounds and positive/negative
  arithmetic truncation.
- `trader-decimal-billing-boundary.test.ts`: actual settlement-builder refusal
  for each malformed remaining quantity/cost/cashflow, exact valid zero/loss/cost
  controls through settlement → receipt → period-profit admission, unchanged
  digest tamper refusal and positive Risk limit refusal/control.
- `trader-billing-reality-truth-integrity.test.ts`: malformed decimal Truth content
  cannot be resealed or passed to the actual lookup; stable typed lookup refusal
  remains `LOOKUP_INVALID_TRUTH_RECORD`.

Execute new tests before correction (RED), then focused primitive/billing/Risk/
Truth suites after correction (GREEN). Existing billing guards map invalid numeric
syntax to their existing domain refusal codes; no guard or financial formula is
rewritten. Risk and Truth already rejected this punctuation at their own admission
boundaries, so this is not claimed as a demonstrated Risk bypass repair.

### Accepted-base integration — 2026-09-26

The implemented correction and independent review are frozen at author commit
`ad62b99dfe92e15d9b9a1b9ebc507a918f830e8e`. Local merge
`8be885dd269bb50d17689f184873cac4dda6b2ff` incorporates exact accepted main
`ed2a25f72008a97211c9454fd29d4f62a65508b2` without conflict. The five author paths
and 28 incoming paths do not overlap. Blob equality and binary diff equality in
both directions prove the author patch and incoming code unchanged at the merge.
The following documentation supplement changes only this plan.

All original 122 focused cases across eight suites pass on the accepted base;
scoped ESLint and diff checks pass. The 12 incoming mandatory PostgreSQL suite
registrations, workflow, executed-proof guard and native test blobs are preserved
exactly. No native PostgreSQL test is run or claimed by this integration.

Previous full readiness evidence is bound to the earlier author head/base. Current
accepted-base delta review, controller full readiness and final PR CI remain
required; they are not represented as complete by these scoped results.

## Validation and limits

Root coordinates global lint/typecheck/build, canon/governance/preflight and
exact-head CI after author handoff. Author runs focused unit tests, scoped eslint
and diff check only. No DB, venue, production, C3 or live action is necessary.

Fixtures contain invented digest-shaped identities solely for offline arithmetic
and integrity contracts. They do not prove durable source provenance, financial
finality, real profit or authority to issue invoices. There is no demonstrated
production financial corruption and no retrospective data repair. Fee rate, HWM,
settlement, source authority, authorization and all Human gates remain unchanged.


### Accepted-base refresh 2565e1a2

Normal merge `751f4550cb145f85f143455e51ca10d0e668d16f` incorporates accepted main `2565e1a23741d0042096fd8209cd9793e8aa7e19` without conflicts. All five original author paths and six incoming paths are disjoint and their blobs preserved exactly; only this plan supplement changes afterward. All 13 incoming mandatory native suites and registration/guard remain intact; preservation is not new native execution. Root schedules fresh scoped offline acceptance, full repository readiness and independent final integration review before publication, followed by all applicable exact-head CI checks. Decimal grammar, arithmetic, financial policy and previous qualification limits remain unchanged.
