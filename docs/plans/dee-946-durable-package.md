---
integrationIssue: DEE-946
integrationTitle: "Bounded lossless predictive package persistence"
branch: dee-946-durable-package
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, build, targeted-unit, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge, human-production-rollout]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-PERSISTENCE
  completedWorkPackages: [WP-CODEC, WP-ASYNC-HYDRATION]
  remainingWorkPackages: [WP-PERSISTENCE, WP-REVIEW]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-06"
  blockedReason: null
  nextAction: "Inspect full sequential Historical V2 test session 38010 on new local DB waia_hsv2_it_dee946_v3; bounded NON_ACTIONABLE commit/resume is wired. Then actual full-data resource measurement, review and PR gates."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
  humanApproval: "2026-09-06 new user turn authorizes DEE-946–951 implementation and PR preparation; no merge, deployment or real account."
---

# DEE-946 — codec and storage implemented, integration incomplete

## Authorized scope

Pure bounded-byte lossless codec for the existing in-memory PredictivePackageV1. Store canonical source anchors once and each pool observation as its exact resample ordinal and source index. Preserve pool order, duplicate bootstrap draws, raw float64 values, Buffers, family, grid and existing scientific digests. Reject duplicate source identities, mismatched anchor contents, invalid indices/ordinals, missing/reordered/substituted chunks and wrong organization/package identity. An externally trusted manifest digest is mandatory at decode; a self-supplied checksum is not authorization.

Each wire chunk and each individually serialized record is bounded. Never stringify the complete package/corpus/pool. The streaming encoder yields at most 64 KiB per chunk and returns the sealed ordered manifest only after complete encoding; hydration accepts an iterable and consumes one chunk at a time. The convenience collector retains all chunks and is for local/small callers. Both retain the original or restored in-memory scientific package and descriptor metadata, so do not claim constant total process memory or database durability. Existing replica artifact payloads contain only metadata, so cannot substitute for this complete representation.

## Remaining integration work

The additive storage migration, RLS and bounded PostgreSQL transport now exist locally and have focused local PostgreSQL tests. Production-callsite wiring, canonical input/outcome reference versions, complete retry/replay integration and full-corpus runtime requalification remain root-owned follow-up. No production mutation, credentials, scientific-law change, corpus reduction or qualification PASS is included here. DEE-946 must not be closed on codec or storage tests alone.

## Validation

Use real buildPredictivePackageV1 fixtures, deep equality after round trip, existing pool replay validators, precise Buffer/float preservation, bounded chunks, tamper and substitution negatives. Run focused tests, typecheck and lint; no commit/push before root review.

## Phase 1 evidence and cost boundary

Focused regression suite covers actual-builder round-trip, existing pool replay verification, duplicate draw preservation, incremental encode/hydrate, byte limits, chunk mutation/order/count/length/missing/extra errors, wrong scoped trusted identity, source-index and resample-ordinal errors, same-ID sub-quantizer outcome substitution, duplicate source identities, source record shape, stubbed scientific digests and iterator cleanup. Full local TypeScript and focused ESLint checks pass before root review; no final commit SHA exists yet.

The codec recomputes existing family/package/pool/artifact/grid digests without refitting or inventing replacement digests. This is not scientific qualification: trusted manifest identity must be obtained from an authorized immutable reference, existing admission/replay validation remains required, and full-corpus cost/load and durable storage tests remain pending. On partial encoder failure no completion manifest is returned; later persistence must stage chunks and publish atomically only after successful final manifest and authority validation.

## Concrete phase 2 integration contract (partially implemented)

Add an immutable manifest table and byte-bounded chunk table with composite organization/package/codec keys. Recheck the next migration number (0203 at the audited base). Reference the canonical package through a same-organization foreign key; chunks include ordinal, byte length, record count and SHA-256. Enforce byte length <=65536 and exact payload length/hash in PostgreSQL. Normalize chunk descriptors as rows, never a giant JSON manifest. Enable tenant RLS using the existing authorized runner organization restriction, INSERT/SELECT only; no DELETE/TRUNCATE/BYPASSRLS or ownership changes. Preserve existing rows.

