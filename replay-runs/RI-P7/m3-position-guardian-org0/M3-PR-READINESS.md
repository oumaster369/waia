# M3 Position Guardian — PR Readiness

**Linear:** DEE-378  
**Branch:** `dee-378-m3-position-guardian` → `dev`  
**Risk tier:** T2  
**Independent audit:** PASS WITH NON-BLOCKING REMARKS — pre-PR remediation applied 2026-07-04

## Summary

- Adds `lib/trader/guardian/*` — pure per-bar position monitor with permission/regime/structural exit rules (no SL/TP).
- Records `GUARDIAN_EVALUATED` and `GUARDIAN_EXIT_INTENT` lifecycle events with `waia.trader.guardian-reason.v1` payloads.
- Wires guardian into `runPaperCycleOnce` only — runs on no-signal bars when open lots exist; dispatches sell exits before strategy entries.
- Opt-in via `PaperCycleInput.guardian`; legacy cycles unchanged when disabled.
- **Pre-PR remediation:** extended paper-cycle integration tests to prove orchestration-path lifecycle events, exit-intent-before-submit ordering, `TRADE_CLOSED` after guardian sell, `maxHoldBars` exit, and per-test SQLite isolation (no production code changes).

## Linked issue / plan

**Linear:** `DEE-378`

**Linear groom verified:** n/a — groom attempted via MCP; branch/issue naming follows DEE-378 convention pending human Linear sync

**Plan:** `.cursor/plans/m3_position_guardian_becd5486.plan.md`

## Risk tier

**Tier:** T2

## Merge strategy

**Merge strategy:** squash

## ADR

ADR: n/a (M3 implements AI-Trader program milestone per implementation plan; no new ADR required)

## Human gate / ambiguity

**Architectural ambiguity surfaced during work:** no

## Migration impacted

no — M1 lifecycle enum already includes GUARDIAN phases; no schema migration

## Test plan

- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test --run` passes
- [x] `pnpm build` passes
- [x] `pnpm test --run tests/unit/trader-guardian-` passes
- [x] `pnpm test --run tests/unit/trader-paper-cycle-runner.test.ts -t "M3"` passes (3 cases: close-only lifecycle path, HOLD, maxHoldBars)
- [x] Independent audit remediation: GUARDIAN_* lifecycle + TRADE_CLOSED + call-order + per-test DB isolation
- [ ] `./scripts/linear/preflight-pr-governance.sh` on rendered PR body at PR open (see below)

## Regression guarantees

- M0 closed-trade forensic test unchanged
- M1 lifecycle pairing / tenant isolation tests green
- M2 portfolio sizing tests green
- Guardian disabled path preserves prior paper-cycle behaviour (implicit legacy tests)
- Orchestration-path lifecycle closure proven in paper-cycle integration tests (post-audit remediation)

## Staging discipline

Stage **only** M3 manifest files — do **not** `git add -A`. Include:

- `lib/trader/guardian/**`
- `lib/trader/lifecycle/lifecycle-recorder.ts`, `lib/trader/lifecycle/index.ts`
- `lib/trader/paper/paper-cycle.types.ts`, `lib/trader/paper/paper-cycle-runner.ts`
- `lib/trader/index.ts`
- `tests/unit/trader-guardian-*.test.ts`
- `tests/unit/trader-lifecycle-recorder-guardian.test.ts`
- `tests/unit/trader-paper-cycle-runner.test.ts` (M3 block only in diff)
- `replay-runs/RI-P7/m3-position-guardian-org0/**`

Exclude pre-existing untracked `replay-runs/**` evidence outside this directory.

## Human merge instruction

Squash merge to `dev` after CI green and architectural review. Do not merge to `main` from this PR.

## Post-merge

No release promotion required. Next milestone: M4 exit intelligence / Worker guardian wiring (separate Linear issues).

## Governance preflight

```bash
PR_TITLE="DEE-378 feat(trader): M3 position guardian" \
PR_BRANCH="dee-378-m3-position-guardian" \
PR_BASE="dev" \
./scripts/linear/preflight-pr-governance.sh --body-file replay-runs/RI-P7/m3-position-guardian-org0/M3-PR-READINESS.md
```

See **Governance preflight result** section appended after local run.

## Agent attribution

Cursor agent implementation per M3 plan (DEE-378).

---

## Governance preflight result

```
PASS: PR body satisfies P0 governance preflight
```

Run: 2026-07-04 · `PR_TITLE="DEE-378 feat(trader): M3 position guardian"` · `PR_BRANCH="dee-378-m3-position-guardian"` · `PR_BASE="dev"`
