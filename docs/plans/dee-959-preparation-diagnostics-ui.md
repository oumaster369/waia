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

Nineteen ceremony tests pass, including the existing request/CSRF/actor/proposal
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

### Independent review correction

Reviewer found a real P2 in49caaf57: comparing response sequence to the latest
issued poll starved all responses taking longer than the five-second interval.
Additionally, an older HTTP failure could replace the current UI error state.
Corrected to latest successfully committed sequence with endpoint/abort fencing;
late HTTP and network errors are ignored only after a newer successful response.
Added deterministic6s-response/5s-poll and both stale-error regression tests.
Initial timer-fixture cleanup order failed one test; corrected cleanup ordering,
then15tests, zero-warning lint and typecheck passed. No assertion suppression.

Reviewer then reproduced the reverse ordering: newer failure followed by older
success cleared that failure. Fence now tracks latest accepted SETTLED outcome
(success or error), never merely-issued requests. Added401/500/network tests in
both directions;19ceremony tests pass. The failure remains until a newer response.

The next independent review found a same-turn microtask race in96340d6:
the accepted error advanced the fence inside refresh, but an outer poll catch
could apply that error after a newer success. Refresh now applies both the
accepted fence and error synchronously in its own catch and returns null;
polling and the pre-CSRF POST path do not rethrow or rewrite that refresh error.
Twelve additional regressions settle both promises in the same act without an
intermediate await (401/500/network, both newer outcomes, both resolution orders).
All31ceremony tests pass. The previous96340 Next/OpenNext and local-browser
passes remain prior-head evidence only, pending corrected-head review/build.
