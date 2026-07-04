# M6 Pattern Catalog — Design

**Linear:** DEE-381  
**Branch:** `dee-381-m6-pattern-catalog` → `dev`

## Architecture

M6 is a post-hoc READ → ANALYZE → STORE layer:

- Consumes ACTIVE `MiPattern` registry, MSV features, lifecycle closes, and backtest rejection events
- Produces append-only score events, price-move explanations, market events, and knowledge edges
- Does not modify Guardian, paper-cycle execution, backtest metrics, or strategy evaluation

## Scoring v1

Deterministic match score from MSV physics + pattern `recurrence.params`:

- `zscoreAbsMin`, `volMin`, `eventRiskMax`
- Output bounded `[0,1]` via fixed-point math

## Confidence v1

Beta-style posterior over supporting/contradicting/neutral outcome tags.

**Not a probability of success** — descriptive historical consistency only.

## Aging v1

`relevanceScore = matchScore * 0.5^(ageBars/halfLifeBars)`

## Knowledge edges

Insert-only relation kinds:

- `pattern_associated_with_close`
- `pattern_associated_with_rejection`

## Integration

Optional post-hook on `runResearchValidationBacktest` V2 path (`patternCatalog.enabled`, default **false**).

Standalone entrypoint: `runPatternCatalogPass()`.
