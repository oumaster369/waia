---
integrationIssue: DEE-615
integrationTitle: "WAIA Treasury Admin HTTP contract completion for Finance Console"
branch: dee-615-waia-treasury-admin-http-contract-completion-for-finance
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
executionLabel: backend
requiredValidation: [lint, typecheck, build, unit-targeted]
approvalGates:
  - plan-approved
  - architect-review
  - human-architecture-approval
  - integration-ready
  - human-merge
includedIssues: []
deferredIssues: [DEE-607]
blockedByActiveWork: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-5
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4]
  remainingWorkPackages: [WP-5]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-08-14"
  blockedReason: null
  nextAction: "Open one PR to main; Linear In Review; wait for required CI; Human squash-merge only. Do not implement DEE-607."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
humanApproval:
  token: CONFIRM-DEE-615-ARCHITECTURE-HTTP-CONTRACTS-977E0239
  authorizedBaseMain: 977e023980bb757e30ce7a6ae17f3948602e6431
  approvedAt: "2026-08-14"
---

# DEE-615 — Treasury Admin HTTP contract completion

## Authority

- Live Linear **DEE-615** is the executable backend task.
- Human architecture approval token: `CONFIRM-DEE-615-ARCHITECTURE-HTTP-CONTRACTS-977E0239`
- Execution label: **`backend` only** ([`AGENT-EXECUTION-LABELS.md`](../waia-governance/AGENT-EXECUTION-LABELS.md))
- Risk: **T3** — Human squash-merge only; agents never merge

## Isolation

| Surface | Value |
|--------|--------|
| Worktree | `/Users/legco/Projects/waia-dee-615-treasury-admin-http` |
| Branch | `dee-615-waia-treasury-admin-http-contract-completion-for-finance` |
| Starting HEAD | `977e023980bb757e30ce7a6ae17f3948602e6431` (= `origin/main` at authorization) |

## Dependency

DEE-606 (Done) → **DEE-615** → DEE-607 (frontend, remains Todo / blocked / unimplemented on this branch)

## Goal

Complete bounded Core Treasury admin HTTP contracts so DEE-607 can render truthful review/overview/budget/commitment UI without redesigning Treasury.

## Human-binding count and filter decisions

**reviewRequiredCount:** `status IN (DETECTED, NEEDS_REVIEW, CLASSIFIED, RECONCILIATION_REQUIRED)`. Exclude `VERIFIED`, `REJECTED`, `DUPLICATE`.

**publicationPendingCount:** `status == VERIFIED AND detailPublication == PRIVATE`. Do not count `SUPERSEDED`. Do not count `CLASSIFIED`.

**Network/token:** `network` → `canonicalNetwork`; `token_contract` → `canonicalTokenContract`. Optional `asset` → `nativeAsset` (symbol only). No fallback to `nativeContract`. Null canonical identity on MANUAL rows is valid and does not match canonical filters.

**Reconciliation filter:** transaction `status == RECONCILIATION_REQUIRED` only. Optional alias `needs_reconciliation=true` maps exactly to that status. Do not combine with balance-recon or observation status.

## Scope (WP-1 … WP-4)

A. Serialize already-existing transaction / funding-need `targetStage` / commitment lifecycle-audit fields.
B. Parse classify patch: `projectModule`, `milestoneStage`, `description`.
C. Authoritative `listTransactions` filters (before pagination).
D. Exact org-scoped overview counts (complete dataset, not a page).
E. Admin derived budget/need totals via existing Breath accounting (signed remaining; spent = negative VERIFIED cash; not EXPENSE-only).
F. `GET /api/admin/treasury/organizations` with `admin.treasury.read`.

## Non-goals

- UI / DEE-607
- Schema, migrations, journal, new enums, FSM, publication semantic change
- Watcher enablement / checkpoint API (DARK)
- R2, wrangler, homepage, AI-TRADER, Execution Server, Commons/DAO, DEE-611/612/613, deploy

## Work packages

### WP-1 — Serialization / parse

Transaction DTO adds: `fundBucketCode`, `category`, `counterpartyDisplay`, `publishCounterparty`, `projectModule`, `milestoneStage`, `description`, `detailSupersededById`, plus existing `verifiedByUserId` / `detailPublishedByUserId` needed by review audit grouping.

### WP-2 — Filters + counts

`GET /api/admin/treasury/overview-counts` for the two exact counts. Extend list query params.

### WP-3 — Derived budget / need reads

Attach server-derived totals on existing GET list responses using complete verified facts.

### WP-4 — Treasury org list

`GET /api/admin/treasury/organizations` — `admin.treasury.read`; not trader URL.

### WP-5 — PR readiness

`pnpm lint && pnpm typecheck && pnpm build` + targeted tests. One PR to `main`. Linear In Review. Stop. Human squash-merge.

## Validation

Targeted: serializer/parser, list filter memory+postgres parity, counts, derived accounting, permissions, cross-org. Full unit suite = GitHub PR CI.

## Rollback

Additive HTTP/DTO only. Disable unused routes if needed. No DROP.
