---
integrationIssue: DEE-962
integrationTitle: "Historical V2 audited launch corrections release candidate"
branch: dee-962-historical-release-integration
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, targeted-unit, build, e2e, postgres-integration, independent-review]
approvalGates: [plan-approved, ci-change-approved, integration-ready, human-merge, human-production-rollout]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-PR
  completedWorkPackages: [WP-INVENTORY, WP-LOCAL-COMPATIBILITY, WP-GATES, WP-FINAL-REVIEW]
  remainingWorkPackages: [WP-PR]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: efc2a57ee5c18f32479a471a05f2b0469501a070
  lastValidationAt: "2026-09-07T10:58:00Z"
  blockedReason: null
  nextAction: "Publish one review PR and collect exact-head CI; no merge or deployment."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
  humanApproval: "2026-09-07: user explicitly approved DEE-962 integration plan and strengthening CI with PostgreSQL17 and omitted checks, retaining existing checks; no merge or deployment."
---

# DEE-962: Historical V2 integration candidate

## Context and authority

User resumed the audited historical completion path on 2026-09-07.
DEE-920's original PR551 already merged; this is a new integration boundary,
not a second PR on920. This plan records existing corrections and new validation.
Human explicitly approved this integration plan and additive CI strengthening on
2026-09-07. No Human launch approval, merge or deployment is conferred.

Ordinary Human-reviewed integration batch, NOT an Integration Train. Existing
implementation predates this plan; no fabricated pre-implementation manifest or
bounded autonomous merge claim is permitted. Parent920 retains production acceptance.

## Goal

One exact historical source candidate with traceable corrections, unchanged data and
scientific criteria, honest diagnostics and executable regression gates. Merged code
is not equivalent to full-corpus qualification, observed test PASS or live readiness.

## Scope and provenance

Base: `56768be12a407e6307d2231392c9a02612d29ca2` (merged PR560).
Existing cumulative source: `7b556eb3abd528049e62848fc0e2dffac664c624`.
Pre-plan combined validation tree: `25b80e3454e14288ed982436e9c6bf886aa2ffe1`.
This is a tree ID, not a production release SHA.

Work packages already implemented in the source:
-946: bounded lossless predictive-package codec, immutable scoped storage0203,
 input/outcome and non-actionable wire binding, hydration/replay.
-947/950: corrected frozen bootstrap law and version invalidation, exact bounded
 ordinal work and cooperative progress/cancellation. No full-corpus PASS claim.
-948: capacity-only heap forwarding, causal error/cleanup preservation, launch extent.
-951: current-accounting Guardian before Risk and chronological pending-entry protection.
-954: content-bound new dataset identity, preserving legacy identity on exact retry.
-955: checkpoint-bound unsettled modeled-order observation.
-958/959: immutable preparation-attempt diagnostics0204, separately committed failure
 evidence and race-safe scoped admin display; no new scientific/launch authority.
-952 copy-only changes already present in the cumulative source are retained with
 their existing tests. New logout/session changes atf16e26b8 are NOT included.
-953 is already merged in main; no second delivery/closure claim.

These identifiers describe provenance, not automatically completed children.
Existing issues remain open wherever full scope or runtime acceptance is missing.

## Batch rationale and reviewability

The large diff combines previously developed, separately tested historical changes.
Storage migration, versioned hydration and atomic producer/consumer changes must ship
together; mixing their versions would invalidate receipts or restore unbounded payloads.
One source/release identity is needed for scientific package binding and replay.
Existing independent review receipts are inputs, not a waiver of frozen-diff review.
The file inventory and original commits below make that review reproducible.

T3 is the highest product-code integration risk. CI gate changes require a separate
explicit approval and must not change deployment topology or weaken existing checks.
Merge and production remain explicit Human gates. If final review establishes
incoherent rollback boundaries, split before publication; do not waive this by deadline.

## Do NOT

