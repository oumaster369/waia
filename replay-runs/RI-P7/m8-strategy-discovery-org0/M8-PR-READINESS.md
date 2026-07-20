# M8 Strategy Discovery — PR Readiness

**Linear:** DEE-383  
**Branch:** `dee-383-m8-strategy-discovery` → `dev`  
**Risk tier:** T2

## Summary

- Adds M8 discovery substrate (`lib/trader/discovery/*`), parametric generator (`lib/trader/generator/*`), human actuation bridges, Postgres 0074/0075, and operator-invoked CLI (`pnpm trader:discovery:run`, default disabled).
- Ratifies NO-REINFORCEMENT-LEAKAGE policy + ADR-0020; comparator ranks on epistemic dimensions only.
- No changes to M1–M7 runtime modules (guardian, exits, events, paper-cycle decision paths).

## Linked issue / plan

**Linear:** `DEE-383`

**Linear groom verified:** yes (DEE-383 groomed via MCP)

**Plan:** `.cursor/plans/m8_strategy_discovery_3fa32d0e.plan.md`

## Risk tier

**Tier:** T2

## Merge strategy

**Merge strategy:** squash

## ADR

[`docs/adr/0020-m8-discovery-architecture-no-reinforcement.md`](../../../docs/adr/0020-m8-discovery-architecture-no-reinforcement.md)

## Human gate / ambiguity

**Architectural ambiguity surfaced during work:** no

## Migration impacted

yes — apply `0074_trader_discovery_substrate.sql` and `0075_trader_discovery_substrate_rls.sql` on target Postgres before staging discovery CLI.

## Test plan

- [x] `pnpm lint` passes (warnings only, pre-existing)
- [x] `pnpm typecheck` passes
- [x] `pnpm test --run tests/unit/trader-discovery-* tests/unit/trader-generator-*` passes
- [x] `pnpm test --run tests/unit/trader-guardian- tests/unit/trader-exits- tests/unit/trader-paper-cycle-runner.test.ts` passes
- [x] `pnpm build` passes
- [ ] `./scripts/linear/preflight-pr-governance.sh` at PR open

## Staging discipline

Stage M8 manifest only — exclude unrelated `replay-runs/RI-P7/m6-pattern-catalog-org0/M6-M7-BOUNDARY.md`.

## Human merge instruction

Squash merge to `dev` after CI green and review. Apply migrations 0074/0075 on staging Postgres. Do not merge to `main`.
