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
  nextAction: "Wire BOTH canonical input/outcome references into persistence and replay; bounded PostgreSQL transport passes focused tests but is not yet called by production paths."
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