No private exchange credentials, HTX account access, live/paper production activation,
real orders or capital, blind holdout, governance edits, authority bypass, RLS weakening,
scientific threshold/data/anchor/K/M/B/baseline reduction or deleted negative evidence.
No automatic dispatcher is claimed: existing approved standalone preparation remains.
No edits to original worktrees, synced sources or user WIP.
No new960/961 observation core/runtime,956 HTX admission,957 logout,639 live composition
or646 adaptive research are included.

## Acceptance

- [x] Reproduce combined source without product-code merge conflict; preserve main plan additions.
- [x] Validate Reality inventory by enumerating actual changed consumers, not disabling its guard.
- [x] Local typecheck, lint and Next/OpenNext bundle; record warnings and original failed attempts.
- [x] Fresh205-migration chain through0204 on PG17 under restricted owner, actual SET ROLE negatives.
- [x] Actual runner LOGIN and persisted Forecast/package local tests, correctly enabled.
- [x] Preparation event7/7 and session-close2/2 local checks passed, with actual PG17 connections.
- [x] Portable registration3/3 on two fresh migrated PG17 stores; random-ID mutation detected.
- [x] Four local historical browser scenarios passed; mocked transport, not production proof.
- [x] Canon146documents and release-identity validation pass; inherited metadata format corrected.
- [x] Obtain and implement CI coverage correction:0204 PG17, actionable Forecast persistence,
      portable dataset-identity and reserved-session-close regression gates.
- [x] Frozen candidate targeted tests, applicable E2E and bounded integration review: no known source-integration P1/P2.
- [ ] Required exact-head PR CI; synthetic upstream tests explicitly not full-corpus qualification.
- [x] PR governance preflight passed; local integration-ready conditions met.
- [ ] Publish one PR to main and collect exact-head gates; this is not production readiness.
- [ ] Human merge decision; no automatic merge authority asserted.

Production acceptance is separate and remains pending: exact-SHA approved rollout,
0203/0204 backup/apply, runtime requalification, unchanged full-corpus preparation,
actual proposal/Human ratification, historical run/repeat and paired authenticated panels.
Scientific rejection is a valid result, not a code defect to hide.

## Validation evidence and remaining defects

Local receipt: project-root `trader-historical-integration-check-2026-09-07.md`.
Typecheck PASS; lint0errors/307warnings; targeted138PASS/1inventoryFAIL, then corrected
whole-repository Reality4/4PASS. Next/OpenNext PASS after sandbox loopback permission.
Full-chain receipt: `/private/tmp/waia-dee962-fullchain-eLZJQr/result.json`:
205migrations,10checks, NOSUPER/NOBYPASS migration owner and actual runner negatives.
Local three-suite PG run64PASS/2FAIL due to operator-supplied synthetic password<32;
unchanged runner suite rerun with valid local fixture41/41PASS. Storage19/19 and
Forecast persistence6/6 passed in the initial run. This is not production proof.

Read-only gate review identified three P2 coverage gaps:
1.0204 test needs PG17 and WAIA_TEST_DEE958_PG_ADMIN_URL; current CI neither selects nor enables it.
2.postgres-forecast-v2-persistence.test.ts missing from actual PG command; generic unit skips it.
3.reserved-close and dataset-identity experiment depend on local-only environment/seed.
Human approved CI strengthening on2026-09-07. Additive PG17 job applies all migrations,
runs Forecast6/portable identity3/reserved close2 and then preparation journal7 with
its real two-connection LOGIN. Exact commands extracted from workflow passed locally
on a separate empty PG17 cluster (only port5432→55463 and pnpm executable routing
changed). Evidence:/private/tmp/waia-dee962-ci-job-0z0wQG. All18tests PASS, zero skips.
YAML parsed; old PG16 job equals original parsed job and all old triggers remain.
Independent bounded CI review found no concrete P1/P2; GitHub execution and required
branch-protection status are not yet verified. Existing synthetic35/80 and
semanticRepeatPass:false evidence stays honest.

