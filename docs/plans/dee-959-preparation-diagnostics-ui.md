---
integrationIssue: DEE-959
integrationTitle: "Historical preparation diagnostic states in Admin ceremony"
branch: dee-958-preparation-attempt-events
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, targeted-unit]
approvalGates: [plan-approved, integration-ready, human-merge, human-production-rollout]
includedIssues: []
state:
  status: in-progress
  currentWorkPackage: WP-VERIFY
  completedWorkPackages: [WP-UI]
  remainingWorkPackages: [WP-VERIFY]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 76189935d3cdffd8727dce4854a7f49f2715ee32
  blockedReason: "Depends on unpublished DEE-958 backend and migration0204."
  nextAction: "Frozen frontend review and cumulative browser integration gates."
---

## Approved scope

Root approved this separate frontend child after DEE-958 on2026-09-07. Change
only the historical Admin ceremony and its targeted tests. Preserve existing
request, CSRF/authenticated actor, exact-proposal Human approval and polling.

## Acceptance before code

- Existing REQUEST_RECORDED without diagnostics remains honest: no assertion
  that computation runs. STARTED/PROGRESS are last-observed events, not a lease
  or proof the process is still alive. Display timestamp and explicit uncertainty.
- FAILED has an accessible, bounded safe reason; never render raw exceptions.
- Counters belong to their actual phase/surface/trial, never estimated overall
  percent or a claim of completion. Unknown fields remain unavailable.
- A diagnostic PROPOSAL_AVAILABLE alone cannot render a ratification button;
  only the existing actual validated proposal path supplies approval authority.
- Existing automatic refresh requires no repeated request click. No retry,
  ratification, launch or changes to scientific criteria are introduced.
- Tests cover absent, STARTED, PROGRESS, FAILED, unknown/inconsistent states,
  actor/scope response isolation and request/approval button boundaries.

## Not claimed

This is preparation diagnostics, not a full-market stream or successful test.
Production deployment and browser integration with a real scoped run remain
root-controlled release gates. No production operation is authorized here.

## Local validation — 2026-09-07

Twelve ceremony tests pass, including the existing request/CSRF/actor/proposal
tests and new durable state, enum redaction, exact surface/trial counters,
automatic refresh, and out-of-order same-scope poll rejection. Typecheck and
scoped lint with zero warnings pass. Initial new test callbacks had unused
parameters; corrected without suppressing lint or deleting assertions.

The UI uses the existing five-second preparation poll, not a new SSE lease.
STARTED/PROGRESS are explicitly last-known observations; no invented staleness
threshold, estimated completion percentage, automatic retry, or ratification.
Diagnostic PROPOSAL_AVAILABLE without the actual proposal remains unconfirmed.

Backend dependency is frozen76189935. Cumulative visual/browser verification,
production/OpenNext build, final integration review and deployment remain open;
passing component tests does not prove end-to-end historical-test readiness.
