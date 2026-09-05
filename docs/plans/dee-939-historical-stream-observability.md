---
integrationIssue: DEE-939
integrationTitle: "Historical V2 streaming observation restoration"
branch: dee-939-historical-stream-observability
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-ci]
requiredValidation: [lint, typecheck, unit, build, e2e]
approvalGates: [plan-approved, integration-ready]
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
  nextAction: "Exact-head independent review, PR CI, then controlled integration"
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Approved scope

Human requested current streamed charts, positions and complete decision evidence
in Admin and tenant panels on 2026-09-06 MSK, delegating engineering through
historical readiness. PR #553 stays frozen; no algorithm, authority, schema,
credentials, live or holdout changes. No legacy diagnostic observer fallback.

WP-1: Shared V2 account charts from ordered committed history, clearly labelled
observed-history drawdown (not a Risk verdict); explicit unknown-lifecycle/transport/stale
states; visible contact and commit timestamps; correct scoped observation links.
An org query is only a selection among server-authorized orgs, never authority.

WP-2: Targeted negative/update/fallback/cleanup regression and local browser E2E,
lint/typecheck/build, exact-head independent review and applicable PR CI.
Fixture UI tests prove rendering/transport behavior, not production correctness.
Actual paired authenticated run evidence remains a DEE-920 readiness gate.

Rollback: one source revert; no production-data mutation is part of this PR.

## Local evidence, 2026-09-06 MSK

- 30/30 targeted dashboard/transport/read-model/route tests PASS.
- Full lint: 0 errors (308 existing warnings); typecheck PASS.
- Canonical production build via Playwright webServer PASS.
- Two Chromium E2E scenarios PASS: paired account charts/positions and snapshot
  updates, duplicate-snapshot history stability, SSE failure and polling recovery,
  scoped tenant link, narrow viewport, unknown URL organization rejection.
- Admin desktop and tenant mobile screenshots visually inspected. Fixtures are
  confined to the test boundary and explicitly are not Trader performance proof.
- Governance regressions and diff whitespace check PASS.
- Preliminary independent review found one P2: missing lifecycle was called
  "not started" despite possible committed history. Fixed with explicit unknown
  lifecycle text and a non-empty-history regression. Isolated chart points are
  now visible without interpolating gaps.
- No deployed UI claim; exact-head review, PR CI and production paired evidence
  remain required. Full unit suite is authoritative in PR CI, not duplicated here.
