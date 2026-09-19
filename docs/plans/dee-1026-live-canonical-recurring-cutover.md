---
integrationIssue: DEE-1026
integrationTitle: "Cut over live-equivalent cycle to canonical Runtime V2 recurring builder"
parentIssue: DEE-601
branch: dee-1026-live-canonical-recurring-cutover
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
  currentWorkPackage: WP-5
  completedWorkPackages: [WP-5]
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

# DEE-1026 — Live-equivalent canonical recurring-cycle cutover

Split from [DEE-639](https://linear.app/deepsense/issue/DEE-639) after `#609` and
paper [DEE-1024](https://linear.app/deepsense/issue/DEE-1024) / `#613`. One
integration issue = one PR; this batch owns only the WP-5 live-equivalent
orchestrator cutover.

## Goal

`runLiveCycleOnce` ordinary ENTER_LONG goes through
`runCanonicalOrdinaryCapitalCycleV2` (epistemic compose → GATE_ONLY admission →
Decision V2 → Risk → Execution V2). Do not enable live trading.

## Canon check

- Step 20: paper and live share the same authority graph wherever semantics apply.
- Missing Navigator, RESEARCH_ONLY Predictive Admission, raw MKB, and unqualified
  future-cycle effect fail closed before capital-shaped live-equivalent execution.
- GATE_ONLY admission stays unbound: `planBound: false`, `executionPlanDigestHex: null`.
- Do not invent Navigator or future-cycle receipts.
- Live-cli / integration that omit Decision V2 deps still fail closed with
  `decision_v2_authority_missing`.
- Do not enable org live trading or weaken live-enable / cooling-off /
  `FORBIDDEN_RUNTIME_KEYS`.

## Work packages

### WP-5 — Live-equivalent orchestrator cutover

Replace the bare `runDecisionCapitalAuthorityV2` live-equivalent entry with
`runCanonicalOrdinaryCapitalCycleV2`. Build `AuthoritativeRuntimeContextV2` from
the cycle's org/account/symbol/PIT and caller-supplied runtime/drift postures
and digests. Map compose/admission `NO_TRADE` onto existing
`decision_v2_no_trade` without claiming execution. Keep
`decision_v2_authority_missing` when Decision V2 deps are omitted. Update the
capital-bypass inventory so `live-cycle-once` is `CANONICAL`. Leave reporting
bridge, billing, historical simulation, C3, and live-enable untouched.

## Acceptance

- Live-equivalent actionable buy path with V2 deps calls
  `runCanonicalOrdinaryCapitalCycleV2` and does not contain
  `runDecisionCapitalAuthorityV2` except inside that builder.
- Missing Decision V2 deps → `decision_v2_authority_missing`.
- Missing Navigator → no submit.
- Missing envelope / envelope bound to another org-account-symbol-PIT → no submit.
- RESEARCH_ONLY Predictive Admission → no submit.
- Admission template posture ≠ envelope → no submit.
- Successful compose + Decision/Risk still submits through existing live
  Execution V2 deps and reconciles as today.
- `unresolvedWriteCapableCapitalBypassesV2()` remains empty.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, targeted live + runtime-v2 unit
  tests, `pnpm validate:canon`.

## Non-goals

- Do not enable live trading or change org live-enable / cooling-off.
- No production `0211`, C3, holdout, capital, Execution Server, observation host,
  HTX keys.
- Do not rewrite `reporting-bridge.ts` or billing period-close (DEE-638 remaining).
- Do not wire historical simulation in this PR.
- No Billing V2 and no Strategy Evolution in this PR.
