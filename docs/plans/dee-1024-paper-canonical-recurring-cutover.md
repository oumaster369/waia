---
integrationIssue: DEE-1024
integrationTitle: "Cut over paper cycle to canonical Runtime V2 recurring builder"
parentIssue: DEE-601
branch: dee-1024-paper-canonical-recurring-cutover
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

# DEE-1024 — Paper canonical recurring-cycle cutover

Split from [DEE-639](https://linear.app/deepsense/issue/DEE-639) after `#609`. One
integration issue = one PR; this batch owns only the WP-5 paper orchestrator cutover.

## Goal

Paper `executionMode === "paper"` entry goes through
`runCanonicalOrdinaryCapitalCycleV2` (epistemic compose → GATE_ONLY admission →
Decision V2 → Risk → Execution V2). No live cutover in this batch.

## Canon check

- Step 20: paper and live share the same authority graph wherever semantics apply.
- Missing Navigator, RESEARCH_ONLY Predictive Admission, raw MKB, and unqualified
  future-cycle effect fail closed before capital-shaped paper execution.
- GATE_ONLY admission stays unbound: `planBound: false`, `executionPlanDigestHex: null`.
- Do not invent Navigator or future-cycle receipts.
- Guardian / HTR protective cancel remains the reducing lane and is not routed
  through ordinary ENTER_LONG.
- Paper remains physically unable to cause a real venue effect.

## Work packages

### WP-5 — Paper orchestrator cutover

Replace the bare `runDecisionCapitalAuthorityV2` paper entry with
`runCanonicalOrdinaryCapitalCycleV2`. Build `AuthoritativeRuntimeContextV2` from
the paper cycle's org/account/symbol/PIT and caller-supplied runtime/drift
postures and digests. Map compose/admission `NO_TRADE` onto existing
`decision_v2_no_trade` without claiming execution. Keep
`decision_v2_authority_missing` when Decision V2 deps are omitted. Update the
capital-bypass inventory so `paper-cycle-runner` is `CANONICAL`; leave
`run-live-cycle` as `MIGRATE`.

## Acceptance

- Paper actionable buy path with V2 deps calls `runCanonicalOrdinaryCapitalCycleV2`
  and does not call `runDecisionCapitalAuthorityV2` except inside that builder.
- Missing Navigator → no paper submit.
- RESEARCH_ONLY Predictive Admission → no paper submit.
- Admission template posture ≠ envelope → no paper submit.
- Successful compose + Decision/Risk still submits through existing paper
  Execution V2 deps and reconciles as today.
- Existing `decision_v2_authority_missing` tests stay green.
- `unresolvedWriteCapableCapitalBypassesV2()` remains empty.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, targeted paper + runtime-v2 unit
  tests, `pnpm validate:canon`.

## Non-goals

- Do not wire `lib/trader/live/run-live-cycle.ts`.
- No production `0211`, C3, holdout, capital, Execution Server, observation host,
  HTX keys.
- No Billing V2 (DEE-638/1023) and no Strategy Evolution (DEE-646) in this PR.
- Do not enable live trading.
- Do not weaken `FORBIDDEN_RUNTIME_KEYS` on either host.
