# ADR-0002 — Staged Postgres / split-runtime discipline

Status: Accepted  
Date: 2026-05-07

## Context

WAIA matured with SQLite-first runtime while introducing Postgres-compatible surfaces (`PostgresTwinPersistence`, route facades via `getWaiaRuntimeDb()`).

Uncontrolled “flip everything Postgres” threatens parity gaps (verification / repeatability / prediction paths previously highlighted in trackers).

## Decision

Maintain **explicit phased routing + env gates** per migration tracker lineage (`DEE-64`, **`DEE-95*`** docs). Agents **avoid** widening neutral transaction façade until Postgres callback semantics validated.**Production promotion requires human operational sign-off.**

## Consequences

+ Safer staged learning of divergences − Slower infra convergence if teams skip discipline Neutral: Telemetry surfaces remain critical observability adjunct

## Links

- [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md)  
- [`../migrations/DEE-95-RUNTIME-ROUTING-STRATEGY.md`](../migrations/DEE-95-RUNTIME-ROUTING-STRATEGY.md)