Inside the existing package transaction, drain the encoder into bounded inserts, publish the final manifest only after complete encoding, and verify contiguous chunk coverage. Use a deferred chunk-to-manifest FK and an end-of-transaction completion guard so partial publication cannot commit. On conflict compare the exact existing seal; never treat mismatched ON CONFLICT DO NOTHING as success. Existing metadata-only package early return must ensure the complete durable artifact exists. Avoid reserializing an unchanged package on every economic cycle.

Introduce versioned storage-wire references for BOTH runtimeInput.predictivePackage and authorizedOutcome.issuance.package. Bind organization, canonical package ID, generation/content/manifest digests and codec version; preserve a validated small family summary for migration 0192 symbol CHECKs and next-cycle horizon access. New wire/verifier versions must not reinterpret old full-JSON digests. Preserve a strict legacy-read path and unchanged in-memory scientific package identity/validation.

Required coordinated call sites:

- forecast-v2-persistence-service: full-input digest/clone, natural retry outcome comparison, bundle outcome, source input and source outcome.
- pit-forecast-input-producer-v2 and pit-forecast-input-loader-v2: verify bounded stored wire then hydrate before unchanged scientific/knowledge/replay validation.
- production-next-cycle-preparation-v2: canonical or verified-summary horizon lookup.
- canonical-verification-receipt-postgres-v2: hydrate before requireForecastRuntimeAuthorizedOutcomeV2.
- outcome-resolution/epistemic-closure-runtime and forecast-runtime-authority-v2 revival: structural/async hydration, not a whole-package JSON round-trip.

The codec now accepts synchronous and asynchronous chunk iterables through a shared parser and scientific validator. PostgreSQL must supply a bounded cursor or page iterator; SELECT-all payload arrays and JSON aggregation are not an acceptable substitute. This is still a full in-memory scientific package after hydration, not constant total memory. Measure cost before choosing a transaction/storage execution plan.

Phase 2 gates: PG17 restricted-admin fresh migration, actual runner RLS negatives, interrupted publication rollback, missing/reordered/tampered chunks, concurrent identical retry and conflicting seal refusal, first/next cycle, process restart/outcome resolution, exact deterministic scientific parity and full-corpus resource measurement. A codec unit PASS does not satisfy any of those database or production gates.

## Async hydration work package — 2026-09-06

Implemented `hydratePredictivePackageAsyncV1` with one outstanding chunk read, no payload collection, shared record parsing/scientific validation, admission before opening a cursor, copied manifest descriptors and trusted identity to prevent mutation across awaits, and awaited cursor cleanup. When both reading and cleanup fail, both errors and the primary cause are retained; cleanup failure after a valid read still refuses success. The synchronous transport continues through the same parser.

37 focused codec tests PASS (original 26 plus 11 asynchronous cases); full TypeScript check, scoped ESLint and diff check PASS. Covers exact real-builder/replay parity, missing/extra/reordered/corrupt chunks, sealed invalid draw indices, denied admission without opening input, caller mutation, one in-flight read, source failure and cleanup failure. Not yet database persistence, not a full-corpus benchmark, not independent review or PR readiness.

## PostgreSQL transport work package — 2026-09-06 19:19 UTC

Implemented local migration 0203, Drizzle table definitions, immutable manifest/chunk tables, same-organization canonical-package lineage, byte/hash constraints, deferred chunk-to-manifest FK, once-per-seal contiguous-coverage verification and package-scoped publication locks. UPDATE/DELETE/TRUNCATE are refused even for an ordinary table owner; runner receives only SELECT/INSERT with the existing fixed-organization RLS boundary. No role privilege escalation, extension, existing-row rewrite or production apply.

