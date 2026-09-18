---
integrationIssue: DEE-639
integrationTitle: "Build Canonical Runtime V2 Recurring Orchestrator + Capital-Effect Spine + Eliminate Authority Bypasses"
parentIssue: DEE-601
branch: dee-639-canonical-runtime-orchestrator
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
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Library spine PR to main with Linear keep-open. Remaining WP-5 is paper/live cutover, not this merge."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-639 — Canonical runtime orchestrator (library spine)

## Goal

Prove one capital-authoritative algorithm for ordinary new exposure:

`AuthoritativeRuntimeContextV2` → Navigator V2 → Predictive Admission → Forecast V2 →
Decision V2 → RiskAllowance V2 → `ExecutionAdmissionProofV2` → Execution V2.

This batch creates the envelope, the admission proof, the epistemic compose, the recurring
ordinary cycle wrapper, and a frozen capital-bypass inventory. It does not cut paper/live
orchestrators over, apply `0211`, or touch C3 / holdout / capital / observation.

## Canon check

- Step 20 creates no new economic authority. Runtime context is `ENVELOPE_ONLY`; admission
  proof is `PROOF_ONLY`.
- Two provenance patterns only: ordinary Decision→Risk→Execution, and Decision-sealed
  protective mandate + trigger. `becauseEmergency=true` is not authority.
- DEE-771/772/773/647/774 are consumed, not reimplemented. Missing Navigator, RESEARCH_ONLY
  Predictive Admission, raw MKB injection, and unqualified feedback fail closed.
- Production write-enabled ingress remains `lib/trader/execution/v2/connector-dispatch.ts`.

## Work packages

### WP-1 — AuthoritativeRuntimeContextV2

Content-addressed envelope pinning organization/account/symbol/PIT, runtime posture,
drift posture, and qualification/package/contract/need-plan/release digests.

### WP-2 — ExecutionAdmissionProofV2

Ordinary and protective proofs. Identity/quantity mismatch, consumed/revoked allowance,
runtime/drift halt, new exposure under restriction, and emergency flags refuse.

### WP-3 — Epistemic compose + ordinary recurring cycle

`composeCanonicalEpistemicSpineV2` then `runCanonicalOrdinaryCapitalCycleV2`, which reuses
`runDecisionCapitalAuthorityV2` and gates `execute` on the ordinary admission proof.

### WP-4 — Capital-bypass inventory

Frozen seam list with `CANONICAL | MIGRATE | READ_ONLY | RESEARCH_ONLY | QUARANTINE`.
Unresolved write-capable findings must be empty. Forbidden prefixes cannot call `placeOrder`.

### WP-5 — Paper/live cutover (deferred)

Wire `run-live-cycle.ts` / `paper-cycle-runner.ts` to the recurring builder without breaking
existing paper Decision V2 tests. Keep Linear open until this WP is proven.

## Non-goals

- No production `0211`, H2/post-H2, C3, observation host, HTX keys, live-enable or capital.
- No Execution Server requalification (DEE-643).
- No Billing V2 (DEE-638) and no Strategy Evolution loop (DEE-646) in this PR.
