# M8 ← M7 Boundary Inheritance

**Authority:** [`replay-runs/RI-P7/m7-event-attribution-org0/M7-M8-BOUNDARY.md`](../m7-event-attribution-org0/M7-M8-BOUNDARY.md)  
**Linear:** DEE-383 inherits DEE-382 binding rules

## Inherited rules

1. M7 outputs are **observational only** — not reward labels or fitness inputs.
2. M8 may cite M7 attribution refs in `ObservationRecord` for human-reviewed hypothesis context.
3. M7 confidence snapshots measure historical attribution consistency — **not** P(profit).
4. No closed loop from M7 artifacts to strategy generation without explicit operator gate (G1/G2/G3).

## M8 enforcement

| Mechanism | Location |
|-----------|----------|
| Descriptive ref types | `observation.types.ts` |
| Banned field guard | `no-reinforcement-guard.ts` |
| Comparator allowlist | `evidence.types.ts` + `candidate-comparator.ts` |
| CI regression | `tests/unit/trader-discovery-no-reinforcement.test.ts` |

## M6 extension (by inheritance)

Same rules apply to M6 pattern catalog refs: descriptive correlation context only; PnL tags and pattern scores must not enter comparator inputs.
