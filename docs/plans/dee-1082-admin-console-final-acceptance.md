---
integrationIssue: DEE-1082
integrationTitle: "Final admin console acceptance repairs"
branch: dee-1081-admin-console-final-integration
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, collector]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1082
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
  nextAction: "Verify scoped details, paper portfolio, collector cold start and full browser acceptance."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1082 — final console acceptance repairs

Complete client/incident direct reads beyond a limited list, incident history and mute separately from resolution, remaining read-only assistant tools, and a distinct paper portfolio with honest missing cash. Reproduce the production hourly retention syntax error on local Postgres before changing its implementation; preserve retention periods. Review the actual production observation contract: all three accounts have complete balance components but partial open-order components. Display the proven balance valuation with partial observation/completeness reasons instead of suppressing it; do not reinterpret an incomplete order list as an empty one or grant trading authority. Keep invalid bindings, incomplete balance components, old quotes and ownership conflicts fail-closed.

## Acceptance

All work stays in the admitted console paths and tests. No financial policy, Risk/Guardian or connector changes. Verify exact decimal/canonical parity, scope/owner/CAS security, local real Postgres and browser behavior; final train full CI then verified-main production smoke. No real trading or invoice/promotion command during QA.

Proven retention root cause: the Worker build lacks `import.meta.url`; the collector's eager `createRequire` throws during module initialization, leaving the retention batch constant uninitialized on subsequent cron calls. Replace only that guard with the existing Worker-compatible `enforceServerOnly`; preserve all retention periods and batch sizes. A bundled cold-start regression reproduces the failure before the change and checks all eight bound SQL batches after it; real Postgres retention verifies deletion boundaries. Refresh only the existing reviewed Reality consumer content digest.

Client pagination preserves Postgres microsecond timestamps and uses the canonical full count. Keyboard palette focuses the search input after the native dialog opens. Browser acceptance covers all eight sections at 1280/1440/1920px and 720 CSS-pixel reflow, critical/serious accessibility violations, incident mute/history without resolution, and the separate virtual paper book.

Final command review found that the initial promotion request lacked a read revision. The console adapter now compares the same metadata-only state used by GET, serializes console commands per organization, delegates to the unchanged governed service, and rolls back a mapped service error so an audit failure cannot leave a partial command. Three real-Postgres adapter tests prove missing/stale rejection, concurrent empty-state creation yielding 200/409 and rollback; existing gate tests remain authoritative for policy. Browser financial acceptance additionally proves refreshed balances and one new fill without page reload.
