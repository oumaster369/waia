---
integrationIssue: DEE-1081
integrationTitle: "Admin console strategy and research evidence"
branch: dee-1081-admin-console-final-integration
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, collector]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1081
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
  nextAction: "Verify canonical research/strategy evidence, manual promotion confirmation and exact-head CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1081 — final admin-console integration

Admission is for serial integration of already implemented and locally tested child deliveries, plus the bounded final acceptance repair. It does not retroactively assert that their original implementation followed this manifest. The user explicitly delegated the operational review, merge and production gates on 2026-09-25. Financial policy and methodology remain unchanged.

Base: main 3f75d95e352a6d29646c99c08cd1e08b1d212847 (merged PR646). Preserve source branches and exact source commits. Integrate DEE-1077, DEE-1079, DEE-1078, DEE-1080, then DEE-1082 in that order. Review shared-file changes against each original source tree; no CI waiver. One frozen manifest, one exact-head full CI, one squash, one verified-main rollout. Superseded PR647/648/649 close only after successful merge.

Acceptance: canonical scoped decimal reads, grounded assistant, entity/version/research drilldowns, manual governed confirmations, explicit unavailable reasons, separate paper portfolio, collector health, all eight sections in real Postgres browser workflows. Existing honest unavailable items (unratified percentages, external flows, sealed holdout, file reasoning, external-host diagnostics) remain explicit.

Validate focused units and Postgres per child, browser workflows, lint/type/build, canon, authority graphs, manifest/governance and authoritative full CI on the frozen head. Production checks read only. No real financial/trading command in QA. Roll back with the previous verified Worker version and revert PR if needed.


Admission renewed at 02:52 UTC to include the existing Reality consumer inventory content digest affected by the proven collector cold-start repair. No consumer identity, count, connector reference, authority or admission-rule change is admitted. Preserve the original integration branch as provenance; the final head must pass both authority graphs.
