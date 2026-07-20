# M4 Design — Dynamic SL/TP Engine

## Architecture

M4 adds pure exit math in `lib/trader/exits/*` and composes into M3 via `GuardianRuleProvider`.

### Priority (unchanged M3 table)

1. Permission exits  
2. Strategy allowlist  
3. maxHoldBars  
4. **M4 SL/TP/trailing provider**  
5. Default HOLD  

### Derived vs session state

| Class | Contents | Replay contract |
|-------|----------|-----------------|
| Derived | ExitPlan, ATR, SL/TP, slTpLevels, exit decisions | Identical bars → identical outputs |
| Session | `trailingStateByLotId` Map | Ephemeral; not replay truth |

### ATR fail-closed

Insufficient/invalid bars → no ExitPlan → HOLD, `slTpLevels: null`, no fallback percentages.

### Integration boundary

`runPaperCycleOnce` only — opt-in via `guardian.exitEngine`.
