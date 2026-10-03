---
integrationIssue: DEE-1150
integrationTitle: "AI-TRADER: bind capital envelope retries to the original command"
branch: dee-1150-envelope-command-identity
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, postgres-integration, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, exact-head-ci]
approvalGates: [independent-review, exact-head-ci]
state:
  status: in-progress
  currentWorkPackage: current-main-review
  completedWorkPackages: [command-identity-regression, implementation, native-proof, independent-review, current-main-rebase, current-base-focused-readiness]
  remainingWorkPackages: [exact-head-ci, merge]
  prNumber: null
  prUrl: null
  blockedReason: null
  nextAction: "Publish after the current serial queue; root source review is complete, and exact-head CI is required before merge."
provenance:
  createdFrom: user-authorized-ai-trader-audit-2026-10-01
  authoritativeBase: 5914d9f4dc37b7d78be4c5363b33b12d22d444c6
  supersedes: null
---

# DEE-1150 — capital envelope command identity

## Problem and result

An envelope stage retry currently resolves by organization/account/command ID
without first comparing the submitted command with the original sealed command.
A changed command can be reported as an idempotent success for an older envelope,
or reach invalidation logic. Capture the immutable envelope digest at the first
durable stage and reject mismatching retries before any journal, current-pointer,
basis or financial effect. Exact retries preserve their existing result.

## Scope and compatibility

Reuse the existing journal's nullable envelope digest; no schema or migration
change. Old histories with an exact SEALED/PUBLISHED digest remain readable.
A legacy CAPTURED-only history with no command digest cannot prove the original
payload and must refuse further advancement; it must not be rewritten or guessed.
Runtime-unknown stages refuse before SQL. Capture caller-owned command, observed
identity and qualification flag before the first await so later mutation cannot
change a stage or the multi-stage producer's command.

This does not grant source-method qualification, account authority, capital,
publication or live activation. Operator-supplied amounts and windows retain the
existing schemas and policy. Migration 0229 remains prohibited in production.

## Acceptance

RED/GREEN cases cover same-ID changed amounts/policy/window, published-command
replay, legacy captured-only refusal, exact old sealed replay, invalid runtime
stages and mutation during an awaited stage. Native PostgreSQL proof must show
the invalid command leaves the original journal/current/basis and allowance/order
counts unchanged, exact retry remains idempotent, and the original valid command
can still complete. Then scoped readiness, independent review and exact-head CI.

## Current validation

The original source failed six focused command-identity/stage regressions. Independent review also reproduced mutable-command leakage into SQL values (one RED case). The rebased branch is `a325afd81b7e05c2b0fc16e9cd45e65392c03a79`, based on `5914d9f4dc37b7d78be4c5363b33b12d22d444c6`. Rebase changed only the commit parent; all four patch paths and their content are unchanged from the previously reviewed DEE-1150 patch.

Focused readiness on the rebased tree passed: the three envelope unit suites (21 tests), typecheck, both consumer-graph validators, canonical validation (278 files), and ESLint on the three changed source/test files. The existing nine-case isolated synthetic PostgreSQL proof passed on implementation commit `3b27d57a` based on `42810ef8`, with zero failures/skips and 1,975 captured source pins unchanged during execution. The rebased patch's six envelope-specific production/helper/test pins match that proof exactly. The broad proof manifest has seven mismatches from the later DEE-1183 merge: `execution-service.ts`, `market-bars-repository-postgres.ts`, `blind-holdout-engine.ts`, `dee-540-blind-tail-commit.ts`, `m9-dataset-seal-preview.ts`, `reconstruct-research-failure-artifacts.ts`, and `research-orchestrator.ts`. These are outside the envelope implementation and its native test path; the native run was not repeated. This is inherited proof, not an exact-HEAD native run.

No build or full unit suite was repeated on this rebased tree. Exact-head GitHub CI remains required. No production database or venue action occurred.

Root review confirms the rebased owned source and tests remain byte-identical to the independently reviewed implementation. The earlier exploratory combined run selected another fixture-dependent account suite whose four cases skipped; that attempt is retained as rejected evidence and is not part of the accepted nine-case envelope proof. No test guard was relaxed.
