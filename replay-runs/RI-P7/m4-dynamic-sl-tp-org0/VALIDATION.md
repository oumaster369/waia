# M4 Validation Report

**Date:** 2026-07-04  
**Branch:** `dee-379-m4-dynamic-sl-tp`  
**Linear:** DEE-379

## Commands

| Command | Result |
|---------|--------|
| `pnpm lint` | pass (warnings only, pre-existing) |
| `pnpm typecheck` | pass |
| `pnpm test --run` | pass (2110 tests) |
| `pnpm build` | pass |
| `pnpm test --run tests/unit/trader-exits-` | pass |
| `pnpm test --run tests/unit/trader-guardian-` | pass |
| `pnpm test --run tests/unit/trader-paper-cycle-runner.test.ts -t "M4"` | pass (2 cases) |

## Acceptance proofs

- Deterministic ATR + SL/TP on fixed fixtures (unit replay tests)
- Insufficient ATR → HOLD, no ExitIntent, slTpLevels null (unit + integration)
- M3 regression green with exitEngine disabled
- SL hit → GUARDIAN_EXIT_INTENT → sell → TRADE_CLOSED (integration)
- Risk path unchanged — guardian `submitOrder` + idempotency keys preserved
