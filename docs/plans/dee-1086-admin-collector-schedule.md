---
integrationIssue: DEE-1086
integrationTitle: "Preserve the scheduled minute for delayed console collectors"
branch: dee-1086-admin-collector-schedule
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1086
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: complete
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-25T08:24:00Z"
  blockedReason: null
  nextAction: "Open the integration PR, await all exact-head CI, then merge and verify scheduled receipts after deployment."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1086 — scheduled minute and observation time are different facts

`custom-worker.ts` discards the cron event and awaits the existing payment watcher before dispatching admin collectors. The collector's due set is calculated from the later wall clock. A delay from minute 00 to 01 silently removes news; 05 to 06 removes Fear & Greed; 35 to 36 removes retention. Three red regressions reproduce these omissions. Production gaps prompted inspection but are not claimed to establish the exact cause of each missed run.

## WP-1 and acceptance

Extract the finite Cloudflare scheduled timestamp once and pass it solely as the console scheduling anchor. Keep actual `now` for observations, quote minute buckets and retention cutoffs, and keep current valuation/job timestamps. Manual callers and invalid event data fall back to existing actual-time behavior. Retention remains due when console market collectors are disabled.

Do not alter the payment watcher, its ordering, settlement or trading loops, cron expression, financial arithmetic, permissions, live gates, or database schema. The user's operational Human delegation covers this minimal shared-entrypoint repair; no policy ratification or independent review is claimed.

Validate delayed news/Fear & Greed/retention and actual evidence timestamps, collector cold start, lint/types/build, OpenNext bundle, canon/governance and all exact-head CI. Deploy merged main and verify subsequently scheduled job receipts on the real database; prior missing receipts remain missing and are not backfilled.

## Integration correction — DEE-1089

PR #655 full CI exposed the omitted Reality consumer-content pin update. The independently reconstructed inventory remains 134 consumers with path digest `e07814e366d0b73f3398f20c75fe40abab1898d54f233577e3a0eb0fa67c3473` and 25 connector references. Against financial main2b1d, the only changed inventoried consumer is `lib/trader/admin-console/collectors/run-due.ts`, reviewed above for scheduled due selection with unchanged actual observation/cutoff time. Its reviewed combined content digest is `999b34af21c2096799158c1e0de29a5da35700b71b8e0b91090158f975525f6e`. Update only that pin; no source/path digest, count, membership, reference/disposition rules or validator changes. Require both Reality/Execution graph validators and the eight-test Reality graph suite before final CI.