Portable regression uses three synthetic bars and a synthetic upstream receipt,
not real scientific qualification. Actual source loader and registration are unmocked.
Agent mutation check failed1/3 with random IDs; mutation removed, final3/3PASS.
Focused lint/full typecheck passed. Root inspected the complete new192-line test.
Final bounded integration review on efc2a57ee5c18f32479a471a05f2b0469501a070
found no known unresolved source-integration P1/P2 blocking review-PR publication.
Product/migration/host bytes match audited7b556, required producer/consumer/migration
closure preserved, and all three CI gaps addressed. This is not a whole-Trader
certificate or full-corpus acceptance. Governance preflight and regression suite PASS.
Browser4/4PASS after creating the missing local SQLite directory; original setup
failure retained. Root-owned Next server stopped; no production observations inferred.
Canon initially rejected seven formatting errors across six inherited plans;
frontmatter/provenance/Acceptance headings corrected without approval promotion,
criterion changes or validator changes. All146documents and release identities PASS.
No new product source edits. Final candidate CI/review and full-corpus gates remain.

Additional files in this integration beyond the existing-source inventory below:
- docs/plans/dee-962-historical-release-integration.md (approved plan)
- tests/integration/postgres-historical-dataset-registration-portable-v2.test.ts
The inherited plans946/948/951/954/958/959 also receive the format corrections above.

Commands: existing `pnpm typecheck`, `pnpm lint`, `pnpm cloudflare:build`,
scoped Vitest and Playwright. Only disposable127.0.0.1 PostgreSQL URLs; no production
credentials in artifacts. Full unit gate belongs to PR CI; no redundant full local suite.

## Rollback and migration memory

0203/0204 are additive but older application code may not understand new wire versions.
Rollback is not an automatic old-image restart. Halt preparation/execution, preserve
append-only rows and artifacts, assess compatible reader release, then use explicitly
approved recovery. Do not drop new tables or rewrite authority rows. Production rollback
and backup details must be bound to the final deployment SHA separately.

## Existing source commits

