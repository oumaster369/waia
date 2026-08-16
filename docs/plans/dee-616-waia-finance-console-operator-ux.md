---
integrationIssue: DEE-616
integrationTitle: "WAIA Finance Console operator UX — transaction filters, manual entry and structured controls"
branch: dee-616-waia-finance-console-operator-ux
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
executionLabel: frontend
requiredValidation: [lint, typecheck, build, unit-targeted, e2e]
approvalGates:
  - plan-approved
  - integration-ready
  - human-merge
includedIssues: []
deferredIssues: [DEE-611, DEE-612, DEE-613]
blockedByActiveWork: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP6
  completedWorkPackages: [WP0, WP1, WP2, WP3, WP4, WP5]
  remainingWorkPackages: [WP6]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-08-16"
  blockedReason: null
  nextAction: "Open one PR to main, move Linear to In Review, watch required CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
humanApproval:
  token: CONFIRM-DEE-616-FINANCE-OPERATOR-UX-89CA5A8F
  authorizedBaseMain: 89ca5a8f79d134cea328bd2561fcc555473cb707
  approvedAt: "2026-08-16"
  historicalBaseMain: 3c45d5e5bf96bd99788176683890d929d95a42d8
  historicalToken: CONFIRM-DEE-616-FINANCE-OPERATOR-UX-3C45D5E5
dependencyMemory:
  DEE-606: Done
  DEE-615: Done
  DEE-607: "Done / PR #461 / squash 3c45d5e5bf96bd99788176683890d929d95a42d8"
---

# DEE-616 — Finance Console operator UX

## Authority

- Live Linear **DEE-616** is the executable frontend task.
- Human authorization token: `CONFIRM-DEE-616-FINANCE-OPERATOR-UX-89CA5A8F`
- Authorized base: `main` = `89ca5a8f79d134cea328bd2561fcc555473cb707`
- Execution label: **`frontend` only**
- Risk: **T3** — Human squash-merge only; agents never merge

The Linear description may still cite the historical base `3c45d5e5…`. That line is provenance only. The refreshed Human comment supersedes the older base/token and does not change scope, risk, ownership, acceptance, or exclusions.

## Isolation

| Surface | Value |
|--------|--------|
| Worktree | `/Users/legco/Projects/waia-dee-616-finance-ux` |
| Branch | `dee-616-waia-finance-console-operator-ux` |
| Starting HEAD | `89ca5a8f79d134cea328bd2561fcc555473cb707` |

## Goal

Make `/finance` transaction filtering, manual entry, and classification obvious and operator-friendly without changing Treasury semantics, exact-money rules, FSM, permissions, audit, or server authority.

## Binding decisions

- Usability only. Preserve DEE-607 A–E cognition, MANUAL_DRAFT + PRIVATE creation, classify/verify/publication separation, and VERIFIED-only `DETAIL_PUBLIC`.
- Canonical finite domains use `db/core-enums.ts` values. No frontend-only enum members.
- Category / Purpose / Project module / Milestone remain free-form Human semantics. No invented taxonomy. No autocomplete from a partial paginated ledger.
- Human decimal amount input is UX conversion only. Parser is string/BigInt-safe. React is not accounting authority.
- Organization selection remains explicit. No silent first-org / Org-0 / hardcoded org.
- If a useful selector cannot be implemented truthfully from existing Admin HTTP contracts, keep the safest fallback and record `DEE_616_BACKEND_CONTRACT_GAP`.

## Backend contract gaps (non-blocking)

1. **Transaction search for correction references** — `GET /api/admin/treasury/transactions` is paginated (`limit` default 50, max 100) and has no search/`q` parameter. Correction UX uses organization-scoped load-more plus an explicit exact-id fallback, and must not present the first page as the complete ledger.
2. **Funding-need list filter** — `parseTreasuryTransactionListQuery` supports `budget_id` but not `funding_need_id`. Do not invent that filter. Funding-need selectors remain on manual create and classify, where the POST/classify contracts already accept `funding_need_id`.

## Out of scope

Backend/API authority, schema/migrations, Treasury FSM, taxonomy, watcher enablement, R2, Breath/homepage binding, DEE-611/612/613, Commons, DAO, AI-TRADER, FHV, DEE-518, DEE-536, Execution Server, production, merge.

## Work packages

### WP0 — preflight / canon / plan

Preflight against authorized main, read live Linear + governance, promote this plan, Linear Todo → In Progress.

### WP1 — transaction filter clarity + structured filters

Primary `Add manual transaction` action; `Filter transactions` identity; compact/collapsible filters; canonical selects for finite list-query fields already supported by the backend; organization-scoped budget selector; free-text for category/project module; server-side filtering and pagination preserved.

### WP2 — exact manual-entry controls

`/finance/transactions/new`: canonical Direction; optional Kind (`Not classified yet` → null); USDT V1 asset/6 decimals as current truth; Human decimal → atomic integer string; accessible datetime → ISO-8601; budget/funding selectors; correction load-more + exact-id fallback; Purpose free text; existing reason/confirm flow.

### WP3 — review/classification usability

Zone B: canonical kind/direction selects; org-scoped budget/funding selectors; free-form semantic fields; preserve A–E, financial lock, classify/verify/publication separation.

### WP4 — accessibility + focused tests

Labels, keyboard, validation copy; unit coverage for parser, canonical options, submit IDs vs labels, free-form semantics, lifecycle/publication invariants; E2E for the changed Human experience.

### WP5 — local validation + visual-review preparation

`pnpm lint`, `pnpm typecheck`, `pnpm build`, targeted unit tests, `pnpm test:e2e`. Prepare a 127.0.0.1-only review URL without touching 54329 / DEE-518 / Execution Server.

### WP6 — PR readiness + CI

One PR to `main`; Linear In Review; required CI green on exact HEAD; Human squash-merge handoff only.

## Acceptance

- Filtering is unmistakably filtering; `Add manual transaction` is the obvious primary action.
- Canonical enums are selected, not typed; no frontend-only enum invented.
- Budget/funding/correction references stay organization-scoped; correction UX does not pretend a partial page is the complete ledger.
- Category, Purpose, Project module, Milestone remain free-form.
- Manual Kind may remain unclassified/null.
- Human amount conversion is exact and BigInt-safe.
- Manual creation remains MANUAL_DRAFT + PRIVATE; verification and publication remain separate; `DETAIL_PUBLIC` remains VERIFIED-only.
- No backend, schema, FSM, watcher, R2, Breath, AI-TRADER, or production change.
