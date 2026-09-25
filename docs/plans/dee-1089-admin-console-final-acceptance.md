---
integrationIssue: DEE-1089
integrationTitle: "Final console evidence and collector acceptance"
branch: dee-1089-admin-console-final-acceptance
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, collector]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1089
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
  nextAction: "Admit exact serial imports, repair the reviewed inventory pin, run cumulative and final checks, then publish one final PR."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: docs/plans/dee-1087-admin-final-stabilization.md
---

# DEE-1089 — final console acceptance

Base: merged financial main `2b1d2f9e96c8e36f682d4595d0ca70b45be9d381`. PR #655 correctly failed its complete unit gate: the scheduled-time change in `lib/trader/admin-console/collectors/run-due.ts` invalidated the pinned Reality consumer content digest. Count and path digest stayed unchanged. Its frozen admission omitted that inventory repair; do not rewrite that history or weaken validation. This new admission precedes importing the original DEE-1085, DEE-1086 and DEE-1088 deliveries into one serial final batch. Source PRs #653/#654/#655 and source branches remain until this batch succeeds.

The existing candidate code already passed 101 combined targeted tests, including real PostgreSQL and the new assistant evidence regression. Those results remain source evidence, not a substitute for this batch's cumulative checks or exact-head CI. Review the inventoried consumer diff and change only its content pin; membership, path/source digests, reference rules and all validators remain unchanged.

## Acceptance and boundaries

Import news/strategy presentation, then scheduled collector dispatch and reviewed inventory pin, then the assistant SystemJob projection. Require exact source/commit/file provenance and cumulative passing checks after each import. The answer must preserve all 13 named jobs, actual outcomes, source times, reasons and coverage. News containers are removed without rewriting history; strategy test completion is distinct from recommendation. Due selection uses scheduled time, while observations and retention cutoffs use actual time.

Run both authority graph validators and the previously failing Reality graph suite, final combined unit/real-Postgres regression, all five Postgres browser scenarios, lint/types/Next/OpenNext, canon, governance and frozen provenance checks. Every applicable final-head GitHub check must pass before guarded squash. Verify the exact merged-main deployment with collectors enabled, subsequent scheduled receipts and affected authenticated production screens/quick answers.

No schema, source/connector authority, grants, arithmetic, commission/HWM/settlement, Risk/Guardian, live gate, holdout or old data changes. No real trading or billing commands during QA. User delegation covers operational self-acceptance and deployment; no independent review or policy ratification is claimed. Original presentation sources are T1, but the combined shared Worker batch uses the stricter T3 boundary. One code/Worker rollback restores the prior financial main.
