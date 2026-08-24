---
integrationIssue: DEE-690
integrationTitle: "WAIA Treasury virtual Development Fund allocation truth"
branch: dee-690-treasury-development-fund-allocation
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, canon, pr-governance]
approvalGates: [human-product-semantics-approved-2026-08-24, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: 2026-08-24
  blockedReason: null
  nextAction: "Commit the validated implementation, open one Human-merge-only PR, and await authoritative CI and Human review."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-690 — Treasury virtual Development Fund allocation truth

## Authority and boundary

The Human Architect approved the initial allocation doctrine in DEE-613, merged to
`main` as `c7b897db85e560f7f2b98a48da4c0f520636d690`. The protected operating requirement is
the one applicable approved and published annual WAIA budget. Canonical free funds above
that amount are virtually accounted to the Development Fund.

Baseline: `origin/main@c7b897db85e560f7f2b98a48da4c0f520636d690`.

Hard exclusions: physical transfers, custody or account mutation, transaction bucket
rewrites, public/admin UI, production/staging SQL apply, walkthrough Postgres
`127.0.0.1:54339`, watcher or chain calls, AI-TRADER, FHV, Execution Server, merge.

## Architectural decisions

1. **Derived-read truth, not write fan-out.** Each current-allocation read reloads the
   complete canonical verified accounting facts and active commitments. It never trusts a
   mutable counter and never updates transaction rows.
2. **One exact authority.** The service requires exactly one currently effective
   `ACTIVE+PUBLIC` ideal annual budget. Missing or overlapping authority fails closed.
3. **Fresh accounting gate.** Allocation requires the same fresh balance-reconciliation
   boundary used by Breath, one active inception, no material unresolved reconciliation,
   and an exact match between the reconciliation accounting balance and the recomputed
   verified ledger balance.
4. **One accounting currency.** V1 allocation authority is USD micros under the existing
   nominal USD accounting policy. The annual budget and every active commitment must use
   the same currency. Mismatch fails closed; currencies are never converted or combined.
5. **Exact formulas.** For non-negative canonical free funds `A` and annual budget `B`:
   `operating=min(A,B)` and `development=max(0,A-B)`. BigInt is required and conservation
   is asserted before persistence.
6. **Append-only evidence.** A new organization-scoped evidence row is inserted only when
   the canonical input digest changes. Repeated reads of identical truth return the same
   row. Corrections, reversals, commitment changes, reconciliation changes and annual
   budget changes produce new evidence without mutating history.
7. **Policy identity is explicit.** Every row records the fixed policy code and version,
   input digest, output digest, budget authority, reconciliation authority and exact input/
   output micros.
8. **Fail closed means no invented zero.** Expected unavailability is returned as an
   explicit reason and no evidence row is written. Negative free funds, stale accounting,
   incomplete verified rows or ambiguous authority never become a zero Development Fund.
9. **Tenant isolation is structural.** Composite same-organization foreign keys, mandatory
   org predicates, advisory locking, deny RLS and append-only database triggers protect the
   evidence relation.
10. **Postgres only.** Treasury admin is Postgres-only. Migrations `0163`/`0164` are
    hand-authored and journaled; no SQLite schema or broad runtime routing change is added.

## Work packages

### WP-1 — Additive evidence schema and RLS

- Add the allocation evidence table, exact arithmetic checks, authority FKs, digest
  uniqueness and latest-read index.
- Add append-only update/delete guards and deny authenticated/anon RLS.
- Update Drizzle schema, migration journal, database guidance and migration tracker memory.

### WP-2 — Pure engine and derived-read service

- Implement exact BigInt allocation and conservation validation.
- Select and validate canonical facts, annual budget, reconciliation and currency.
- Compute deterministic input/output digests and explicit fail-closed reason codes.
- Materialize idempotent evidence under organization-scoped concurrency control.

### WP-3 — Repository and runtime boundary

- Add memory and Postgres repositories with complete, unpaginated, org-scoped fact loads.
- Bind the allocation service into existing Treasury admin services without adding a route
  or changing public/admin DTOs.

### WP-4 — Validation and integration readiness

- Unit-test formulas, thresholds, ambiguity, staleness, negative free funds, currency,
  corrections and idempotency.
- Validate empty migration history plus tenant isolation, same-org FKs, append-only guards
  and concurrent idempotency on disposable Postgres only.
- Run lint, typecheck, build, canonical and PR-governance validation.
- Open one Human-merge PR; never merge.

## Expected file surfaces

- `docs/plans/dee-690-treasury-development-fund-allocation.md`
- `db/schema.postgres.ts`
- `db/migrations_postgres/0163_*`, `0164_*`, `meta/_journal.json`
- `db/AGENTS.md`, `docs/migrations/DEE-64-TRACKER.md`
- `lib/waia-core/treasury/allocation/**`
- `lib/waia-core/treasury/admin/services.ts`, `lib/waia-core/treasury/index.ts`
- focused `tests/unit/**` and `tests/integration/**`

## Validation

```bash
pnpm exec vitest run tests/unit/treasury-fund-allocation.test.ts
WAIA_PG_INTEGRATION=1 DATABASE_URL_POSTGRES=<disposable> pnpm exec vitest run tests/integration/treasury-fund-allocation-postgres.test.ts
pnpm lint
pnpm typecheck
pnpm build
pnpm validate:canon
pnpm validate:pr-governance
```

Migration apply and tests use only a dedicated disposable Postgres instance. The walkthrough
database on `127.0.0.1:54339` is never an implementation or validation target.

## Merge disposition

T3 Human squash-merge only. No agent merge or auto-merge.
