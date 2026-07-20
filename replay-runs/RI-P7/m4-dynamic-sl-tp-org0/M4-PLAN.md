# M4 — Dynamic SL/TP Engine (frozen snapshot)

**Linear:** DEE-379  
**Branch:** `dee-379-m4-dynamic-sl-tp`  
**Base:** `origin/dev` @ `e119475359854468128e50a0ecde057952125a20` (M3 / DEE-378 / PR #365)  
**Plan:** `.cursor/plans/m4_dynamic_sl_tp_34b74d24.plan.md`

## Delivered

- `lib/trader/exits/*` — ATR estimator, SL/TP calculator, trailing reducer, exit plan builder, guardian rule provider
- Additive guardian hooks — `slTpLevels`, `evaluatePositionGuardian` exitEngine branch
- `runPaperCycleOnce` opt-in `guardian.exitEngine` with session-scoped trailing map
- Unit + paper-cycle integration tests (SL hit, insufficient ATR HOLD)

## Out of scope (unchanged)

- M5 Exit Intelligence
- Worker / paper-loop wiring
- DB trailing persistence
- Live / billing / execution-service changes

---

## Historical execution annotation (2026-07-06)

**Status:** Complete · **Linear:** DEE-379 · **Merged:** PR #366  
**Superseded by:** `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` for post-M9 work  
**Canonical recovery entry point:** `../AI-TRADER-ENGINEERING-STATUS.md`
