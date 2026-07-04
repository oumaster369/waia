# M5 Design — Exit Intelligence Context (Reasoning Overlay)

**Linear:** DEE-380 · **Branch:** `dee-380-m5-exit-intelligence`

## Layering

| Layer | Role | M5 relationship |
|-------|------|-----------------|
| M3 Guardian | Sole exit decision executor | M5 reads `decision/reasonCode/ruleId` |
| M4 exits | Sole exit math (SL/TP/trailing) | M5 reads `slTpLevels` snapshot |
| MSV | Regime + permission context | M5 reads; no re-classification |
| M5 | Reasoning overlay | Scores + conflict tags + explanation only |

## Derived vs authoritative

- **Authoritative for execution:** `GuardianReasonRecord.decision` (M3 + M4 providers)
- **Advisory only:** `exitIntelligenceContext.scores` — never fed back into `decideGuardianAction`

## Scores (non-decision)

- `exitPressureScore` — cross-layer exit attention magnitude
- `riskAlignmentScore` — MSV permission/regime coherence with guardian outcome
- `conflictScore` — cross-layer tension

## Integration

Opt-in via `guardian.exitIntelligence.runConfig.enabled` (default `false`). Post-assemble attach in `evaluatePositionGuardian` after full reason record assembly.
