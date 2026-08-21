---
integrationIssue: DEE-619
integrationTitle: "Finance Console — central ledger UX and one-glance Treasury workspace"
branch: dee-619-finance-console-central-ledger-ui
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
executionLabel: frontend
requiredValidation: [lint, typecheck, build, targeted-unit, e2e, human-visual-review, canon, pr-governance]
approvalGates: [human-product-semantics-approved-2026-08-21, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-5
  completedWorkPackages: [WP-0, WP-1, WP-2, WP-3, WP-4, WP-5]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: 2026-08-21
  blockedReason: null
  nextAction: "Open one Human-merge PR, record its identity, and await green checks and Human product review."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-619 — Finance Console central ledger UI

## Authority and boundary

The Human product owner approved the transaction-centered Finance model on 2026-08-21. Live Linear DEE-619 is the executable frontend contract. Merged DEE-661 provides the server-owned catalog, signed-amount, planned-state, and tenant-safe reference contracts.

Baseline: `origin/main@3117675275c2f7b0f0cb0e4865ce2cfa656bb3a4`.

This issue changes only the authenticated Finance Console. It does not change backend/API/schema/FSM authority or the public homepage/Breath implementation.

Hard exclusions: production/staging apply, financial-data deletion or repair, watcher/chain execution, R2, AI-TRADER, FHV, holdout/live capital, Execution Server, public homepage/Breath, deployment, and merge.

## Product decisions

1. **Three destinations.** Primary Finance navigation is exactly Overview, Transactions, and Budget. Evidence, publication, funding needs, commitments, and reference catalogs remain contextual secondary tools.
2. **Transactions are the center.** The primary ledger exposes occurred date/time, simplified Human status, signed amount, counterparty, account, category, project, notes, and review action. Direction remains an internal canonical fact derived by the server from the signed amount and is not a normal Human control.
3. **Human gates remain authoritative.** Automatic wallet rows require review. Manual rows default to Needs review; Planned is future-only. Verification remains an audited command, never a dropdown shortcut.
4. **Form-open time.** The manual transaction timestamp is captured once when the form opens and remains editable. It does not drift during typing or submit.
5. **Organization-scoped catalogs.** Counterparty, account, category, and project selectors use the DEE-661 server search contracts. Missing values can be created contextually. Sensitive counterparty/account detail stays out of transaction list DTOs.
6. **Budget by category.** Category monthly amounts are editable granular budget inputs. Existing annual budget, funding-need, and commitment authorities remain distinct and are composed into one Budget workspace.
7. **One-glance Overview.** The primary surface answers Available now, Runway, Annual budget, and Requires review. Publication and operational diagnostics remain progressive disclosure and retain truthful pending states.

## Work packages

### WP-0 — preflight and isolation

- Confirm DEE-661 merge and exact current `origin/main`.
- Read current AGENTS/governance/Design OS, live Linear DEE-619, and GitHub PR state.
- Create a dedicated DEE-619 worktree/branch and inventory AI-TRADER worktrees without modifying them.

### WP-1 — information architecture and client contracts

- Reduce primary Finance navigation to Overview / Transactions / Budget.
- Add display-safe catalog DTOs and organization-scoped search/create/update client hooks.
- Add shared signed amount, simplified status, and catalog-label helpers.

### WP-2 — central transaction workflow

- Rework the transaction ledger around signed amount and catalog references; remove Direction from normal list/filter UI.
- Rework manual creation around form-open date/time, Needs review / Planned, signed amount, catalog selectors, and notes.
- Rework review/classification to use catalog references and preserve audited classify/verify/publication separation.

### WP-3 — one-glance Overview and combined Budget

- Reduce Overview to the three Treasury facts plus one review queue action.
- Move publication and operational details behind progressive disclosure.
- Compose category budget planning, annual budgets, funding needs, and commitments into one Budget workspace.

### WP-4 — focused validation

- Unit-test signed Human input, simplified status semantics, catalog request bodies, and navigation/UI invariants.
- Extend Finance E2E for the central ledger, manual form-open timestamp, contextual catalogs, review, Overview, and Budget.
- Run lint, typecheck, build, targeted Treasury tests, canon, and PR governance.

### WP-5 — Human visual review and integration readiness

- Build current branch and restore the isolated split walkthrough runtime on `127.0.0.1:3310` only when its additive DEE-661 schema prerequisites are proven.
- Preserve the existing auth SQLite/session; do not seed, repair, or otherwise mutate financial rows for review.
- Inspect Transactions, manual form, existing transaction review, Overview, Budget, console, and runtime errors in an actual visible browser.
- Prepare one PR for Human squash merge only after all gates are green.

## Expected file surfaces

- `docs/plans/dee-619-finance-console-central-ledger-ui.md`
- `lib/treasury-admin/{types,manual-draft,ledger-catalog,status}.ts`
- `components/treasury/admin/{finance-shell,transaction-table,manual-transaction-form,transaction-review,overview-panel,budget-workspace,ledger-catalog-select,category-budget-panel}.tsx`
- `app/(treasury-admin)/finance/budgets/page.tsx`
- focused `tests/unit/**` and `tests/e2e/treasury-admin-finance.spec.ts`

## Validation commands

```bash
pnpm exec vitest run <DEE-619 focused unit and UI tests>
pnpm lint
pnpm typecheck
pnpm build
pnpm test:e2e -- tests/e2e/treasury-admin-finance.spec.ts
pnpm validate:canon
pnpm validate:pr-governance
```

## Merge disposition

Human squash-merge only. No autonomous AI-TRADER merge exception applies to this Core Treasury T3 frontend task.

## Validation record — 2026-08-21

- `pnpm lint`: pass (repository baseline warnings only; no errors).
- `pnpm typecheck`: pass.
- `pnpm build`: pass.
- focused Treasury admin unit/UI tests: 28/28 pass.
- `pnpm test:e2e tests/e2e/treasury-admin-finance.spec.ts --project=chromium`: 4/4 pass.
- `pnpm validate:canon`: pass.
- `pnpm validate:pr-governance`: pass.
- Human visual review: Transactions, manual form, an existing transaction review, Overview, and every Budget workspace tab inspected in an actual visible browser; browser console remained clean and no write action was submitted.
- Walkthrough Postgres `127.0.0.1:54339`: full pre-migration backup created; only merged sequential migrations 0152–0155 applied because current-main UI contracts require 0154/0155. Financial row counts remained exactly unchanged (budgets 1, commitments 1, funding needs 1, transactions 4); all four new catalogs remain empty.
- Existing auth SQLite/session preserved; no cookie value read or printed.
- No Execution Server access, watcher/chain call, deployment, financial record mutation, main mutation, or active AI-TRADER worktree/process mutation.
