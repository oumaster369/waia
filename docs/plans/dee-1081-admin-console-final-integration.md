---
integrationIssue: DEE-1081
integrationTitle: "Final admin console integration and acceptance"
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

## Acceptance

Canonical scoped decimal reads, grounded assistant, entity/version/research drilldowns, manual governed confirmations, explicit unavailable reasons, separate paper portfolio, collector health, all eight sections in real Postgres browser workflows. Existing honest unavailable items (unratified percentages, external flows, sealed holdout, file reasoning, external-host diagnostics) remain explicit.

Validate focused units and Postgres per child, browser workflows, lint/type/build, canon, authority graphs, manifest/governance and authoritative full CI on the frozen head. Production checks read only. No real financial/trading command in QA. Roll back with the previous verified Worker version and revert PR if needed.


Admission renewed at 02:52 UTC to include the existing Reality consumer inventory content digest affected by the proven collector cold-start repair. No consumer identity, count, connector reference, authority or admission-rule change is admitted. Preserve the original integration branch as provenance; the final head must pass both authority graphs.

## Operational authority and review record

The user's current instruction explicitly delegates self-acceptance, PR publication, merge, production and database operations to Codex for this time-critical stabilization. Final acceptance is an adversarial self-review under that instruction, not an independent second-agent or Human review. Do not label it independent. Consequently this delivery uses the directly delegated operational merge path, not a claim of automatic DEE-653 controller admission. The frozen child inventory remains a verifiable provenance artifact; full exact-head CI, scope checks, rollback and production verification remain required. The PR must disclose this operational exception and preserve all review evidence. No standing governance, acceptance threshold, financial policy or authority rule is changed by this one delivery.
