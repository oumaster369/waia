---
integrationIssue: DEE-661
integrationTitle: "WAIA Treasury central ledger — counterparties, accounts, budget categories and projects"
branch: dee-661-treasury-central-ledger
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, build, targeted-unit, targeted-http, postgres-integration, canon, pr-governance]
approvalGates: [human-product-semantics-approved-2026-08-21, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-5
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4, WP-5]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: pre-commit-working-tree
  lastValidationAt: 2026-08-21
  blockedReason: null
  nextAction: "Commit, push and open the Human-merge PR after final diff inspection."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-661 — Treasury central ledger backend

## Authority and boundary

The Human product owner authorized the transaction-centered Finance model on 2026-08-21. Live Linear DEE-661 is the executable contract. This plan implements backend persistence and HTTP authority only. DEE-619 owns the Finance Console UI; DEE-617/618 own the public Treasury and minimal Breath surfaces.

Baseline: `origin/main@292af189b100f1c412dbf65e348ca844efe7bd4a`.

Hard exclusions: production/staging apply, walkthrough DB `127.0.0.1:54339`, production financial data, watcher enablement/chain calls, R2, AI-TRADER, holdout/live capital, Execution Server, merge.

## Architectural decisions

1. **Signed Human amount, canonical accounting tuple.** A non-zero signed amount is the admin input. Positive maps to `INFLOW`; negative maps to `OUTFLOW`; storage retains non-negative native/accounting amounts plus signed cash effect and canonical direction. Internal transfer remains an advanced domain semantic and is not forced through the external signed-flow adapter.
2. **Verified-only truth.** `PLANNED` is future/manual-only and has no accounting, reconciliation, contribution-share, budget-spend, runway, or public effect. Automatic watcher rows continue through `DETECTED -> NEEDS_REVIEW`.
3. **Additive catalogs.** Counterparties, accounts, categories, and projects are organization-scoped reference entities. Existing text fields and rows remain compatible; transaction references are nullable.
4. **Tenant-safe references.** Every reference table has `(organization_id, id)` uniqueness; transaction/catalog links use composite same-org foreign keys. Referenced catalogs are archived, not deleted.
5. **Sensitive-data boundary.** Catalog list/transaction DTOs expose display-safe summaries only. Full counterparty contact/payment metadata and account requisites remain dedicated admin-detail data. Secret/custody material and full card credentials are rejected.
6. **Budget authority.** Category monthly amounts are mutable granular inputs. Existing approved/published annual budget records remain the public snapshot authority, refreshed only by an explicit audited server command using exact integer arithmetic.
7. **Identity privacy.** User-to-counterparty linkage requires an authoritative contribution attribution/user identity. Blockchain addresses never infer identity. Public consent remains independent.
8. **Migration discipline.** Hand-authored Postgres migrations and journal entries; no blind Drizzle generation. New public-schema tables receive deny-by-default RLS for `anon`/`authenticated` matching existing Treasury posture.

## Work packages

### WP-1 — Additive schema and RLS

- Add `PLANNED` to the Treasury status enum.
- Add four catalog tables, exact constraints, search/order indexes, archive state, composite tenant uniqueness/FKs.
- Add nullable catalog reference columns to `treasury_transactions` and safe watched-address linkage for accounts.
- Update `db/schema.postgres.ts`, `db/core-enums.ts`, migration journal, foundation migration and RLS migration.
- Prove empty-DB apply only in the dedicated disposable validation topology; never use port 54339.

### WP-2 — Core repository/services

- Add catalog record/input/query types, validation, exact monthly/annual aggregation, repositories, audit actions and serializers.
- Extend transaction semantic records/repositories with nullable reference IDs and same-org validation.
- Add planned-state transitions and explicit exclusion tests across all accounting/public aggregates.
- Add signed-amount adapter while preserving canonical invariants.
- Add attribution-based user/counterparty linkage without public-consent coupling.

### WP-3 — Admin HTTP contracts

- Add organization-scoped routes for counterparties, accounts, categories, and projects.
- Support deterministic paginated search/list plus create/update/archive.
- Return display-safe summaries from transactions; full sensitive fields only from dedicated detail endpoints.
- Add signed manual transaction and classification inputs without a verification bypass.
- Add explicit audited annual-budget refresh from active category inputs.

### WP-4 — Focused validation

- Unit: parsing/validation, signed money, planned FSM/exclusions, budget aggregation, identity/privacy.
- HTTP: permissions, tenancy, pagination/search, safe DTOs, rejected custody/card material.
- Postgres: empty history apply, RLS deny, cross-org composite references, indexes/constraints, legacy null compatibility.
- Regression: existing Treasury transaction/watcher/share/accounting tests.

### WP-5 — Integration readiness

- Run lint, typecheck, build, targeted tests, canonical-plan validation and PR-governance validation.
- Inspect exact diff/status and synchronize with current `origin/main` under the hook-safe policy.
- Commit/push feature branch and prepare one Human-merge PR only when every gate is green.

## Expected file surfaces

- `docs/plans/dee-661-treasury-central-ledger.md`
- `db/core-enums.ts`
- `db/schema.postgres.ts`
- `db/migrations_postgres/0154_*`, `0155_*`, `meta/_journal.json` (identities may be renumbered after main synchronization)
- `lib/waia-core/treasury/**` bounded catalog/transaction modules
- `app/api/admin/treasury/{counterparties,accounts,categories,projects}/**`
- targeted `tests/unit/**`, `tests/integration/**`

The backend contract crosses schema, repository, service, HTTP and tests and may exceed the normal ~20-file review target. It remains one atomic batch because independently landing partial catalog/FK/status/HTTP contracts would create unusable or unsafe intermediate authority. Modules stay bounded and generated/lockfile churn is excluded.

## Validation commands

```bash
pnpm exec vitest run <DEE-661 focused unit and HTTP tests>
pnpm exec vitest run <affected existing Treasury regression tests>
<dedicated disposable Postgres empty-DB and DEE-661 integration tests>
pnpm lint
pnpm typecheck
pnpm build
pnpm validate:canon
pnpm validate:pr-governance
```

## Merge disposition

Human squash-merge only. No DEE-653 autonomous AI-TRADER merge exception applies to this Core Treasury T3 task.

## Validation record — 2026-08-21

- `pnpm lint`: pass (repository baseline warnings only; no errors).
- `pnpm typecheck`: pass.
- `pnpm build`: pass.
- `pnpm exec vitest run tests/unit/treasury-*.test.ts`: 305/305 pass.
- focused DEE-661 catalog/FSM/accounting/share/watcher/admin HTTP tests: 123/123 pass.
- `pnpm validate:canon`: pass.
- `pnpm validate:pr-governance`: pass.
- Empty migration history: pass on dedicated disposable Postgres 16 at `127.0.0.1:54341`; container removed after validation.
- Postgres structural proofs: `PLANNED` enum present; all four catalog tables have RLS; 16 deny policies present; catalog references present; authenticated catalog read returns zero rows; cross-organization watched-address/account reference rejected by the composite FK.
- Walkthrough Postgres `127.0.0.1:54339`: not used or mutated.
- The broader repository unit suite was sampled but not treated as a DEE-661 gate: unrelated FHV tests require sandbox-prohibited loopback sockets and temporary Git worktree metadata writes. Treasury and affected migration-identity tests are green.
