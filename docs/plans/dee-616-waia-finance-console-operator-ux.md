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
  status: in-review
  currentWorkPackage: WP7
  completedWorkPackages: [WP0, WP1, WP2, WP3, WP4, WP5, WP6, WP7]
  remainingWorkPackages: []
  prNumber: 464
  prUrl: https://github.com/oumaster369/waia/pull/464
  lastValidatedGitSha: 4864c455111bd0e37c23fbbf9a14fab854737e63
  lastValidationAt: "2026-08-16"
  blockedReason: null
  nextAction: "Push simplified UX to the same PR #464; Human visual review; required CI green on exact HEAD; Human squash-merge only."
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

## Human product correction — simplicity overrides feature density

Live Linear comment `1467814d-9d58-439f-b1cd-76aba56728df` (2026-08-16) is an in-flight UX clarification, not a backend/domain expansion. It supersedes any reading of DEE-616 that would make the UI more feature-dense merely because the backend supports more fields.

Governing principle: **Minimal, obvious, logical, operator-first.** Every screen exposes only the knowledge and actions needed at that moment.

Objective: fewer decisions per screen + clear defaults + progressive disclosure + full Treasury truth underneath. Not more controls.

Binding application in this issue:

1. **Transactions** — primary action remains `Add manual transaction`. Filtering is secondary. Default filter surface is Status only. All other list-query fields live under collapsed `More filters`. The ledger table shows Occurred, Direction, Kind, Amount, Status, Publication. Hash / network / budget-category columns stay on review, not on the list.
2. **Manual transaction** — primary path is Direction, optional Kind, Human-readable exact Amount, Occurred at, and optional Purpose. Asset fact, ISO preview, budget, funding need, and correction reference live under collapsed `More details`. Classification remains a later step.
3. **Transaction review** — A–E order and semantics are preserved. The next Human action is visually first. Provenance technical identifiers, extra classification fields, public-disclosure text, and history are available but collapsed. Canonical finite values still use selects; free-form semantic values remain free-form text. No autocomplete systems.
4. Exact-money, FSM, audit, tenant isolation, and VERIFIED-only `DETAIL_PUBLIC` are unchanged.
5. **Do not redesign top-level Finance navigation.** DEE-619 owns the later Overview / Transactions / Budget simplification.
6. **Do not touch homepage/Breath.** DEE-617 / DEE-618 / DEE-611 own that corrected public architecture.

Test for every visible control: “Does the Human need this here, at this moment?” If no, remove it from the primary surface or move it behind progressive disclosure.

Do not discard valid work already completed (canonical selects, exact-money parser, org-scoped selectors, truthful correction pagination). Adapt it to this simpler hierarchy on the same branch and the same PR #464.

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

### WP7 — Human simplicity correction

Adapt the already-landed operator controls to progressive disclosure without discarding exact-money, canonical selects, org-scoped selectors, or A–E semantics. Re-run local validation and push to the existing PR #464. No second DEE-616 PR. No merge.

## Acceptance

- Filtering is unmistakably filtering; `Add manual transaction` is the obvious primary action.
- Default transaction filter surface is minimal (Status). Advanced list-query fields are collapsed.
- Canonical enums are selected, not typed; no frontend-only enum invented.
- Budget/funding/correction references stay organization-scoped; correction UX does not pretend a partial page is the complete ledger; those selectors do not dominate the primary manual path.
- Category, Purpose, Project module, Milestone remain free-form. No autocomplete systems.
- Manual Kind may remain unclassified/null. Manual primary path asks only what is needed for a truthful MANUAL_DRAFT.
- Human amount conversion is exact and BigInt-safe.
- Manual creation remains MANUAL_DRAFT + PRIVATE; verification and publication remain separate; `DETAIL_PUBLIC` remains VERIFIED-only.
- Review keeps A–E cognition; the next Human action is visually obvious; technical/history detail is secondary.
- Top-level Finance navigation is unchanged (DEE-619). Homepage/Breath is untouched (DEE-617 / DEE-618 / DEE-611).
- No backend, schema, FSM, watcher, R2, Breath, AI-TRADER, or production change.
