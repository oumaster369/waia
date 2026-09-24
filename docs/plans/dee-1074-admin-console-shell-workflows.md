---
integrationIssue: DEE-1074
integrationTitle: "Admin console usable shell and safe control workflows"
branch: dee-1074-admin-console-shell-workflows
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1074
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: done
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-1
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 4481222677bb4e2ecdf8bc36727d9e6037f1233e
  lastValidationAt: "2026-09-24T23:13:27.416247+00:00"
  blockedReason: null
  nextAction: "Open PR, merge the verified DEE-1073 dependency, then rebase and require exact-head CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1074 — usable console shell and safe workflows

## Goal

Continue audit P7/P8 and shared section foundations after DEE-1072/1073. Keep the eight canonical sections, and make their reading and control flows understandable, consistent and usable in Russian. The old shell has a narrow three-column layout, inert context controls and an emergency dialog with no wired submission.

## Implementation

- A full-width desktop shell with a quiet sidebar, clear section header, URL-backed tabs, context filters, market strip and explicit delivery state. The assistant opens in a panel, preserving table space by default.
- One context provider and URL builder for organization/account, period/timezone, currency and mode. Navigation keeps global context; section tabs and selected details remain in the URL. Back restores the previous selection and scroll. Abort and key guards prevent stale scope content.
- Shared table, detail panel, data-state, exact money and timestamp components. Loading, empty, partial, stale, unavailable and rejected access remain visible and distinct. No raw JSON as the main screen.
- Navigation-only keyboard palette with Escape, focus return and proper dialog behavior. Eight Russian labels are preserved.
- Existing kill-switch commands get a read-before-write three-step scope/effect/reason confirmation. Only actually supported scopes/effects can be submitted; unsupported account/venue/strategy runtime authority must be stated explicitly, never silently upgraded to an organization-wide action. expectedRevision/stateVersion and confirmation are reset after a conflict and scope changes; completion requires reread.
- Saved invoice detail and six manual confirmations, command revision checks through existing issuance service, and incident status transitions with atomic expectedRevision and audit evidence. No automatic issuance or checked-by-default attestations.
- Back the research, strategy and System tabs with minimal scoped metadata reads: campaigns/hypotheses/knowledge/qualification without sealed payload or file reasoning; same-version promotion versus trading/test evidence; jobs/source freshness and read-only authority/audit. Runtime account IDs are not silently treated as exchange IDs. Historical runs require the History contour.
- Apply WAIA Design OS tokens, tabular figures, calm surfaces, consistent spacing, keyboard focus and contrast. No new information architecture, trading terminal, order cancellation or asset movement.

## Boundaries

No fee/HWM/settlement/risk policy, live eligibility, fill finality, holdout, return methodology, or validation-gate change. Operational review/merge/deploy authority was explicitly delegated by the user on 2026-09-24; that does not supply financial attestations. Minimal API adapters and proven authorization/revision defects are included with the frontend issue's explicit scope. Broader missing read models, PnL history and grounded assistant responses continue in subsequent bounded packages.

## Acceptance

Browser checks cover all navigation, context query propagation, Back/tab/selection/scroll, keyboard palette, stale request rejection, missing schema, denied access, and each supported command's read/confirm/pending/reread/conflict flow. Screenshots at desktop and compact widths must be inspected. Run focused unit and Postgres tests plus `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`; required exact-head CI before merge. Production smoke only after verified deployment.

## Validation evidence

213 targeted console/assistant tests passed, followed by seven origin/overview checks after the browser-discovered CSRF correction. Seven real PostgreSQL command and section-metadata tests passed. Production build and two browser checks passed (eight sections with contrast/accessibility, context and invoice confirmation reset); the full PostgreSQL workflow passed (client isolation, URL detail/Back, delayed scroll restoration, synthetic-org PAUSE and reread). The two PostgreSQL stream slice/SLO tests passed, including post-paint delivery within 500 ms under 100 events/s for 60 seconds. This is a local bounded performance check, not the deferred long production soak. Lint/typecheck/canon and consumer graph passed; required full CI remains outstanding.

The browser test exposed Request.url using Next's internal listening address. The origin guard now accepts the configured trader origin only with an exact Host match, while foreign origins, protocol/path variations, arbitrary forwarded-host and incorrect JSON media types remain rejected. No production command was sent during acceptance.
