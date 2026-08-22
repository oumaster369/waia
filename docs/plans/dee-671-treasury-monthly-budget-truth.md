---
integrationIssue: DEE-671
integrationTitle: "WAIA Treasury monthly category budget truth and history"
branch: dee-671-treasury-monthly-budget-truth
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, build, targeted-unit, targeted-http, postgres-integration, canon, pr-governance]
approvalGates: [human-product-semantics-approved-2026-08-22, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-4
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: 2026-08-22
  blockedReason: null
  nextAction: "Commit and open the Human-merge PR; serialize migration-journal integration behind active AI-TRADER PR #477."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-671 — Treasury monthly category budget truth and history

## Authority and boundary

The Human product owner approved the refined transaction-centered Finance model on 2026-08-22. Live Linear DEE-671 is the executable backend contract. DEE-672 owns the dependent Finance Console UI; DEE-617/618 own public read models and pages.

Baseline: `origin/main@8aa3d316d407f2f1ded567e8bb44123657972113`.

Hard exclusions: production/staging SQL apply, walkthrough Postgres `127.0.0.1:54339`, watcher or chain calls, R2, production financial data, AI-TRADER, FHV, Execution Server, merge.

## Architectural decisions

1. **Groups are values, not entities.** `group_name` is normalized category text. The UI may suggest Development, Advertising, Payroll, Equipment and Office while the backend accepts other non-empty values. There is no group table or group identity lifecycle.
2. **Codes are server authority.** Category create derives a stable uppercase slug from the Human name and adds a deterministic numeric suffix on organization-local collisions. Clients cannot choose the create-time code.
3. **Effective-month history.** An additive history table records a category limit, currency and group snapshot beginning at a calendar month. The latest record at or before a requested month is effective. This preserves month-by-month truth without cron jobs or copied monthly rows.
4. **Exact verified spend.** Only complete `VERIFIED` negative cash effects assigned to the category and occurring in the requested month consume its limit. Duplicates and detail-superseded rows are excluded; review/planned/inflow/internal rows never consume budget.
5. **Derived reads, no write fan-out.** Current and annual category/group summaries are computed from authoritative category history and transactions at read time. Transaction writes do not update counters.
6. **Currency partitions.** Totals never combine unlike currencies. Remaining may be negative to expose overspend.
7. **Legacy compatibility.** Existing category amounts remain current inputs. Migration backfills `Other` and seeds one effective record from each category's `updated_at` month; it does not invent earlier history.
8. **Migration discipline.** Hand-authored Postgres migrations and journal entries only; deny-by-default RLS matches existing Treasury posture. No SQLite migration because Treasury admin is already Postgres-only.

## Work packages

### WP-1 — Additive schema and RLS

- Add category `group_name` and effective-month budget history table.
- Add tenant-safe uniqueness/FKs, indexes, exact checks, legacy backfill and deny RLS.
- Update Postgres schema, migration journal, `db/AGENTS.md` and the migration tracker memory line.

### WP-2 — Core service and repositories

- Add code generation, group normalization and effective-month writes to category create/update.
- Add pure exact derivation for monthly category/group summaries and annual month history.
- Extend memory/Postgres repositories without broad runtime routing changes.

### WP-3 — Admin HTTP read contract

- Extend category DTO/input with group and server-owned code.
- Add a read-only organization-scoped budget-summary route for month/year views.
- Preserve mutation permissions/audit requirements and reject client code authority on create.

### WP-4 — Validation and integration readiness

- Unit and HTTP tests for codes, effective dates, status/correction/duplicate exclusions, overspend and currencies.
- Migration/RLS checks on disposable Postgres only.
- Run lint, typecheck, build, canonical and PR-governance validation.
- Open one Human-merge PR; never merge.

## Expected file surfaces

- `docs/plans/dee-671-treasury-monthly-budget-truth.md`
- `db/schema.postgres.ts`
- `db/migrations_postgres/0158_*`, `0159_*`, `meta/_journal.json` (`0157` is reserved by active AI-TRADER PR #477)
- `db/AGENTS.md`, `docs/migrations/DEE-64-TRACKER.md`
- `lib/waia-core/treasury/admin/**`
- `app/api/admin/treasury/category-budgets/route.ts`
- focused `tests/unit/**` and Postgres structural coverage

## Validation

```bash
pnpm exec vitest run <DEE-671 focused tests>
pnpm lint
pnpm typecheck
pnpm build
pnpm validate:canon
pnpm validate:pr-governance
```

Migration apply uses only a dedicated disposable Postgres instance. Port `54339` is never an implementation or validation target.

## Merge disposition

T3 Human squash-merge only. The active AI-TRADER PR/worktrees and the Execution Server are outside this issue.

## Validation record — 2026-08-22

- `pnpm lint`: pass (305 repository baseline warnings, 0 errors).
- `pnpm typecheck`: pass.
- `pnpm build`: pass; the first isolated-worktree attempt correctly rejected an external `node_modules` symlink, then passed with a normal lockfile-frozen install.
- `pnpm exec vitest run tests/unit/treasury-*.test.ts tests/unit/forecast-v2-applied-migration-identity-v1.test.ts`: 321/321 pass across 33 files.
- focused DEE-671 service/HTTP regressions after the group-history snapshot refinement: 27/27 pass.
- `pnpm validate:canon`: pass.
- `pnpm validate:pr-governance`: pass.
- Empty migration history and Postgres driver smoke: pass on dedicated disposable Postgres 16 at `127.0.0.1:54341`; container removed after validation.
- Postgres structural proof: `group_name` history snapshot is non-null; history RLS is enabled; 4 deny policies and 8 constraints are present.
- Walkthrough Postgres `127.0.0.1:54339`: not accessed or mutated.
- No watcher/chain call, production/staging apply, financial-row mutation, Execution Server access, main mutation, or active AI-TRADER worktree mutation.
