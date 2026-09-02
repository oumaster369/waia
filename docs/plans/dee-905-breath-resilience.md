---
integrationIssue: DEE-905
integrationTitle: "Breath resilience — preserve verified finance facts and link the time radar to Patrons"
branch: dee-905-breath-resilience
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
executionLabel: frontend
requiredValidation: [lint, typecheck, build, targeted-unit, e2e, canon, pr-governance]
approvalGates: [human-scope-approved-2026-09-02, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-0, WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-02T14:05:00+03:00"
  blockedReason: null
  nextAction: "Open the single DEE-905 PR to main and stop for Human squash merge."
provenance:
  createdFrom: human-approved-chat-2026-09-02
  gapRegistry: docs/gaps/breath-of-waia-gap-registry.md
  supersedes: null
---

# DEE-905 — Breath resilience and Patrons radar link

## Approved outcome

The public Breath of WAIA block keeps verified current free funds and the ideal annual budget visible
even when the independently governed runway snapshot is temporarily unavailable or stale. A current
runway continues to drive the live seconds-level countdown. When the runway reaches zero, the
counter remains exactly `0d 0h 0m 0s` and displays the approved English operational message:
`WORK IS PAUSED. AWAITING FUNDING.` The animated time radar is an accessible link to `/patrons`.

## Boundaries

- Verified finance facts and runway state remain separate; no value or time is invented.
- A missing runway shows a truthful refresh state while verified balance and budget remain visible.
- No database, production data, environment, watcher, AI-TRADER code, route, schema, worktree, or PR
  is changed.
- Merge and production activation remain Human-only.

## Work packages

### WP-0 — Admission and isolation

- Track the correction in one Linear issue, one branch, one canonical plan and one PR.
- Start from current `origin/main` in an isolated worktree.

### WP-1 — Public Breath resilience

- Decouple verified balance and annual-budget rendering from runway publication.
- Preserve the current live countdown when the runway snapshot is published.
- Render exact zero plus the approved English pause message after runway expiration.
- Make the animated radar an accessible internal link to `/patrons`.

### WP-2 — Qualification

- Cover published finance with pending runway, elapsed countdown, exact copy and radar navigation.
- Run lint, typecheck, production build, targeted unit tests, Playwright, canon and PR-governance
  validation.
- Open one PR to `main` and stop for Human squash merge.

## Rollback

Before merge, discard the isolated branch. After merge, revert the single squash commit; no data
rollback is required.
