---
integrationIssue: DEE-624
integrationTitle: "Remove residual legacy realizedVol20 consumers"
branch: dee-624-realized-vol-consumers
riskTier: T3
prPolicy: one-issue-one-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [focused-rv-and-consumer-tests, typecheck, lint, build, canonical-governance, exact-head-review]
approvalGates: [human-ratified-dee-624m-split, dee-653-exact-head-admission]
state:
  status: locally-validated
  currentWorkPackage: null
  completedWorkPackages: [DEE-624]
  remainingWorkPackages: []
provenance:
  authoritativeBase: 91628d4987f2ac3305d272c5ac8f2596c8d41f54
  predecessor: docs/plans/dee-742-rv-measurement-schema.md
---

# DEE-624 — residual `realizedVol20` consumer repair

## Admitted disposition

DEE-742 proved that legacy `realizedVol20` is exactly price-level sample
dispersion and froze the downstream inventory until DEE-634. DEE-634 is now
Done and makes Decision V2 the sole capital economics authority. This repair
therefore removes the ambiguous runtime identity without inventing replacement
economics:

1. Runtime Feature/MSV/Event/MI/Strategy V0 surfaces use the honest
   `priceDispersion20` identity for the existing price-dispersion value.
2. Canonical return volatility remains exclusively `realizedVol20m_1m`, with
   variance `realizedVar20m_1m`; formulas, availability, PIT and rounding do
   not change.
3. Strategy V0 expected-edge fields remain non-authoritative research/tactical
   proposal context. They are not converted mechanically to return volatility
   and cannot authorize capital under the DEE-634 consumer graph.
4. Historical replay evidence is immutable compatibility data and is not
   rewritten. Read-only audit tooling labels the legacy serialized value as
   price dispersion.

## Acceptance proof

- No executable runtime type or consumer exposes `realizedVol20`.
- A repository inventory test permits the name only in explicit immutable
  compatibility evidence, migration documentation, and negative assertions.
- Known-answer, missing/gap, PIT-prefix and parity tests keep the exact RV v2
  measurement contract.
- Strategy/Event/MI behavior is byte-semantic-equivalent under the renamed
  price-dispersion field.
- Existing DEE-634 authority tests prove Strategy V0 output cannot authorize
  an order request.
- Typecheck, lint, build, authoritative CI, exact-head review and DEE-653 pass
  before merge.

## Exclusions

No Decision economics, Risk, Execution, database migration, live/production,
holdout, secret or capital action is in scope.
