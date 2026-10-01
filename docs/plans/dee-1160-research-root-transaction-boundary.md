---
integrationIssue: DEE-1160
integrationTitle: "AI-TRADER: refuse nested research transactions before one-shot blind disclosure"
parentIssue: DEE-1159
branch: dee-1160-research-root-transaction-boundary
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, isolated-postgres, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, native-postgres, validate-canon, consumer-graphs, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-real-holdout]
state:
  status: in-progress
  completedWorkPackages: [source-fix, native-counterexample]
  remainingWorkPackages: [standalone-readiness, independent-review, required-ci, merge]
  nextAction: "Validate the extracted correction independently, then integrate after required CI."
provenance:
  createdFrom: "DEE-1159 independent audit and isolated PostgreSQL16 counterproof on 2026-10-01"
  supersedes: null
---

# DEE-1160 — durable root transaction boundary

The blind-commit API previously accepted a caller-owned Drizzle transaction. Its nested transaction was only a savepoint: the synthetic native counterexample exposed bars to a callback once, then an outer rollback erased the one-shot content consumption. No observed production incident is asserted.

Both the direct blind-commit entry and research pipeline now require an actual root Postgres.js Drizzle database before any status read, scoring or bar callback. A `PgTransaction` or structural replacement is refused. Existing root burn/outcome transactions, bar-content identity, terminal failure handling, authorization checks and parent-pool guard remain unchanged. This adapter check is not scientific or capital authority. The larger DEE-1159 preregistration and executed-candidate work remains open.

## Validation and limits

The pre-fix native RED recorded `statusReads=1`, `backtestCalls=1`, `tokenConsumedAfterRollback=false`. The corrected run records zero status reads/callbacks and no consume for the refused nested call; the subsequent real root call remains the first opener. All 15 native tests across the max-one-connection and research-parity suites passed without skips on the prepared DEE-1155/1158 composition. This combined result is not standalone-source qualification; extraction must receive its own applicable native and readiness checks.

Dedicated adapter tests reject structural/serialized substitutes without invoking their transaction function. The older in-memory commit-order harness explicitly mocks only the new root check; it does not prove real transaction durability. Native tests cover actual adapters and preserve success, terminal failure and competing-opener behavior. No real holdout, C3, venue, production database or live trade is accessed. No migrations or financial/scientific gates change.

## Acceptance

Only accept after exact-source independent review, lint/typecheck/build/canon, focused tests, actual PostgreSQL execution and required CI. A caller-owned outer rollback must never erase a consumption made by these public entry points after bar disclosure.
