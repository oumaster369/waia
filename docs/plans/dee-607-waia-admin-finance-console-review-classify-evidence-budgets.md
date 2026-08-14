---
integrationIssue: DEE-607
integrationTitle: "WAIA Admin Finance Console — review, classify, evidence, budgets and publication"
branch: dee-607-waia-admin-finance-console-review-classify-evidence-budgets
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
executionLabel: frontend
requiredValidation: [lint, typecheck, build, unit-targeted, e2e]
approvalGates:
  - plan-approved
  - architect-review
  - human-architecture-approval
  - integration-ready
  - human-merge
includedIssues: []
deferredIssues: [DEE-605, DEE-611, DEE-612, DEE-613]
blockedByActiveWork: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-review
  currentWorkPackage: WP10
  completedWorkPackages: [WP0, WP1, WP2, WP3, WP4, WP5, WP6, WP7, WP8, WP9]
  remainingWorkPackages: [WP10]
  prNumber: 461
  prUrl: https://github.com/oumaster369/waia/pull/461
  lastValidatedGitSha: c62561e5b2fc8e21b33a7019a8c4cc8e1b7be635
  lastValidationAt: "2026-08-14"
  blockedReason: null
  nextAction: "Watch required GitHub CI on PR #461 HEAD; Human squash-merge only when required checks are green."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
humanApproval:
  token: CONFIRM-DEE-607-FRONTEND-IMPLEMENTATION-F442DE82
  authorizedBaseMain: f442de82a2847aef2c6dbe6dc038e4a49bc1a0ee
  approvedAt: "2026-08-14"
dependencyMemory:
  DEE-606: Done
  DEE-615: "Done / squash f442de82a2847aef2c6dbe6dc038e4a49bc1a0ee / PR #460"
---

# DEE-607 — WAIA Admin Finance Console

## Authority

- Live Linear **DEE-607** is the executable frontend task.
- Human implementation authorization token: `CONFIRM-DEE-607-FRONTEND-IMPLEMENTATION-F442DE82`
- Execution label: **`frontend` only**
- Risk: **T3** — Human squash-merge only; agents never merge
- Architecture (2026-08-13) plus this implementation authorization (2026-08-14) are binding

## Isolation

| Surface | Value |
|--------|--------|
| Worktree | `/Users/legco/Projects/waia-dee-607-admin-finance` |
| Branch | `dee-607-waia-admin-finance-console-review-classify-evidence-budgets` |
| Starting HEAD | `f442de82a2847aef2c6dbe6dc038e4a49bc1a0ee` (= `origin/main` at authorization) |

Do not reuse DEE-605 / DEE-606 / DEE-615 / DEE-518 / release worktrees.

## Dependency

DEE-606 (Done) → DEE-615 (Done, PR #460, squash `f442de82`) → **DEE-607 frontend (this issue)**

Backend HTTP contracts required by this console are already on main. Do not implement backend repair here. If a prerequisite is missing: STOP.

## Goal

Build the secure WAIA Admin Finance Console at `/finance` as the accountable Human interface over merged Treasury truth.

Visible reasoning chain:

observation/provenance → Human accounting meaning → evidence → VERIFIED financial truth → separate publication decision → exact Breath preview → deliberate Human confirmation

## Binding decisions

- Route **`/finance`** via `app/(treasury-admin)/finance/**`. Not trader `/admin`.
- Do not modify `app/(trader)/admin/layout.tsx` or `components/trader/admin/admin-shell.tsx`.
- Commitments UI included (existing semantics). APPROVED + RELEASED reduce free funds; do not recompute free funds in React.
- DETAIL_PUBLIC UI action only when `status === VERIFIED`. Publication never mutates accounting status. VERIFIED + PRIVATE remains valid.
- Watcher remains DARK / unavailable. No last-sync invention. No checkpoint API.
- Production R2 unprovisioned. Evidence 503 `EVIDENCE_STORAGE_NOT_CONFIGURED` shown truthfully.
- Do not wire `lib/landing/breath-public.ts`. Preview consumes `GET /api/admin/treasury/breath-preview`.
- Out: DEE-611/612/613, Commons, DAO, AI-TRADER, Execution Server, schema/migrations, watcher enablement, production deploy.
- No ADR-0011 cooling-off. Deliberate confirmation + existing reason/audit.

## Exact money

Wire format is canonical decimal integer strings. Format USD with BigInt micros / `1_000_000n`. Never `Number(bigint)` / `parseFloat` for truth. Render server-derived totals. Signed remaining is not clamped.

## Auth / org

- Unauthenticated → redirect `/`
- Authenticated without `admin.treasury.read` → fail-closed English 403 (no trader gate)
- Org list: `GET /api/admin/treasury/organizations` only
- Selected `organization_id` is explicit (URL). Never silent personal/Org-0/hardcoded/first-org
- Browser never receives privileged tokens

## Acceptance

- Operator can take a newly detected transaction from `NEEDS_REVIEW` to a classified, evidenced, and intentionally published record.
- Operator can enter a manual transaction with provenance and audit.
- Budgets, funding needs, and commitments are managed against server-derived totals; React does not recompute free funds.
- Public preview consumes `GET /api/admin/treasury/breath-preview` exactly; publication does not mutate accounting status; `DETAIL_PUBLIC` is offered only when `status === VERIFIED`.
- Unauthenticated visitors redirect to `/`; authenticated users without `admin.treasury.read` see a fail-closed English 403.
- Product UI copy is English. Exact money display uses canonical integer strings and BigInt micros.
- Local PR readiness: `pnpm lint`, `pnpm typecheck`, `pnpm build`, targeted unit tests, `pnpm test:e2e`. Authoritative full unit suite runs in PR CI.

## Work packages

### WP-0 — Human authorization + canonical plan promotion (this file)

### WP-1 — `/finance` shell, auth, org context, nav

### WP-2 — overview from breath-preview + overview-counts + recon; watcher DARK

### WP-3 — transaction list + review zones A–E

### WP-4 — command/correction workflow; FSM affordances; VERIFIED-only DETAIL_PUBLIC

### WP-5 — manual transaction

### WP-6 — budgets, funding needs, commitments

### WP-7 — evidence metadata/viewer + R2-unavailable UX

### WP-8 — publication preview + high-impact publication controls

### WP-9 — targeted frontend tests + Playwright

### WP-10 — local readiness, one PR to `main`, Linear In Review, required CI green

## E2E note

Playwright default runtime is SQLite. Treasury domain persistence is Postgres-only (`503 TREASURY_BACKEND_UNAVAILABLE`). E2E therefore proves auth/org/fail-closed/unavailable truthfully against the real server, and proves the complete Human workflow against Playwright-intercepted DEE-615 contracts (no new production endpoints).

## Explicit exclusions

homepage binding · watcher enablement · production R2 · DEE-611/612/613 · Commons/DAO · AI-TRADER · Execution Server · production deploy · schema/migrations
