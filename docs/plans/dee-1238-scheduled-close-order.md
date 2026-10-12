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
  prNumber: 780
  prUrl: "https://github.com/oumaster369/waia/pull/780"
  lastValidatedGitSha: null
  lastValidationAt: "2026-10-12T08:16:43Z"
  blockedReason: null
  nextAction: "Root independently reviews these uncommitted bytes, then commits and pushes the correction to PR 780 and qualifies CI on the new exact head."
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
- Apply the closed-error and transaction queue settlement fix to the package's Node, CJS, and Cloudflare source surfaces. Preserve the socket error for work submitted between `error` and `close(true)`, and clear query/result state before startup reconnects.
- Add deterministic fake-socket regression cases for close settlement, queue rejection, late callback behavior, the error-to-close gap, startup array-type reconnects, transaction `ReadyForQuery` status, fresh-socket reuse, and ordinary query/rollback behavior.
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
- Focused fake-protocol tests and scheduled-owner/pool-lifetime unit coverage pass; the native scheduled-owner file completes all 15 cases with no skips, including rollback, acknowledged commit, and abort settlement coverage. The post-review fake-protocol changes must also pass their focused tests and CI.
- Typecheck, build, full repository lint, governance checks, and independent source review pass. Full unit CI remains a separate required gate.

## Work packages

### WP-1 — Scoped driver fix and regression

Completed in the working tree. The local patch applies to postgres 3.4.9 and covers Node, CJS, and Cloudflare package source. Seven focused fake-protocol tests, scheduled-owner unit 8/8, pool-lifetime unit 11/11, typecheck, build, and frozen offline lockfile install pass on the current uncommitted bytes. The original four-case result belongs to prior bytes; exact-head PR CI remains required after publication.

### WP-2 — Review and PR readiness

Native PostgreSQL 16 scheduled-owner integration passed 15/15 with zero failed/pending/todo cases; DEE-1213 abort/rollback passed on prior bytes. The fixture was isolated to a private container network and cleaned up. Prior PR preflight and `pnpm validate:pr-governance` passed. Full repository lint passed with zero errors and 337 existing warnings on prior bytes. The three PR 780 inline findings are corrected in the current uncommitted change; root review and exact-head CI remain pending.

## Validation record

Current uncommitted-byte validation: focused fake-protocol regression 7/7, scheduled-owner unit 8/8, pool-lifetime unit 11/11, changed-file ESLint, typecheck, and build pass. A pre-fix check confirmed that the new error-to-close case fails on the prior driver bytes. The earlier native scheduled-owner integration 15/15 with zero skips, full lint, and PR governance checks remain prior-byte evidence only. The exact former runner image is unavailable locally, so the native fixture was not recreated for these uncommitted bytes. No full local unit suite or UI E2E run was performed. Exact-head PR review and CI remain pending after publication.
