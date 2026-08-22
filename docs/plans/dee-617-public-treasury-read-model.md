---
integrationIssue: DEE-617
integrationTitle: "WAIA public Treasury read model — Breath, annual budget and Patrons"
branch: dee-617-public-treasury-read-model
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
executionLabel: backend
requiredValidation: [lint, typecheck, build, targeted-unit, canon, pr-governance]
approvalGates: [human-product-semantics-approved-2026-08-22, architect-t3-approved-2026-08-22, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-4
  completedWorkPackages: [WP-0, WP-1, WP-2, WP-3, WP-4]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: 2026-08-22
  blockedReason: null
  nextAction: "Commit the validated diff, open one PR to main, await authoritative CI, and stop for Human squash-merge."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-617 — Public Treasury read model

## Authority and goal

The Human product owner approved completion of the `Breath of WAIA` work in English on 2026-08-22. This backend issue provides the single server-owned, read-only public Treasury projection required by DEE-618 and DEE-611. The homepage itself remains out of scope here.

The projection must answer three primary questions without inventing values:

1. How much money WAIA has now.
2. How long that money will last.
3. How much WAIA needs for one year.

It also supplies a bounded public transaction record, published category/group budget history, public funding needs, and consent-gated Patron contribution shares.

Baseline: `origin/main@d45bb9b11b21c7217eed5957eecdb629d309f4c6` after the Human squash merge of DEE-672 / PR #480.

## Product and security decisions

1. **Explicit organization binding.** The server reads `WAIA_PUBLIC_TREASURY_ORGANIZATION_ID`. Missing or empty binding fails closed; no public organization selector, first-row fallback, personal organization, or Org-0 assumption is allowed.
2. **Postgres only.** Public Treasury reads fail closed when the WAIA runtime is not Postgres. No SQLite public-finance fallback is introduced.
3. **Read-only execution.** Public functions and HTTP GET do not insert runway snapshots, mutate publication state, create audit rows, or update financial records. Runway is published only from a current pre-existing authoritative snapshot; stale or absent snapshots produce a pending runway.
4. **Three primary facts.** The compact Breath DTO exposes available amount/currency, runway, published annual budget amount/currency, publication state, safe pending reasons, and last-updated time.
5. **Published annual authority.** The amount comes only from the one applicable ACTIVE+PUBLIC ideal annual snapshot. DEE-671 category/group/month rows are exposed only when their derived annual total matches that snapshot exactly and uses the same currency; mismatch fails closed.
6. **Public ledger safety.** Only VERIFIED, DETAIL_PUBLIC, non-duplicate, non-superseded transactions are returned, in deterministic newest-first order, capped by a server constant. DTOs contain occurred time, signed amount, currency, safe category/group/project labels, and explicit public description only. No internal notes, account data, counterparty contacts/requisites, admin IDs, review metadata, transaction IDs, or private identity are returned.
7. **Funding needs.** Only public OPEN/PARTIALLY_FUNDED records are returned with exact server-derived funded and remaining amounts; callers cannot provide counters.
8. **Patron privacy.** Confirmed qualifying contribution totals use the frozen contribution-share rules. Named rows require a single current ATTRIBUTED record, `consent_public_identity=true`, and an existing public profile display name. Everything else is aggregated as private/anonymous support. The response returns exact numerator/denominator money plus deterministic integer parts-per-million; no floating-point financial percentage is authoritative.
9. **No ownership meaning.** Contribution share is financial participation only and conveys no ownership, governance, voting, profit, or security rights.
10. **English contracts.** Public messages and future consumer copy are English. This backend issue exposes stable codes and concise English HTTP errors; DEE-618/DEE-611 own the visible page copy.

## Non-goals

- no homepage, `/budget`, `/patrons`, or `/work-plan` UI
- no Linear integration (DEE-673)
- no schema or migration
- no admin Finance redesign or admin permission broadening
- no watcher enablement, chain access, R2 provisioning, production deployment, or financial-row mutation
- no AI-TRADER, FHV, or Execution Server changes
- no autonomous merge

## Work packages

### WP-0 — preflight and isolation

- Read current repository governance, subsystem instructions, Linear DEE-617, and merged dependencies.
- Confirm DEE-661, DEE-671, DEE-672, and DEE-674 are Done; confirm no open GitHub PRs.
- Create an isolated DEE-617 worktree from exact current `origin/main` without touching existing Finance or AI-TRADER worktrees.

### WP-1 — pure public projection

- Define a minimal public contract for Breath, annual/category budgets, published transactions, funding needs, and Patrons.
- Implement pure exact-money/publication/privacy derivation over an explicit organization-scoped fact set.
- Reuse canonical Treasury accounting, DEE-671 monthly history, contribution qualification/netting, and existing publication gates; do not reproduce financial truth in frontend-oriented code.

### WP-2 — Postgres facts and public binding

- Add one server-only, unpaginated, organization-scoped Postgres facts repository for the projection.
- Resolve the public organization exclusively from `WAIA_PUBLIC_TREASURY_ORGANIZATION_ID` and document the empty example variable.
- Add a read-only public service/runtime adapter that disposes per-request Postgres clients and rejects SQLite.

### WP-3 — public HTTP boundary

- Add `GET /api/public/treasury` with no auth/admin authority, no organization query parameter, `public, max-age=0, must-revalidate`, and fail-closed error envelopes.
- Add content-free route telemetry without organization IDs, finance values, names, or error messages.

### WP-4 — focused validation and PR readiness

- Cover exact three-fact pending/published behavior, annual snapshot matching, runway snapshot freshness, bounded transaction filtering, category/project label safety, funding derivation, Patron consent/private aggregation, exact share basis, tenant isolation, missing binding, SQLite rejection, and absence of mutation.
- Run focused tests, lint, typecheck, build, canonical validation, PR governance, and `git diff --check` twice where required.
- Open one PR to `main`, move Linear to In Review, and stop for Human squash merge.

## Expected file surfaces

- `docs/plans/dee-617-public-treasury-read-model.md`
- `.env.example`
- `lib/waia-core/treasury/public/**`
- `lib/waia-core/treasury/index.ts`
- `app/api/public/treasury/route.ts`
- `lib/observability/waia-runtime-route-telemetry.ts`
- `tests/unit/treasury-public-read-model.test.ts`
- `tests/unit/treasury-public-http.test.ts`
- `tests/unit/helpers/treasury-public.ts`
- `tests/unit/treasury-breath-boundary.test.ts`
- `tests/unit/treasury-contribution-share-privacy.test.ts`

No `db/**` file is in scope.

## Validation

```bash
pnpm exec vitest run tests/unit/treasury-public-read-model.test.ts tests/unit/treasury-public-http.test.ts
pnpm lint
pnpm typecheck
pnpm build
pnpm validate:canon
pnpm validate:pr-governance
git diff --check
```

## Rollback and merge disposition

Rollback is one revert of the DEE-617 squash commit; the public route then disappears and no stored financial state needs reversal. T3 Human squash-merge to `main` only.
