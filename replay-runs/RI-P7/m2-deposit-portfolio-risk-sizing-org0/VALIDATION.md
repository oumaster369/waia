# M2 Deposit / Portfolio / Risk Sizing — VALIDATION

**Linear:** DEE-377 · **Date:** 2026-07-04 · **Remediation:** post-audit

## Deterministic proofs

| Criterion | Evidence |
|-----------|----------|
| StopDistanceProvider contract + invalid pct | `tests/unit/trader-portfolio-stop-distance-provider.test.ts` |
| Stop-based sizing (caps, dust, invalid stop) | `tests/unit/trader-portfolio-stop-based-sizing.test.ts` |
| Fee-aware balance trim | `trimQtyToAffordable` tests in sizing suite |
| Ledger derivation (cash, fees, equity) | `tests/unit/trader-portfolio-account-state.test.ts` |
| AccountRiskState adapter | `tests/unit/trader-portfolio-account-risk-adapter.test.ts` |
| Legacy buy-only path documented | `tests/unit/trader-account-risk-state-from-orders.test.ts` |
| Capital limits (concurrent, portfolio risk, balance, invalid stop) | `tests/unit/trader-capital-limits-evaluator.test.ts` |
| Risk engine end-to-end reject codes | `tests/unit/trader-risk-engine-service.test.ts` (M2 section) |
| Risk limits schema (new columns) | `tests/unit/trader-risk-limits-schema.test.ts` |
| Risk limits service mapping | `tests/unit/trader-risk-limits-service.test.ts` |
| Tenant isolation (M2 columns org-scoped) | `tests/unit/trader-risk-limits-tenant-isolation.test.ts` |
| Paper cycle portfolio integration | `tests/unit/trader-paper-cycle-runner.test.ts` (M2 section) |
| Paper loop env wiring | `tests/unit/trader-paper-loop-worker.test.ts` |
| M0 forensic regression | `tests/unit/trader-closed-trade-attribution-forensics-m0.test.ts` (unchanged) |
| M1 lifecycle regression | `tests/unit/trader-lifecycle-*.test.ts` |

## Validation commands

```bash
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
./scripts/linear/preflight-pr-governance.sh   # at PR body render time
```

## Sizing behavior (verified)

1. **Buy sizing:** `qty = min(riskBudget/stopDistance, portfolioRiskCap/stopDistance, balance trim, notional cap, defaultQuantity)`.
2. **Dust:** qty below `minOrderQty` → skip with `PORTFOLIO_BELOW_MIN_QTY` (paper cycle: `no_submit`, no execution call).
3. **Concurrent cap:** capital evaluator rejects new symbol at cap (`RISK_MAX_CONCURRENT_POSITIONS`); paper cycle integration test uses real risk engine.
4. **Sell sizing:** pass-through close qty; capital evaluator unchanged for reduce-only paths.

## Intentionally deferred (not failures)

| Item | Notes |
|------|-------|
| Legacy `deriveAccountRiskStateFromMockOrders` | Retained for v1/fixture paths; portfolio adapter supersedes for M2 runners |
| Paper loop org limits source | Uses `DEFAULT_ORG_RISK_LIMITS` projection; production org overrides via limits service at runtime |
| M4 stop providers | `DefaultStopDistanceProvider` provisional (`RUN_DEFAULT_PCT`) |
| Byte-identical replay artifact hashes | Provider/sizing determinism covered by unit equality tests |

## Human review stop

M2 remediation complete — proceed to manifest commit + PR after human architectural review.
