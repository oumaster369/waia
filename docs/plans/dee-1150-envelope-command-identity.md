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
  currentWorkPackage: actual-main-readiness
  completedWorkPackages: [command-identity-regression, implementation, native-proof, independent-review, actual-main-rebase, actual-base-local-readiness]
  remainingWorkPackages: [current-base-review, exact-head-ci, merge]
  prNumber: null
  prUrl: null
  blockedReason: null
  nextAction: "Complete root review of the actual-main commit, then publish and wait for exact-head CI before merge."
provenance:
  createdFrom: user-authorized-ai-trader-audit-2026-10-01
  authoritativeBase: 42810ef804150dab0b1f9c01cb38b5bd8bac3659
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

The original source failed six focused command-identity/stage regressions. A
separate independent-review correction reproduced mutable-command leakage into
SQL values (one RED case). The rebased actual-main commit is `3b27d57a`, based on
`42810ef804150dab0b1f9c01cb38b5bd8bac3659`. Current-base local readiness passed:
full lint (327 warnings, zero errors), typecheck, build, canonical validation,
both consumer graph validators, and 21 focused units across three files.
Fresh isolated synthetic PostgreSQL 16.14 on implementation commit `3b27d57a`
passed all nine envelope cases, with zero failures/skips and all 1,975 captured
proof-source pins unchanged during execution. The subsequent plan-only refresh
does not change any captured native proof source. The earlier nine-case receipt
on the 4f54 predecessor remains historical: 19 of its repo-wide pins changed
across intervening merged work, including four DEE-1161 signer-gate files. None
of the changed paths belongs to the envelope implementation or its native test
path; the fresh run captures the current source set.
The current-main rebased patch is content-equivalent to the previously reviewed
single DEE-1150 commit. Exact-head CI remains required; full unit suite was not
run locally.

An exploratory combined native run also selected the separate current-account
suite, whose four cases correctly skipped without its acquisition fixture
profile; these are not accepted evidence. A bootstrap with that other namespace
correctly refused. Final envelope proof uses the approved historical-validation
bootstrap namespace and only its nine executed cases; no test guard was changed.
No production database or venue action occurred.
