---
integrationIssue: DEE-613
integrationTitle: "WAIA conscious contribution and Development Fund doctrine"
branch: dee-613-conscious-contribution-development-fund-doctrine
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [format-scope, validate-canon, lint, typecheck, build, pr-governance]
approvalGates: [architect-semantic-approval, integration-ready, human-merge]
includedIssues: []
deferredIssues: [DEE-690]
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: [WP-0]
  remainingWorkPackages: [WP-1, WP-2]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Complete the doctrine diff and validation, then prepare one Human-reviewed PR to main."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-613 — conscious contribution and Development Fund doctrine

## Authority and admitted base

The Human Architect approved the first minimal allocation policy on 2026-08-24: the approved annual WAIA budget is protected, and canonical free funds above it are accounted to the Development Fund.

This product-only batch starts from `origin/main` at `2945feba8fe48aa3c197e8a76078b9937f5e1c88`.

Active AI-TRADER PR #487 owns migration `0162` and changes `db/schema.postgres.ts`. It and all AI-TRADER worktrees are isolated and out of scope. DEE-690 is the separately scoped backend implementation and remains blocked until this doctrine is Human-merged.

## Product contract

1. Contributions are voluntary and must not be framed as compulsory taxation, moral debt or a purchase of human weight.
2. The initial fund topology has two virtual balances only: WAIA operating fund and Development Fund.
3. Canonical free funds `A` come from existing verified Treasury accounting after active commitments.
4. The protected authority `B` is the one applicable approved and published annual WAIA budget in the same currency.
5. `operatingAllocation = min(A, B)` and `developmentAllocation = max(0, A - B)` using exact integer micros.
6. The balances conserve `A`; money remains on the same physical accounts and wallets.
7. Material authoritative changes recalculate the allocation. Unverified transactions do not.
8. Missing, stale, conflicting, negative or currency-incompatible authority fails closed.
9. Development spending, Commons, solidarity, investment, DAO and physical-transfer mechanics remain deferred.
10. No public claim that the Development Fund operates is allowed before backend implementation truth exists.

## Work packages

### WP-0 — admission and isolation

- Refresh `origin/main`, open PRs, worktrees, governance and DEE-613.
- Identify migration collision with active AI-TRADER PR #487.
- Create an isolated DEE-613 branch/worktree and move Linear to In Progress.
- Create backend issue DEE-690, blocked by DEE-613.

### WP-1 — doctrine

- Add one English product doctrine with approved formulas, boundaries and examples.
- Link the doctrine from the product hub.
- Narrow DEE-612's deferred-language boundary to the now-approved DEE-613 rule and DEE-690 implementation gate.

### WP-2 — validation and handoff

- Run targeted formatting, canonical validation, lint, typecheck, build, PR-governance validation and diff checks.
- Prepare one product-only PR to `main` for Human semantic review and squash-merge.
- Do not begin DEE-690 schema work before DEE-613 is Human-merged and the competing migration position is available on current `main`.

## Expected files

- `docs/product/waia-conscious-contribution-development-fund-doctrine.md`
- `docs/product/waia-user-stewardship-doctrine.md`
- `docs/product/WAIA-V1-MVP-SPEC.md`
- `docs/plans/dee-613-conscious-contribution-development-fund-doctrine.md`

## Do not

- no runtime code, schema, migration, API, Finance Console or public-page changes;
- no physical transfer, custody action or financial-data mutation;
- no production deployment, release or secret change;
- no Commons, solidarity payment, grant, sponsorship, DAO, investment or adaptive reserve implementation;
- no AI-TRADER, FHV or Execution Server access/mutation;
- no merge or auto-merge.

## Acceptance criteria

- The annual-budget protection rule and exact conservation formula are unambiguous.
- Virtual accounting is clearly separated from custody and physical transfers.
- Recalculation, corrections and fail-closed semantics are defined.
- Development Fund is separated from deferred Commons/solidarity mechanics.
- Public claims remain blocked until implementation truth exists.
- DEE-690 is the sole first backend implementation boundary.
- Human Architect approval remains the squash-merge gate.

## Validation

```bash
pnpm exec prettier --check docs/product/WAIA-V1-MVP-SPEC.md docs/product/waia-user-stewardship-doctrine.md docs/product/waia-conscious-contribution-development-fund-doctrine.md docs/plans/dee-613-conscious-contribution-development-fund-doctrine.md
pnpm validate:canon
pnpm lint
pnpm typecheck
pnpm build
pnpm validate:pr-governance
git diff --check
```

No runtime or user-visible behavior changes; unit and end-to-end tests are not required for this product-doctrine batch.

