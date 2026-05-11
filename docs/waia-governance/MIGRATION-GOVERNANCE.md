# Migration governance pointers

**Doctrine source:** [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) (`DEE-64` staged migration slices) plus [`../migrations/DEE-95-RUNTIME-ROUTING-STRATEGY.md`](../migrations/DEE-95-RUNTIME-ROUTING-STRATEGY.md) and descendants (`DEE-95b/e/f/g*`).

This file **never** substitutes or paraphrases **forbidden shortcuts** listed inside those trackers. If code seems to contradict a tracker, escalate — do not silently “fix prose here.”

## Runtime split context (readable summary)

SQLite remains the pragmatic default paths while Postgres surfaces mature via **`getWaiaRuntimeDb()`**, env gates (`WAIA_DB_BACKEND`), and phased route adoption — **truth is in trackers + merged code.**

## Architectural approval triggers

Discuss with Architect before:

- Editing transaction abstraction promises (`runWaiaTransaction`, callback widening) prematurely.  
- Broad route migration implying dual-write/dual-read inconsistencies.  
- Telemetry / observability emitting new contracts cross-vendor ingestion.

Map engineering risk to **[`RISK-TIERS.md`](RISK-TIERS.md)** (`T2+` routes, `T3` orchestration/auth, `T4` infra rollout).

## Operational docs

Staging / telemetry runbooks reside under [`../migrations/`](../migrations/) (`DEE-95*` family).
