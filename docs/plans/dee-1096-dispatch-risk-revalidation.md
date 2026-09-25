---
integrationIssue: DEE-1096
integrationTitle: "Current Risk revalidation at dispatch and executed PostgreSQL proof"
branch: dee-1096-dispatch-risk-revalidation
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1096
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
  nextAction: "Validate current Risk admission on PostgreSQL, review and run exact-head PR CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1096 — current Risk at execution dispatch

Base: main `e80f5763fde3a9e45aa49c7af75231699601c0f6`. One issue and one PR under DEE-639. Full audit findings D-01, D-10 and D-11 supply the before evidence. Previously, a consumed allowance could dispatch after a committed kill/HALT/divergent reconciliation. Three isolated PostgreSQL regressions called the synthetic submitter despite the downgrade; no exchange call occurred.

## Acceptance

Dispatch obtains the current account lock before the attempt lock, matching the account-first order of Risk consumption/revocation. After acquiring the locks, it checks the sealed consumed allowance against current kill, posture, reconciliation, Reality identity, expiry and strict reduction. Reuse the existing Risk permission predicate; do not consume again or transfer reservations again. Keep current durable effect binding and single submission rules.

The admission linearization point is the transaction committing the revalidation plus `SUBMIT_STARTED`. A restriction that wins this account lock prevents dispatch. A restriction after admission cannot recall an already admitted network effect; Reality/recovery must reconcile it, with no blind resend. No database transaction spans network I/O. A rejected check rolls back the admission and leaves the attempt BOUND, preserving the reservation/pending accounting; terminal pre-submit cancellation and wider Runtime/lease/promotion invalidation remain in the full completion program, not a claimed result of this fix.

Acceptance: zero synthetic callbacks and no SUBMIT_STARTED for post-bind TRIPPED/UNKNOWN/HALT/CLOSE_ONLY entry/stale or divergent reconciliation/changed Reality/changed reconciliation authority/expired allowance/invalid current reduction. A valid current reduction under CLOSE_ONLY remains permitted. A real PostgreSQL blocker test establishes ordering without sleep-based assumptions. Two concurrent dispatchers admit one callback, and locks are released before it runs. Existing atomic bind, timeout/uncertainty, report chains and tenant tests remain green.

The PG16 integration job must execute execution/risk/reality/canonical schema suites. Its JSON report gate rejects missing, failed, empty or skipped suites. Add path triggers for the previously omitted Risk/Reality/test surfaces. Correct the stale pre-0199 zero-policy assertion to verify the actual SELECT/INSERT runner role, org and pre-holdout namespace; retain authenticated denial and immutable-write checks. No RLS policy or migration changes.

## Validation and review

Isolated local PostgreSQL, never production: 55 tests across four required suites. Validate the report gate on actual PASS and deliberate no-PG skipped results (expected failure). Run `pnpm lint`, `pnpm typecheck`, `pnpm build`, Execution and Reality consumer graph validators, `pnpm validate:canon`, governance preflight and authoritative full PR CI. UI e2e is not applicable to this backend-only change.

Review lock order, current-time evaluation after lock waits, immutable identity reconstruction, no mutation on refusal, one admission under concurrent senders, correct protective reduction and no new connector call. Reality inventory source content seal changes only for the reviewed execution authority file; path/count/consumer/connector authority is unchanged.

## Authority, exclusions and rollout

The user explicitly delegates technical self-acceptance, PR publication, merge after required checks, and non-trading deployment. This delivery uses that session-specific operational authority, not a claim of standing DEE-653 admission. Adversarial self-review is not independent review or a Human signature. No change to canon, ADRs, thresholds, fee/HWM/settlement, live flags, account ownership, credential scopes, promotion or scientific evidence. C3 workers/mounts/parameters remain untouched. Actual financial effects and activation for them are operator actions.

This patch does not qualify or compose the full recurring live runtime. Current live promotion, runtime lease/deadman/release revalidation and final exact-tuple security/scientific gates remain mandatory. No production trading activation follows merge. Non-trading rollout uses the repository's verified release path; rollback is a reviewed revert to the prior release, retaining all durable evidence.
