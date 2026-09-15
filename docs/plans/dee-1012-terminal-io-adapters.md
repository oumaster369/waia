---
integrationIssue: DEE-1012
integrationTitle: "Authenticated Historical V2 observation and terminal receipt persistence adapters"
branch: dee-1012-terminal-io-adapters
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, targeted-unit, targeted-postgres-integration, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-PR
  completedWorkPackages: [WP-HTTP, WP-PERSISTENCE, WP-VALIDATE]
  remainingWorkPackages: [WP-PR]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-15T10:22:38Z"
  blockedReason: null
  nextAction: "Open one PR to main and stop at the Human squash-merge gate."
provenance:
  createdFrom: chat
  gapRegistry: GAP-D1
  supersedes: null
  parentIssue: DEE-1007
---

# DEE-1012 — terminal I/O adapters

## Goal

Close only GAP-D1 / TERMINAL-IO by exposing two production-capable primitives
that a later TERMINAL-ASSEMBLY batch can call:

1. obtain Historical V2 admin and tenant observations through the real
   authenticated HTTP polling routes; and
2. append an already-built canonical migration 0208 terminal receipt to
   PostgreSQL.

The Human-provided DEE-1012 execution contract is the plan approval for this
isolated lane. The branch is intentionally based at
`b10f7edcb2187253355399ca5dfb82bac0177c12`.

## Non-goals and isolation

- Do not assemble the terminal scientific fact set or invoke
  `verifyHistoricalTerminalLaunchV1` over production facts.
- Do not collect comparison identities, evaluate Holm/FWER, assemble
  proposal/ratification/authority or H5 health facts, or orchestrate markers.
- Do not connect to execution hosts, run C1/C2/C3, or mutate P2/operator state.
- Do not modify H2/H5 lifecycle behavior, Forecast/scoring/bootstrap code,
  migrations, the migration journal, or `db/schema.postgres.ts`.
- Do not create sessions, call route handlers directly, substitute SQL for
  HTTP observation, or permit fixture identities in the production adapter.

## Work packages

### WP-HTTP — authenticated observation adapter

Add
`lib/trader/historical-simulation-v2/historical-terminal-observation-http-adapter-v1.ts`.
The server-only factory binds one approved HTTPS origin and one exact
organization/run/account scope, consumes only caller-supplied cookies, calls
the existing admin and tenant polling URLs through `fetch`, rejects redirects
and all unexpected statuses, reads a bounded JSON body, validates the complete
Historical V2 projection shape, and refuses identity mismatches.
The bounded transport accepts at most 10,000 canonical cycles and aborts both
request and body reads at an explicit timeout.

Add
`tests/unit/historical-terminal-observation-http-adapter-v1.test.ts` with
mocked network-boundary tests for real cookie forwarding, no credential
disclosure, origin/redirect/auth/status/content-type/schema/size refusal, exact
admin and tenant identities, and retained lifecycle/ledger/cycle facts.

### WP-PERSISTENCE — append-only PostgreSQL repository

Add
`lib/trader/historical-simulation-v2/historical-terminal-receipt-repository-postgres-v1.ts`.
The repository is factory-bound to one organization/run scope, validates the
existing receipt schema version and exact semantic digest, uses a serializable
transaction plus a fixed advisory-lock namespace, checks both migration 0208
tables, inserts into a hard-coded table only, returns exact duplicates
idempotently, retries only fresh-snapshot serialization failures, and refuses
conflicting content or terminal kind. It exposes no
update, delete, arbitrary SQL, or caller-selected table surface.

Extend the existing local-only
`tests/integration/postgres-historical-terminal-receipts-v1.test.ts` harness to
exercise repository insert, exact-repeat idempotency, content and kind
conflicts, cross-organization/wrong-kind refusal, database immutability, and
rollback after a failed write. No production database is allowed.

### WP-VALIDATE — readiness evidence

Run targeted unit tests first. Run the targeted PostgreSQL integration test
only when a local test database URL is available; otherwise record the
environmental skip and rely on the PR PostgreSQL CI harness. Then run:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm validate:canon`
- `pnpm validate:pr-governance`

Inspect the exact diff and confirm:
`R_IMPACT=NONE`, `P2_IMPACT=NONE`,
`SCIENTIFIC_PROTOCOL_IMPACT=NONE`, and `MIGRATION_IMPACT=NONE`.

### WP-PR — one integration boundary

Commit only this scope using the DEE-1012 conventional commit prefix, push
`dee-1012-terminal-io-adapters`, render and preflight the canonical PR body,
open exactly one PR to `main`, move Linear to In Review, and stop without
merging.

## Risk and rollback

Risk is T3 because the adapter transmits authenticated session material and the
repository writes irreversible terminal receipts. HTTP failures are
fail-closed and redact credentials by construction. Persistence validates
before insert and relies on migration 0208 append-only triggers after insert.

Rollback is code-only: revert the adapter/repository commit before use. No
migration or existing receipt is changed, and persisted terminal receipts are
intentionally never updated or deleted.

## Open questions

None. The Human execution contract fixes the routes, polling transport,
identity boundaries, receipt kinds, isolation constraints, and validation
gates.
