---
integrationIssue: DEE-1224
integrationTitle: "AI-TRADER: remove the internal Org0 connection step from Admin"
batchMode: single-issue
branch: dee-1224-remove-org0-ui
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [targeted-unit, targeted-e2e, lint, typecheck, build, validate-canon, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-live-activation]
state:
  status: in-progress
  completedWorkPackages: []
  remainingWorkPackages: [WP-1, WP-2]
  nextAction: "Remove the rejected UI step and prove redirect/no credential requests."
provenance:
  createdFrom: "Direct user correction and production screenshot, 2026-10-02"
  supersedes: null
---

# DEE1224 - remove an internal connection step

Frozen before implementation on main a5597a548116b31dbdf61a21c8582c2b5dbdfb60.
The user explicitly rejected the Org0 form/menu as confusing and unnecessary.
This removes that presentation; it does not remove internal tenant isolation or
create a new extra setup form under a different label. Autonomous research remains
a separate runtime workstream, never implied complete by removing a page.

## Acceptance

1. Remove the Org0 connection navigation item and its shell exception. Keep normal
   Accounts and Research navigation/query context intact.
2. Redirect legacy /admin/org0-connect to /admin/accounts. No credential form or
   credential endpoint request should remain reachable through that UI route.
3. Remove the unused frontend form. Replace its obsolete form E2E with redirect,
   navigation and no credential request assertions. Keep all backend safety tests.
4. Focused local E2E, lint/type/build/canon, independent review and exact-head CI;
   serialized admission and squash merge with current Linear state and base.

## Boundaries

No API/credential/tenancy/schema or financial-rule changes. No migrations, key
movement/deletion, automatic trading, venue calls or production activation.
Production0229 prohibition remains. Deployment is a separate nontrading step after
review and release checks. Rollback is a revert PR. Source files: old page,
frontend form, Admin navigation/shell and their focused tests.
