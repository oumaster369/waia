# M2 Deposit / Portfolio / Risk Sizing — PR Readiness

**Linear:** [DEE-377](https://linear.app/deepsense/issue/DEE-377)  
**Branch:** `dee-377-m2-portfolio-risk-sizing` → `dev`  
**Risk tier:** T2

## Summary

- Adds `lib/trader/portfolio/*` — USDT spot deposit ledger, stop-based sizing, `StopDistanceProvider` boundary.
- Extends `trader_risk_limits` with portfolio risk columns (SQLite 0039 / Postgres 0069).
- Wires portfolio sizing into backtest, research v2, paper cycle, and paper loop env config.
- Capital evaluator + risk engine enforce concurrent positions, portfolio risk cap, available balance, invalid stop distance.
- Post-audit remediation: paper-cycle portfolio account sync, integration tests, tenant column isolation tests, honest artifacts.

## Test plan

- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test --run`
- [x] `pnpm build`
- [ ] `./scripts/linear/preflight-pr-governance.sh` on rendered PR body (human/agent at PR open)

## Regression guarantees

- M0 forensic test unchanged
- M1 lifecycle tests green
- v2 research metrics parity with generous deposit fixture

## Staging discipline

Stage **only** M2 manifest files — do **not** `git add -A`. Exclude pre-existing untracked `replay-runs/**` evidence (see list below).

## Human merge instruction

Squash merge to `dev` after CI green and architectural review. Do not merge to `main` from this PR.

## Post-merge

No release promotion required. Continue AI-Trader program per Linear backlog.

## Deferred (documented, not PR blockers)

- Legacy `deriveAccountRiskStateFromMockOrders` for v1/fixture paths
- Paper loop static limit defaults (org limits service at runtime)
- M4 provider swap for final stop distance
