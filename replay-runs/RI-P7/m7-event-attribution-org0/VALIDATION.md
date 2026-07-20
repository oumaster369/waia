# M7 Validation

**Linear:** DEE-382  
**Branch:** `dee-382-m7-event-attribution` @ post-M6 `dev` (`fc4bbdb`)

| Gate | Result |
|------|--------|
| `pnpm typecheck` | pass |
| `pnpm lint` | pass (0 errors; pre-existing warnings only) |
| `pnpm test --run tests/unit/trader-event-*` | pass (11 tests) |
| `pnpm test --run` | pass (2153 passed, 89 skipped) |
| `pnpm build` | pass |

## Regression (M3–M6 unchanged modules)

Guardian, exits, pattern-catalog, and paper-cycle decision paths untouched. Full unit suite green including `trader-guardian-*`, `trader-pattern-catalog-*`, `trader-exits-*`, `trader-paper-cycle-runner`.

## Fix during validation

- Corrected `computeEventAttributionBreakdown` weighted-average divisor (`10n` not `10000n`) so attribution strength lands in [0,1] and threshold gate (0.25) works as designed.
