---
integrationIssue: DEE-624
integrationTitle: "Hermetic SQLite settlement reconciliation health-route bootstrap"
branch: dee-624-hermetic-settlement-bootstrap
riskTier: T1
prPolicy: one-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [focused-unit, full-unit, lint, typecheck, build, canon, pr-governance, independent-exact-head-review, dee-653]
approvalGates: [independent-exact-head-review, dee-653]
state:
  status: admitted
  blockedReason: "Linear child creation awaits explicit user approval after connector risk rejection"
provenance:
  authoritativeBase: 56ba1ddc262204ca2cd2d2732756e509c856b743
  createdFrom: user-authorized-ai-trader-program-controller
---

# DEE-624 — hermetic settlement health bootstrap

## Outcome

The settlement reconciliation health-route unit test provisions its own fresh, fully migrated SQLite database. It no longer depends on persistent state in a developer checkout.

## Boundaries

- Test fixture/setup only.
- No production route, schema, migration or settlement semantics change.
- No assertion weakening or skip.
- No live, capital, holdout or production action.

## Evidence baseline

On exact base `56ba1ddc262204ca2cd2d2732756e509c856b743`, a literal fresh full suite completed with 5,148 passing tests, 431 skipped tests and one failure: `no such table: trader_settlement_reconciliation_cases`. The failure reproduces when the single test runs against a fresh checkout.

## Verification

- Prove the SQLite file does not exist before fixture migration and does exist afterward.
- Run the health-route/SQLite focused suite.
- Run literal full fresh suite, typecheck, lint, build, canon and PR governance.
- Require independent exact-head review, authoritative CI, applicable PostgreSQL gate and DEE-653 before merge.