The new server-only storage module streams inserts/read pages of at most eight 64-KiB payloads (512 KiB/page), retains descriptor metadata rather than payload collections, validates the immutable seal, retries root serializable conflicts, skips re-encoding an existing matching sealed artifact and reconstructs through the tested asynchronous codec. It is not yet wired into Forecast input/outcome persistence or replay.

Fresh local PostgreSQL 17 migration journal through 0203 PASS. The new migration separately applies within a rollback-only probe as an administrator with no SUPERUSER, BYPASSRLS, CREATEROLE or CREATEDB. 18 PostgreSQL tests + 37 codec tests PASS: actual runner round-trip and byte equality, bounded rows, retry, wrong identities/seal, partial/empty/gapped/extra/oversized publication rollback, byte tampering, forbidden mutation privileges, actual other-tenant invisibility, post-seal extension refusal, owner immutability, concurrent identical publication and new-connection hydration. One initial owner-TRUNCATE test was preempted by PostgreSQL pending deferred trigger events; the corrected probe flushes constraints before asserting the actual immutable trigger. No runtime protection was weakened.

Remaining: both versioned wire surfaces, canonical consumers/outcome/restart integration, full-data resource measurement, independent review and complete PR gates. These local tests are not an end-to-end Historical Simulation PASS or production readiness. Test fixtures are synthetic and stay only in a dedicated localhost PostgreSQL container; no production data was copied.

## Versioned wire adapters — 2026-09-06 19:32 UTC

Added server-only `forecast-package-wire-v1.ts` adapters for BOTH runtime input and authorized outcome. A package becomes an explicit `waia.trader.forecast_package_reference.v1` reference binding organization, canonical package ID, codec/generation/content/manifest digests and the small family summary. Exact reference shape and scope are checked before storage access; the summary must equal the hydrated family. Other metadata has a conservative 4-MiB pre-serialization budget; corpus/pools are replaced before traversal. The wire keeps the existing top-level JSON fields required by 0189/0192. These adapters do not mint Forecast authority; normal issue/replay validation still follows hydration. Unknown reference versions are refused; legacy full-package JSON is read separately.

New wire regressions use an actual authorized Forecast fixture, the real bounded codec and a mocked DB transport (the storage layer has its separate actual PostgreSQL tests). They verify both round-trips, identical regenerated Forecast and validator outcome, no corpus/pool traversal on encoding, symbol preservation, wrong organization/package/version/extra authority/digest refusal before I/O, wrong trusted seal, family substitution, legacy parity and metadata size/cycle/nonfinite refusal. Combined 82 tests PASS (27 runtime/wire, 37 codec, 18 PostgreSQL), full TypeScript/scoped lint/diff checks PASS. This is transport validation, not a full historical cycle or production launch.

### Exact remaining integration changes identified from current source

1. `persistPredictivePackageV2InTransaction`: ensure storage before BOTH metadata-only existing return and new return. Do not publish an incomplete canonical package.
2. `validateRuntimeInputSource` currently hashes `replay` and whole `JSON.parse(JSON.stringify(runtimeInput))`; separate scientific replay validation from bounded wire hashing. New source verifier is `waia.forecast-runtime-input-source.verifier.v3`; existing v2 bytes/hashes must retain strict legacy semantics. DB row schema can stay v2 because outer fields/checks are unchanged; inner package and verifier explicitly distinguish new representation.
3. `loadExistingBundleByNaturalIdentity`: hydrate existing outcome for comparison; select source verifier version and verify legacy/new digests without rewriting old evidence. New bundle/source writes serialize bounded input/outcome wires only, within their issuance transaction.
4. PIT producer currently revives full source, compares full canonical outcome strings, clones the hydrated full input into its record. Instead validate durable wire digest/version, hydrate for science, and persist the original bounded wire. Add canonical package ID to the source query for exact scope.
5. PIT loader's synchronous `assertHistoricalForecastInputPitBindingV2` has tests and legacy callers. Separate durable wire/row digest validation from hydrated replay validation; do not pass hydrated objects into checks of stored-wire hashes. Validate wire first, hydrate asynchronously in the real loader, and compare canonical/source/outcome before replay. Preserve all PIT/knowledge/scientific checks. Its final full-JSON clone must be removed or replaced without losing value/prototype semantics.
6. Canonical receipt verifier has THREE outcome reads (Forecast, scientific receipt, Decision preparation) requiring scoped hydration before the existing require function. Select canonical package ID on each. Outcome-resolution restart loop also needs it. Next-cycle lookup already reads the retained small family horizon but needs version/identity validation.
7. `reviveForecastRuntimeJsonV2` still uses a whole JSON round-trip, and legacy semantic digest computation uses a corpus-sized canonical string. Avoid routing hydrated packages through these. If changing shared helpers, prove exact existing Buffer/number/ordering/undefined semantics with regression vectors; never reinterpret legacy digests or silently skip validation.

