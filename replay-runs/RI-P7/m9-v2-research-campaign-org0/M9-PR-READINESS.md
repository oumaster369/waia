# M9 PR Readiness

**Linear:** DEE-384  
**Branch:** `dee-384-m9-v2-research-campaign` → `dev`  
**Risk tier:** T2

## Summary

- Wires v2 metrics (`2.0.0`), configurable portfolio, lifecycle recorder, and optional guardian/exit evidence through RI orchestrator.
- Adds `pnpm trader:m9:campaign` with operator authorization gates and candidate duplicate preflight.
- M9 vault artifacts + operator runbook under `replay-runs/RI-P7/m9-v2-research-campaign-org0/`.
- **No campaign execution during Build** — VALIDATION.md remains template until operator phase.

## Linked issue / plan

**Linear:** `DEE-384` (proposed — groom at PR open)

**Plan:** `.cursor/plans/m9_v2_research_campaign_bb3822c5.plan.md`

## Risk tier

**Tier:** T2

## Merge strategy

**Merge strategy:** squash

## ADR

ADR: n/a (M9 program milestone; no new migrations)

## Human gate / ambiguity

**Architectural ambiguity surfaced during work:** no

## Migration impacted

no

## Test plan

- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test --run` passes
- [ ] `pnpm build` passes
- [ ] `pnpm test --run tests/unit/trader-research-m9-*` passes
- [ ] `./scripts/linear/preflight-pr-governance.sh` at PR open

## Staging discipline

Stage M9 manifest only — no unrelated replay-runs, no `.env*`.

## Human merge instruction

Squash merge to `dev` after CI green and review. Do not merge to `main`. Operator campaign is a **separate phase** requiring explicit authorization.

## Build agent stop condition (S3)

PR readiness delivered → **stop**. Do not run `pnpm trader:m9:campaign`, do not fill VALIDATION.md with campaign results, do not mark completion plan `m9` completed.
