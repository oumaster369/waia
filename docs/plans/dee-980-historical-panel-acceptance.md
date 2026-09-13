---
integrationIssue: DEE-980
integrationTitle: "Offline paired historical projection diagnostics and operator handoff"
branch: dee-980-historical-panel-acceptance
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [focused-unit, lint, typecheck, build, canonical-docs, independent-review]
approvalGates: [integration-ready, verified-merge, separate-production-execution]
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  blockedReason: null
provenance:
  authoritativeBase: 5aee44883454551760c889129577615737aa5b80
  createdFrom: user-authorized-parallel-acceptance-work
---

# DEE-980 — bounded offline diagnostic, not historical readiness

## Scope and ownership

Implement a pure local comparator for two explicit JSON exports of the existing
HistoricalObservableProjectionV2. Backend-only, no HTTP/database/credential access,
launching, science, migration, deployment or upstream authority modifications.
No changes to the existing running preparation on release 90de233a.

Compare a completed single-account capture for explicit org/run/account/extent.
Reject malformed, oversized, wrong-scope, missing/duplicate/inconsistent cycles.
Only root observedAt/eventId are transport metadata; all lifecycle timestamps,
digests, nested economics, evidence and array ordering remain significant.
Strictly compare the complete accepted JSON body, without floating tolerances.

MATCH means matching supplied projection bodies only. It does not authenticate
the exporter, validate scientific evidence seals, prove independent executions,
UI rendering/stream freshness, economic correctness or qualify a strategy.
Equal fabricated exports cannot establish any of those properties. The actual
authenticated paired capture, runtime and independent-repeat gates remain open.
The offline bound is explicit: 32 MiB per JSON, depth 96, 500,000 values and up to
1,000 cycles. A refused large export is not a passing acceptance result.

## Acceptance

All complete same-scope exports match only when every non-transport field is equal.
Malformed or incomplete equal exports are refused. Parent readiness remains open.

## Work packages

1. RED/green comparison tests, then read-only diagnostic implementation.
2. Source-pinned operator handoff from existing local DEE-920 draft, independent
   verification of links/flags and shell syntax only. Keep old WIP intact.

## Validation

Scoped unit/read-model regression tests; lint/typecheck/build; docs syntax;
independent exact-diff review and unchanged GitHub gates before publication.
No full local unit suite duplicated solely for PR CI. DEE-920 remains open.

## Local evidence — 2026-09-10

- 54 focused tests PASS: comparator 34, actual read-model producer fixtures 6,
  routes 5, pending modeled orders 9. No real run or authenticated capture claimed.
- Typecheck, scoped lint, canonical plan validation and PR governance regressions PASS.
  Full lint zero errors / 307 existing warnings; production build PASS. GitHub full
  exact-head unit/build/E2E gates remain required, not inferred from local checks.
- Test-first and review regressions preserved: missing module, aggregate mismatch,
  numeric rounding, duplicate JSON members, missing object stages, and stripped
  opaque __proto__ member each reproduced before correction; none relabelled PASS.
- Final independent bounded review: no proven P1/P2; comparator blob
  aa02c7baaabd6dbddec2ef589ab5d77cd2ba12ad, focused tests
  c5769e50b5381ed40209428bf39d271c2a61e680. Not whole-system certification.
- Operator templates source-checked against release 90de233a and base 5aee4488;
  bash syntax verified only, never executed. Initial-state archive/repeat boundary
  explicitly stops monolithic launch unless independently resolved or deferred.