No production callsites use the new wire yet; do not report this phase as integration complete. Already merged PR558/559 were cleanly integrated from origin/main into this local branch before adapter work. Their CI is historical evidence, not validation of this new branch head.

## Authorized-path integration — 2026-09-06 19:58 UTC (supersedes adapter-only status)

Canonical package persistence now publishes immutable complete storage in the same transaction, including the existing-metadata path. Bundle and runtime-source persistence use both bounded wire surfaces with explicit source verifier v3. Natural retries validate version, stored hashes, trusted package identity and hydrated exact values; legacy v2 hashes retain their old meaning. Scoped streaming semantic hashing avoids corpus-sized strings and has parity vectors (Buffer, JSON Buffer, numeric keys, Unicode, -0 and sparse arrays); prototype-mutating keys are explicitly refused. Legacy package decoding structurally revives jsonb without a full-package stringify, preserving old Buffer/JSON values and rejecting executable/custom-prototype inputs.

PIT producer retains the stored bounded wire, hydrating only for the unchanged scientific/PIT/knowledge replay. The asynchronous PIT loader checks wire/row identity separately from hydrated replay and no longer creates a package-sized JSON string on return. All three canonical outcome verifiers and outcome-resolution restart hydrate the exact organization/package reference before require/replay. Next-cycle horizon is read from canonical same-org package metadata rather than the whole input JSON. No scientific criterion or authorization gate removed.

Focused validation: 103 unit tests PASS, 19 actual PG17 storage tests PASS (including new canonical persistence/atomic seal/idempotency test), all 6 PostgreSQL Forecast persistence tests PASS including restart, outcome resolution and real general/paper callers. Additional SQL assertions prove both stored wires contain no inline corpus/pools, remain below 50 KiB for the test fixture and match one immutable manifest. Full TypeScript/scoped ESLint/diff checks pass. Initial local test failures were an omitted required build SHA, deferred-FK fixture cleanup ordering and absent native better-sqlite3 binary; these were corrected in local setup/scoped fixture cleanup without weakening production protections. This is not CI or full Historical V2 PASS.

A full Historical production-first/35-cycle/restart/negative suite is running in a separate freshly migrated PG17 database `waia_hsv2_it_dee946` on the existing dedicated localhost container. It has not returned a result; no timeout/assertion changes were made. Session 48768 began about 19:53 UTC. The existing test-only execution authority is restricted to this local modeled proof, not production/live permission.

**Additional in-scope callsite found during integration audit:** `non-actionable-forecast-source-v2.ts` still JSON-round-trips the complete runtime input and stores it in atomic stage artifacts. The allowed HYPOTHESIS_NOT_APPLICABLE path can hit the same size failure even when authorized Forecast persistence is bounded. It must receive an explicit bounded source-wire version with scoped hydration in atomic-cycle commit/resume; retain complete negative evidence, exact refusal checks, source/verification digests and in-memory Forecast input. Do not omit the package, weaken the abstention proof or declare DEE946 complete while this path remains. First/next graph result, this transport, full-corpus resource measurement, independent review and complete PR gates are still pending. No push, production migration or deployment.

