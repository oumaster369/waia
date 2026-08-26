---
integrationIssue: DEE-630
integrationTitle: "Canonical EWMA return-squared baseline v2"
parentIssue: DEE-601
branch: dee-630-ewma-correction
riskTier: T3
prPolicy: one-integration-pr
authoritativeBase: 95e421b0026bafdcd4bf28f2fa23753d0fd2157f
---

# DEE-630 — Canonical EWMA baseline v2

## Frozen API and invariants

1. EWMA variance starts from the DEVELOPMENT sample variance and applies `0.94 × variance + 0.06 × r²` to raw 1m returns; adjacent returns are never differenced.
2. The latest window contains exactly 2000 observations at strictly increasing 60,000 ms timestamps. Missing timestamps, gaps, duplicates, reverse order, nulls and non-finite returns make EWMA unavailable.
3. Forecast volatility is `sqrt(variance) × sqrt(h)` for the existing 30m or 60m horizon.
4. The corrected baseline identity is `ewma-lambda094/v2`; v1 is not in the mandatory family. Research-harness and scientific-admission receipt identities advance to v2 so defective evidence cannot collide with corrected evidence.
5. Lambda, warm-up length, horizons, target grid, scoring, bootstrap, Holm and blind-holdout policy do not change. Decision, Risk, production/live and capital surfaces are excluded.

## Work packages

- DEE-738: corrected computation and fail-closed input contract.
- DEE-737: baseline/trial/receipt identity invalidation.
- DEE-736: known-answer, negative, scaling, replay and integration evidence.

## Validation

Focused and negative tests run continuously. The frozen exact head requires lint, typecheck, build, one fresh SQLite full suite, exact-head independent review with zero P1/P2, authoritative CI/PostgreSQL and DEE-653 before squash merge.
