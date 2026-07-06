# M3 — Position Guardian Implementation Plan (frozen snapshot)

**Linear:** DEE-378  
**Branch:** `dee-378-m3-position-guardian`  
**Base:** `origin/dev` @ `0b26d13c4d0a16e0538e5e170ce924d61839f948` (M2 / DEE-377 / PR #364)  
**Risk tier:** T2 (new execution-path module; no live, no blind, no billing)  
**Implementation started:** 2026-07-04  
**Authoritative plan source:** `.cursor/plans/m3_position_guardian_becd5486.plan.md` (not modified during implementation)

---

## Goal

Add a per-bar **Position Guardian** in `lib/trader/guardian/*` that monitors M1 open lots, emits auditable hold/exit decisions (no SL/TP math), converts exit intents to sell orders through the existing execution/risk path, and wires **exclusively** into `runPaperCycleOnce`.

## Integration boundary (binding)

- **In scope:** `runPaperCycleOnce` in `lib/trader/paper/paper-cycle-runner.ts`
- **Forbidden in M3:** `build-worker-deps.ts`, `paper-loop-worker.ts`, Worker production wiring, backtest/research runners, strategy files, `lib/trader/exits/*`, billing/HWM

## Hook point

After `runEvaluationCycle`, before strategy signal loop:

1. Load open lots + trade metadata
2. `evaluatePositionGuardian` → evaluations + exit intents
3. `recordGuardianEvaluated` / `recordGuardianExitIntent`
4. `mapExitIntentToSubmitOrder` → `submitOrder` → `reconcile`
5. Refresh `accountState` when configured
6. Existing strategy entry loop unchanged

**Paper-cycle fix:** guardian runs when open lots exist even if `actionableSignals.length === 0`.

## M3 decision rules (pure, no SL/TP)

| Priority | Condition | Decision |
|----------|-----------|----------|
| 1 | `tradingPermission === ONLY_CLOSE_POSITIONS` | EXIT_FULL |
| 2 | `tradingPermission === STOP_TRADING` | EXIT_FULL |
| 3 | trade `strategyId` ∉ `allowedStrategyIds` | EXIT_FULL |
| 4 | `maxHoldBars > 0` && `barsHeld >= maxHoldBars` | EXIT_FULL |
| 5 | M4 `GuardianRuleProvider` hooks (composition only) | provider outcome |
| default | — | HOLD |

## Deliverables

### New — `lib/trader/guardian/*`

Types, reason record schema, reason codes, run config, decision model, orchestrator, exit mapper, order keys, public index.

### Modified

- `lib/trader/lifecycle/lifecycle-recorder.ts` — `GUARDIAN_EVALUATED`, `GUARDIAN_EXIT_INTENT`
- `lib/trader/paper/paper-cycle.types.ts` — guardian deps/input/result
- `lib/trader/paper/paper-cycle-runner.ts` — guardian phase + no-signal fix
- `lib/trader/index.ts` — re-export guardian API

### Tests

- `tests/unit/trader-guardian-decision-model.test.ts`
- `tests/unit/trader-guardian-evaluate.test.ts`
- `tests/unit/trader-guardian-exit-intent-mapper.test.ts`
- `tests/unit/trader-lifecycle-recorder-guardian.test.ts`
- `tests/unit/trader-paper-cycle-runner.test.ts` (M3 integration block)

## Validation commands

```bash
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
pnpm test --run tests/unit/trader-guardian-
pnpm test --run tests/unit/trader-paper-cycle-runner.test.ts -t "M3"
```

## Human STOP points (plan)

1. After groom — before branch ✅
2. End of Phase 3 — before artifacts ✅ (implementation complete)
3. End of Phase 4 — before human opens PR ⏳

**Agents do not open PRs.** Human authorization required as separate step.

---

## Historical execution annotation (2026-07-06)

**Status:** Complete · **Linear:** DEE-378 · **Merged:** PR #365  
**Superseded by:** `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` for post-M9 work  
**Canonical recovery entry point:** `../AI-TRADER-ENGINEERING-STATUS.md`
