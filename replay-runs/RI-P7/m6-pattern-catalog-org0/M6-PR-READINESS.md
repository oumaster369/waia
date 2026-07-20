# M6 PR Readiness

**Linear:** DEE-381  
**Branch:** `dee-381-m6-pattern-catalog` → `dev`  
**Risk tier:** T2

## Staging discipline

- `lib/trader/mi/pattern-catalog-*`
- `lib/trader/mi/pattern-score-repository-postgres.ts`
- `lib/trader/mi/serialize-pattern-catalog.ts`
- `lib/trader/knowledge/pattern-knowledge-relation-kinds.ts`
- `lib/trader/knowledge/price-move-explanation.types.ts`
- `lib/trader/knowledge/price-move-explanation-repository-postgres.ts`
- `lib/trader/knowledge/record-pattern-knowledge.ts`
- `lib/trader/research/research-backtest-runner.ts` (optional post-hook only)
- `db/migrations_postgres/0070_*`, `0071_*`, `schema.postgres.ts`, journal
- `tests/unit/trader-pattern-catalog-*`
- `tests/unit/trader-pattern-knowledge-edges.test.ts`
- `replay-runs/RI-P7/m6-pattern-catalog-org0/**`

## Linked issue / plan

**Linear:** `DEE-381`  
**Plan:** `.cursor/plans/m6_pattern_catalog_f5e406ec.plan.md`

## Risk tier

**Tier:** T2

## Merge strategy

**Merge strategy:** squash

## ADR

ADR: n/a (M6 program milestone; knowledge layer only)

## Human gate / ambiguity

**Architectural ambiguity surfaced during work:** no

## Migration impacted

yes — Postgres `0070_trader_mi_pattern_catalog`, `0071_trader_mi_pattern_catalog_rls`

## Safety statement

M6 introduces no changes to Guardian decision logic, exit math, order placement, Risk Engine behavior, or paper-cycle execution paths. It adds a deterministic, append-only pattern scoring and explanation layer that writes knowledge edges for trade closes and signal rejections. Default-off; no promotion or autonomous trading behavior.
