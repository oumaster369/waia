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
  status: in-progress
  currentWorkPackage: WP-2
  completedWorkPackages: [WP-1]
  remainingWorkPackages: [WP-2]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 02653262858ee75eae814c8c7382b6a10e9f2bb1
  lastValidationAt: "2026-09-28T00:25:06.656Z"
  blockedReason: null
  nextAction: "Complete independent native-outcome and plan-only carry review, publish the one integration PR, then require all exact-head CI and fresh checked-merge admission. No deployment or trading activation follows."
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
5. `docs/ai-trader/reality-v2-source-consumer-inventory.json`: mechanically regenerate only exact source/consumer content digests after the adapter change. Preserve discovery roots, path sets/counts, path digests, all admission rules and the validator itself. This necessary scope addition was registered in Linear before editing it after the existing graph guard correctly detected the changed adapter bytes.
6. `tests/fixtures/reality/execution-reality-adapter-82819a95.ts`: a byte-identical copy of the accepted828 adapter for the native historical-conflict control, with its original real contract dependency unchanged. This test-only fixture runs the original mapper over the actual stored report; the real unchanged Reality writer persists those genuine baseline drafts. CI needs neither Git history nor dynamic code evaluation. The fixture is never imported by production and is not a repair issuer. This addition was registered in Linear before editing it.

No schema or migration, other production modules, global clock changes, report reserialization, new timestamp helper framework, live connector/account access, weakened native guards, source qualification or broader Guardian/recovery composition. DEE-1135 and DEE-1136 remain separate active work in separate checkouts. No source overlap is expected with their admitted maps.

## WP-1 — Source correction and focused controls

WP-1: commit this plan before executable changes. Capture targeted baseline RED for the asymmetric-time contract, then the narrow FILL correction and focused actual non-DB controls. Preserve original failures. Run scoped lint/typecheck and relevant consumer-graph checks; source review is independent of the author. Unit success is not durable/native acceptance.

## WP-2 — Durable delivery and historical conflict

Add actual delivery controls using inactive synthetic local fixture data and real repository/writer/FKs/triggers, without venue/order submission. Test distinct source times in one report, source/truth/projection propagation, equal/non-fill preservation, fresh-client idempotent replay and unchanged knowledge, and explicit conflict with genuinely baseline-mapped earlier rows. Any baseline writer must be exact accepted828 in its isolated fixture, not a falsely labelled current mapper. Expected failures must prove the intended reached boundary. Before running, bind exact immutable source/full-chain fixture, one fresh explicitly assigned local DB, bounded clients and cleanup; no existing shared native resource is assumed available.

## Acceptance

Required local readiness: focused units, scoped checks during work, then lint/typecheck/build, canon, governance and existing Execution/Reality consumer-graph validators. Run the exact full relevant native delivery suite without skipped selected tests; keep errors and raw evidence, close all clients and assert no venue/order effects. Exact-head required CI and independent source/outcome acceptance precede PR merge. The authoritative full unit suite belongs to PR CI; do not duplicate it locally without cause. No new UI requires a browser flow test.

No whole audit, scientific or live readiness follows from this correction. Core accepted/deployed versions, baseline RED, corrected unit/native versions and prospective operator rollout are distinct identities.

## Actual partial evidence — 2026-09-27 UTC

The original adapter at plan-first commit `436468b5b1a7ea6285c88d659e4f711ad9815bd9` passed the four existing focused cases and failed all twelve new asymmetric/malformed/knowledge-time cases. With the correction, the same full focused file passed 16/16 with no skips. Final scoped lint, typecheck and Execution graph passed; the Reality graph initially correctly rejected the changed content digest and passed after the scope-admitted mechanical update preserving both path sets/counts/digests and all rules. The first canonical-plan check exposed missing recognized work-package headings; those headings are corrected here. Original failed outputs remain retained, including the earlier test-only lint warnings fixed before final lint.

These checks were executed against recorded work-in-progress bytes on the plan-first head, with per-file before/after digests, and are not an immutable-head or native attestation. External raw results and receipts are under audit evidence `evidence/dee-1137/`. This was the initial source checkpoint; the subsequent immutable-source review, native proof and readiness below supersede its pending work. Exact-head CI remains open. No source-history rewrite, deployment, live request or whole-issue completion is claimed.


## Immutable-source readiness and native evidence — 2026-09-28 UTC

Independent source review accepted `5f217d87c87c1e8e5808391ffeb273c70e5fe830`, REPORT `a7d5dfc29c17af73b8fb0aec0cce50f08e4d382f6c1e7c5dc7338d5eebedad13` and 61-artifact manifest `cfca4209e13b89d6170df768e8b3976f196589bd81a9c41db6afe799c81cefca`. The later native fixture/control source is exact `02653262858ee75eae814c8c7382b6a10e9f2bb1`, tree `edbe1995f71b8116d6b1afdaa2e1d42a4e999328`; production, focused-unit and inventory bytes are preserved from the source review. Its exact original828 fixture SHA is `4560258f04cbe8ba89e256b4138acfcb0022fe01086252f070ded419f079c0f3`.

On026, scoped lint/compiler passed at00:08:42UTC. Full lint/build/governance passed00:14:27–00:15:27UTC. The source and unchanged relevant validation inputs were captured before and after each command. Canon and both consumer graphs also passed on the recorded same source bytes. No complete local unit rerun substituted for authoritative CI.

The independent 67-artifact native-source/runner review, manifest `e71666a8abf898b20acad7887be680c3a5e2b68f32afd7d5e37c0947fbbd5d84`, accepted only a separate root-controlled attempt. It identified stale companion prose and incomplete failure-finalization evidence in unexecuted runner drafts; both were corrected and originals preserved before any native grant. Final runner SHA `e1f8b5dc8f600b279bf24128fbfc067b5060dc76828deea2e1856c62cb20b506` binds fixed loopback PostgreSQL16.14, a single absent database name, full224 original migration chain, exactly six source paths, all tracked source identities, whole41 registrations, bounded command/process cleanup and unchanged role/catalog posture.

One admitted synthetic attempt ran the entire delivery file: **41 passed, zero failures, zero skips**, actual00:24:58.817–00:25:06.656UTC, terminal exit0. The new cases prove distinct fill times through actual stored Execution reports, Reality source/truth/projection and fresh-client/CLI replay; genuine original828 mapping through the unchanged writer followed by `SOURCE_BINDING_INVALID` catch-up and direct immutable-lineage refusal; actual stored noncanonical timestamp refusals; and future source-time rollback at the existing knowledge-time rule. No old case was removed. Native event-time preservation is not separately claimed; unchanged source and focused controls cover the non-fill boundary.

All224 actual migration hash/when rows, all5533 tracked Git entries, roles and database posture matched before/after. Every cleanup phase succeeded and final other clients were zero. The synthetic database and raw evidence are retained. The 19-artifact result seal is `005c57f6763dd29e09f9b94fd209f26fbb647aa273b8112deb7c242677c41f9e` under external `evidence/dee-1137/native-preparation/results-0010`. Root verification does not replace independent outcome review, which is the remaining prepublication gate. This plan-only successor carries the five non-plan changed files unchanged; it does not relabel026 execution as a run on the successor commit. Final exact-head CI and checked merge remain required. The correction supplies no history repair, scientific acceptance or live enablement.
