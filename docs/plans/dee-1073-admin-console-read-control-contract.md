---
integrationIssue: DEE-1073
integrationTitle: "Admin console scoped reads and transactional command evidence"
branch: dee-1073-admin-console-read-control-contract
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1073
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: done
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-1
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 8747b2b8f78d31d7fd7eb23b5e1d439a8b8b467e
  lastValidationAt: "2026-09-24T21:40:21.724793+00:00"
  blockedReason: null
  nextAction: "Publish after dependency merges and require exact-head CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1073 — scoped reads, stream handoff and atomic administrative evidence

## Goal and dependencies

Continue the audit repairs after DEE-1072. Deliver a consistent read boundary for lists, invoice CSV and the assistant, safe snapshot-to-stream handoff, and atomic revision checks on administrator-owned saved views and visit markers. Covers bounded repairs in P3–P6 and actual DOM evidence from P18. Canon: `dee-1050-admin-console-v2.md` §§3, 3.1, 6 and AC-01, AC-05, AC-11, AC-14, AC-15, AC-25, AC-29, AC-31, AC-32. This package does not declare every acceptance criterion complete.

## Read and stream contract

- Entity reads execute in one REPEATABLE READ READ ONLY transaction and return that snapshot's xmin cursor. Account/overview keep their existing shared financial transaction.
- Orders, fills, positions and closed trades apply organization, account and execution-mode attribution before LIMIT. A trade/position with conflicting or missing leg attribution cannot be assigned to the selected account/mode. Historical run identity takes precedence over the execution enum.
- Invoices, payments, disputes and reporting periods filter the selected account through their saved binding. Invoice detail returns 404 outside the requested scope. Client connection dates only use complete observations.
- HTTP invoice summaries, CSV and assistant read the same repository with saved amounts, aggregate and finance revision. Export asks for one row beyond its cap and refuses oversize output. It declares the document currency rather than applying an invented exchange rate.
- Fee-chain verification cannot certify a previous cumulative result derived from the invoice being checked, or use that invoice's own HWM as ledger evidence. Missing independent evidence remains unavailable; stored values are unchanged.
- Stream cursor acknowledges a completed batch only; reconnect midway replays unacknowledged events. Pagination uses numeric seq ordering and excludes only already-sent seqs, preserving late commits with smaller seq/xid. Malformed/future/expired cursors and bounded backlog resync explicitly.
- Scoped stream projections do not expose foreign organization/account identifiers. Orders use the same safe DTO as HTTP. Identifier-only changes for other models are explicit invalidations, followed by their scoped read model; they are not presented as complete DTOs.
- A new scope immediately hides old data, aborts prior reads, and ignores late responses. Permission revocation closes the stream, clears query data and unmounts private UI. Tombstones block stale resurrection; queues and metric buffers are bounded.
- Receipt and render measurements are separate. Render ACK records after browser paint, distinguishes offscreen rows and never substitutes network arrival for display latency.

## Command contract

- Console writes require admin.audit.read plus admin.trader.operations.mutate, JSON and same Origin.
- Saved views and visit markers compare expectedRevision and write in one transaction, with a per-administrator advisory lock including empty initial state. A race produces one success and one 409. Another administrator's object is 404 before revision comparison.
- No financial issuance, trading or policy mutation is added. Existing incident and business command workflows are repaired in their own bounded section packages.

## Acceptance

No changes to fee rate, HWM policy, settlement, risk math, trade execution, live eligibility, holdout, append-only records or methodology. This is a minimal console authorization correction; the user's explicit operational delegation covers review/merge/deployment, not financial attestations or policy ratification. Exact-head CI remains mandatory.

Acceptance: disposable real Postgres tests for scoped reads, mode filtering before LIMIT, same-org multiple accounts, foreign invoice 404, HTTP/assistant/CSV parity, saved-chain missing evidence, scoped stream DTOs, command races and foreign-owner 404; client tests for late scope responses, HTTP/SSE permission revocation and cache clearing; browser slice and real post-paint SLO under 100 events/s. Full unit CI is authoritative; no fabricated readiness percentage.

Commands: `pnpm lint`; `pnpm typecheck`; `pnpm build`; `pnpm test --run tests/unit/admin-console*.test.ts tests/unit/admin-console*.test.tsx tests/unit/admin-assistant*.test.ts`; `WAIA_PG_INTEGRATION=1 DATABASE_URL_POSTGRES=<disposable-local-db> pnpm test --run tests/integration/admin-console-control-contract-postgres.test.ts tests/integration/admin-console-read-scope-postgres.test.ts`; `DATABASE_URL_POSTGRES=<disposable-local-db> pnpm test:e2e:admin-pg`.

Remaining packages include complete shell/design/URL context, section workflows, operational PnL/history, grounded assistant, all-section browser acceptance, verified production deployment and targeted 0216 application. Research/strategy/search scope details that lack saved account bindings must be resolved or explicitly unavailable in those section packages. This package does not pretend the whole console is finished.
