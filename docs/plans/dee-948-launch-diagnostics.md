---
integrationIssue: DEE-948
integrationTitle: "Historical launch: preserve bounded heap configuration, primary errors and supported extent"
branch: dee-948-launch-diagnostics
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, build, targeted-unit, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge, human-production-rollout]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-REVIEW
  completedWorkPackages: [WP-HEAP, WP-CLEANUP, WP-EXTENT, WP-REGRESSION]
  remainingWorkPackages: [WP-REVIEW]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-06"
  blockedReason: null
  nextAction: "Root independent review, integration and remaining PR gates; no commit, push, merge or deployment by child agent."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
  humanApproval: "2026-09-06: latest explicit user approval authorizes DEE-946–951 implementation and PR preparation; preserves full corpus, scientific and safety boundaries; no merge, production deployment or real account."
---

# DEE-948 — bounded launch configuration and diagnostics

## Scope

Restore three operational contracts without changing the trading algorithm or scientific acceptance criteria:

1. Preserve an explicitly configured child Node heap limit, accepting only one `--max-old-space-size` option (hyphen/underscore spelling and equals/space delimiter normalized), integer 128–32768 MiB. Reject all additional Node options, duplicate flags and injected flags. Absence preserves Node defaults; this change does not invent a new heap requirement. The existing child environment allowlist remains intact.
2. Preserve the primary bootstrap/preparation failure when cleanup also fails. Attempt every unlock/reset/release/pool-close callback. Aggregate original errors with the primary error as `cause`; fixed aggregate messages contain no connection data. Render a bounded, redacted stack/cause/error chain rather than replacing the original failure with a cleanup error or a bare code.
3. Require `initialRecordIndex` to equal the qualified receipt's exact first economic boundary. Reject first+1, malformed or overflowing extents both when preparing a proposal and when validating an existing proposal. Resume remains a separate durable-cursor operation.

No migration, RLS change, authority bypass, credential expansion, corpus reduction, Forecast substitution, model change, blind holdout, trading, capital or production mutation is included. Service timeouts, operational deadlines and launch/campaign duration limits are unchanged. There is no claim that heap propagation alone resolves package persistence or full-corpus qualification costs.

## Files and acceptance

- Execution-host entrypoint: validate and forward only the allowlisted heap option before listening or spawning children.
- Historical bootstrap, ratification and launch-consumer modules: use a shared cleanup helper that retains the original failure and runs all cleanup callbacks.
- Proposal and approved-launch CLIs: bounded diagnostics using existing redaction plus URL, Bearer/Basic, credential-assignment and PEM redaction. Never enumerate arbitrary thrown objects or environment values. Preserve native stack accessors under a failure guard; avoid invoking cause/aggregate metadata getters. Limits: 32768 output characters, 8192 per error, depth 4, 16 errors, eight aggregate children, cycle detection.
- Proposal validator: bind the supported initial boundary to the qualified candidate; do not silently clamp or mutate caller input.
- Regressions: real child-process heap observation, malicious options rejection, primary plus multiple cleanup failures, cleanup-only failure, role-assumption failure, secret redaction, diagnostic bounds, exact boundary and resealed unsupported proposal rejection.

## Receipt and deployment constraints

Do not fabricate, relabel or waive a runtime-requalification receipt. This work changes launch implementation and diagnostics only: it does not establish that the dataset, scientific evidence, deployed release, Human ratification or runtime is qualified. Final integration requires the controller's exact-head gates, followed by separately authorized rollout/requalification against the actual release and dataset. Existing failure evidence must remain available in its private journal; stderr formatting is not a substitute for the journal. Unsupported offsets are rejected before launch, not converted into a different approved run.

## Actual local evidence

Base: `4a98f3acf68d498bbb75565a1bace685fefb8c1c`. Changes are uncommitted; no final SHA or CI result exists, so `lastValidatedGitSha` remains null.

- Ten targeted files covered 80 passing tests in total. The combined run passed 78 tests; after adding the resealed-proposal boundary regression, the extent/candidate pair passed all 11 tests, including that new test. Author adversarial review reproduced a throwing-stack-getter diagnostic failure and missing short Basic-authorization redaction. Both were fixed; the formatter suite then passed 4/4, including one added getter regression and the strengthened redaction case. An initial descriptor-only stack approach failed the existing stack-preservation test and was corrected to safely read V8 native accessors without losing frames.
- Suites: launch consumer (20), first-cycle contract (13), execution host (17), ratification execution CLI (6), execution-server cleanup (2), cleanup helper (4), diagnostic formatter (4), launch extent (7), candidate binding (4), proposal CLI startup (3).
- A real spawned Node child reported a heap limit consistent with the requested 24576 MiB; injection and invalid-limit cases were rejected. No production process was started.
- Full TypeScript check passed after the final behavioral change. Targeted ESLint and `git diff --check` passed. Frozen-lockfile dependency installation used disabled lifecycle scripts and did not modify the lockfile.
- No full unit suite, PostgreSQL integration, production build, CI, deployment, runtime requalification or historical campaign was performed by this child. Remaining PR gates and independent review belong to the root integrator.

This evidence supports the bounded fixes, not a guarantee of full AI-TRADER readiness or a launch deadline.
