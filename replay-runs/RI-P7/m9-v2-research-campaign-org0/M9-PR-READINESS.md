# M9 PR Readiness

**Linear:** DEE-384 (build), DEE-385 (operator)  
**Status:** **CLOSED** — build + operator merged; campaign blocked by accounting defect  
**Closure:** `M9-ENGINEERING-CLOSURE.md`

## Summary

- Wires v2 metrics (`2.0.0`), configurable portfolio, lifecycle recorder, and optional guardian/exit evidence through RI orchestrator.
- Adds `pnpm trader:m9:campaign` with operator authorization gates and candidate duplicate preflight.
- M9 vault artifacts + operator runbook under `replay-runs/RI-P7/m9-v2-research-campaign-org0/`.
- Build PR #371 merged @ `87e5fb8`; operator PR #372 merged @ `a9c416a`.
- Operator campaign executed; **no success bundle** — `M9_BLOCKED_BY_ACCOUNTING_DEFECT`.

## Linked issue / plan

**Linear:** `DEE-384` (build, Done), `DEE-385` (operator, Done)

**Plan:** `.cursor/plans/m9_v2_research_campaign_bb3822c5.plan.md` (build phase)

## Risk tier

**Tier:** T2

## Merge strategy

**Merge strategy:** squash (completed)

## ADR

ADR: n/a (M9 program milestone; no new migrations)

## Human gate / ambiguity

**Architectural ambiguity surfaced during work:** no (build). Operator campaign surfaced **accounting defect** — documented in `M9-FORENSIC-REPORT.md`.

## Migration impacted

no

## Test plan (build — completed)

- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test --run` passes
- [x] `pnpm build` passes
- [x] `pnpm test --run tests/unit/trader-research-m9-*` passes
- [x] `./scripts/linear/preflight-pr-governance.sh` at PR open

## Operator phase (completed with blocker)

- [x] Campaign executed with operator authorization
- [x] `VALIDATION.md` finalized
- [x] Forensic + execution records written
- [ ] Success evidence bundle — blocked

## Next engineering step

PR1 Canonical Position Ledger → PR2 Spot Lifecycle Hardening → repeat M9.

## Human merge instruction

Build and operator PRs **merged**. No further M9 PRs until repeat M9 after PR1 + PR2.
