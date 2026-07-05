# M7 PR Readiness

**Linear:** DEE-382  
**Branch:** `dee-382-m7-event-attribution` → `dev`  
**Risk tier:** T2

## Safety statement

M7 introduces no changes to Guardian decision logic, exit math, order placement, Risk Engine behaviour, or paper-cycle execution paths. It adds a deterministic, append-only event attribution layer. Default-off; no promotion or autonomous trading behaviour. M7 outputs are observational only — not reward signals, training targets, or strategy inputs.

## Linked issue / plan

**Linear:** `DEE-382`  
**Plan:** `.cursor/plans/m7_event_attribution_memory_bfedcc24.plan.md`

## Risk tier

**Tier:** T2

## Merge strategy

**Merge strategy:** squash

## Migration impacted

yes — Postgres `0072_trader_event_attribution_memory`, `0073_trader_event_attribution_memory_rls`
