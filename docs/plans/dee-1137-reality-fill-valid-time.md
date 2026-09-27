---
integrationIssue: DEE-1137
integrationTitle: "Preserve venue fill valid-time in Reality delivery"
parentIssue: DEE-639
branch: dee-1137-reality-fill-valid-time
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [lint, typecheck, targeted-unit, native-postgres, build, validate-canon, validate-pr-governance, validate-execution-v2-consumer-graph, validate-reality-v2-consumer-graph]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: approved
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1, WP-2]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Reproduce asymmetric fill timing in focused units, correct only FILL mapping, then independently review and qualify actual durable delivery and historical conflict."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1137 — Preserve the source time of exact fills

## Problem and authority

[DEE-1137](https://linear.app/deepsense/issue/DEE-1137/ai-trader-preserve-venue-fill-valid-time-in-reality-delivery) is one atomic backend issue under DEE-639, related to DEE-1111 and DEE-944. Base is accepted main `82819a9581d09afb81eeeff4153abebbf59b8662`, tree `382c1d2fb5a962315e3b25cf2b722069fd36dcde`. Root owns this separate primary-checkout branch; the existing untracked `.playwright-mcp/` is preserved.

Independent M02-GER-C01 found that `fillDraft` copies `report.observedAtUtc` through the shared base and discards the already supplied `trade.executedAt` for canonical valid-time. Reality Doctrine section7 requires the source-valid time (specifically the venue fill time) and separately assigned knowledge-time. Existing real report-delivery code reaches this adapter. Equal source/report times in existing fixtures conceal the error. Audit REPORT `86ee6f0e069e7ef23019aae4adf0d159c68a92e67632044d44191b3b7a6cf084`,76-artifact manifest `6bcb6f4aedc79c7e00a23605cd5016bbec24ad45b8a0b3a788579e413afc92bf`, root adoption `c1676c23eeec380c15cdbc3262b5186a8ddab8bfddd32b12790baf6f303b25f3` are external evidence. This is a source-supported P2; no native reproduction or deployed incident is initially claimed.

The user has already authorized technical corrections, checks, PRs and checked merge. The conventional human-merge gate records the delegated root control; it does not require asking again. Actual trades and enabling them remain operator-only. No financial rule, strategy, risk value or empirical gate changes.

## Exact correction and compatibility

Only FILL drafts use their own exact `trade.executedAt`. Require a nonempty finite string that round-trips exactly through Date.toISOString, matching the existing Reality canonical UTC millisecond contract. Carry those bytes verbatim. Reject missing, malformed, normalized invalid-calendar, offset/noncanonical and finer-precision strings rather than silently truncating/normalizing or falling back to report observation. The upstream report repository's broader finite-time check is not proof of canonical Reality admission. Unsupported forms remain explicit fail-uncertain input; no new quarantine policy is introduced.

Keep ORDER and VENUE_EVENT report-observation timing, report/raw digest and source identity, quantities, fees, side, OBSERVED settlement meaning and separate monotonic Reality knowledge allocation unchanged. The existing source writer still rejects knowledge before valid-time. Do not add a report-time comparison that would silently redefine the existing knowledge-time rule.

Existing immutable erroneous source rows remain unchanged. Reinterpreting their same Execution lineage under the corrected mapping must retain the writer/delivery's explicit immutable binding conflict; it must not overwrite history, mint a fictitious adapter revision or return inconsistent success. Corrected rows must replay idempotently with their original knowledge-time. A history repair issuer/backfill is out of scope; before any deployment acceptance its absence and the explicit refusal behavior must be stated.

## Closed scope

1. `lib/trader/execution/v2/reality-adapter.ts`: validate and assign only each FILL's exact source time.
2. `tests/unit/trader-reality-v2-ingress.test.ts`: meaningful asymmetric/two-fill, equal/non-fill, malformed/noncanonical and knowledge-time controls using actual adapter/ingress/Reality contracts.
3. `tests/integration/postgres-execution-reality-delivery.test.ts`: actual durable source/truth/projection, fresh-client replay and baseline-data immutable-conflict controls under the existing real fixture/guards. Preserve existing registrations and exact transactions/constraints.
4. This sole plan.

No schema or migration, other production modules, global clock changes, report reserialization, new timestamp helper framework, live connector/account access, weakened native guards, source qualification or broader Guardian/recovery composition. DEE-1135 and DEE-1136 remain separate active work in separate checkouts. No source overlap is expected with their admitted maps.

## Work and proof

WP-1: commit this plan before executable changes. Capture targeted baseline RED for the asymmetric-time contract, then the narrow FILL correction and focused actual non-DB controls. Preserve original failures. Run scoped lint/typecheck and relevant consumer-graph checks; source review is independent of the author. Unit success is not durable/native acceptance.

WP-2: add actual delivery controls using inactive synthetic local fixture data and real repository/writer/FKs/triggers, without venue/order submission. Test distinct source times in one report, source/truth/projection propagation, equal/non-fill preservation, fresh-client idempotent replay and unchanged knowledge, and explicit conflict with genuinely baseline-mapped earlier rows. Any baseline writer must be exact accepted828 in its isolated fixture, not a falsely labelled current mapper. Expected failures must prove the intended reached boundary. Before running, bind exact immutable source/full-chain fixture, one fresh explicitly assigned local DB, bounded clients and cleanup; no existing shared native resource is assumed available.

Required local readiness: focused units, scoped checks during work, then lint/typecheck/build, canon, governance and existing Execution/Reality consumer-graph validators. Run the exact full relevant native delivery suite without skipped selected tests; keep errors and raw evidence, close all clients and assert no venue/order effects. Exact-head required CI and independent source/outcome acceptance precede PR merge. The authoritative full unit suite belongs to PR CI; do not duplicate it locally without cause. No new UI requires a browser flow test.

No whole audit, scientific or live readiness follows from this correction. Core accepted/deployed versions, baseline RED, corrected unit/native versions and prospective operator rollout are distinct identities.
