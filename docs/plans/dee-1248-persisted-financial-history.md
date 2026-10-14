---
integrationIssue: DEE-1248
integrationTitle: "Persist collected HTX bill history through the signed isolated reader"
branch: dee-1248-persisted-financial-history
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [scoped-lint, typecheck, focused-unit, isolated-postgres, build]
approvalGates: [plan-approved, independent-review, integration-ready, human-merge, human-production-rollout]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: [WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-10-14T02:05:54Z"
  blockedReason: null
  nextAction: "Independent source review and PR governance; no runtime or production acceptance is claimed."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1248 implementation plan

## Approved scope and risk

The issue authorizes a local backend implementation of retained financial facts from the normal collector. T3 reflects the signed authorization boundary and new persistence. Independent review, Human merge and a separately approved rollout remain gates. No provider calls, diagnostics ingestion, backfill, trading, production changes, or financial inference belong to this change.

## WP-1: immutable collector persistence

Add Postgres bill and coverage tables, schema mappings, scoped observer INSERT/SELECT and reader SELECT policies, append-only mutation guards and source-observation foreign keys. Preserve every existing migration byte for byte; 0232 is reserved by pending PR759, root coordination reserves 0233_trader_account_financial_history_v1, journal idx 232, when 1780000000233. The filename gap deliberately preserves PR759's future 0232 reservation; that held PR must reconcile its own journal at later integration. Never replay the historical journal.

Append only from the actual payload selected by commitIfCurrent's existing database-time gate, inside its transaction and before final pointer publication. Exact amounts and immutable normalized content are retained. Duplicate bill identity is organization + credential ID + account + UID + provider bill ID; equal content is idempotent, differing content rolls back. Coverage preserves each observation's scope, revisions, times and UNKNOWN completeness, including error/unavailable outcomes. No configured financial component means no synthesized coverage. Nullable UID is retained only on coverage; bill values require established UID.

## WP-2: isolated signed history read and authenticated API

The schema has no credential UID field. Resolve the current UID from the latest observation joined to exact active credential/configuration revisions, account and organization. Missing UID or stale current observation fails closed. Query prior configuration revisions only in that exact credential/account/UID lineage, in a read-only repeatable snapshot. Keep readLatest unchanged.

Add readFinancialHistory with exact internal path, strict request/response schemas, at most 100 bills and 100 coverage facts, a 1 MiB response cap and existing five-second signed request deadline. Use HMAC-authenticated keyset cursors bound to the exact active binding, UID, page size and time filters; retain the initial PostgreSQL snapshot (at most 1,024 ASCII bytes) and filter both tables through pg_visible_in_snapshot using DB-owned full top-level recorded_xid values. This freezes page membership despite later commits and subtransactions. Only the new tables gain xid8 columns; observer INSERT column grants exclude recorded_xid and recorded_at. Cursors expire after one hour and remain capped at 3,072 characters. Snapshot/cursor overflow fails closed; cursor data never supplies authorization. Preserve provenance and explicit persisted-only source/providerRequests=0. Reuse tenant/admin session, entitlement, membership/operator and final-binding rechecks; no Worker observation SQL or fallback. Unknown, missing, observed empty, error and unavailable remain distinct.

## WP-3: validation and handoff

Run focused protocol/client/dispatcher/HTTP/API tests and isolated native Postgres tests for overlap deduplication, conflicting content, rollback/expiry retry, least-privilege RLS, current UID and revocation/configuration/cursor isolation. Run typecheck and scoped lint; full unit suite is CI-only. Record exact checks and remaining build/governance/review gates in handoff.

## Reader-first rollout and rollback

Apply the new additive migration only through a separately approved ordered operator step after migration collision review. Deploy the reader with all legacy resolveBinding/readLatest operations preserved; then deploy the Worker history caller once signed readFinancialHistory is accepted. Old callers remain compatible. Roll back callers/readers before disabling the producer; retain immutable tables and evidence. No destructive down migration and no complete-history or runtime acceptance claim follows from source completion.

## API contract

Tenant GET `/api/trader/account-observation/financial-history` takes credentialId and exchangeAccountId; organization derives from the authenticated personal organization. Admin GET `/api/trader/admin/account-observation/financial-history` additionally requires organizationId and the existing operator/list scope. Optional pageSize (1–100, default 100), windowStartMs (inclusive), windowEndMs (exclusive) and opaque cursor are the only extra query fields. Revisions, UID and scope IDs cannot be supplied by the caller. The signed internal POST path is `/internal/v1/account-observation/read-financial-history`.

A successful response carries the exact current binding/UID, currentFinancialStatus (including NOT_CONFIGURED), records and coverage, and an opaque nextCursor. Bill order is createdTimeMs then provider bill ID in C collation; coverage order is collection completion time then observation UUID. Each stream has its own cursor position and is bounded to pageSize. Records retain their first-seen source scope and revision; each coverage fact retains its own immutable window. A filter selects bill timestamps and overlapping coverage windows. A null cursor means no further retained rows in this snapshot, never provider exhaustion. Missing current observation/UID returns 204; observed empty is a 200 with explicit PARTIAL coverage and observedRowCount=0. Failed authorization is 401/403; storage/protocol/cursor failures are 503. All responses are private/no-store.

Migration memory: this remains the existing Postgres-only isolated projection boundary; no runtime-routing expansion, SQLite fallback, secret grant, or Worker observation query is added. The bounded page API has no frontend in this issue. Existing normalized history is not retroactively populated from old snapshots.

## Local validation at source handoff

- Focused regression: 151 assertions across eight unit suites passed; the subsequent focused pass covered 36 assertions across four suites, including the new exact HTTP history path and invalid path suffix rejection. These counts overlap; they are not a combined unique total.
- Native PostgreSQL 17.11, strict verified TLS, separate restricted collector and reader LOGINS: all 17 integration cases passed. Coverage includes 100 bills plus 100 consistent duplicates with exactly three financial SQL statements, immutable conflict rollback, exact retry, scope and lease expiry, caller mutation across downgrade, old configuration/revision provenance, UID/credential/account isolation, cursor context/tamper, actual concurrent commit visibility, top-level xid inside a savepoint, both-table xid/time INSERT custody, source/physical-key corruption rejection and append-only/RLS grants.
- Typecheck passed. Scoped lint passed with no errors and one preexisting unused-parameter warning in the unrelated schema section.
- Normal Node 22 `pnpm build` passed using owned dependency files. An earlier dependency-symlink attempt failed in Turbopack; a webpack diagnostic fallback failed in an unrelated research import. Neither required product-source changes.
- All 234 existing non-journal migration paths remain byte-identical, and all 232 prior journal entries remain an identical prefix. Only migration 0233 and its single coordinated journal entry are added. No historical migration replay or production application occurred.
- Full unit CI, full lint/PR governance, independent review and Human merge/rollout remain separate gates. No venue call, financial diagnostic write, UI history implementation, backfill or full-period acceptance is implied.
