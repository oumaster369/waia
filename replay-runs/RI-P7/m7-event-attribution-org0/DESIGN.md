# M7 Event Attribution — Design

**Linear:** DEE-382  
**Branch:** `dee-382-m7-event-attribution` → `dev`

## Architecture

M7 is post-hoc READ → ANALYZE → STORE for external market events:

- Operator batch fixture ingest → normalized event records
- Deterministic classification + attribution to price/pattern/trade windows
- Append-only confidence, explanations, market events, knowledge edges

## Confidence semantics

Descriptive co-occurrence tags (`supporting` / `contradicting` / `neutral`) — **not** P(profit), not PnL-sign based.

## Integration

Optional post-hook on `runResearchValidationBacktest` V2 (`eventAttribution.enabled`, default **false**).

Standalone: `runEventAttributionPass()`.
