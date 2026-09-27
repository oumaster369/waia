---
integrationIssue: DEE-1134
integrationTitle: "Serialize Execution bind with Risk account locks and refresh window checks"
branch: dee-1134-execution-bind-account-lock-order
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, execution-consumer-graph, reality-consumer-graph, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, baseline-native-release, corrected-native-release, independent-review, integration-ready, exact-head-merge-admission]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1, WP-2, WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Freeze and independently review WP-1 test-only source before any separately admitted unchanged-production native baseline."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1134 — Execution bind account lock ordering

Issue: [DEE-1134](https://linear.app/deepsense/issue/DEE-1134/ai-trader-serialize-execution-bind-with-risk-account-locks-and-refresh), UUID `86295e68-cca6-402e-97c0-c73c3b370122`; parent DEE-639, project WAIA Development, execution label `backend`. The actual issue was read in Todo on 27 September 2026. Accepted base and freshly fetched `origin/main`: `dd5fdb00b4bd829983ea34766b8ab193e0e5fe55`, tree `fc4d48c9d06517b180da0eebd1af0642892d2388`.

This is the sole canonical plan. Root adopted clean plan head `825a9c6d106ccb7dad6374689bb7d12af82cbc2f` and released WP-1 test-only source plus scoped lint/typecheck/canon on 27 September 2026. No PostgreSQL/native, WP-2 production, publication or activation grant follows that admission. T3 is the existing technical correction authorization recorded in the issue and session, not authority to create financial or scientific rules. Root coordinates exact source admission, independent review, local resources, publication and merge separately.

## Goal and source finding

Make the existing atomic Execution V2 bind acquire its exact tenant/account Risk lock before lower locks and writes, and evaluate its existing policy/plan windows after actual waits. Preserve deterministic effect identity, Risk ownership, reservation/pending accounting, immutable restart binding and the existing dispatch admission boundary.

At the accepted base, `lib/trader/execution/v2/authority-postgres.ts:167–175` inserts the plan before consumption. Its nested `repository-postgres.ts:509–519` takes the allowance lock; Risk consumption takes the account lock only at `lib/trader/risk/v2/risk-allowance-repository-postgres.ts:1162`. The outer bind is therefore allowance→account, including restart replay. Dispatch is account→attempt→allowance→order at authority 344–389, while issued revoke/expire is account→allowance at Risk repository 789–800. The comment at authority 333–335 does not prove the current outer bind follows that order. This source inversion is established; no actual deadlock has been reproduced yet.

The independent finding is preserved externally under `audit-ai-trader-full-2026-09-25/parallel-research-binding/risk-independent-coverage-dd5fdb00/LOCK-ORDER-FINDING.md`, SHA-256 `aab17166cc010d0dadf015705cbb7bcff8fd1d8dda1761a474d6cd3a5f028885`. Root adopted the finite proposal under `parallel-runtime-owner/execution-bind-lock-order-preparation-dd5f/`: final freeze `571a2e86bd6c7b708dc6e1a94c99df5cf8ffd5738510db6fac48dcec4364fc7c`, five verified artifacts and 15 immutable Git pins. Its timestamp clarification governs over the earlier report sentence; the complete current rule is restated below. These are design receipts, not native proof.

## Exact file boundary

| Path | Responsibility |
|---|---|
| `docs/plans/dee-1134-execution-bind-account-lock-order.md` | Sole plan, admission checkpoints and truthful evidence state. Only file writable in this preparation. |
| `tests/integration/postgres-execution-v2.test.ts` | WP-1: finite transparent query barrier and exactly five new native registrations; preserve every existing test and cleanup behavior. |
| `lib/trader/execution/v2/authority-postgres.ts` | WP-2: outer-bind account lock, existing typed missing-state refusal, existing window refreshes and correct fresh-binding timestamps. |
| `docs/ai-trader/reality-v2-source-consumer-inventory.json` | WP-2 only: mechanically refresh `sourceDiscovery.sortedContentDigestHex` from the actual reviewed source bytes. All other inventory fields stay unchanged. |

The inventory's `sourceDiscovery.roots` includes `lib/trader/execution/v2` and its content seal covers all 157 discovered source files. The validator checks that seal at `scripts/trader/validate-reality-v2-consumer-graph.ts:167–183`; changing authority necessarily changes it. Root independently confirmed this dependency and added its explicit WP-2-only field allowance to DEE-1134 before this plan commit. Preserve the 157 count, every path digest, rule, consumer map and connector authority; do not weaken the validator or refresh unrelated fields. WP-1 leaves the complete inventory byte-identical. The field may change only with the reviewed WP-2 source, after root adopts this plan and grants that stage.

No Risk repository, schema, migration/journal, dependency, workflow, shared transaction helper, connector, financial limit, scientific gate, C3 worker, production or live operation change. No general tracing framework or production test hook. No new test file or unit-test edit is planned; existing unit tests are validation references. Broader Risk/Guardian composition, M01 and the full recurring runtime remain separate. DEE-1133 uses separate saved-research files; integration/merge and local heavy/native resources are serialized by root.

## WP-1 — Test-only baseline and five actual native cases

After exact plan/source admission, change only the existing native test file and this plan. Keep every production blob byte-identical to the accepted base and freeze that fact, the exact test registrations, adapter and runnable source. A separate reviewed runner/native release is required before baseline execution. Preserve a genuine unchanged-production RED separately from corrected evidence; setup failures do not prove this defect.

During each race, use two independent actual PostgreSQL clients, each `max: 1`, with distinct recorded backend PIDs. Each production API retains its real root transaction. The test-local adapter forwards actual transaction/query builders, executes each actual SQL query once and pauses only after the scoped account `SELECT ... FOR UPDATE` has successfully completed. It records actual account/allowance acquisition order. It may not supply fake rows, replace repositories, move the lock, or substitute a nested savepoint for the real root transaction. Review its exact receiver binding, result mapping, types and error propagation. Keep it small and local to this test file.

The paused counterparty transaction performs bounded serialized catalog observations: exact binder PID waiting on a Lock, actual `pg_blocking_pids` relation to the counterparty and the matching scoped query, plus bounded relevant `pg_locks` evidence. No third active observer is required; the ordinary fixture pool stays idle during the critical schedule. A pre-query log or sleep is not evidence of lock acquisition. Do not infer absence of a held row lock solely from absent tuple entries in `pg_locks`.

Five new registrations:

1. **Issued bind versus actual issued revoke.** Prepare one actual ISSUED allowance. Start the real `revokeRiskAllowanceV2Postgres` and pause after its account lock; start real new bind; observe the binder's account wait and whether it already acquired the allowance; release revoke; await both outcomes. Corrected behavior: revoke true exactly once, bind retains the existing nested-plan `ExecutionV2PersistenceConflictError` for the now-REVOKED allowance, no execution policy/plan/order/attempt/report or CONSUMED event persists, reservations R=25→0 and pending P=0, one linked ALLOWANCE_REVOKED event, zero callback.
2. **Replayed bind versus actual dispatch.** Commit one actual binding first. Pause actual dispatch after its account lock; start exact bind replay; observe the actual account wait/acquisition history; release dispatch. Corrected behavior: SUBMITTED and consumedNow:false both terminate, original IDs/digests remain, one order/attempt/plan/policy, exactly one committed SUBMIT_STARTED and inert callback, no duplicate consumption, R=0/P=25 unchanged. The callback reads the committed report and acquires the account lock in a new short transaction, proving the original root transaction closed. It performs no connector or external order call.
3. **Fresh plan expiry during an actual account wait.** Hold the exact account in the other client, start bind while valid, observe its server wait, bounded-poll real database time to the declared plan close, release. Policy and allowance remain valid longer. Require exact `ExecutionV2AuthorityRefusedError` / `EXECUTION_WINDOW_CLOSED`, no durable bind effects or new Risk event, R=25/P=0 unchanged.
4. **Replay policy expiry during a later actual attempt wait.** Initially commit the binding while valid. Hold its exact attempt row, start replay, prove its pre-consumption clock sample was still within the policy window and its subsequent actual attempt wait. Bounded-poll real database time to policy expiry, release. Require the exact window error with unchanged stored binding, timestamps, ledger/report heads and R=0/P=25; no callback. This catches a check placed only after the first account lock. Actual `contracts.ts:447–455` requires plan close at or before policy expiry, so the valid fixture uses a shared deadline and does not claim isolated policy-only expiry; root accepted this necessary clarification during WP-1.
5. **Typed missing account.** After real issuance, remove only the synthetic fixture's own account-state row under the existing schema, leaving its immutable allowance/verdict/events. Require existing `RiskV2AdmissionRefusedError`, name and reason `RISK_ACCOUNT_STATE_MISSING`, no policy/plan/order/attempt/report or new Risk event and no foreign-tenant mutation. The accepted schema's account constraint triggers cover INSERT/UPDATE and its allowance FKs target verdict/order, so this needs no new trigger disable. If actual admitted schema disagrees, preserve the failure; do not bypass it. Distinguish the fixture deletion's ordinary admin audit from bind effects.

Record both settled outcomes, full nested PostgreSQL cause/code chains (including a Drizzle-wrapped `40P01`) and acquired-query/server-wait observations in raw output before post-fix assertions can fail. Either transaction may be the baseline deadlock victim. Baseline dispatch callback may be zero or one depending on the victim; corrected dispatch must produce exactly one. Claim an actual deadlock only for emitted `40P01`; `55P03`/`57014` or harness deadlines remain distinct failures. All promises receive rejection handlers immediately; finally release barriers, await both real operations and close both clients. Do not abandon in-flight SQL with a timeout race. Preserve all baseline failure evidence without automatic retries.

The five tests are the finite new inventory, not replacement suites. Preserve existing suite cleanup as-is; add no guard disable to make a race or missing-state fixture pass. All database order rows are synthetic local fixtures and all supplied submitters are inert.

## WP-2 — Minimal outer-bind correction

Begin only after root accepts WP-1 source/baseline evidence and grants WP-2. Keep the single `runWaiaPostgresTransaction` and all existing tenant, identity, seal, allowance, Risk and replay checks.

1. Retain the initial Execution wall-clock/window check for fast rejection.
2. Before policy/plan writes, acquire `readRiskAccountStateV2Postgres(tx, scoped, input.allowance.accountId, true)`. This existing helper is already imported. A null row throws the existing exported `RiskV2AdmissionRefusedError("RISK_ACCOUNT_STATE_MISSING")`, using the same module import. Do not ignore an empty row, change Risk's own independently safe helper or create another transaction.
3. Continue existing policy/plan insertion. After its waits, resample the existing Execution `durableTransactionTime` (`clock_timestamp()`, authority 86–97) and check the existing policy/plan windows before consumption. Refreshing only immediately after the account lock would miss later policy/plan waits.
4. After successful consumption, for a new binding sample and check again immediately before creating the attempt. Persist that same fresh post-consumption sample as `boundAtUtc` and the three initial bind reports' `observedAtUtc`. Do not alter Risk's own event/order timestamps or separate clock semantics.
5. Recheck those same existing windows immediately before both successful callback returns, after remaining replay reads or fresh writes. A late failure rolls back all new transaction effects. Replay returns its original stored attempt/order/plan identities and timestamps; never rebuild or retimestamp them.
6. Recompute only the explicitly admitted inventory `sourceDiscovery.sortedContentDigestHex` from the actual reviewed production bytes, preserving every other field. Freeze this mechanical identity update with the authority change; do not substitute it for the unchanged graph checks.

Missing-state compatibility is the exact existing Risk class/reason, refusal and no lower writes. Compound-invalid error precedence changes intentionally: missing account can now win before a simultaneous lower policy/allowance conflict. Do not claim all error ordering is identical; existing early tenant/plan-construction/window checks keep their positions. Non-missing invalid allowance/reservation checks retain their ownership.

The persisted sample represents authoritative post-consumption binding validation, not commit time. The final check is the last application-level check; it cannot guarantee commit finishes before expiry. Existing dispatch is still the true subsequent effect-admission boundary, with its existing lock order, current Risk checks and callback after commit. No new policy/timeout or Risk expiry semantics is introduced.

## WP-3 — Corrected native acceptance, readiness and review

Freeze the exact corrected source, affected identity and five-case inventory before separate native release. The reviewed runner must prove fresh scratch database absence/identity, approved service/user/version, real full auth prelude and migration/journal/hash/when chain, actual role/RLS/trigger/session posture, bounded clients/time, raw output retention, source immutability and client closure. Root selects actual names and grants exclusive PostgreSQL/local-heavy ownership later; this plan invents none.

Prospective finite race bounds: each client max1/connection timeout5s; transaction-local lock_timeout10s, statement_timeout15s, idle_in_transaction_session_timeout20s; observation deadline5s; each added test30s including settlement/closure. Record actual deadlock_timeout and require detection before the lock timeout; do not change server settings to manufacture a receipt. Existing fixture policy timeout5000ms and setup120s stay unchanged. Race allowance validity60s is within the existing maximum300000ms and the existing fixture option. Clock cases use a predeclared real-clock deadline around3s ahead, require the actual wait before expiry and fail if arrival was too late. No fake clocks, resealing mid-operation or sleep-based ordering proof. Future runner watchdogs are infrastructure bounds and need exact admitted inventory, not waivers of product timeouts.

Execute the full existing Execution and Risk native files, preserving all tests and requiring zero skipped proof. Verify exact R/P, effect identities, event/report chains, both terminal outcomes, inert callback counts and closure. Preserve all prior REDs; no database reuse/repair, automatic rerun, role/guard weakening or real network effect. Run affected non-native checks and serial local readiness only under resource release; then obtain independent finite source/native review and all applicable exact-head GitHub checks.

## Acceptance

- Actual two-client baseline captures the source inversion using acquired locks and server waits; an actual deadlock is reported only if its PostgreSQL code is present. Baseline and corrected artifacts remain distinct.
- Both corrected native schedules have the exact terminal/accounting/event/effect behavior in WP-1, with actual root transactions and no database lock held across the inert callback.
- Fresh and replay window failures after real waits are atomic; post-consumption fresh timestamps and immutable replay semantics are proved; missing-state class/reason and deliberate compound-error precedence are documented.
- Exactly five new native registrations coexist with all prior compatibility gates, unchanged cleanup and guards. Every new proof reports actual participation and no skips.
- Source closure stays within the four-file map; the generated-identity change affects only the admitted source content seal. No semantics, limits, live authority, migrations or production changes are smuggled into this correction.
- Local readiness and independent source/native review pass before PR publication; all applicable exact-head GitHub checks pass before merge admission. No unexecuted check or prospective result is represented as PASS.

## Validation commands and existing compatibility

Commands below are prospective, not executed by this plan-only commit:

```bash
pnpm exec vitest run tests/unit/trader-execution-v2-authority.test.ts tests/unit/trader-execution-v2-contracts.test.ts tests/unit/trader-execution-v2-consumer-graph.test.ts tests/unit/trader-execution-v2-fail-unknown.test.ts tests/unit/trader-risk-v2-execution-consumption.test.ts
pnpm exec vitest run tests/integration/postgres-execution-v2.test.ts tests/integration/postgres-risk-v2.test.ts
pnpm validate:execution-v2-consumer-graph
pnpm validate:reality-v2-consumer-graph
pnpm lint
pnpm typecheck
pnpm build
pnpm validate:canon
pnpm validate:pr-governance
```

Native commands may run only through the separately admitted frozen runner with exact environment flags and actual scratch service credentials held privately. Baseline targets exactly the five new registrations against unchanged production; corrected proof includes the two full native suites. Capture raw default and JSON reports before evaluating count/title/skip gates. The mandatory GitHub capital PostgreSQL job already includes both files; no workflow change is planned. The authoritative full unit suite remains GitHub PR CI. No UI surface changes, so browser e2e is not applicable.

Retain Execution atomic bind/restart/one-effect (native 621–692), locked allowance/policy refusal (694–741), current Risk rollback (872–905), dispatch windows/expiry (765–843, 971–988), real restriction wait (1029–1083), locks released before callback (1085–1121) and reserved ceiling (1123–1148). Existing Risk native revoke/digest-chain (264–303) and exact consume/continuation accounting (306–390) remain separate gates; they do not substitute for the new issued-bind/revoke race.

## Rollout, evidence and current checkpoint

One issue, one canonical plan, one branch, one eventual PR to main. Synchronization, publication and exact-head merge admission remain root-coordinated; this task authorizes no push or PR. A later reviewed revert can restore the prior executable while preserving all native evidence; no schema rollback is required. No production/live activation or scientific qualification follows this technical correction.

Current checkpoint: WP-1 test-only source prepared under the exact plan admission. The existing native test file contains the finite real-query forwarding observer and the five declared cases; production and inventory bytes remain unchanged. Removing only the two new helper/case blocks and explicit import additions reconstructs the entire prior native file byte-for-byte, including cleanup. No native import/execution, database connection, race reproduction, runner admission or work-package completion is claimed.

Scoped ESLint, `pnpm typecheck` and `pnpm validate:canon` passed serially on 27 September 2026; canon checked 263 documents. The checked native-file SHA-256 is `c59d9e498ebff7fd862cc442f4a2d0b9029ea8759061cc88d73c9f7b84ca7f28`. Actual logs, source identities and the checked plan snapshot are external under `parallel-runtime-owner/dee1134-wp1-test-baseline-dd5f`; this results paragraph is a documentation-only follow-up to the canon receipt. Local-heavy ownership was released immediately after checks. The concrete barrier/source freeze still requires independent/root review before the baseline. WP-1 is not complete until that native evidence is accepted; the actual WP-2 source/seal delta and all native/full-readiness/CI acceptance remain pending.

## WP-1 independent review correction — statistics snapshot

Independent source review of frozen `6ef74c3b45c7f72e759ee9dd4a0fd7ad9fd4da1f` identified a blocking harness defect: repeated `pg_stat_activity` polls inside the same held transaction could retain an early statistics snapshot and miss a later real wait. Root admitted one targeted helper correction: await `SELECT pg_stat_clear_snapshot()` immediately before each activity poll, as a separate SQL call. Exact backend PID, blocker relation, target table, `FOR UPDATE`, raw trace and all assertions remain unchanged. This is a source finding, not an executed native failure. The old freeze and its check receipts are preserved; no baseline may execute that superseded head. Corrected scoped checks and independent closure precede rebinding the external runner; PostgreSQL/native and WP-2 remain ungranted.

The corrected native-file SHA-256 `c48a29b5c497439337f3240ef4c6229c1bbea42fee845142296a4e93fd71e331` passed scoped ESLint, typecheck and canon serially on 27 September 2026, finishing at 15:54:47 UTC; local-heavy ownership was released immediately. Raw receipts and the checked plan snapshot are preserved under `parallel-runtime-owner/dee1134-wp1-stats-snapshot-correction-6ef74c3b`. This result paragraph is the sole documentation follow-up after those checks. Independent closure and a rebound runner/native grant remain pending; no database, native test or WP-2 action occurred.

## WP-1 first native baseline and deadline wire correction

Root executed the admitted five-case baseline once at clean `bcf613165f74d0bd3ad8de477024bc7946b64303`, using fresh retained `waia_dee1121_dee1134_baseline_20260927_1610`; it finished on 27 September 2026 at 16:10:36 UTC with native exit 1 and runner exit 2 (incomplete evidence). Both real race cases recorded distinct backend PIDs, actual server waits and nested PostgreSQL `40P01`, without harness failures. The typed missing-account case passed. Both expiry cases failed before their wait/body proof because `clock.deadline.toISOString` was not a function, so only seven of thirteen required proof records existed; no expiry behavior is claimed. Posture, exact source and client closure passed. Raw evidence is retained under `parallel-runtime-owner/dee1134-native-baseline-bcf61316/results`; the first baseline remains incomplete and is not replaced or relabelled.

Read-only source/dependency diagnosis found the same raw postgres client is passed to Drizzle, whose installed postgres-js adapter replaces the timestamp OID 1184 parser with a transparent wire-string parser. A TypeScript `Date` annotation did not convert that result. Root admitted a routine fixture-only correction: type each of the two direct deadline results as `Date | string`, construct a `Date` from the actual returned value, assert its milliseconds are finite, then convert to ISO. The actual `clock_timestamp() + interval '3 seconds'` query, deadline duration, clock source, barriers, case limits, product assertions, cleanup, production and inventory all stay unchanged. Scoped checks, independent review and a separately admitted fresh baseline successor remain pending; no same-database retry or WP-2 grant follows this correction.
