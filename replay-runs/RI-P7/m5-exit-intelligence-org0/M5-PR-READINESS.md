# M5 Exit Intelligence — PR Readiness

**Linear:** DEE-380  
**Branch:** `dee-380-m5-exit-intelligence` → `dev`  
**Risk tier:** T2

## Summary

- Adds `lib/trader/intelligence/m5/*` — pure reasoning overlay (`buildExitIntelligenceContext`).
- Attaches analytical scores + conflict metadata to `GuardianReasonRecord.exitIntelligenceContext`.
- Opt-in via `PaperCycleInput.guardian.exitIntelligence`; M3/M4 unchanged when disabled.
- Bumps reason record schema to `waia.trader.guardian-reason.v2`.

## Linked issue / plan

**Linear:** `DEE-380`

**Linear groom verified:** yes (DEE-380 created via MCP 2026-07-04)

**Plan:** `.cursor/plans/m5_exit_intelligence_3efb7229.plan.md`

## Risk tier

**Tier:** T2

## Merge strategy

**Merge strategy:** squash

## ADR

ADR: n/a (M5 program milestone; reasoning overlay only; no new ADR)

## Human gate / ambiguity

**Architectural ambiguity surfaced during work:** no

## Migration impacted

no

## Test plan

- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test --run` passes
- [x] `pnpm build` passes
- [x] M5 unit + guardian + paper integration tests pass
- [ ] `./scripts/linear/preflight-pr-governance.sh` at PR open

## Staging discipline

Stage **only** M5 manifest:

- `lib/trader/intelligence/m5/**`
- `lib/trader/intelligence/index.ts`
- `lib/trader/guardian/guardian-reason-record.types.ts`
- `lib/trader/guardian/evaluate-position-guardian.ts`
- `lib/trader/guardian/index.ts`
- `lib/trader/paper/paper-cycle.types.ts`
- `lib/trader/paper/paper-cycle-runner.ts`
- `tests/unit/trader-exit-intelligence-*.test.ts`
- `tests/unit/trader-guardian-exit-intelligence.test.ts`
- `tests/unit/trader-guardian-exit-intent-mapper.test.ts`
- `tests/unit/trader-lifecycle-recorder-guardian.test.ts`
- `tests/unit/trader-paper-cycle-runner.test.ts` (M5 block)
- `replay-runs/RI-P7/m5-exit-intelligence-org0/**`

## Human merge instruction

Squash merge to `dev` after CI green and review. Do not merge to `main`.
