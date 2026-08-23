---
integrationIssue: DEE-680
integrationTitle: "Canonical PIT Observation + Inert Measurement Lineage Integration Batch"
branch: dee-680-canonical-pit-measurement-lineage
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, postgres-ci, github-pr-ci]
requiredValidation:
  - focused-contract-tests
  - focused-postgres-tests
  - gateway-replay-tests
  - source-consumer-closure
  - lint
  - typecheck
  - build
  - full-frozen-head-unit-suite
  - pr-governance
  - independent-exact-head-adversarial-review
approvalGates:
  - plan-approved
  - t3-scope-preauthorized
  - integration-ready
  - dee-653-exact-head-admission
includedIssues:
  - id: DEE-681
    role: A-contracts-vocabulary-source-mapping-validators
    completionPolicy: manual-at-integration-ready
    status: in-progress
  - id: DEE-682
    role: B-postgres-pit-trust-measurement-lineage
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-683
    role: C-gateway-pit-replay-bridge
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-684
    role: D-source-consumer-bypass-closure
    completionPolicy: manual-at-integration-ready
    status: pending
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: DEE-681
  completedWorkPackages: []
  remainingWorkPackages: [DEE-681, DEE-682, DEE-683, DEE-684]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Commit the admitted manifest, then implement and validate DEE-681 contracts."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: "frozen head 7f9072b1c5bc9b9f752b7a2b660225a5682420cf"
  scopeAmendment:
    authorizedAt: 2026-08-23
    sourceThread: 01a019c0-8940-7272-bc9c-6b330e6bf0f2
    scope: "Order-independent Reality V2 0160 migration-identity test compatibility only; no Reality implementation or semantic change."
  inventoryAmendment:
    authorizedAt: 2026-08-23
    sourceThread: 01a019c0-8940-7272-bc9c-6b330e6bf0f2
    base: a4242a4b50da6415836ba1a83cd53c6073c556a2
    scope: "Mechanical Reality V2 source-inventory count/digest refresh for the three already-admitted DEE-620 market-data files plus its focused exact-count assertion only; preserve every disposition and semantic boundary."
  reviewRemediation:
    authorizedAt: 2026-08-23
    sourceThread: 01a019c0-8940-7272-bc9c-6b330e6bf0f2
    reviewedHead: f734d44196b48e2f1759a426faf6fc6520ee2dad
    scope: "Smallest fail-closed corrections for content-addressed Measurement identity authentication, admitted internal MSV lineage, and explicit unavailable news replay provenance; no new source class or scientific semantic."
---

# DEE-680 — Canonical PIT Observation + Inert Measurement Lineage

## Ratified authority and ownership

- Human-ratified parent scope: DEE-620, confirmed 2026-08-23.
- Human-ratified narrow compatibility amendment: after frozen head `7f9072b1c5bc9b9f752b7a2b660225a5682420cf` exposed the obsolete assumption that Reality V2 migration `0160` must remain the permanent journal tail, the Human authorized re-admission of the same four-child train with only `tests/unit/trader-reality-v2-migration-identity.test.ts` added to DEE-682. The amendment preserves every exact `0160` identity/content/uniqueness assertion and permits only an order-independent exact journal-entry lookup; no Reality implementation or semantics may change. Authorization source: Codex task `01a019c0-8940-7272-bc9c-6b330e6bf0f2`, 2026-08-23; mirrored on Linear DEE-680 and DEE-682.
- Human-ratified inventory provenance amendment: the same source task and standing mechanical-base authority authorize readmission onto `origin/main@a4242a4b50da6415836ba1a83cd53c6073c556a2`, the exact Reality V2 source-inventory identity refresh required by the three already-admitted DEE-620 market-data files, and the focused consumer-graph assertion that must report that exact count. The non-overlapping DEE-618 public transparency UI, DEE-673 public Linear read model, and DEE-617 Treasury public read model are preserved byte-for-byte. Every Reality disposition, implementation semantic, allowlist, exclusion, and fail-uncertain boundary remains unchanged. Authorization is mirrored on Linear DEE-680 and DEE-684.
- Standing Human authority from the same source task admits the smallest ordinary correction inside already-ratified semantics. The independent review of frozen head `f734d44196b48e2f1759a426faf6fc6520ee2dad` therefore re-admits only: recomputation of inert Measurement definition/value identities, structural lineage for the already-admitted internal `msv_envelope` without external trust fields, and a registered `news_headline` provider identity for the existing explicit unavailable replay lane. No new source class, formula, unit/window choice, evaluator, or downstream authority is introduced.
- Authoritative base: `origin/main@a4242a4b50da6415836ba1a83cd53c6073c556a2`.
- Integration owner: one visible owner across DEE-681 → DEE-682 → DEE-683 → DEE-684.
- Integration boundary: one branch/worktree, one admitted/frozen manifest, one next-numbered PostgreSQL migration, one journal/tracker update, one PR to `main`, one squash merge, and one revert-PR rollback.
- Duplicate audit: DEE-680 is the only active non-duplicate Integration Batch under DEE-620; it has exactly the four children above. No remote canonical branch or GitHub PR existed at admission.
- Dependencies DEE-597, DEE-628, DEE-653, and DEE-654 are Done. Existing DEE-654/656 foundations are reused; no parallel Source/provenance namespace is created.

