# M4 Dynamic SL/TP — PR Readiness

**Linear:** DEE-379  
**Branch:** `dee-379-m4-dynamic-sl-tp` → `dev`  
**Risk tier:** T2

## Summary

- Adds `lib/trader/exits/*` — deterministic ATR-based SL/TP + trailing stop math.
- Composes into Position Guardian via `createSlTpGuardianRuleProvider`.
- Opt-in via `PaperCycleInput.guardian.exitEngine`; M3 unchanged when disabled.
- Populates `GuardianReasonRecord.slTpLevels` when ATR/plan valid.

## Linked issue / plan

**Linear:** `DEE-379`

**Linear groom verified:** yes (DEE-379 created via MCP 2026-07-04)

**Plan:** `.cursor/plans/m4_dynamic_sl_tp_34b74d24.plan.md`

## Risk tier

**Tier:** T2

## Merge strategy

**Merge strategy:** squash

## ADR

ADR: n/a (M4 program milestone; aligns with Master Spec exit path; no new ADR)

## Human gate / ambiguity

**Architectural ambiguity surfaced during work:** no

## Migration impacted

no

## Test plan

- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test --run` passes
- [x] `pnpm build` passes
- [x] `pnpm test --run tests/unit/trader-exits-` passes
- [x] `pnpm test --run tests/unit/trader-guardian-` passes
- [x] `pnpm test --run tests/unit/trader-paper-cycle-runner.test.ts -t "M4"` passes
- [ ] `./scripts/linear/preflight-pr-governance.sh` at PR open

## Staging discipline

Stage **only** M4 manifest:

- `lib/trader/exits/**`
- `lib/trader/guardian/guardian-reason-record.types.ts`
- `lib/trader/guardian/evaluate-position-guardian.ts`
- `lib/trader/guardian/index.ts`
- `lib/trader/paper/paper-cycle.types.ts`
- `lib/trader/paper/paper-cycle-runner.ts`
- `lib/trader/index.ts`
- `tests/unit/trader-exits-*.test.ts`
- `tests/unit/trader-paper-cycle-runner.test.ts` (M4 block)
- `replay-runs/RI-P7/m4-dynamic-sl-tp-org0/**`

## Human merge instruction

Squash merge to `dev` after CI green and review. Do not merge to `main`.
