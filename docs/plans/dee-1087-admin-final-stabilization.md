---
integrationIssue: DEE-1087
integrationTitle: "Final console collector and presentation stabilization"
branch: dee-1087-admin-final-stabilization
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, collector]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1087
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
  nextAction: "Serially import reviewed children, validate cumulatively, freeze and run all exact-head CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1087 — final console stabilization

Base: merged financial main `2b1d2f9e96c8e36f682d4595d0ca70b45be9d381`. Integrate reviewed DEE-1085 then DEE-1086, preserving original branches/PRs #653/#654 until successful merge. Their collector tests overlap, so integration is serial. This admission covers importing existing deliveries; it does not retrospectively claim to precede their original implementation.

One coherent final collector/presentation result, one rollback version, no schema changes. The presentation-only child originally has T1 risk; integration applies the stricter shared Worker T3 review boundary to both. The user's autonomous operational instruction authorizes this combined batch and self-review. No independent review or automatic DEE-653 controller admission is claimed. Protected checks, tests and acceptance thresholds remain unchanged.

## Acceptance and boundaries

Clean news text on canonical reads and new persistence, unchanged historical rows/source/time; Russian strategy evidence labels with original machine diagnostics. Scheduled minute determines due collectors despite preceding watcher delay; actual time determines observations/cutoffs. Existing watcher order, trading, Risk, Guardian, commission/HWM/settlement, permissions, cron expression and financial arithmetic are unchanged.

Run cumulative targeted tests after each import; all five real-Postgres browser scenarios, lint/types/Next+OpenNext/canon/governance and frozen provenance validation on the combination. All exact-head GitHub checks must pass before squash. Verify main deployment, scheduled receipts and authenticated production UI. Local connection failures are documented as such, not treated as successful production acceptance. Never manufacture old data or execute real trade/billing commands for QA.
