# AT-E12 S3-C-B — Architecture Compliance Report

Date: 2026-06-26 (updated after PR readiness blocker closure)

| Item | Result | Evidence |
|------|--------|----------|
| FSM implemented exactly as specified | PASS | `lib/trader/settlement/reconciliation/reconciliation.transitions.ts`; `tests/unit/reconciliation-transitions.test.ts` (full status × command matrix) |
| Ownership boundaries preserved | PASS | Financial effect via `lib/trader/settlement/apply-settlement-application.ts`; case ledger in reconciliation repos; `tests/unit/reconciliation-commands.test.ts` ("OPEN -> RESOLVED MANUAL_APPLY marks invoice PAID once") |
| ADR-0011 preserved | PASS | Cooling-off in `propose-resolution.ts` / gate in `execute-resolution.ts`; audit on every command; `tests/unit/reconciliation-commands.test.ts` ("rejects execute when cooling-off has not elapsed", event+audit count tests) |
| ADR-0016 preserved | PASS | Immutable EXCEPTION settlement unchanged; derived `effectiveOutcome()` in `effective-outcome.ts`; `tests/unit/effective-outcome.test.ts` |
| Append-only guarantees preserved | PASS | Events insert-only; existing mutation-block triggers unchanged; `tests/integration/postgres-settlement-parity.test.ts` (existing S3-B append-only) |
| Replay preserved | PASS | `fold-reconciliation-events.ts`; `tests/unit/reconciliation-fold-replay.test.ts`; `tests/unit/reconciliation-commands.test.ts` ("fold replay reproduces stored projection fields", "digest chain is continuous") |
| effectiveOutcome implemented exactly | PASS | `effective-outcome.ts`; `tests/unit/effective-outcome.test.ts` (FINANCIALLY_APPLIED, CLOSED_WITHOUT_APPLICATION, PENDING_RECONCILIATION, ESCALATED, CANCELLED never produced) |
| Settlement ownership preserved | PASS | `apply-settlement-application.ts` sole writer of applications; `tests/integration/settlement-application-uniqueness.test.ts` |
| Billing ownership preserved | PASS | Invoice PAID via `invoiceSettlementRepository.markInvoicePaid` inside shared apply effect; `tests/unit/reconciliation-commands.test.ts` ("OPEN -> RESOLVED MANUAL_APPLY marks invoice PAID once") |
| Reconciliation ownership preserved | PASS | Commands append reconciliation events only; MANUAL apply requests shared effect; `tests/unit/reconciliation-commands.test.ts` |
| No architecture deviations introduced | PASS | Section 12 freeze honored; no new aggregates/states/resolution types |
| Postgres execute atomicity | PASS | `reconciliation-workflow-handler.ts` wraps execute in `runWaiaPostgresTransaction` with tx-bound repos; `tests/integration/postgres-reconciliation-workflow-parity.test.ts` ("rolls back financial effects when appendEvent fails inside postgres transaction") |
| SQLite/Postgres parity | PASS | `tests/integration/postgres-reconciliation-workflow-parity.test.ts` ("runs OPEN -> RESOLVED MANUAL_APPLY…"); sqlite coverage in `tests/unit/reconciliation-commands.test.ts` + `tests/integration/settlement-application-uniqueness.test.ts` |
| RLS tenant isolation | PASS | Existing 0053/0055 policies; `tests/integration/reconciliation-rls.test.ts` |

**Overall: PASS** — validation chain: `pnpm lint`, `pnpm typecheck`, `pnpm test --run`, `pnpm build` (see PR readiness closure report).