## Goal

Close the gateway-to-canonical lineage gap for a fixed primitive vocabulary. Persist exact point-in-time Source/trust/Observation lineage and inert Measurement definition/value identity without adding formulas, scientific parameter choices, an economic evaluator, or any capital authority.

## Closed vocabulary

Primitive canonical Observation kinds are exactly:

1. `msv_envelope`
2. `ohlcv_bar`
3. `quote_l1`
4. `order_book_snapshot`
5. `market_trades_snapshot`
6. `fear_greed_index`
7. `news_headline`

The remaining 11 current gateway kinds are exactly `EXCLUDED_UNMODELED` at the primitive Observation boundary:

- `global_market_stats`
- `cross_exchange_confirmation`
- `macro_series`
- `macro_calendar_event`
- `macro_probability`
- `news_event_cluster`
- `exchange_announcement`
- `protocol_release`
- `blockchain_network_stats`
- `regulatory_filing`
- `mempool_stats`

`cross_exchange_confirmation` and `news_event_cluster` are reserved downstream Measurement categories. They are never primitive Observations and are still `EXCLUDED_UNMODELED` when presented to the primitive gateway bridge.

## Work packages

### DEE-681 — contracts and vocabulary

- Freeze the seven-kind canonical vocabulary and exhaustive 17-kind gateway disposition map.
- Define exact provider/source logical-key mapping from existing gateway provenance into the existing `trader_mi_source` namespace.
- Add default-deny structural validators for admitted normalized inputs and inert MeasurementDefinition/MeasurementValue identity and lineage.
- Keep definitions contract-only: no formula, unit, window, parameter calibration, or evaluator.

Expected implementation surfaces:

- `lib/trader/mi/canonical-observation-v1.ts`
- `lib/trader/mi/measurement-lineage-v1.ts`
- `lib/trader/mi/observation.types.ts`
- `lib/trader/mi/measurement.types.ts`
- `lib/trader/market-data/observation-types.ts`
- `lib/trader/market-data/provider-registry.ts`
- `lib/trader/market-data/normalization/canonical-pit-contract.ts`
- `tests/unit/trader-mi-canonical-contracts.test.ts`

### DEE-682 — PostgreSQL persistence

- Hand-author exactly `0161_trader_mi_canonical_pit_lineage_v1.sql`, append its journal entry, update `db/schema.postgres.ts`, and record the identity in `docs/migrations/DEE-64-TRACKER.md`.
- Extend the existing MI Source/Observation/Measurement namespace additively; preserve exact historical trust revision identity and append-only revision chains.
- Persist service-only, tenant-scoped PIT admission receipts and inert MeasurementValue lineage with authenticated/anon deny RLS.
- Prove real-role CRUD denial, organization isolation, same-organization foreign keys, append-only mutation rejection, deterministic idempotency, and trust-as-of binding on fresh PostgreSQL.
- Mechanically keep Reality V2 migration `0160` identity/content/uniqueness proof compatible with legitimate later journal entries by replacing only its tail-position lookup with an order-independent exact-entry lookup.

Expected implementation surfaces:

- `db/schema.postgres.ts`
- `db/migrations_postgres/0161_trader_mi_canonical_pit_lineage_v1.sql`
- `db/migrations_postgres/meta/_journal.json`
- `docs/migrations/DEE-64-TRACKER.md`
- `lib/trader/mi/canonical-pit-repository-postgres.ts`
- `tests/unit/trader-mi-canonical-pit-migration-identity.test.ts`
- `tests/unit/forecast-v2-applied-migration-identity-v1.test.ts`
- `tests/unit/trader-reality-v2-migration-identity.test.ts`
- `tests/integration/postgres-mi-canonical-pit-lineage-v1.test.ts`

### DEE-683 — deterministic gateway and replay bridge

- Map admitted normalized gateway inputs into the canonical PIT repository with `AVAILABLE`, `UNAVAILABLE`, or `REJECTED` receipts.
- Resolve exact Source and trust-as-of identity at the PIT anchor; never use current/latest trust during replay.
- Reject excluded kinds, invalid inputs, stale inputs, unknown trust, and inconsistent chronology explicitly. Never substitute zero, stale, synthetic, or unrelated observations.
- Use the same pure canonicalization path for live gateway-shaped inputs and historical replay; Measurement definitions remain inert.

Expected implementation surfaces:

- `lib/trader/mi/canonical-pit-service-postgres.ts`
- `lib/trader/market-data/market-data-gateway.ts`
- `lib/trader/market-data/normalization/gateway-to-canonical-pit.ts`
- `lib/trader/market-data/replay/canonical-pit-replay.ts`
- `lib/trader/market-data/replay/replay-lane-normalizer.ts`
- `tests/unit/trader-market-data-canonical-pit-bridge.test.ts`
- `tests/unit/trader-market-data-canonical-pit-replay.test.ts`
- `tests/integration/postgres-mi-canonical-pit-lineage-v1.test.ts`

