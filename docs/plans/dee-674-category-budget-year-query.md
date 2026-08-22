---
integrationIssue: DEE-674
integrationTitle: "Fix Treasury category-budget annual year query parsing"
branch: dee-674-category-budget-year-query
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
executionLabel: backend
requiredValidation: [lint, typecheck, build, targeted-unit, canon, pr-governance]
approvalGates: [integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-review
  currentWorkPackage: WP-2
  completedWorkPackages: [WP-0, WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: 479
  prUrl: https://github.com/oumaster369/waia/pull/479
  lastValidatedGitSha: 357734ccf6706b7a81cef1679fead4de21432b98
  lastValidationAt: 2026-08-22
  blockedReason: null
  nextAction: "Await green authoritative CI and Human squash-merge; never merge autonomously."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-674 — Category-budget annual year query parsing

## Authority and boundary

Human visual review of DEE-672 proved that merged DEE-671 returns `INVALID_BODY` for every annual category-budget request because `URLSearchParams.get()` returns a string and the handler passes it directly to the number-only `requireInt` validator.

Baseline: `origin/main@9fd25a456bf5f785eb9e5e99760a654fc5a311c2`.

Hard exclusions: schema or migrations, category-budget truth changes, database or financial data writes, Finance UI, public Breath, AI-TRADER, FHV, Execution Server, deployment, and merge.

## Acceptance

- A real `year=2026` URL query returns the annual DEE-671 summary.
- Missing `year` retains current-month behavior.
- malformed, fractional, and out-of-range years fail closed.
- No change to category/month calculations or serialization.

## Work packages

### WP-0 — reproduce and isolate

- Reproduce the failure through a real visible walkthrough request.
- Create Linear DEE-674 and a dedicated worktree/branch from current `origin/main`.

### WP-1 — repair and regression

- Convert the URL query string to a number before `requireInt`.
- Add focused HTTP regressions for valid, malformed, and out-of-range values.

### WP-2 — validation and Human merge PR

- Run focused unit, lint, typecheck, build, canon, and PR governance.
- Open one Human squash-merge PR; never merge.

## Expected file surfaces

- `docs/plans/dee-674-category-budget-year-query.md`
- `lib/waia-core/treasury/admin/handlers.ts`
- `tests/unit/treasury-category-budget-truth.test.ts`

## Merge disposition

T3 Human squash-merge only. DEE-672 stays blocked until this correction lands.

## Validation record — 2026-08-22

- focused DEE-671/674 truth and HTTP test: 3/3 pass, including canonical `year=2026` and malformed/range fail-closed cases.
- `pnpm typecheck`: pass.
- `pnpm lint`: pass with 305 repository baseline warnings and 0 errors.
- `pnpm build`: pass.
- `pnpm validate:canon`: pass.
- `pnpm validate:pr-governance`: pass.
- No database/schema/data mutation, AI-TRADER/FHV/Execution Server access, deployment, or merge.
