# M3 Position Guardian — VALIDATION

**Linear:** DEE-378 · **Date:** 2026-07-04 · **Branch:** `dee-378-m3-position-guardian`  
**Independent audit:** PASS WITH NON-BLOCKING REMARKS (pre-PR remediation applied 2026-07-04)

## Deterministic proofs

| Criterion | Evidence |
|-----------|----------|
| Decision rule priority + DEFAULT_HOLD | `tests/unit/trader-guardian-decision-model.test.ts` |
| Multi-lot evaluation, deterministic sort, qty = remainingQty | `tests/unit/trader-guardian-evaluate.test.ts` |
| Byte-identical ExitIntent replay | `tests/unit/trader-guardian-evaluate.test.ts` |
| Sell mapping preserves openingStrategySignalId | `tests/unit/trader-guardian-exit-intent-mapper.test.ts` |
| Lifecycle GUARDIAN_* phases persisted (recorder unit) | `tests/unit/trader-lifecycle-recorder-guardian.test.ts` |
| Paper cycle: ONLY_CLOSE → sell on no-signal bar | `tests/unit/trader-paper-cycle-runner.test.ts` (M3 block) |
| Paper cycle: GUARDIAN_EVALUATED + GUARDIAN_EXIT_INTENT in orchestration path | same — close-only + maxHoldBars cases |
| Paper cycle: GUARDIAN_EXIT_INTENT recorded before submitOrder | same — spy invocation order assertion |
| Paper cycle: guardian sell → TRADE_CLOSED / lot closed via M1 path | same — close-only case |
| Paper cycle: maxHoldBars structural exit on allow-trading bar | same — maxHoldBars case |
| Paper cycle: ALLOW_TRADING → HOLD, GUARDIAN_EVALUATED only | same — HOLD case |
| Per-test SQLite isolation (no cross-case lot leakage) | M3 harness uses fresh DB per test via `resetWaiaSqliteSingleton` |
| M0 forensic regression | `tests/unit/trader-closed-trade-attribution-forensics-m0.test.ts` (unchanged) |
| M1 lifecycle regression | `tests/unit/trader-lifecycle-*.test.ts` (green in full suite) |
| M2 portfolio regression | `tests/unit/trader-paper-cycle-runner.test.ts` (M2 block) + portfolio unit tests |

## Fixture scenarios (integration)

| Scenario | Setup | Expected |
|----------|-------|----------|
| Close-only exit | Open lot + `ONLY_CLOSE_POSITIONS` + zero signals | GUARDIAN_EVALUATED → GUARDIAN_EXIT_INTENT → sell → TRADE_CLOSED |
| Hold | Open lot + `ALLOW_TRADING` + `maxHoldBars: 0` | GUARDIAN_EVALUATED only, HOLD, no submit |
| Max hold bars | Open lot + `ALLOW_TRADING` + `maxHoldBars: 5` + 26 bars held | GUARDIAN_MAX_HOLD_BARS exit, sell, trade closed |
| Legacy opt-out | No `input.guardian` | Guardian fields absent/empty; prior cycle behaviour unchanged (implicit via legacy tests) |

## Pre-PR remediation (audit-driven)

Independent implementation audit identified gaps in orchestration-path lifecycle proof and shared-DB test isolation. Remediation added:

1. Lifecycle event assertions in `runPaperCycleOnce` integration tests
2. `recordGuardianExitIntent` before `submitOrder` call-order proof
3. `TRADE_CLOSED` / open-lot exhaustion after guardian sell
4. `maxHoldBars` integration case
5. Fresh SQLite harness per M3 test case

## Validation commands

```bash
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
pnpm test --run tests/unit/trader-guardian-
pnpm test --run tests/unit/trader-paper-cycle-runner.test.ts -t "M3"
```

## Regression checklist

- [x] Guardian disabled → legacy paper cycles unchanged (implicit legacy tests)
- [x] No new DB migration (M1 enum already includes GUARDIAN phases)
- [x] No strategy file edits
- [x] No sealed RI-P7 vault artifact mutation (new M3 dir only)
- [x] No Worker / build-worker-deps changes
- [x] Full test suite green after remediation

## Human review stop

Pre-PR perfection remediation complete — ready for manifest commit after human review. **Do not open PR until human approves M3-PR-READINESS.md.**
