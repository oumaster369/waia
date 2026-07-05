# M7 PR Readiness

**Linear:** DEE-382  
**Branch:** `dee-382-m7-event-attribution` → `dev`  
**Risk tier:** T2

## Safety statement

M7 introduces no changes to Guardian decision logic, exit math, order placement, Risk Engine behaviour, or paper-cycle execution paths. It adds a deterministic, append-only event attribution layer. Default-off; no promotion or autonomous trading behaviour. M7 outputs are observational only — not reward signals, training targets, or strategy inputs.

## Linked issue / plan

**Linear:** `DEE-382` https://linear.app/deepsense/issue/DEE-382/m7-newsevent-attribution-memory  
**Plan:** `.cursor/plans/m7_event_attribution_memory_bfedcc24.plan.md`  
**Linear groom verified:** yes (DEE-382 groomed 2026-07-05; see `LINEAR-ID-COLLISION-RECOVERY.md`)

## Risk tier

**Tier:** T2

## Merge strategy

**Merge strategy:** squash

## Migration impacted

yes — Postgres `0072_trader_event_attribution_memory`, `0073_trader_event_attribution_memory_rls`