### DEE-684 — repository-wide closure

- Inventory all 17 normalized gateway kinds, registered provider/kind producers, gateway aggregation paths, replay paths, MI consumers, and possible bypasses.
- Prove all six external admitted primitive kinds plus internal `msv_envelope` have one canonical disposition; the 11 excluded kinds cannot enter primitive persistence.
- Prove the two downstream categories remain Measurement-only and no Formula/Forecast/Decision/Risk/Execution/Reality/holdout/capital path is introduced.
- Close end-to-end representative market (`ohlcv_bar`) and non-price (`news_headline`) Source → trust-as-of → PIT Observation → inert MeasurementValue lineage, including tenant and replay determinism.
- Mechanically refresh the pinned Reality V2 source-inventory count and digests for the three admitted DEE-620 market-data files without changing any inventory rule or disposition.
- Mechanically update only the focused consumer-graph expected source count to the same exact inventory count.

Expected implementation surfaces:

- `docs/ai-trader/reality-v2-source-consumer-inventory.json`
- `lib/trader/mi/canonical-source-consumer-inventory-v1.ts`
- `tests/unit/trader-mi-canonical-source-consumer-closure.test.ts`
- `tests/unit/trader-market-data-canonical-pit-bridge.test.ts`
- `tests/integration/postgres-mi-canonical-pit-lineage-v1.test.ts`
- `tests/unit/trader-reality-v2-consumer-graph.test.ts`

## Validation and freeze

After each serialized child commit, run its focused tests plus cumulative focused tests for all earlier waves, typecheck, and scoped lint. DEE-682 and later require a freshly migrated disposable PostgreSQL database with real `authenticated` and `anon` roles.

After DEE-684, freeze the manifest and complete diff. Run once on the immutable frozen head:

- fresh migration apply from an empty PostgreSQL database through `0161` and PostgreSQL smoke;
- focused PostgreSQL/tenant/replay closure;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm build`;
- a fresh migrated SQLite database plus the full unit suite, solely as explicitly Human-required frozen-head evidence;
- canonical and PR-governance validation/preflight.

Then obtain one independent exact-head adversarial review with zero unresolved P1/P2. Any material base/head/manifest change invalidates affected evidence and requires refreeze. Open exactly one PR only after all local gates pass; authoritative GitHub CI/PostgreSQL and a fresh DEE-653 exact-base/head admission are required before any controller squash merge.

## Acceptance criteria

1. Exactly the seven ratified primitive Observation kinds are canonical; all 11 remaining gateway kinds are explicit `EXCLUDED_UNMODELED` and the two reserved downstream categories never validate as primitive Observations.
2. Every persisted external Observation carries organization scope, existing canonical Source identity, event/availability/ingest chronology, immutable normalized-input and content digests, exact trust-as-of revision, schema version, and append-only revision lineage.
3. Every bridge attempt is content-addressed and explicitly `AVAILABLE`, `UNAVAILABLE`, or `REJECTED`; no zero, stale, synthetic, unrelated, current-trust, or silently dropped fallback exists.
4. Inert Measurement definitions pin admitted input kind/schema identities, and MeasurementValue identities trace to the exact definition digest and exact PIT Observation/trust digests without formula or economic evaluation.
5. Identical gateway and replay inputs produce identical Observation, receipt, and lineage digests; missing/future trust and future data fail closed.
6. Real PostgreSQL proves service-role CRUD, append-only behavior, authenticated/anon denial, organization isolation, cross-tenant reference denial, and deterministic idempotency.
7. Repository-wide inventory proves every current source producer, gateway/replay path, MI consumer, and bypass disposition; representative market and non-price paths close end to end.
8. The diff stays inside the admitted surfaces and changes no Forecast, Decision, Risk, Execution, Reality implementation/semantics, holdout, credential, production, live, capital, security-policy, retention, raw-storage-policy, or scientific/formula semantics. The only Reality-owned surfaces are the Human-authorized migration-identity test lookup correction, mechanical source-inventory identity refresh, and its exact-count proof assertion above.

## Non-goals and STOP conditions

No Forecast, Decision, Risk, Execution, Reality implementation/semantic, holdout, provider credential, production, live, capital, security-policy, retention, or raw-storage-policy change. No new source class. No formula, scientific units/windows/parameter choice, economic value evaluator, source→BUY/SELL shortcut, or final first-live REQUIRED/OPTIONAL classification. The exact test-only Reality compatibility amendment, mechanical Reality inventory identity refresh, and its focused numeric proof above are the sole exceptions.

STOP on a new source class, any formula/scientific semantic choice, security/retention/raw-storage/holdout/capital/production surface, semantic conflict with current `origin/main`, unadmitted file/schema surface, migration collision, or an unfixable required gate.

## Rollback

Rollback is one revert PR of the squash commit. No destructive down migration, production SQL, release tag, deploy, credential operation, holdout access, or Execution Server action is authorized.
