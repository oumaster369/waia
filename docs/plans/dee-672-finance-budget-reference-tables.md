---
integrationIssue: DEE-672
integrationTitle: "WAIA Finance Console budget and reference-table refinement"
branch: dee-672-finance-budget-reference-tables
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
executionLabel: frontend
requiredValidation: [lint, typecheck, build, targeted-unit, e2e, human-visual-review, canon, pr-governance]
approvalGates: [human-product-semantics-approved-2026-08-22, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-review
  currentWorkPackage: WP-5
  completedWorkPackages: [WP-0, WP-1, WP-2, WP-3, WP-4, WP-5]
  remainingWorkPackages: []
  prNumber: 480
  prUrl: "https://github.com/oumaster369/waia/pull/480"
  lastValidatedGitSha: 89cecd2f829dddf64ab5f00a792b976fc800e669
  lastValidationAt: 2026-08-22
  blockedReason: null
  nextAction: "Await green PR #480 CI and Human visual review; Human squash-merges to main. Never merge autonomously."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-672 — Finance budget and reference-table refinement

## Authority and boundary

The Human product owner approved the minimal transaction-centred Finance refinement on 2026-08-22. Merged DEE-671 provides server-generated category codes, category groups, effective-month budget history, and server-derived monthly/annual summaries. DEE-672 is the dependent authenticated Finance Console UI only.

Baseline: `origin/main@5f0fc2ad86b4c5a961ee8f117df0dbfc91762b76` after the Human squash merge of DEE-674 / PR #479.

Hard exclusions: database/schema/API changes, public homepage or Breath pages, public transaction/budget pages, Linear work-plan embedding, production or walkthrough financial-row mutation, watcher/chain execution, AI-TRADER, FHV, Execution Server, deployment, autonomous merge, and direct `main` mutation.

## Product decisions

1. **Transactions remain the centre.** The default table order is Counterparty, Category, Amount, Status, Date & time, Project, Notes, Review. Account remains available in create/review detail but is not a default ledger column.
2. **Budget truth is server-owned.** Current month category/group Budget, Spent, and Remaining and the annual month history come only from DEE-671 derived reads. The client never recomputes spend or persists counters.
3. **One monthly input.** Category create asks for name, positive monthly limit, group, optional description, and a quiet explicit currency. The server alone creates the unique code.
4. **Groups are values.** Development, Advertising, Payroll, Equipment, and Office are suggestions; a Human may enter another non-empty group. There is no group table.
5. **Annual view is derived.** Annual budget and monthly history are read-only summaries. The legacy Create planned budget form and Funding needs tab leave the primary Budget workspace. Commitments stay available only as an advanced operational tool.
6. **Reference tables are first-class but compact.** Counterparties, Accounts, and Projects sit next to Budget in Finance navigation. Each page provides organization-scoped search, add, edit, and archive controls using the merged catalog contracts and existing audit gates.
7. **Fresh reads after ledger changes.** Budget and catalog workspaces fetch with no client cache whenever opened or explicitly reloaded. Transaction writes do not fan out derived values from the browser.
8. **Minimum sufficient information.** Default screens favour concise tables and progressive disclosure. Sensitive account/counterparty details appear only in authenticated edit surfaces, never in the transaction list.

## Work packages

### WP-0 — preflight and isolation

- Confirm DEE-671 squash merge, green authoritative checks, and exact `origin/main`.
- Read current AGENTS, governance, Design OS, live Linear DEE-672, and GitHub state.
- Create a dedicated DEE-672 worktree/branch and inventory the active AI-TRADER worktree without modifying it.

### WP-1 — navigation, transaction order, and client contracts

- Add Counterparties, Accounts, and Projects after Budget in Finance navigation.
- Reorder the transaction table exactly as approved and remove Account only from the default columns.
- Add DEE-671 category-group and monthly/annual summary DTOs.
- Remove obsolete client-authority category-code fields from contextual creation.

### WP-2 — current and annual budget workspace

- Replace catalog-only category totals with server-derived current-month category, group, and total summaries.
- Add/edit category name, group, positive monthly limit, description, and currency through audited catalog mutations.
- Replace planned-budget creation with a read-only annual total and twelve-month history.
- Remove Funding needs from Budget; place Commitments under advanced tools.

### WP-3 — compact reference-table workspaces

- Add searchable Counterparties, Accounts, and Projects pages.
- Provide minimal audited add/edit/archive forms while retaining safe detail fields and secret-data warnings.
- Preserve organization isolation and inactive/historical references.

### WP-4 — focused validation

- Add focused unit/UI coverage for exact transaction columns, server-owned budget rendering, code omission, group input, and compact catalog behavior.
- Extend Finance E2E fixtures and workflow for the new navigation, current/annual budget views, and reference tables.
- Run lint, typecheck, build, focused tests, canonical validation, and PR governance.

### WP-5 — Human review and integration readiness

- Build current branch and restore the isolated split walkthrough runtime only after proving compatibility with merged migrations.
- Preserve the existing auth SQLite/session and financial rows.
- Inspect Transactions, Budget, all reference pages, forms, responsive layout, console, and runtime errors in an actual visible browser.
- Open one PR for Human squash merge; never merge it autonomously.

## Expected file surfaces

- `docs/plans/dee-672-finance-budget-reference-tables.md`
- `lib/treasury-admin/types.ts`
- `components/treasury/admin/{finance-shell,transaction-table,ledger-catalog-select,category-budget-panel,budgets-panel,budget-workspace,ledger-catalog-workspace}.tsx`
- `app/(treasury-admin)/finance/{counterparties,accounts,projects}/page.tsx`
- `wrangler.jsonc` (bounded shared packaging correction only; no deployment)
- focused `tests/unit/**` and `tests/e2e/treasury-admin-finance.spec.ts`

## Validation

```bash
pnpm exec vitest run <DEE-672 focused tests>
pnpm lint
pnpm typecheck
pnpm build
pnpm test:e2e tests/e2e/treasury-admin-finance.spec.ts --project=chromium
pnpm validate:canon
pnpm validate:pr-governance
```

Walkthrough Postgres `127.0.0.1:54339` is a Human-review target only. No financial write is permitted during validation.

## Merge disposition

T3 Human squash-merge only. AI-TRADER worktrees/PRs and the Execution Server remain outside this issue.

## Validation record — 2026-08-22

- exact Finance E2E workflow: 4/4 pass, including transaction columns, category create without client code, current/annual budget rendering, and three reference workspaces.
- focused Treasury UI/truth/catalog tests: 25/25 pass.
- `pnpm typecheck`: pass.
- `pnpm lint`: pass with 302 repository baseline warnings and 0 errors.
- `pnpm build`: pass.
- `pnpm validate:canon`: pass.
- `pnpm validate:pr-governance`: pass.
- Human walkthrough: Transactions, manual form, existing review, Categories, Counterparties, Accounts, and Projects pass read-only with a clean browser console. Annual UI passes in a local review build containing the exact DEE-674 correction.
- Source walkthrough DB on 54339 remains unchanged at 4 transactions, 1 budget, 1 commitment, and 1 funding need. Review uses a local cloned database on the same container/port with only Treasury 0158/0159 applied; no source financial mutation and no AI-TRADER migration.
- No form submit, financial-row mutation, Execution Server access, deployment, main mutation, or AI-TRADER worktree mutation.
- Rebased the unpublished DEE-672 branch onto `origin/main@5f0fc2ad86b4c5a961ee8f117df0dbfc91762b76`; the merged DEE-674 annual query fix is now part of the real branch history. Repeated focused tests, lint, typecheck, production build, Finance E2E, canon, and PR-governance validation successfully on code HEAD `89cecd2f829dddf64ab5f00a792b976fc800e669`.

## PR #480 CI correction — 2026-08-22

- The native Cloudflare Workers build compiled the OpenNext application, then failed its upload validation with Cloudflare error `10027`: `3086.48 KiB` gzip exceeded the account's `3072 KiB` Worker limit.
- The bounded correction enables Wrangler's supported top-level `minify` option. This is a shared packaging setting, not a Finance runtime or AI-TRADER source change; it does not alter bindings, variables, routes, cron configuration, or product behavior.
- Workflow-equivalent dry runs must remain below the Cloudflare limit without a CLI-only `--minify` override. No real deployment is permitted as part of this correction; PR #480 remains Human squash-merge only.
