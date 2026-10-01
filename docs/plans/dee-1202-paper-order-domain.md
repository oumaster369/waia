---
integrationIssue: DEE-1202
integrationTitle: "Keep scheduled ordinary paper orders separate from historical mock execution"
parentIssue: DEE-1151
branch: dee-1202-paper-order-domain
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, isolated-postgres]
requiredValidation: [lint, typecheck, build, targeted-unit, native-postgres, validate-canon, validate-reality-v2-consumer-graph, independent-review, required-ci]
approvalGates: [user-authorized-technical-fix, independent-review, required-ci]
state:
  status: implementation
  prNumber: null
  nextAction: "Implement and prove the ordinary-paper repository boundary; do not enable capital or live execution."
provenance:
  createdFrom: "Source audit of scheduled paper worker on 2026-10-02"
  supersedes: null
---

# DEE-1202 — Scheduled ordinary-paper order domain

## Trigger and behavior

The scheduled paper worker's `mock` startup reconciliation lists every open mock
order in its organization. Historical simulation persists orders with the same
`mock` execution mode; an absent order on the worker's fresh mock connector can
then be marked `RECONCILIATION_REQUIRED` and trigger an organization mismatch
kill. Later portfolio and Guardian reads also consume all mock orders and fills,
including completed historical runs. The worker must use only ordinary paper
rows: exact mock venue, `mock` mode, and both historical
identity columns null. Startup uses only ordinary `mock` orders, while the
worker's V2 portfolio and cycle use only ordinary `paper` orders at exact `HTX`
venue, as the canonical allowance-bound order records. The generic
historical repository retains its behavior.

The venue split follows the existing producer, not a new venue policy:
`risk-allowance-repository-postgres.ts` persists the order using
`allowance.venue`, the Risk account profile fixes that venue to `HTX`, and
`postgres-execution-v2.test.ts` consumes a paper order under an HTX verdict.
This issue's native fixture reproduces that stored row shape; it does not
claim to execute the full V2 producer. Legacy reconciliation's ordinary fill
call has no historical economics fields; those remain refused by this worker
repository.

## Implementation boundary

- Build two fixed-mode ordinary PostgreSQL repositories in
  `buildPaperLoopDepsFromEnv`: `paper` for the V2 portfolio and paper cycle's
  existing execution/reconciliation dependencies, `mock` only for the
  existing hardcoded-mock startup reconciliation. The fixed venues are `HTX`
  for V2 paper and `mock` for legacy mock startup; neither comes from
  HTTP/config caller input. Do not add a
  new V2-to-legacy reconciliation route or change the V2 order path.
- Enforce the predicate in SQL for `listOrders` and `listOpenOrders`; all direct
  order/client/idempotency lookup and event/fill readers require an in-scope
  parent order. Creation accepts only the repository's fixed mode; any global
  client/idempotency collision with a foreign row refuses rather than adopting
  it. A supplied fill ID cannot adopt an existing foreign fill, even when its
  payload matches. Direct transition/fill/progress writes lock and check the scoped parent
  inside the same transaction as the mutation. A read on the pool followed by
  a write on another transaction is not sufficient.
- Half-tagged rows are foreign. Canonical PostgreSQL currently rejects their
  insertion; the worker also excludes any preexisting malformed row rather
  than relabeling or repairing it.
  Keep Execution V2, generic historical simulation, live, and connector
  authority unchanged. No new financial policy, database migration or live
  activation is part of this issue.

## Acceptance

- On a fresh isolated PostgreSQL fixture, ordinary `paper` fills contribute to
  the actual V2 worker portfolio and ordinary `mock` orders reconcile at startup.
  Co-resident historical `mock` open and terminal filled orders have no
  effect on worker cash/equity/open count, Guardian inputs or startup result and
  retain exact state/events/fills/audit after the cycle.
- A half-tagged mock-venue insert is refused by the canonical database and is
  never adopted by the ordinary-paper repository.
- SQL-backed list/read methods exclude foreign rows. Direct get/find/events/fills
  cannot expose them. Direct create with foreign fields, historical
  client/idempotency collision, and transition/fill/progress by foreign order ID
  refuse without changing any persisted row. A foreign fill-ID collision also
  refuses without returning the foreign fill. An unknown connector client ID
  colliding with a historical row cannot cause that row to be adopted or
  mutated.
- Prove RED on the original worker composition and GREEN after the scoped
  repository wiring. Run focused unit/native, lint, typecheck, build, canon,
  graph validation. No real venue, production database, holdout or capital
  activation.