```text
7b556eb3abd528049e62848fc0e2dffac664c624 DEE-959 apply refresh error at atomic settlement fence
96340d6ef7c73049eb64837b8a53508a15e14300 DEE-959 preserve latest failed refresh against stale success
8925b5a28f59b5f9f36f9fa60fa58ab4fb5e79d3 DEE-959 preserve slow successful diagnostic refreshes
49caaf579a0d3e619ea80d6880a661214c477fed DEE-959 display durable preparation failure and scoped progress
76189935d3cdffd8727dce4854a7f49f2715ee32 DEE-958 persist scoped historical preparation attempt diagnostics
ded0cb0d2e37cb45d9c8c17007d9a69860fd2a11 DEE-950 fix(historical): reject closed reserved database sessions
42e9b0c87d0569dc29f489ba2f820c206ece9f8f DEE-950 fix(historical): show validated preparation request acknowledgement
7bb650eec6fa9cda8e73cfee2fe205246e41b1b7 DEE-920 test(historical): preserve composed progress and cleanup failures
ebc5222e6f72d752a0da4da1b792fd8ea4466789 DEE-955 feat(trader): expose checkpoint-bound unsettled modeled orders
24e9ec5284b79f8f1b745a5998713045412ee6b2 DEE-950 test(historical): assert finalization replay progress on PostgreSQL
c2f3ce11c30813d26cedfe4911893764bd3a6be5 DEE-950 fix(trader): propagate finalization cancellation and progress
e9a9c9f938746f30054fbe141ece063347a05f73 DEE-950 test(historical): verify proposal cancellation cleanup
c1a847466f616928ab726bab0d2a92915f6f611a DEE-950 feat(historical): emit scoped technical preparation diagnostics
a27b4587fd409906b4144fb6b0fdb632d782e920 DEE-946 fix(forecast): reject malformed authority before package hydration
475b3872f231d05f030a0fbfe3d346de284298ec DEE-954 fix(historical): bind new dataset registration IDs to immutable content
75eb4f458c78161d8ac2b94aa8c605374cedd210 DEE-920 test(historical): preserve exact pre-execution seed for local repeat
93e43a7a4fd145092330ec4bdf44552ededccf9c DEE-920 test(historical): bind independent local repeats and retain raw evidence
f4fc3b5925de206ad7f576163c24d6f7a822fda9 DEE-950 perf(trader): reuse worker preparation and bound progress chunks
f6d5985a00ca4fbcf7331425352889336119fc30 DEE-950 fix(trader): wire exact Node bootstrap into proposal preparation
82b22f7020e35f60350d6ec5091cc7b96ace58d3 DEE-950 feat(qualification): execute exact bootstrap ordinal worker ranges
cc91750f65ce0dbcb4aa74af0f9de96c399fd7f8 DEE-950 perf(forecast): share exact dual-role sample encoding
c0169c8d0d044fbb4764888dca0c8e180e3f258d DEE-950 docs: record completed corrected-law full graph proof
e4dba9c772f34d9857ee734ee22a056973a520a8 DEE-920 test: include approved 952 copy in local interface validation
37de0528df6e9fea736e0f4374289cb113ec8319 DEE-920 test: include local 953 receipt retry in validation only
2a1fe0dd98047221540ed0f2af503bb9d5a33882 DEE-920 test: include reviewed 951 Guardian in local validation
e9aaf33a94bb361e8ec97ba1d78268f6ab5a0a50 DEE-920 test: include reviewed 948 diagnostics in local validation
12b603d68091ea43aa0309b4edbb792f1a482914 DEE-920 test: local-only cumulative validation of 946 and 950
ef85357aad8451aa3e183c8eed4f7d5418c67aee DEE-950 docs: record current-base graph validation in progress
570d41f12b63541ea8f8659d93f05abcbcf442ee DEE-950 perf(historical): yield between complete predictive anchors
b25c69e16629cf8b8eb3437a4598854c8559453f Merge remote-tracking branch 'origin/main' into dee-950-qualification-cost
f72549414284844f106e943e08c978102ea5e056 DEE-950 perf(historical): yield between exact validation resamples
1941a5c291237a7d6957296a8111b25143933983 DEE-946 test(historical): prove bounded negative wire in 35-cycle graph
d6559efe619b324bf91dabec49e58a9724a454a8 DEE-953 fix(trader): preserve HTX receipt retry after JSONB reload
d31992837f2b02e4cf079d2a283938279c817151 DEE-946 fix(historical): bound abstention evidence and require package schema
19c79da402876649e7cab1a97fc1521faae3a000 DEE-946 fix(forecast): wire bounded package persistence and replay
c5db957c5befae50cb60addea20986b29a61a046 DEE-946 feat(trader): bind bounded input and outcome package wires
4b3a150565dcaf362a5ebe8ceb83fa716a01fd17 Merge remote-tracking branch 'origin/main' into dee-946-durable-package
824d2500a292867aa3638eec507483213f90ea14 DEE-946 feat(trader): persist immutable bounded package chunks
8ae36988eab911fb8cc14e554d6f8b2c2b5e66ed DEE-946 feat(trader): hydrate bounded package chunks asynchronously
61c166aa0e66f64da6053211eab8e756ed9eeb97 DEE-952 fix(ui): remove Twin wording from Trader registration
5fb4658ba828f5ca75672baa1c4b72df71e39a58 DEE-946 docs: specify remaining durable persistence integration
494596f60492d7a3849238e9dd99da83d35b6a43 DEE-950 perf(research): stream exact bootstrap and reject nonfinite evidence
f63f298137cb5871f393c679c5f56816ef822561 DEE-946 feat(storage): add bounded lossless package codec phase one
7abad4769bee23ea2c60950e623c641608e12a1b DEE-948 fix(launch): retain heap limits and causal diagnostics
bffe71d59c6dd213284146f8818b192446602142 DEE-951 fix(risk): apply current modeled Guardian before new allowance
```

## Frozen pre-plan file inventory relative to base

