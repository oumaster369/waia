# DEE-1154 — Commit credential refusal kill switches before reporting refusal

## Contract

A credential refusal during the public Execution V2 pre-bind authorization or direct live bind must persist the existing organization EMERGENCY_STOP and Risk projection without creating an order or consuming its allowance. Only after the owning transaction commits may telemetry report WRITTEN/ALREADY_ACTIVE and the public API throw its existing refusal. Non-credential gate refusals remain fail closed. A write/commit failure must never report durable success or reach a connector.

Scope: existing live-gates, org-order-path and authority-postgres boundaries, credential telemetry helper if needed, native postgres-execution-v2 regressions, affected source inventory seals and unit caller checks. Pre-POST telemetry follows the same post-commit rule; its existing returned-refusal behavior is retained. No database schema or financial policy changes, no new decision provider, no live enablement or venue calls.

## Implementation sequence

1. Native RED through actual public pre-bind and direct-bind APIs, valid synthetic Org0/live/strategy facts, read-only credential metadata, no secrets or connector.
2. Return a typed gate refusal plus pending kill-write evidence from the transaction; throw/emit outside the owning transaction. Unexpected failures roll back. Do not open an independent connection while holding account locks.
3. Prove one switch/audit/projection and no order/allowance consume on repeat/concurrent attempts; preserve cross-org state. Inject rollback after successful transaction callback and actual SQL write failure to prove no WRITTEN telemetry on rollback/write failure. A lost connection during COMMIT is not simulated by the callback fault. Valid/noncredential gates retain behavior.
4. Local targeted native/unit/lint/typecheck/build, exact source seals, independent review, required CI, then separate PR and squash merge under current user authorization. Inherit PR722 only while preparing; rebase onto actual merged main before publication. No production action.

## Evidence status

Source defect confirmed on main a20bfcce and reproduced through both public APIs in native PostgreSQL16. The original source produced no durable switch/audit and CLEAR Risk while logging WRITTEN. Corrected full native suite:65 PASS/0 skipped, including retries, same-account concurrent convergence, SQL write failure, post-callback rollback, and pre-POST scope loss after a valid bind. This is bounded synthetic proof, not live activation, a server COMMIT-failure test or global multi-account deadlock-freedom evidence. Targeted unit/graph checks, lint, typecheck and default build passed. Independent review confirmed the correction; exact merged-base CI remains required.
