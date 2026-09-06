---
integrationIssue: DEE-949
integrationTitle: "Protect trader admin presentation and bound observer authorization"
branch: dee-949-admin-access
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, build, targeted-unit, e2e, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge, human-production-rollout]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-VALIDATION
  completedWorkPackages: [WP-IMPLEMENTATION]
  remainingWorkPackages: [WP-VALIDATION, WP-PR]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-06"
  blockedReason: null
  nextAction: "Finish final browser validation and prepare PR; no merge or deployment."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
  humanApproval: "2026-09-06 user explicitly authorized DEE-946–951 implementation, testing and PR preparation, including admin access correction; merge, deployment and real accounts separately."
---

# DEE-949 — Admin admission and bounded observer authorization

## Context and scope

User explicitly authorized DEE-946–951 implementation, tests and PR preparation
on 2026-09-06, including closing anonymous admin presentation. Merge, deployment
and real-account access remain separate. No trading logic, corpus, statistical
criteria, RLS, credentials or Human launch gate changes.

## Acceptance

- Before rendering trader admin, verify the existing server-side session and
  canonical `admin.audit.read` permission. Anonymous users go to the existing
  sign-in landing; authenticated non-admins cannot receive the admin shell.
- Keep API authorization independent: layouts may be reused during navigation.
- Dispose the actual authorization database runtime on success and denial.
- Admin and tenant historical SSE expire after at most 30 seconds from stream
  construction. Existing reconnect/polling performs fresh route admission.
  This bounds stale route permission/entitlement, not immediate global JWT
  invalidation; auth-provider semantics still apply. Delivered data cannot be
  recalled. Expiry is independent of read completion; discard late results.
- Cancellation, expiry and abort dispose only once.
- The browser proactively renews SSE at 25 seconds (without resetting freshness
  or inventing progress). A real failure falls back to authenticated polling;
  401/403 clears previous data and stops rather than retrying stale authority.

## Validation

Focused layout/route/stream and revocation tests; Playwright anonymous,
non-admin, admin and paired observation; lint, typecheck and build. Exact-head
CI before PR readiness. Browser presentation fixtures do not qualify the
production graph or HTX. Workers CPU/load and actual paired production
observation remain rollout gates, not claims from local tests.

## Partner onboarding boundary

Existing registration is not qualified HTX onboarding. These changes access
no real credentials, balances or positions. Read-only account binding,
isolation, key lifecycle, reconciliation and live stream verification require
a separately tested account-integration package.
