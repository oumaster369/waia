---
integrationIssue: DEE-611
integrationTitle: "WAIA Patrons — public contribution map and supporter list"
branch: dee-611-waia-patrons
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, build, targeted-unit, targeted-e2e, canon, pr-governance]
approvalGates: [human-product-direction, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-review
  currentWorkPackage: null
  completedWorkPackages: [WP-0, WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: 488
  prUrl: https://github.com/oumaster369/waia/pull/488
  lastValidatedGitSha: e112a4f60ec364421ed1a3e282c774588a208cd4
  lastValidationAt: 2026-08-24
  blockedReason: null
  nextAction: "Await exact-head required PR CI and Human review, then stop for Human squash merge."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-611 — WAIA Patrons

## Authority and admitted base

The Human directed continuation of the Breath of WAIA work after reviewing the completed DEE-612 doctrine. This frontend-only batch starts from origin/main at 5cc17ad85e47266eb8f832e16eda093641ba3b54.

Concurrent AI-TRADER PR #487 and its dee-685-required-information-sufficiency-gate worktree are isolated and out of scope.

## Product contract

1. /patrons has one purpose: show confirmed public financial participation from the DEE-617 server-owned projection.
2. The page uses the approved English copy: “People who help keep WAIA alive.”
3. The list contains Patron, Contributed, and Share only.
4. Named rows render exactly as supplied by the consent-gated public contract. Private or anonymous support is one non-identifying aggregate row when supplied.
5. The frontend preserves the server's deterministic order and formats its integer parts-per-million share exactly; it does not derive contribution authority from transactions or arbitrary browser data.
6. Every published list carries the approved boundary: “Share shows financial participation only. It does not grant ownership, governance power or voting weight.”
7. Pending publication and temporary unavailability are distinct, truthful states. No zero-like or invented data is shown.
8. The existing minimal homepage Patrons link remains the only Breath change required by this issue.

## Scope boundaries

- frontend page, exact public formatter, focused unit/E2E tests, and this canonical plan only
- no app/api changes, Treasury projection, schema, migration, Finance Console, watcher, R2, or financial-data mutation
- no reserve, sponsorship, Commons, subsidy, ownership, governance, or transfer mechanics
- no AI-TRADER, FHV, Execution Server, production deployment, or merge

## Work packages

### WP-0 — admission and isolation

- Verify current origin/main, DEE-611, merged dependencies, and active PRs.
- Create the isolated branch/worktree and move DEE-611 to In Progress.

### WP-1 — public Patrons surface

- Add the dynamic /patrons server page over readPublicTreasuryForView.
- Render published, empty, pending, and unavailable states with no controls.
- Add an exact BigInt-safe formatter for the server-owned parts-per-million share.

### WP-2 — validation and integration readiness

- Cover rendering, consent-safe aggregation, exact shares, pending, unavailable, empty, read-only, responsive, and accessibility behavior.
- Run targeted unit/E2E, lint, typecheck, build, canonical and PR-governance validation, targeted formatting, and git diff --check.
- Synchronize with origin/main, then stop at the T3 Human gate before any publication action not separately approved.

## Expected file surfaces

- docs/plans/dee-611-waia-patrons.md
- app/patrons/page.tsx
- lib/landing/public-format.ts
- tests/unit/public-transparency-format.test.ts
- tests/unit/public-transparency-pages.test.tsx
- tests/e2e/public-transparency.spec.ts

## Rollback and merge disposition

Rollback is a single revert. Existing public APIs and financial truth remain unchanged. Human squash merge to main only.

## Local validation record

- focused Vitest: 9/9 passed across public format and public-page states
- focused Chromium Playwright: 3/3 passed across Budget, Work Plan, and responsive Patrons
- lint: passed with no errors; pre-existing warnings remain outside this diff
- typecheck and production build: passed
- targeted formatting, canonical validation, PR-governance regression validation, rendered PR-body preflight, and git diff check: passed
- Browser review: desktop 1280 × 720 and mobile 390 × 844, no console errors or horizontal page overflow
- the local review environment has no public Treasury binding and truthfully rendered the unavailable state; published, private aggregate, exact share, pending, and empty states are covered by focused deterministic tests
