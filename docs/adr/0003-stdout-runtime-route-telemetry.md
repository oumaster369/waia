# ADR-0003 — Stdout-first runtime route attribution telemetry

Status: Accepted  
Date: 2026-05-07

## Context

During split-runtime adoption, diagnosing which backend answered a route without expensive vendor contracts mattered.**Engineering prioritized lightweight JSON stdout lines.**

## Decision

Canonical pattern described in **`DEE-95f` / runbooks**: emit structured `waia_runtime_route` lines capturing backend key, latency, outcome (see migration docs for exact schema evolution).

Avoid premature external vendor ingestion until rollout stable.

## Consequences

+ Cheap introspection − Need log hygiene discipline Neutral: Vendor export optional later (`DEE-95g` scaffolding)

## Links

- [`../migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md`](../migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md)
- Related planning: [`../migrations/DEE-95-RUNTIME-ROUTING-STRATEGY.md`](../migrations/DEE-95-RUNTIME-ROUTING-STRATEGY.md)
