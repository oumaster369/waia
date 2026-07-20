# HTR-WP03 replay benchmark baseline

Measurement-only baseline for the legacy expanding-window replay path
(`HistoricalBarReplaySource` → `runBacktest` → `runPaperCycleOnce`).

## Reproduce

```bash
pnpm trader:replay:benchmark
```

## Fixture

- Path: `tests/fixtures/trader/dee-337-p5-btcusdt-1m-replay.json`
- SHA-256: `814981bc3055d8fd52d1277d60a0b443de7644416aceba8cbe99819c70242061`
- Cycles: 81 (100 bars, expanding window from 20)

## Non-goals

This baseline does **not** assert performance qualification (D-11B deferred to HTR-WP22),
does not optimize replay, and does not close HTR-GAP-024.
