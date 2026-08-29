---
integrationIssue: DEE-634
integrationTitle: "Decision V2 Sole Capital Authority"
parentIssue: DEE-601
branch: dee-634-current-main-rebuild
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [focused-negative-tests, consumer-graph, parity, typecheck, production-build, one-full-fresh-migrated-sqlite-suite, independent-exact-head-review, authoritative-postgres-and-dee-653]
approvalGates: [ratified-dee-634-contract, exact-head-independent-review, dee-653-exact-head-admission]
includedIssues: [DEE-634, DEE-780, DEE-778]
authoritativeBase: 75a659bd9e8f4d19e21e00e7e349d073d458002d
state: frozen
provenance:
  createdFrom: ratified-dee-634-build
  authoritativeBase: 75a659bd9e8f4d19e21e00e7e349d073d458002d
  admissionAudit: "Fresh origin/main, Linear duplicate/ownership/dependency audit, and frozen Integration Train admission preceded semantic implementation."
---

# DEE-634 — Decision V2 sole actionability and economics authority

## Frozen public boundary

`ForecastRuntimeAuthorizedOutcomeV2 → Decision V2 economic action or terminal NO_TRADE → exact qualified intent/size → RiskVerdictV2/RiskAllowanceV2 → ExecutionPlanV2/ExecutionAttemptV2`.

Strategy output is diagnostic/tactical context only. `StrategySignal.confidence`, `expectedEdge` and `maxRisk` have no authority to create or improve a Decision, Risk permission, allowance, plan, attempt or order.

## Invariants

- exactly one authoritative Decision V2 outcome exists for an executable organization/account/symbol/cycle;
- only an exact admitted Forecast V2 with verified scientific admission may reach Decision economics;
- `TRADE` requires the frozen economic policy and `EV_lower > 0`; otherwise `NO_TRADE` is terminal and reason-coded;
- Decision owns actionability and qualified economic sizes; Risk may veto or reduce only within that set and can never manufacture actionability or improve economics;
- Execution consumes an exact current RiskAllowance V2 and compatible sealed plan; it cannot choose economic merit;
- normal paper and live-equivalent paths cannot map StrategySignal directly to an executable request;
- replay/historical/paper/live-equivalent semantics are identical for identical sealed inputs; qualification produces no live venue effect and uses no real capital.

## Persistence and rollback

Reuse the existing append-only Decision V2, Risk V2 and Execution V2 stores and transaction boundaries. No new scientific formula, Risk policy, venue policy or live/capital authorization is introduced. Rollback is one squash revert; already durable evidence is never rewritten.

## Validation

Run focused positive/negative/degenerate economics and authority-chain tests continuously. DEE-778 also refreshes only the exact existing Execution V2 and Reality V2 consumer-inventory pins affected by the admitted cutover; this is proof-only and introduces no production or protected Reality semantics. Before publication require whole-repository forbidden-consumer proof, paper/live-equivalent parity, PostgreSQL atomic and rollback/concurrency negatives where touched, typecheck, lint, build, one fresh migrated SQLite full suite and exact-head independent review with zero P1/P2. Merge only after authoritative CI and DEE-653 pass.

## Acceptance

- Forecast V2 is the sole source of Decision V2 actionability and economics; Strategy output remains non-authoritative context.
- Decision, Risk and Execution identities bind exactly through the submitted Order row and fail closed on every mismatch.
- Paper and live-equivalent paths preserve identical sealed-input authority semantics without enabling live trading or real capital.
- Focused and negative tests, consumer-graph and parity proofs, PostgreSQL gates, typecheck, lint, production build, one literal fresh-migrated SQLite suite, exact-head independent review, authoritative CI and DEE-653 pass before squash merge.
