---
integrationIssue: DEE-1088
integrationTitle: "Preserve operational job evidence in assistant answers"
branch: dee-1088-admin-assistant-job-evidence
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1088
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
  nextAction: "Local acceptance passed; merge DEE-1087 main, validate the final combined state, then publish the PR."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1088 — assistant job evidence

Authenticated production `2b1d2f9e` shows correctly named jobs, last-run outcomes and reasons in System, but its quick answer repeats unnamed `ok`/`unavailable` values. The fact projector reads absent title/name/id/reasons fields, ignores canonical jobKey/reason/lastRun and treats quality as the job outcome. Its hard cap of twelve also omits the thirteenth catalog entry without reporting projection coverage.

Use a pure shared Russian job-name/status dictionary for System and the assistant. Project the observed last run outcome separately from its freshness/availability state, retain the source timestamp and reason, and link directly to jobs/releases. Cover every present catalog entry and report a bounded projection's N/M if future source lists exceed its limit. Never infer success from a fresh failed run, or replace an absent run with a zero/success.

## Acceptance

- The real canonical job catalog appears with every job name, observed outcome, timestamp and unavailability reason. Fresh failed runs remain failures; stale successful runs retain their age.
- A bounded answer reports its actual N/M coverage, including the manual invoice operation. Jobs and release facts link to their corresponding System tabs.
- Existing source binding, scope isolation, model-disabled quick answers and prompt-injection protections continue to pass.
- The authenticated production answer matches the System screen after exact-head CI, merge and publication.

## Validation and boundaries

First reproduce the exact canonical DTO mismatch in unit tests, then assert failed, stale, missing, external/manual and complete/throttled catalog cases. Verify through the real-Postgres quick-answer handler, existing grounded-fact security/context tests and browser workflows. Lint/types/build/canon/governance and every exact-head GitHub check precede merge. Final production answer must preserve the same evidence as System.

Only read-only projection/presentation changes. No provider enablement, scheduling, new commands, auth/grants, schema, finance/commission/HWM/settlement or old-data mutations. User operational delegation covers merge/deploy; no independent review or policy ratification is claimed. Prepare locally while DEE-1087 CI runs; synchronize with its merged main before final PR publication to satisfy strict branch protection.
