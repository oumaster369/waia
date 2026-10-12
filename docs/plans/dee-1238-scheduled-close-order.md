---
integrationIssue: DEE-1238
integrationTitle: "Settle PostgreSQL transactions safely after connection close"
branch: dee-1238-scheduled-close-order
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [focused-unit-tests, native-postgres-integration, lint, typecheck, build, pr-governance, independent-source-review]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-2
  completedWorkPackages: [WP-1]
  remainingWorkPackages: [WP-2]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-10-12T07:28:13Z"
  blockedReason: null
  nextAction: "Publish the reviewed change and qualify exact-head PR CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1238 — Scheduled PostgreSQL close ordering

Parent issue: DEE-639. This single-issue work package fixes PostgreSQL client transaction settlement following connection closure. It is non-trading client correctness work: no order placement, capital use, production operation, provider access, or financial E9 changes are in scope.

## Context and defect

The pinned `postgres@3.4.9` client can close a socket while a transaction callback or transaction-local queue still has work. In the driver, `begin()` races the callback against connection close, but its transaction handler can subsequently submit work through the closed connection. `Connection.closed()` nulls the socket, while the scheduled `nextWrite` path dereferences `socket.write`; this state ordering can produce a null-socket failure and leave transaction work unsettled. This plan records the source-level race and the deterministic reproduction, not a claim about the exact original CI event timing.

## Goal

Retain the lockfile resolution `postgres@3.4.9` and make close handling settle in-flight, pipelined, queued, and later transaction queries with connection-close errors. The manifest's existing `^3.4.9` range stays unchanged; the patch applies only to 3.4.9. Active and pipelined queries share their driver close error, while `begin`, queued, and later transaction work share the transaction's captured close error. Preserve rollback and callback error behavior on a live connection, avoid COMMIT or rollback writes on the closed socket, and allow a later clean query to reconnect normally.

## Scope

- Add a pnpm patched dependency for only `postgres@3.4.9`; update the lockfile patch hash.
- Apply the closed-error and transaction queue settlement fix to the package's Node, CJS, and Cloudflare source surfaces, with closed connection result/query state cleanup.
- Add deterministic fake-socket regression cases for close settlement, queue rejection, late callback behavior, fresh-socket reuse, and ordinary query/rollback behavior.
- Validate the repository change with targeted tests, native scheduled-owner PostgreSQL integration, lint, typecheck, build, PR governance checks, and independent source review.

## Do NOT

- Do not upgrade postgres.js or broaden the patch to unrelated driver behavior.
- Do not change application trading, order execution, account, venue/provider, capital, or financial E9 behavior.
- Do not access production hosts, databases, accounts, secrets, providers, or deployment systems.
- Do not add a migration or alter the application data contract.
- Do not claim this reproduces the exact original CI event sequence; report only observed test evidence.
- Do not treat the local native integration result as full-suite CI or release evidence.

## Acceptance

- Connection close settles the transaction and callback; active, pipelined, queued, and later transaction work reject using the captured close error.
- No COMMIT or rollback is written to a closed socket; pool shutdown settles; a later ordinary query can use a fresh socket.
- A successful query followed by a callback error preserves that original error and performs rollback while the connection is open.
- Focused fake-protocol tests and scheduled-owner/pool-lifetime unit coverage pass; the native scheduled-owner file completes all 15 cases with no skips, including rollback, acknowledged commit, and abort settlement coverage.
- Typecheck, build, full repository lint, governance checks, and independent source review pass. Full unit CI remains a separate required gate.

## Work packages

### WP-1 — Scoped driver fix and regression

Completed in the working tree. The local patch applies to postgres 3.4.9 and covers Node, CJS, and Cloudflare package source. Four fake-protocol tests passed; scheduled-owner unit tests passed 8/8 and pool-lifetime tests passed 11/11. Typecheck, build, changed-TypeScript ESLint, formatting, and frozen offline install passed.

### WP-2 — Review and PR readiness

Native PostgreSQL 16 scheduled-owner integration passed 15/15 with zero failed/pending/todo cases; DEE-1213 abort/rollback passed. The fixture was isolated to a private container network and cleaned up. PR preflight and `pnpm validate:pr-governance` passed. Full repository lint passed with zero errors and 337 existing warnings. Independent source review approved all four code/dependency paths with no blockers. GitHub PR CI remains the full unit-suite gate; publication is the next step.

## Validation record

Local validation: fake-protocol regression 4/4, scheduled-owner unit 8/8, pool-lifetime unit 11/11, native scheduled-owner integration 15/15 with zero skips, typecheck, build, full lint, and PR governance. The native run's parsed assertion output and source-bound independent review are retained in the private task evidence; the temporary standalone reporter file was unavailable after container exit. No full local unit suite or UI E2E run was performed. The native result is limited to that exact scheduled-owner test file and disposable local fixture.
