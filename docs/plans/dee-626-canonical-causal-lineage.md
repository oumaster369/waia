---
integrationIssue: DEE-626
integrationTitle: "Canonical Causal Hypothesis / Forecast Lineage"
parentIssue: DEE-601
branch: dee-626-causal-lineage
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  - exact-pit-causal-lineage
  - deterministic-replay-and-mutation
  - hypothesis-to-forecast-byte-identity
  - missing-mismatch-cutoff-fail-closed
  - one-full-fresh-sqlite-suite
  - postgres-parity
  - independent-exact-head-review
  - dee-653-exact-head-admission
approvalGates:
  - t3-scope-preauthorized
  - integration-ready
  - dee-653-exact-head-admission
state:
  status: in-progress
  completedWorkPackages: []
  remainingWorkPackages: [DEE-727, DEE-728, DEE-729, DEE-730]
provenance:
  authoritativeBase: 5f13652acb23b2ce6bb1d698b513c3cb4c456fad
---

# DEE-626 — Canonical causal lineage

## Frozen API and invariants

1. `CanonicalCausalLineageV1` is additive and content-addressed. It binds exact organization, symbol, PIT anchor, runtime Knowledge derivation/state digests, Hypothesis identity/definition, supporting and contradicting Evidence refs with content/event/ingest identity, Knowledge refs, invalidation and supersession.
2. The canonical JSON and content digest propagate byte-identically from `MarketHypothesis` to `TraderIntelligenceHypothesisRecord` to `TraderIntelligenceForecastRecord`.
3. Missing JSON/digest pairs, unsupported derivation, non-canonical JSON, scope mutation, digest mutation and Evidence later than the Forecast cutoff fail closed to no Forecast.
4. Semantic terminal/reason codes remain outside the immutable causal ref bundle. They cannot rewrite lineage.
5. Evidence outside the selected Hypothesis does not perturb its lineage.
6. Legacy diagnostic hypotheses carry null lineage and cannot produce a canonical Forecast.
7. This train changes no numeric model, Decision, Risk, source, holdout, security, production/live or capital authority.

## A → B → C → D

- DEE-727 freezes `CanonicalCausalLineageV1` and validation.
- DEE-728 derives per-Hypothesis lineage from the exact DEE-629 PIT authority and preserves it in the cycle record.
- DEE-729 binds Forecast identity/content to the same byte-identical lineage and fails closed on every mismatch.
- DEE-730 closes PostgreSQL persistence/read parity, replay/mutation negatives, inventory and integration evidence.

## Validation

Focused negative tests run after each wave. After semantic completion and independent review, run exactly one fresh migrated SQLite full suite, PostgreSQL parity, CI and DEE-653 before squash merge.

Rollback is one revert of the squash merge plus the additive nullable PostgreSQL columns. Existing legacy rows remain valid with null lineage and cannot acquire canonical Forecast authority.