## Negative-source transport and preflight — 2026-09-06 20:19 UTC

This checkpoint supersedes the preceding missing NON_ACTIONABLE transport statement. The new source/verification V3 uses a bounded immutable package reference, explicit new hashes/verifier version, same organization/symbol binding and complete negative evidence. Next-cycle preparation keeps the full scientific runtime input separately; atomic commit and resume validate source/release/wire seals, hydrate the exact canonical package and replay the unchanged sole HYPOTHESIS_NOT_APPLICABLE condition. Strict legacy V2 read semantics remain. No caller receives live/Human authority, and no package is omitted. Unit fixtures using the actual issuer and codec cover bounded replay, wrong scope/release/version/seal, downgrade, legacy compatibility, invalid refusal, missing expected scope and mutation across asynchronous hydration. The preparation orchestration fixture remains explicitly mocked; it is not scientific proof.

Full suite session48768 ended 12 PASS /1 FAIL /1 skipped. The 35-cycle case failed before cycles because schema preflight's explicit journal ended at0202. The local branch now requires0203 and its two tables; missing/unknown migrations continue to refuse. Nine focused preflight tests PASS. A retry on the populated local DB stopped during setup at an order-sensitive JSON.stringify HTX-volume receipt conflict; preserve this separate negative finding for a minimal idempotency regression, do not silently suppress it. A fresh DB with only the35-cycle case selected then refused RUN_AUTHORITY because the sequential suite's earlier test creates its run-start. Neither attempt is a 35-cycle PASS. The complete sequential suite (including its first-cycle setup and every35-cycle assertion) is now running as session38010 in fresh local database waia_hsv2_it_dee946_v3, after all migrations through0203. Old local DBs remain intact. No timeout changes or production mutations.

Focused source/preparation/preflight checks pass; full TypeScript passes; scoped ESLint has0errors and one pre-existing unused-function warning in atomic-cycle repository. Full graph result, full-corpus resource cost, independent review and full PR gates remain open. No Historical or Live readiness claim.

## In-flight database proof and local build — 2026-09-06 20:35 UTC

Full local lint passed with307warnings/0errors; TypeScript passed; Next production build passed (after ordinary sandbox escalation for its localhost build port). Not a deployment or Cloudflare runtime receipt. Session38010 continues without timeout changes. A read-only progress query first observed14committed cycles; the added SQL regression query was executed independently on11completed NON_ACTIONABLE artifacts from the same run: all sourceV3/referenceV1, all linked to an exact same-org manifest/codec/generation/content/seal, no inline corpus or replicaArtifacts, maximum JSONB payload17001bytes. This is an in-flight partial-run observation, NOT35-cyclePASS. The assertion is now part of the full integration test for the final CI head; the already-running process predates the assertion addition.

The separately reproduced retained-receipt retry defect is tracked as DEE-953, a separate minimal branch; do not silently include it in this issue. Full graph completion, full-data resource feasibility and review/CI remain required.

## Completed local graph proof — 2026-09-06 20:41 UTC

Session38010 completed successfully: 13 tests PASS /1 skipped, 1091.36 seconds total. The complete 35-cycle production-graph case passed in745.087seconds, including modeled opening/closing, economic accounting and future-only evidence closure; the suite's reserved-backend, durable-boundary recovery and actual-runner queue/consumer tests also passed. This remains a bounded local modeled fixture, not a production campaign or full-corpus feasibility/learning claim. Its process loaded the implementation before the later symbol-scope guard and newly added SQL regression; final-head CI is still required.

After completion, the new bounded-negative SQL query was executed independently against that same durable run: exactly35FORECAST_LIFECYCLEstages, 15NON_ACTIONABLEartifacts, allsourceV3/referenceV1, all exact same-org sealed-manifest joins, no inline corpus/pools, maxJSONBpayload17001bytes. No data, test length, assertions, timeout or scientific thresholds were reduced. The query is now checked into the35-cycle test for the eventual final-head CI.
