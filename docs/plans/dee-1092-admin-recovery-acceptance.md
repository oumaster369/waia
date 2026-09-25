---
integrationIssue: DEE-1092
integrationTitle: "Collector recovery and dialog acceptance"
branch: dee-1092-admin-recovery-acceptance
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, collector]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1092
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
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
  nextAction: "Serially import admitted source, implement long-title dialog regression and repair, then freeze provenance and run complete acceptance."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1092 — collector recovery and dialog acceptance

Production46f9 passed its affected acceptance. During incident recovery, five actual PostgreSQL regressions proved non-atomic news persistence (DEE-1090, source8400c467, PR657), and an authenticated long-title incident exposed dialog header overflow:574px client width,697px scroll width,123px horizontal displacement after reaching Close (DEE-1091). Preserve both findings and their independent source history.

## Serialized result

Admit both scopes before this batch imports any source. Import DEE-1090 unchanged, run cumulative checks, then implement the bounded dialog wrapping/close-control correction with a real production-like long-title browser failure first. Freeze exact commit/file/test evidence and run all five real-Postgres browser workflows, lint/types/Next/OpenNext, both graphs, canon/governance and rendered PR preflight. All exact-head CI must pass before guarded squash and verified merged-main publication. Keep PR657/source history until successful incorporation; do not merge its older base independently.

## Boundaries

No schema, auth/grants, money, commission/HWM/settlement, Risk/Guardian, trading, holdout, scheduling or policy changes. The UI keeps full evidence and existing dismissible/URL behavior. User explicitly delegated operational self-acceptance, merge and deployment; original UI source is T1 but this combined Worker batch applies T3. No independent review or automatic DEE653 admission is claimed. Final acceptance remains DEE1075 and includes actual scheduled news writes, integrity and long-title incident closing in the ordinary production session.