This list excludes this integration-owned plan; future changes require inventory refresh.

```text
.github/workflows/postgres-integration.yml
components/landing/AuthBlock.tsx
components/trader/admin/historical-ratification-ceremony-v2.tsx
components/trader/historical-v2-observation-dashboard.tsx
components/trader/historical-v2-pending-orders.tsx
db/migrations_postgres/0203_predictive_package_storage_v1.sql
db/migrations_postgres/0204_historical_preparation_events_v2.sql
db/migrations_postgres/meta/_journal.json
db/postgres-reserved-close-guard.ts
db/schema.postgres.ts
docs/ai-trader/reality-v2-source-consumer-inventory.json
docs/ops/dee-950-qualification-cost-evidence.md
docs/plans/dee-946-durable-package.md
docs/plans/dee-948-launch-diagnostics.md
docs/plans/dee-950-qualification-cost.md
docs/plans/dee-951-current-guardian.md
docs/plans/dee-952-trader-auth-copy.md
docs/plans/dee-954-historical-dataset-identity.md
docs/plans/dee-955-unsettled-observation.md
docs/plans/dee-958-preparation-attempt-events.md
docs/plans/dee-959-preparation-diagnostics-ui.md
lib/trader/historical-simulation-v2/atomic-cycle-repository-postgres-v2.ts
lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2.ts
lib/trader/historical-simulation-v2/current-modeled-guardian-v2.ts
lib/trader/historical-simulation-v2/dataset-registration-identity-v2.ts
lib/trader/historical-simulation-v2/execution-server-bootstrap-v2.ts
lib/trader/historical-simulation-v2/launch-cleanup-v2.ts
lib/trader/historical-simulation-v2/launch-consumer-cli-v2.ts
lib/trader/historical-simulation-v2/launch-error-format-v2.ts
lib/trader/historical-simulation-v2/modeled-capital-binding-v2.ts
lib/trader/historical-simulation-v2/non-actionable-forecast-source-v2.ts
lib/trader/historical-simulation-v2/non-actionable-forecast-source-v3.ts
lib/trader/historical-simulation-v2/observable-pending-orders-v2.ts
lib/trader/historical-simulation-v2/observable-read-model-postgres-v2.ts
lib/trader/historical-simulation-v2/observable-read-model-v2.ts
lib/trader/historical-simulation-v2/pit-forecast-input-loader-v2.ts
lib/trader/historical-simulation-v2/pit-forecast-input-producer-v2.ts
lib/trader/historical-simulation-v2/preparation-attempt-events-v2.ts
lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2.ts
lib/trader/historical-simulation-v2/production-next-cycle-forecast-v2.ts
lib/trader/historical-simulation-v2/production-next-cycle-preparation-v2.ts
lib/trader/historical-simulation-v2/ratification-admin-handler-v2.ts
lib/trader/historical-simulation-v2/ratification-execution-cli-v2.ts
lib/trader/historical-simulation-v2/ratification-split-v2.ts
lib/trader/historical-simulation-v2/technical-preparation-observer-v2.ts
lib/trader/intelligence/forecast-v2/distribution-semantic-digest-v1.ts
lib/trader/intelligence/forecast-v2/forecast-package-wire-v1.ts
lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service.ts
lib/trader/intelligence/forecast-v2/forecast-wire-semantic-v1.ts
lib/trader/intelligence/forecast-v2/predictive-package-codec-v1.ts
lib/trader/intelligence/forecast-v2/predictive-package-storage-postgres-v1.ts
lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1.ts
lib/trader/intelligence/forecast-v2/waia-cbrng-v1.ts
lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime.ts
lib/trader/observability/fhv-v2-postgres-schema-preflight.ts
lib/trader/research/benchmark/research-harness-admission-orchestrator-v1.ts
lib/trader/research/benchmark/validation-bootstrap-v1.ts
lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2.ts
lib/trader/research/execopp-qualification/scientific-admission-v2.ts
scripts/trader/benchmark-forecast-issuance-cost.ts
scripts/trader/benchmark-validation-bootstrap-cost.ts
scripts/trader/benchmark-validation-bootstrap-parallel.ts
scripts/trader/benchmark-validation-bootstrap-responsiveness.ts
scripts/trader/historical-simulation-v2-launch-approved.ts
scripts/trader/historical-simulation-v2-prepare-proposal.ts
scripts/trader/validation-bootstrap-node-pool.ts
scripts/trader/validation-bootstrap-range-worker.mjs
services/ai-trader-execution-host/Dockerfile
services/ai-trader-execution-host/entrypoint.mjs
tests/e2e/historical-v2-observation.spec.ts
tests/e2e/trader-host.spec.ts
tests/helpers/historical-independent-repeat.ts
tests/helpers/historical-repeat-seed.ts
tests/integration/historical-preparation-events-v2.test.ts
tests/integration/postgres-forecast-v2-persistence.test.ts
tests/integration/postgres-historical-dataset-registration-identity-v2.test.ts
tests/integration/postgres-historical-observable-read-model-v2.test.ts
tests/integration/postgres-historical-production-first-cycle-v2.test.ts
tests/integration/postgres-predictive-package-storage-v1.test.ts
tests/integration/postgres-reserved-close-guard.test.ts
tests/unit/fhv-v2-postgres-schema-preflight.test.ts
tests/unit/forecast-distribution-dual-role-parity.test.ts
tests/unit/forecast-wire-semantic-v1.test.ts
tests/unit/helpers/validation-bootstrap-independent-reference.ts
tests/unit/historical-approved-finalization-observer-v2.test.ts
tests/unit/historical-current-modeled-guardian-v2.test.ts
tests/unit/historical-dataset-registration-identity-v2.test.ts
tests/unit/historical-execution-server-bootstrap-cleanup-v2.test.ts
tests/unit/historical-independent-repeat.test.ts
tests/unit/historical-launch-cleanup-v2.test.ts
tests/unit/historical-launch-error-format-v2.test.ts
tests/unit/historical-launch-extent-v2.test.ts
tests/unit/historical-observable-pending-orders-v2.test.ts
tests/unit/historical-observable-read-model-v2.test.ts
tests/unit/historical-preparation-failure-gap-v2.test.ts
tests/unit/historical-production-first-cycle-contract-v2.test.ts
tests/unit/historical-proposal-candidate-binding-v2.test.ts
tests/unit/historical-ratification-admin-handler-v2.test.ts
tests/unit/historical-ratification-ceremony-v2.test.tsx
tests/unit/historical-ratification-execution-cli-v2.test.ts
tests/unit/historical-repeat-seed.test.ts
tests/unit/historical-request-observation-v2.test.ts
tests/unit/historical-simulation-production-next-cycle-preparation-v2.test.ts
tests/unit/historical-technical-proposal-cancellation-v2.test.ts
tests/unit/historical-technical-proposal-main-v2.test.ts
tests/unit/historical-v2-pending-orders.test.tsx
tests/unit/postgres-reserved-close-guard.test.ts
tests/unit/predictive-package-codec-v1.test.ts
tests/unit/preparation-attempt-events-v2.test.ts
tests/unit/research-harness-admission-integration.test.ts
tests/unit/rv-state-conditional-empirical-joint-v1.test.ts
tests/unit/scientific-admission-v2.test.ts
tests/unit/technical-preparation-observer-v2.test.ts
tests/unit/trader-forecast-runtime-authority-v2.test.ts
tests/unit/trader-historical-execution-host-v2.test.ts
tests/unit/trader-historical-modeled-capital-binding-v2.test.ts
tests/unit/trader-landing-page.test.tsx
tests/unit/validation-bootstrap-cooperative.test.ts
tests/unit/validation-bootstrap-known-answer-v2.test.ts
tests/unit/validation-bootstrap-node-parallel.test.ts
tests/unit/validation-bootstrap-streaming-parity.test.ts
```
