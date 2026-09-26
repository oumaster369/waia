---
integrationIssue: DEE-1113
integrationTitle: "Release denied admin authorization runtimes exactly once"
branch: dee-1113-admin-runtime-disposal
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: independent-review
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Obtain independent exact-commit review, then controller runs integration readiness and final-base CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1113 — denied admin runtime ownership

## Proven defect and bounded result

On accepted main55bcefa4128b716915574971a0a7f28c4f4b12f9, the shared
`authorizeAdminRoute` acquires a runtime and returns it on permission denial.
Most handlers return the403 result before retaining that handle, then dispose
undefined. The registered invoice-list path reproduces this with its actual
permission resolver and an inert read executor: one acquired handle, zero
actual disposal attempts. This proves a missed lifecycle operation, not measured
production connection retention/exhaustion or an authorization bypass.

WP-1 has one result: the helper retains ownership until authorization succeeds.
Denial or permission failure disposes the acquired handle once. Success alone
transfers the handle to the caller for its existing finally. Signed-out callers
acquire nothing. The failure type exposes only optional undefined runtime, so
callers cannot receive an already disposed handle. Cleanup lives in finally;
its rejection cannot re-enter a catch and retry the same resource.

## Caller inventory and compatibility

Source inventory on the base found28 call sites in18 production files, including
the shared Treasury wrapper. No aliased/dynamic invocation was found in the
production reference search. Five calls retain `auth.runtime` before inspecting
`auth.ok`: the admin layout, historical stream route, historical launch handler,
and both historical ratification handlers. They already accept undefined for
their cleanup callback; returning no handle on failure avoids double disposal.
The remaining23 calls retain only a successful runtime and keep their existing
cleanup. No production caller changes are necessary.

The inventory covers `app/(trader)/admin/layout.tsx`, the historical-v2 stream
route, Trader overview/cockpit, credential, billing commands/list/detail/dispute,
reporting-period reads, FHV read/mutate/stream, historical launch/ratification,
live governance, kill-switch, runtime-authority/health, settlement and Core
audit/Treasury handlers. This change affects resource ownership only; it does
not invoke, expand, or qualify any of those commands.

Tests mocking failed authorization with a live runtime are updated to the new
failure contract. New composed tests exercise the actual helper and permission
resolver, including callers on both sides of the earlier ownership convention.
An undefined disposal callback remains a supported no-op, not a second resource
close. No socket or database client is constructed by these synthetic tests.

## Acceptance and validation

- Denied ordinary members retain403 for read and mutate permissions, close the
  acquired resource once and receive no runtime ownership.
- Signed-out401 acquires nothing; acquisition errors dispose nothing.
- Permission-read exceptions close once and retain existing error propagation.
- Allowed read/mutate transfers the same live handle without premature disposal.
- Actual invoice read succeeds with the same empty response and closes once;
  denied/failed reads also close once without a protected read on denial.
- Actual layout denial, historical read/mutate denial and stream denial do not
  close a handle twice or open a secondary domain/stream runtime.
- Disposal rejection is attempted once and propagates; it never becomes an
  authorization success or a recursive cleanup attempt.

Initial regression on unchanged production code:4 failures and17 controls pass
in `tests/unit/admin-runtime-disposal.test.ts`. The failures demonstrate denied
handle escape/absence of disposal and the cleanup-failure boundary.

After the correction, the21 original cases pass. An additional deferred-cleanup
case proves the refusal waits for disposal completion, bringing the new suite
to22 passing tests. Together with the four existing caller/layout suites,
46 tests across5 files pass. Scoped ESLint and diff checks pass. These local
results do not replace independent review or the controller's full readiness
and exact-head PR checks.

Run the new test plus `trader-admin-layout`, `trader-admin-layout-cpu-boundary`,
`historical-simulation-admin-launch-handler-v2` and
`historical-ratification-admin-handler-v2` with `pnpm test --run`. Run scoped
ESLint and diff checks during implementation. The controller schedules full
lint/typecheck/build, canon/governance checks and applicable exact-head PR CI.
No native Postgres acceptance or browser visual change is claimed by this
resource-ownership correction.

## Boundaries

Do not alter role resolution, membership, grants, permissions, HTTP status/error
envelopes, Origin/CSRF, scientific ratification, trading/live gates, audit content,
finance policy, data schema or migrations. No database, production, venue, C3 or
live command is executed. The separate console fleet-authorizer remains
unchanged. Other domain-runtime disposal ordering/failure handling and actual
driver/socket close-time behavior are not qualified by this bounded result.
