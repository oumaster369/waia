---
integrationIssue: DEE-742
integrationTitle: "RV v2 legacy-consumer inventory"
parentIssue: DEE-624
branch: dee-742-rv-measurement-schema
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [inventory-test, canonical-governance, exact-head-review]
approvalGates: [human-ratified-dee-624m-split, dee-653-exact-head-admission]
state:
  status: frozen-inventory
  completedWorkPackages: [DEE-743]
  remainingWorkPackages: []
provenance:
  authoritativeBase: 36929bba3f46ec79002ef45f2a04dce8e86593c4
  owningPlan: docs/plans/dee-742-rv-measurement-schema.md
---

# DEE-742 — `realizedVol20` consumer inventory

This inventory freezes the Human-ratified DEE-624M boundary. In RV v2,
`realizedVol20` is a compatibility name for price-level sample dispersion and is
always exactly equal to `priceDispersion20`. It is not return-based realized
volatility. Correct return measurements are `realizedVar20m_1m` and
`realizedVol20m_1m`.

## Compatibility producer and proof surfaces

- `lib/trader/intelligence/types.ts` — legacy optional compatibility shape plus
  required `FeatureVectorRvV2` / `FeatureSnapshotRvV2` producer contract.
- `lib/trader/intelligence/feature-engine-v0.ts` — sole producer; exact alias
  assignment `realizedVol20 = priceDispersion20`.
- `lib/trader/intelligence/feature-engine-parity.ts` — live/backtest comparison;
  compares the alias and all three canonical RV v2 identities independently.

## Frozen downstream consumers — deferred to parent DEE-624 after DEE-634

No file below is changed or reinterpreted by DEE-742. They remain quarantined
behind the later Decision/consumer-authority disposition:

- Strategy V0: `strategies/mean-reversion-v0.ts`,
  `strategies/liquidity-sweep-reversal-v0.ts`,
  `strategies/trend-momentum-v0.ts`.
- MSV bridge: `analytical-layers-v0.ts`.
- Event V0: `events/event-attribution-pass.ts`,
  `events/event-attribution-rules.ts`, `events/event-attribution.types.ts`,
  `events/event-classifier.ts`.
- MI pattern catalog V0: `mi/pattern-catalog-pass.ts`,
  `mi/pattern-catalog-scoring.ts`, `mi/pattern-catalog.types.ts`.

These consumers receive price-dispersion semantics only. DEE-742 does not claim
that they are authoritative return-volatility or economic-edge consumers.

## Research-only tooling

- `scripts/trader/audit-dataset-regime-coverage-readonly.ts` reads the legacy
  snapshot field for a read-only historical coverage report. It has no runtime,
  Decision, execution or capital authority and remains unchanged.

## Enforcement

`tests/unit/feature-engine-rv-v2-inventory.test.ts` fails when an unclassified
runtime occurrence appears, so any future consumer requires explicit ownership
and semantic disposition rather than silently inheriting the ambiguous name.

## Acceptance

- Every runtime `realizedVol20` occurrence is listed and classified.
- New runtime occurrences fail the inventory test.
- The inventory changes no consumer, formula, authority or protected surface.
