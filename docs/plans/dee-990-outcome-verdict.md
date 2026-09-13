---
integrationIssue: DEE-990
integrationTitle: "Authoritative local scientific process verdict"
branch: dee-990-outcome-verdict
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build]
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
  nextAction: "Finish publication gates and independently reviewed read-only collector wiring; no production execution."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Scope

User authorized next independent local work and parallel quality control on 2026-09-12.
Base: 6ab1b156a14fb883043f3c6c81c5365be858ffe2. One isolated worktree/issue.

Pure local verdict function over explicit, typed snapshots of exact container identity/state/exit, optional wrapper markers and independently verified scientific evidence. Do not call Docker/SSH/DB, create or read credentials, change existing probe or wrapper, fabricate receipt verification, or grant authority. Preserve process, preparation journal and scientific evidence as separate facts; do not infer qualification from exit zero or FAILED event. Unknown identity or contradictory evidence must refuse success.

## Acceptance

Container running + wrapper0; exited1 + wrapper0; missing container; identity mismatch; exited0 without verified proposal; invalid or wrong-scope evidence; nonzero/signal/OOM; valid exact process/evidence result; no external commands.

## Exclusions

No push, merge, deployment, scientific computation or recovery on production. No
scientific-law changes, smoothing, release-cache relabeling, private exchange
credentials, capital or Human-gate bypass. Local tests are not production acceptance.
Exact publication approval remains separate. Preserve all unrelated work.

## Local implementation evidence

WP-1 pure diagnostic reconciler implemented in scientific-process-verdict-v1.ts;
51 focused tests and focused ESLint pass. Root whole-worktree TypeScript no-emit
check passes. Root reviewed exact identity/freshness/terminal/error/evidence
separation; no proven blocking defect in this limited pure-function scope.
No import or external operation in the helper; every result has authorityGranted:false.
The caller must independently verify canonical receipts; this helper does not do so.
Container nanosecond timestamps require trusted normalization to ISO milliseconds.

WP-2 remains: read-only acquisition/normalization adapter and verified receipt input
wiring, runbook, full publication gates/build, independent final review and CI.
Not a deployed monitor, not scientific qualification, not complete DEE-990 acceptance.

WP-2 progress 2026-09-12: pure seven-field Docker projection adapter implemented in
scripts/trader/scientific-container-observation-v1.ts; no Docker/SSH/DB calls.
Exact raw StartedAt match precedes normalization; nanosecond chronology retained;
unknown/extra fields, invalid calendars, restarts and mismatched identities refuse.
Adapter runs through actual reconciler in regression tests, preserving exit1 versus
wrapper0 and keeping zero-exit without verified evidence UNKNOWN.
31 adapter tests plus51 reconciler tests PASS (82); focused ESLint and full typecheck
PASS. Operator contract added in docs/ops/scientific-process-observation-v1.md.
Actual collector binding to trusted launch journal, canonical receipt verification,
final build/review/publication gates and production acceptance still outstanding.
