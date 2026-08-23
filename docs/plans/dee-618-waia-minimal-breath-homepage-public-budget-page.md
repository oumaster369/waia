---
integrationIssue: DEE-618
integrationTitle: "WAIA minimal Breath homepage and public transparency pages"
branch: dee-618-waia-minimal-breath-homepage-public-budget-page
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, build, targeted-unit, targeted-e2e, canon, pr-governance]
approvalGates: [human-product-decision-2026-08-22, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-review
  currentWorkPackage: WP-4
  completedWorkPackages: [WP-0, WP-1, WP-2, WP-3, WP-4]
  remainingWorkPackages: []
  prNumber: 485
  prUrl: https://github.com/oumaster369/waia/pull/485
  lastValidatedGitSha: 814fb1bd292f56665116deb778b30f9e85c0e310
  lastValidationAt: 2026-08-23
  blockedReason: null
  nextAction: "Await green authoritative PR CI on the exact final head, then stop for Human squash-merge."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-618 — Minimal Breath and public transparency pages

## Authority and admitted base

The Human approved execution after the Human squash merge of DEE-673. This frontend-only batch starts from `origin/main@714549934b6a00981d34476749f5e885c667f0fa`.

The active AI-TRADER PR #484 and its DEE-680 worktree are concurrent but isolated. This batch must not read, modify, merge, or validate through that worktree.

## Product contract

1. The homepage `Breath of WAIA` answers only `Available now`, `Runway`, and `Annual budget` from the DEE-617 public projection.
2. Unpublished or unavailable Treasury truth renders one calm pending statement, never zero-like placeholders.
3. Funding needs may appear only as quiet secondary public facts. They do not become primary cards.
4. Homepage actions are visually subordinate: `Transactions & budget`, `Patrons`, and `Work plan`.
5. `/budget` is the read-only public financial record: published annual total, category/group monthly records, and the bounded public transaction ledger from DEE-617.
6. `/work-plan` groups only the DEE-673 public projection by project and status. No iframe, browser token, private Linear API, or frontend recomputation.
7. All public copy is English. No private counterparty, admin note, account detail, internal identifier, or unpublished financial value is rendered.

## Scope boundaries

- frontend consumers and presentation only
- no `app/api/**` or Treasury/public-work-plan backend changes
- no schema, migration, Finance admin, watcher, R2, or financial-data mutation
- no AI-TRADER, FHV, Execution Server, production deployment, or merge
- no Patrons implementation; DEE-611 owns `/patrons`

## Work packages

### WP-0 — admission and isolation

- Verify PR #483 squash merge and DEE-673 Done.
- Verify DEE-617 and DEE-671 Done.
- Confirm no DEE-618 branch/PR duplicate.
- Create the isolated branch/worktree from exact `origin/main` and move DEE-618 to In Progress.

### WP-1 — typed public presentation boundary

- Add server-only read adapters that consume the existing public Treasury and Work-plan services without altering them.
- Add exact BigInt-safe money and date/runway presentation helpers.
- Provide truthful unavailable values to presentation components without leaking provider errors.

### WP-2 — public detail pages

- Implement `/budget` with accessible category/group and transaction tables, pending/empty states, and no admin controls.
- Implement `/work-plan` with accessible project/status grouping, safe external issue links, and available/stale/unavailable states.
- Add one restrained shared public-page shell and responsive overflow handling.

### WP-3 — minimal homepage Breath

- Replace the dashboard/grid/diagram with the three primary facts only.
- Render a single calm pending state when the public snapshot is not publishable.
- Add quiet funding-needs context and links without duplicating detail pages.
- Preserve accessibility, responsive behavior, design tokens, and one-glance hierarchy.

### WP-4 — validation and PR readiness

- Cover published, pending, stale, unavailable, exact-money, privacy, and no-iframe boundaries with focused unit tests.
- Update focused Playwright expectations for desktop and mobile public flows.
- Run lint, typecheck, build, targeted tests, E2E, canonical validation, PR-governance validation, and `git diff --check`.
- Synchronize with `origin/main`, open one PR to `main`, move Linear to In Review, and stop for Human squash merge.

## Expected file surfaces

- `docs/plans/dee-618-waia-minimal-breath-homepage-public-budget-page.md`
- `app/page.tsx`
- `app/budget/page.tsx`
- `app/work-plan/page.tsx`
- `components/landing/BreathOfWaiaSection.tsx`
- `components/landing/landing-page-content.tsx`
- `components/public/**`
- `lib/landing/**`
- focused `tests/unit/**` and `tests/e2e/**`

The coherent page set may exceed the approximate 800-line review target because the approved issue owns one public navigation boundary and one rollback unit. It remains under the same frontend label and Human gate, changes no backend contract, and splitting would temporarily create dead or misleading public links.

## Rollback and merge disposition

Rollback is a single revert of the DEE-618 squash commit. Existing public APIs remain unchanged. Human squash merge to `main` only.

## Local validation record

- focused unit: 44/44 passed across the minimal Breath, copy, exact formatter, and published public-page suites
- focused Chromium E2E: 18/18 passed across the landing and public-transparency suites
- targeted and full lint: passed; full lint retains only pre-existing repository warnings outside this diff
- typecheck, production build, canonical validation, PR-governance validation, and `git diff --check`: passed
- desktop and 390 px mobile Browser review: no console warnings/errors and no horizontal overflow
- walkthrough `:54339` read-only review: the current public Treasury projection truthfully remains pending; no administrative or zero-like fallback was rendered
- repository-wide Prettier check remains non-authoritative because `origin/main` contains pre-existing formatting drift and a malformed replay artifact; every DEE-618 file passes targeted Prettier
