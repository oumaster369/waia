---
integrationIssue: DEE-1125
integrationTitle: "Retain and replay the exact accepted reporting-period basis"
branch: dee-1125-reporting-period-basis
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1125
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 68cb284730870617f5a3f952e7c1546b813d8465
  lastValidationAt: "2026-09-26T17:11:53Z"
  blockedReason: null
  nextAction: "Independent exact-snapshot review, then root accepted-base integration, mandatory CI registration and full readiness; preserve fresh merged migration-order proof."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1125 — exact reporting-period basis retention and replay

## WP-1 — mandatory owned retention and historical read consumer

One coherent work package implements the full controller-admitted Linear contract below. This canonical plan is committed before implementation. Accepted base: `56ee65f00f3b19858d57ea8f3947d2867822e9ac`. Parent DEE-638. Frozen design SHA256: `296709251ceb004f3dd6ddc28a6aa6feed01e85eee4d66a9c4ebd05f71df3da2`. Controller and M01 reviewed the design; implementation is not yet tested or accepted.

Root owns full readiness, sole native resource allocation, exact-head independent review, CI and publication. Author initially runs scoped units/lint only. All validation claims must identify their actual tested bytes and preserve initial failures. Native acceptance remains pending. This package does not qualify economic attribution, period completeness, prior consumption, automatic finality or live trading.

## Exact admitted Linear contract

# P08: mandatory period-basis retention and historical replay

Proposed implementation contract, frozen for controller review on accepted source **56ee65f00f3b19858d57ea8f3947d2867822e9ac**. This is an engineering prerequisite with a real write and read consumer. It is not a qualified financial producer, general economic-consumption control, or completion of P08. No implementation, test, database, venue, network, host, production or C3 operation was performed in preparing it.

The source study reads `M01/review-P08-P10-NEXT-21a60ec3.md` and the earlier after-OBSERVED report first. It accepts the review's correction: exact source discovery and basis retention may proceed under current canon; they do not require universal strategy decomposition, automatic finality or a new Human decision for every stored field. Evidence is pinned in `p08-period-basis-56ee65f0/source-manifest.json`, SHA256 `ba9ab132f19df4765c06508b07edf33652f4f81b1ae10852f358c2ea1f1642fb`: 58 immutable blobs, five complete production/caller searches and input-report hashes. A pinned blob is not a claim that every line was audited.

## 1. Deliverable and authority boundary

Every successful **new PostgreSQL public period close** must retain one immutable, exact basis alongside the existing period close, Core audit and any DRAFT. A real authorized API then retrieves that basis and reconstructs its accepted receipt and Reality dependency result at the **saved closing cutoff**, after connection/process recreation. Missing or inconsistent evidence remains visible and never becomes a zero, a regenerated history, or an upgraded financial claim.

Billing & HWM §§5 and10 already require reconstructable exact period inputs. The accepted implementation retains only the period's valued scalar payload, its digest and a dependency-summary audit; full receipt and settlement bodies disappear. Saving those admitted bodies is authorized engineering. The package keeps the current fee/HWM arithmetic, manual issuance, SQLite close refusal, receipt scope, SETTLED support restriction and every1120 admission refusal.

Explicit result limits remain:

* `economicAttribution: UNPROVEN`;
* `periodCompleteness: UNPROVEN`;
* `priorConsumption: UNPROVEN`;
* `realizedFillFinality: OPERATOR_VERIFICATION_REQUIRED`;
* `capitalAuthority: NONE`.

Historical replay means “these were the dependency-consistent inputs accepted by this close.” It does **not** mean current economic validity after subsequent corrections. It does not prove that all gains/losses were selected, that source money was previously unused, that opaque balance snapshot references resolve, or that an invoice is issuable. No new unique constraint across receipt, settlement or truth digests is introduced: such a constraint would silently choose a consumption model.

## 2. Actual production entry points and consumers

| Existing path at56ee | Required composition |
| -- | -- |
| `app/api/trader/admin/reporting-periods/commands/route.ts` → `handleAdminReportingPeriodCommandPost` → `createPostgresBillingPeriodCloseOrchestrator().closeAndMaterialize` | Mandatory retention through the same transaction-owning factory; retain exact account bytes and the existing admin permission/membership callback bound to that transaction. No handler outer transaction. |
| `createPostgresReportingPeriodLifecycleService().closeReportingPeriod` | Identical mandatory retention for the direct public factory. `lib/trader/live/build-live-cli-deps.ts:129` constructs this factory; it must not become a bypass. |
| Private bound lifecycle compositions in both factory modules | Own the retention writer. Existing `createReportingPeriodLifecycleService` remains the low-level dependency-composed core, not a security boundary. |
| Existing `materializeDraft`, invoice generation/issuance, period list and console period list | Preserve behavior; they do not synthesize a missing basis or claim historical source acceptance. No new money command is added. |
| Legacy live reporting bridge | Remains refused before effects without a durable binding. Do not repair or activate it in this package. |
| Bare repositories, pure builders and explicitly named historical test fixtures | Remain low-level composition tools, not public close admission. Their use must be labeled in tests; no optional production retention bypass is added to keep them green. |

Existing list readers (`reporting-periods-read.ts`, console `handlers/reporting-periods.ts`) return full period IDs, so a new read route can select an exact period without changing the current prefix-only close result. Add **GET** `/api/trader/admin/reporting-periods/[periodId]/basis?organization_id=…&exchange_account_id=…` as the actual replay consumer. No UI redesign or new trade action is needed. The existing query/list responses remain compatible.

The repository/caller search covers direct imports, the billing barrel and adapters, actual public factories, generic cores, live composition, script composition and SQL/Drizzle reporting-period references. It found no additional production close factory to upgrade in this bounded source. Future callers must use the same public factories. Privileged arbitrary SQL or a low-level repository is not transformed into a proof-authoring capability by this package.

## 3. Retained object and stable identity

Add `ReportingPeriodBasisV1`, schema `waia.trader.reporting_period_basis.v1`. It is a retention envelope; do not modify or reinterpret the sealed V2 receipt/settlement schemas.

The exact body contains:

1. `schemaVersion`, `capitalAuthority: NONE`;
2. `organizationId`, exact `exchangeAccountId`, full `reportingPeriodId`;
3. `period`: the existing `serializeReportingPeriodDigestInput` representation of the actual returned CLOSED row, plus its exact `recordContentDigest`. Thus the actual start/end, realized/unrealized values, equity, transfer disclosures, valuation source, snapshot timestamps and existing open-position snapshot reference are retained. Do not replace a preexisting OPEN period's actual start disclosure with a conflicting caller copy;
4. the full **admitted** `RealizedStrategyProfitReceiptV2`;
5. the full admitted `ClosedTradeSettlementV2[]`, sorted by content digest for the envelope, without changing any nested sealed content or discarding facts;
6. the exact `BillingRealityDependenciesMatched` result produced by the owned reader, including its complete binding/projection identity and all four unavailable/operator-verification statuses;
7. `ledgerReadSet`: complete immutable identity manifests for every source report, truth record and event actually loaded by the1120 owner, plus the exact selected projection identity. Each source/truth entry stores its ID and content digest; each event also stores its decimal sequence. Source/truth entries sort by ID, events by bigint sequence. Include source-only, quarantined and unrelated rows, even source rows with knowledge time later than the last event. No selected-fact subset may replace the actual owner read set;
8. the scoped close actor as `USER` with the already-authenticated `userId`, or `SERVICE` with no invented user identity. This records the current service contract; it creates no new authorization or attestation.

`contentDigestHex` is the existing semantic SHA256 of that complete canonical body. Require an exact top-level grammar, supported versions, canonical time/decimal handling, deterministic order, no duplicate settlement digest, and exact SQL-column/body equality. Rebuild the receipt from settlements using `admitCanonicalPeriodProfitFromReceiptV2`, use the actual period window, and compare the admitted profit to the retained period through the existing exact decimal semantics. Preserve valid zero, negative profit and different equivalent decimal spellings already accepted; do not use `Number` or add a profitability floor.

Use existing period serializer/verifier and V2 builders rather than a second fee or profit algorithm. Retain the original sealed body strings; sorting the outer settlement set is not normalization of their contents. The nested receipt/binding/settlement digest joins must agree. Read-set identities are unique and scoped; events are the exact contiguous1..N chain ending at the bound event digest/sequence, with all referenced source/truth identities present. Full ledger bodies remain in their existing append-only store; the new basis pins the actual read set instead of copying the entire ledger. A matching outer hash is content integrity, not authentication or proof of the caller's economic story.

Database `recorded_at` is service-generated metadata and is **outside** the canonical body. It is neither event finality nor a period-membership timestamp. Replay does not read a wall clock to re-seal old content.

## 4. One additive PostgreSQL relation

Add `trader_reporting_period_bases_v1` with:

* `reporting_period_id uuid PRIMARY KEY`, foreign key to the existing period ID;
* `organization_id uuid NOT NULL`, foreign key to Core organizations;
* exact nonempty `exchange_account_id text`;
* `schema_version`, `period_record_content_digest`, `receipt_content_digest`, `content_digest`;
* `reality_projection_id`, `reality_frontier_sequence bigint`, `reality_frontier_event_digest`, `reality_knowledge_as_of timestamptz`;
* `canonical_json text NOT NULL`, not a lossy reparsed replacement for sealed bytes;
* `recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()`.

Indexed columns are derived from the owned body, never accepted independently from a request. Add an org/account/period index for scoped lookup and the org foreign-key access path. Existing digest columns retain lower-case64-hex checks; frontier is positive and never converted through a JavaScript `number`. Exact JSON/schema/column checks and an insert guard require a scoped CLOSED period with matching `record_content_digest`. No new index on “consumed monetary facts” and no receipt-wide uniqueness rule.

The relation is append-only for normal application UPDATE/DELETE, has targeted RLS and explicit authenticated/anon denial/revocation consistent with Reality and ADR0007. Do not use SECURITY DEFINER to turn a browser caller into a writer. The service database remains trusted; neither a trigger nor a seal authenticates a hostile table owner. Foreign-key deletion is restrictive for retained financial evidence, not a new automatic deletion/correction path. Native teardown must use the existing explicit isolated-fixture discipline and restore all fault guards; no runtime cleanup bypass.

No trigger rewrites old periods. No migration backfills a receipt from PnL, and no old migration/schema registry is edited. Root reserves the **next unallocated migration number** at admission (pending1121 has independent schema work); the logical file is `NNNN_trader_reporting_period_bases_v1.sql` with its exact journal entry and schema declaration. This number reservation is integration bookkeeping, not an unresolved financial policy. Preserve prior SQL hashes and register only the new additive identity where existing compatibility manifests require it.

Store at most **16MiB canonical UTF-8 body**; SQL and runtime both reject oversize bodies. This is a technical capacity refusal, not a financial threshold. Check before insert; an oversize final body throws and the complete close transaction rolls back. Do not claim no SQL statement was attempted before that refusal.

## 5. Mandatory transaction ownership and write order

Keep the current outer owner unchanged in meaning:

`capture nested request/context before first await → real root DB ownership check → canonical org check → owned READ COMMITTED transaction → transaction-bound membership → exact candidate validation → existing Reality675 account lock → current complete ledger/projection match → existing close composition`.

Do not accept a caller-held Drizzle transaction/savepoint handle, an injected source reader, caller-supplied matched proof/read-set manifest, optional persister or public “skip retention” flag. Both public factory options remain membership-only. Preserve the existing copied-options lifetime and account/organization lock spelling.

After the actual owner loads and matches its ledger under675, it constructs and freezes the read-set manifest from those loaded objects. Extend only the internal `apply` callback payload of `runPostgresBillingRealityCommand` to carry that owned manifest alongside the unchanged public matched proof. Its two production consumers are the two factory wrappers; no request option or public source-reader injection is introduced. Capture this metadata before entering the effect callback.

Implement the small shared seam as an **internal bound repository decorator** used by the two private close compositions: its `closePeriod` calls the existing repository, validates/builds the basis from that actual returned row and the owner-captured candidate/proof/read-set, persists it using the same executor, then returns the unchanged row. This places retention before the existing close audit and automatic DRAFT. It avoids changing the generic public dependency-core contract or adding an optional public production hook. The decorator/held insert helper is internal infrastructure, not a new command accepting an arbitrary evidence packet.

The same transaction includes any existing HWM bootstrap/open, period close, basis row, close audit, and billable DRAFT/audit. A failure at any of these storage points rolls back every new effect. A nonbillable close still retains its basis and close audit; absence of a DRAFT is a valid result. Existing nonbillable handling and history-cap controls stay exact.

One period owns one immutable basis. A held insert may reread an exact identical row after an insert conflict and return it; any content/scope difference refuses. This does not change public repeat-close semantics: an already CLOSED period remains the existing normal duplicate-window/not-open refusal. A lost response is investigated through the read route; do not reinterpret it as permission to create a second period.

Preserve ordering: Reality675 precedes existing HWM/open/period writes and the basis insert; no invoice lock or HWM-anchor lock is newly acquired. The basis FK/insert check reads the same period that this transaction has just updated. It must not introduce an inverse lock against the separate invoice→bootstrap issuance protocol. Reality675 is only the cooperative source-writer protocol; it is not a universal invoice/HWM snapshot or financial consumption mutex.

## 6. Real historical read/replay consumer

Add `readReportingPeriodBasisV1Postgres` and the actual route handler. Input is only `{periodId, exchangeAccountId}` plus separately supplied authenticated scope. No request receipt, proof, time cutoff, evaluator callback, source rows or “latest” selector is accepted.

The handler uses existing `authorizeAdminRoute(..., 'admin.audit.read')`, server runtime resolution and exactly-once disposal. It does not accept user identity from the body/query. Preserve exact account bytes; no trimming into another account. A syntactically missing/invalid identifier is400; a nonexistent or foreign-scope period is the same404 envelope. SQLite returns an explicit supported-backend refusal; do not add SQLite storage. Do not widen a role or consult exchange credentials.

The public reader copies its small input/context before awaiting and owns a **read-only REPEATABLE READ transaction**, established before membership/data queries. A caller-held transaction is refused. The permission/membership callback is bound to that same executor. No675 writer lock is necessary in this historical snapshot. No read path updates a projection, backfills a basis, emits a close/DRAFT/audit, or changes HWM.

Read/replay sequence:

1. Scoped period lookup through the existing validated mapper. Require CLOSED; verify its exact current retained valued-payload/digest against the stored basis. Mutable database `updated_at` and invoice state are not part of the saved basis body.
2. Read basis header and `octet_length(canonical_json)` before transferring its full text; reject oversize. Parse exact grammar, recompute canonical text/digest, compare every duplicated SQL identity, verify the period payload digest and rebuild the saved receipt from saved settlements/window. Do not silently rebuild and replace a corrupt supplied receipt.
3. Load **exactly the saved manifest identities** under organization/account predicates and the exact saved projection ID. Add small scoped exact-ID read helpers beside the existing Reality row mappers, reusing their validation; do not duplicate those mappers or use raw JSON as trusted rows. Compare every returned ID/digest, exact cardinalities, duplicate absence, event1..N ordering/head and projection binding. Missing rows are unavailable, changed bodies are mismatch. Keep source-only and quarantine rows in the reconstructed set. A source-only observation may be later than the event head; a truth inserted later can copy an older source knowledge time. Therefore **time alone is explicitly insufficient**: do not reconstruct with only `knowledge_at <= savedTime`, a latest projection selector, or a current live ledger. The saved time is part of the exact projection identity, not a substitute for the recorded read set.
4. Run the existing pure `matchBillingRealityDependencies` with that exact historical read set and saved candidate. Its complete fold, selected fact/body/type/asset/cost checks, supersession and selected uncertainty checks remain unchanged. Compare the returned proof to the saved proof exactly. This is historical replay, not a new current-head close admission.
5. Return the full immutable basis, content identity and `status: BASIS_REPLAYED_AT_CLOSE`. Also return `currentEconomicValidity: NOT_ASSESSED` and the original four proof limitations. Later valid corrections, new observations or unrelated uncertainties do not make the old historical statement disappear or turn into current eligibility.

Status/refusal distinctions are mandatory: `PERIOD_NOT_CLOSED`; `BASIS_MISSING` (legacy **or otherwise unrecorded**, never assumed legitimate legacy); `BASIS_SCHEMA_UNAVAILABLE`; `BASIS_VERSION_UNSUPPORTED`; `BASIS_CONTENT_INVALID`; `BASIS_PERIOD_MISMATCH`; `BASIS_SOURCE_REPLAY_UNAVAILABLE`; `BASIS_SOURCE_REPLAY_MISMATCH`; `BASIS_CAPACITY_EXCEEDED`. These are not PnL values. A validated retained body may be returned with an explicit source-replay-unavailable status; it must not receive the success label. Unexpected storage errors remain errors, not missing-data success.

HTTP mapping: existing auth failures remain401/403; invalid request400; missing/foreign period404; OPEN period409; missing basis on a valid CLOSED period200 with `{status: BASIS_MISSING, basis: null}`; absent schema/backend503; unsupported stored version422; corrupt content/period/source mismatch409 without a replay-success body. A valid basis with missing or over-capacity historical source returns200 with `BASIS_SOURCE_REPLAY_UNAVAILABLE` and an explicit reason; only successful full replay uses `BASIS_REPLAYED_AT_CLOSE`. An oversized canonical basis is413 before body materialization. Unexpected storage errors use the existing server-error mapping. Retain `currentEconomicValidity: NOT_ASSESSED` for every returned basis, including a successful historical replay.

Bound new reader materialization: at most4096 manifest identities **per** historical source/truth/event collection, at most1MiB per serialized row and32MiB aggregate across those collections; selected projection at most16MiB. Check manifest cardinality before constructing SQL. Perform scoped exact-ID SQL cardinality/size preflight in the same read-only snapshot before materializing bodies; each query is limited to the already-bounded requested ID set. Check selected projection/body size independently. Do not transfer all JSON to discover overflow, scan the current entire account, or substitute a capped prefix for an exact set. This bounds the new reader, **not** the inherited1120 current-close ledger reader. A later read exceeding that capacity leaves the retained body intact and reports source-replay unavailable/capacity; do not claim every future history size is replayable. No new financial close threshold is introduced merely to make the read path pass. Capacities are explicit engineering constants with boundary tests, not silently configurable policy.

## 7. Compatibility and exclusions

* No retroactive basis for existing CLOSED rows; missing rows are inspectable as missing. No history reset and no conversion of scalar PnL into source authority.
* No change to current period/receipt/invoice schema meanings or their existing digests. The new envelope has its own version and digest.
* `materializeDraft`, fee calculation and issuance continue their existing behavior; this package does not retroactively certify their legacy inputs or make basis presence a new issuance approval.
* Existing historical fixture paths stay visibly lower-level; actual public factory tests separately prove mandatory retention. Do not weaken1120 admission or replace source fixtures with self-sealed caller packets.
* No source adapter, Realm/Reality finality promotion, cashflow producer, period membership selector, valuation/conversion, partial-allocation rule, trade activation or commercial anti-reuse rule.
* No new balance snapshots are invented. Existing valuation/source/time/reference strings are retained exactly, with their prior authority limits.
* Production migration/deployment is a separately reviewed rollout action. The obsolete DEE638/1023 “0211 Human-blocked” text is not silently erased or reused. The new issue must explicitly admit this new additive nontrading retention scope; C3 and its database/host processes remain untouched.

## 8. Exact affected-path proposal

Required production/storage paths:

| Path | Change |
| -- | -- |
| `lib/trader/billing/v2/reporting-period-basis-v1.ts` (new) | Pure exact envelope, serializer/hash, typed statuses and receipt/period replay. |
| `lib/trader/billing/v2/reporting-period-basis-postgres-v1.ts` (new) | Internal mandatory repository decorator/held insert; owned historical read and bounded SQL preflight. |
| `lib/trader/billing/v2/reality-dependencies-postgres-v1.ts` | Capture the exact loaded ledger identity manifest in the owner, extend its internal effect callback payload only. Keep matched-proof semantics and current admission exact. |
| `lib/trader/reality/v2/repository-postgres.ts` | Scoped exact-ID read helpers using existing source/truth/event/projection mappers; no writer or knowledge-allocation change. |
| `lib/trader/billing/reporting-period-lifecycle-service.ts` | Wire mandatory decorator into private close composition only. |
| `lib/trader/billing/billing-period-close-orchestrator.ts` | Same for private orchestrator lifecycle; retain public API/owner order. |
| `lib/trader/billing/reporting-period-basis-read.ts` (new) | Actual authorized admin reader/response mapping/disposal. |
| `app/api/trader/admin/reporting-periods/[periodId]/basis/route.ts` (new) | Actual dynamic GET route using production admin dependencies. |
| `db/schema.postgres.ts`; `db/migrations_postgres/NNNN_trader_reporting_period_bases_v1.sql`; `db/migrations_postgres/meta/_journal.json` | One additive relation/guards/indexes/RLS and reserved new migration identity. |
| `lib/trader/observability/fhv-v2-postgres-schema-preflight.ts`; its unit test; `tests/unit/forecast-v2-applied-migration-identity-v1.test.ts` | Exact additive migration compatibility only; keep prior hashes/required prefixes and unknown-future refusal. |

Required new tests: `tests/unit/trader-reporting-period-basis.test.ts`, `tests/unit/trader-reporting-period-basis-handler.test.ts`, `tests/integration/postgres-reporting-period-basis.test.ts`, `tests/helpers/reporting-period-basis-process.ts`. Reuse existing real financial-source fixtures in `billing-reality-evidence.ts`/`billing-reality-postgres.ts`; add only explicit basis assertions to `postgres-billing-reality-dependencies.test.ts` and actual close atomicity tests where needed. Do not change historical proof attribution.

Integration-owned additive paths: `.github/workflows/postgres-integration.yml`, `scripts/postgres-validation/assert-capital-test-results.mjs`, `tests/unit/postgres-capital-proof-guard.test.ts`, the exact Reality consumer inventory if the new imports change it, and the canonical issue plan. Preserve every then-accepted native suite and the canonical three billing companions. At56ee there are16 mandatory capital suites; the final count must be measured after any separately accepted1122/other packages, not predeclared from this report. No blanket graph allowlist or native skip waiver.

The current Reality repository has valid row mappers but only broad cutoff list/latest readers; adding bounded exact-ID readers is necessary to preserve the original read set. Do not rewrite its writers, schemas, fold or source-admission policy. The contract does not require changes to live execution, connector capability, fee/HWM modules, old invoice semantics, all billing consumers, or production infrastructure.

## 9. Meaningful acceptance matrix

| Proof | Required actual behavior |
| -- | -- |
| Baseline omission | Actual public close succeeds on controlled stored Reality but its full receipt/settlements cannot be retrieved. Mark new schema/API absence separately from a runtime incident; do not call a missing test import a demonstrated monetary defect. |
| Both public positives | Orchestrated new open/HWM bootstrap and direct existing OPEN close each retain the actual CLOSED payload + full financial basis. Include positive, loss and net-zero/nonbillable outcomes; no zero-valued REALIZED_CASHFLOW primitive is fabricated. |
| Noninvented snapshot | An existing OPEN baseline whose disclosure differs from caller's unused open-input fields is retained from the actual period row. Snapshot references remain references. |
| Exact content | Nested cashflow/cost/settlement/receipt/period/proof tampering, alteredSQL duplicate columns, extra fields, wrong version and mutated seals refuse. A valid signature/hash alone with different saved inputs is not accepted. |
| Original1120 admission | Forged/missing/legacy/foreign/stale/uncertain/superseded dependencies still fail before lasting financial effects and never create a basis. All unknown proof flags survive a valid close. |
| Copy/transaction scope | Mutate original nested arrays/bodies/dates/context while membership or675 blocks; stored basis reflects captured original. Options callback captured consistently. A genuine held Drizzle transaction refuses before membership/source/basis queries. |
| Atomic rollback | Inject period-close, basis-insert, close-audit, invoice-insert and invoice-audit faults in turn. Assert preexisting state preserved and no new basis/orphan period/HWM/DRAFT/audit. Real trigger faults, not only mocked promises. |
| Concurrency | Two-session same-account close gives existing duplicate/not-open behavior with exactly one period/basis/effect set. Other account progresses while675 is held. Source writer waits through basis/audit/DRAFT; reader never takes inverse invoice/HWM locks. Preserve existing issuance contention companion. |
| Reconnect/child replay | Close through actual owner, dispose connections, read in a genuinely separate child with no caller receipt and no provider capability. Same basis, receipt digest, historical projection and proof. |
| Historical versus current | Include a source-only row whose knowledge time is beyond the saved event head, and then append a later truth for an older source plus a correction/new event after close. The saved exact read set replays identically without losing the source-only row or admitting later rows; new close on stale dependencies still refuses. Corrupt/missing saved prefix/projection cannot become “latest” fallback. |
| Read-only and auth | Authorized actual handler/route; denied/signed-out/wrong org/account; literal account whitespace; exact-once cleanup including exceptions; read-only role/transaction rejects attempted writes; no new audit/HWM/invoice effect while reading. |
| Legacy/unsupported | Old scalar CLOSED → BASIS_MISSING; OPEN → NOT_CLOSED; SQLite → explicit backend refusal; new table absent → schema unavailable, not backfill or partial close. |
| Storage integrity | Actual RLS browser denial; scoped insert checks; UPDATE/DELETE blocked; same-period conflicting row refused; identical held insert does not create a second row. Privileged fixture corruption is restored and distinct from supported application access. |
| Capacity | Body exactly at/below/above16MiB; SQL header rejects overflow before full body transfer. Historical row-count/row-bytes/total/projection limits produce typed unavailable without unbounded materialization or write. Retained data is not deleted. |
| Compatibility | Original numeric/fee/HWM/issuance/manual-finality controls remain; original receipt/period digest identities match. Legacy lower-level fixture tests stay labeled. No success is inferred from unchecked boxes or skipped native files. |

Run new scoped units and all affected billing/1120 companions; then root-coordinated fresh PostgreSQL migrations, new native suite, all accepted mandatory native suites and canonical billing companions with executed-proof validation and zero skips. Full lint/typecheck/build/canon/governance/graphs and fresh exact-head PR CI remain normal gates. Record exact tested SHAs, raw initial failures, migration identities, role/profile, assertion counts and cleanup. No need to duplicate a whole global local unit run.

## 10. Admission and rollout disposition

**Ready for controller admission as one bounded engineering package**, subject to independent contract review, a new Linear contract/canonical plan and migration-number reservation before code. No new financial/scientific ratification is required for the exact retention/replay semantics above. It deliberately does not implement the deferred source producer in the separate discovery note.

Rollout is migration-first/code-second after validation; absence of the new table must fail new close atomically. A code rollback preserves the append-only table and all retained bases; it cannot claim continued mandatory retention under an older close implementation. Quiesce new closes if rolling back that guarantee. No schema downgrade, record deletion, source correction, issued-invoice rewrite, C3 change or live trade is part of rollback.

This advances the real P08 path by preventing new accepted financial inputs from being lost and by making them inspectable after restart. It does not substitute durable storage for evidence of actual complete, attributable, previously unconsumed realized profit.

## Controller admission — 26 September 2026

The user expressly delegated technical repairs, independent audits, normal checked merge and nontrading deployment. Root adopts frozen contract SHA256296709251ceb004f3dd6ddc28a6aa6feed01e85eee4d66a9c4ebd05f71df3da2 and the independent M01 design review before implementation. This is T3 bounded retention/replay engineering under existing financial semantics, not financial/scientific ratification or any live activation.

Mechanical scope addition: lib/observability/waia-runtime-route-telemetry.ts for the distinct new basis route key. Apply all M01 notes: exact org/account/period SQL predicates before mapping; explicit known status mapping and true unexpected500; exactly-once disposal; limited-role real INSERT and append-only tests; no production skip-retention switch.

Migration reservation: only this issue owns 0220_trader_reporting_period_bases_v1.sql with when1780000000220. Accepted base56ee ends0218/idx218; pending DEE1121 owns0219. Author honestly appends its own0220 entry as next idx219 on this base and declares that identity in local compatibility manifests. Do not manufacture or import pending0219. After0219 is actually accepted, normal base integration may reindex only this still-unmerged0220 entry to idx220 and update its own compatibility metadata, retaining all prior identities and exact SQL bytes. Actual Drizzle migrator accepts the tag/index gap, but a DB that already applied0220 cannot subsequently prove lower-timestamp0219 migration: all merged-base acceptance must use a NEW throwaway DB, never registry repair. Production/publication waits until final migration order is verified. This is bookkeeping, not a new Human financial gate.

Isolated author checkout: reuse clean <issue id="3d475a1d-b747-40ab-b6d6-b904cf78db17" href="https://linear.app/deepsense/issue/DEE-1098/ai-trader-preserve-operator-risk-limits-across-paper-startup-and">DEE-1098</issue>-risk-limit-bootstrap with a new issue branch from accepted56ee; preserve original <issue id="5cc78e9b-2318-4275-a8e8-79170618acb9" href="https://linear.app/deepsense/issue/DEE-1119/ai-trader-bind-legacy-guardian-assessment-to-exact-account-and">DEE-1119</issue>-guardian-observation-scope at6e6a5b68. Commit canonical plan before code. Scope/scoped tests initially; root coordinates sole Postgres/heavy resources, final full readiness and independent review. No production/C3/provider/trade action in implementation. Main remains reserved for DEE1124 payment train; independent source work may proceed, final integration remains serialized.

Dependencies: DEE1120 is merged and accepted; pending1121 is migration-order coordination only, not a semantic implementation input. P08 remains open for complete source economics, attribution, prior consumption and manual finality verification. This issue never claims them solved by retention.


## Author implementation snapshot — pending final native matrix

The actual two public PostgreSQL close owners now retain the admitted full receipt/settlements, actual CLOSED payload, unchanged dependency proof and exact source/truth/event/projection read set through one mandatory private repository decorator. The reader owns a read-only repeatable snapshot, admits exact scope before mapping, bounds stored bodies before transfer, and replays the saved identities without current-frontier substitution. The administrator GET route owns ordinary authorization/cleanup and distinguishes absent evidence from malformed evidence and unexpected storage failures. Economic attribution, completeness, prior consumption and finality proof remain unchanged.

Author scoped validation so far: 83 tests / 4 files passed, selected changed-file ESLint passed, typecheck passed. Native development runs reached 35 passing cases on a fresh author-only 220-entry migration chain; five further SQL storage controls have been added and await the final immutable-source run with all 16 inherited mandatory native suites. These are development results, not final integration/CI acceptance. Original fixture errors (audit observer column, unsupported test matcher, inert SQLite query shape, oversize source fixture constraint/index and a shared Date fixture) are retained separately in author evidence; they are not production defect claims. No production or provider action occurred.

## Author acceptance at implementation snapshot 68cb2847

Executed source: `68cb284730870617f5a3f952e7c1546b813d8465`, clean before/after native execution; accepted base `56ee65f00f3b19858d57ea8f3947d2867822e9ac`. This final documentation update changes no production, migration or test bytes.

- Fresh isolated local `waia_dee1125_author_68cb2847_release`, PostgreSQL on loopback54329: all **220 migrations** applied from an empty public schema. The chain retains0000–0218 plus this issue's0220/idx219/when1780000000220; no pending0219 was manufactured.
- **355 native tests /17 suites PASS,0 skipped**: all16 inherited mandatory suites (315 cases) plus40 new retention/replay cases. The existing executed-proof validator passed for every inherited suite; the author receipt independently checks all17 suites/all assertions passed. Root still must add the new mandatory CI registration and negative proof-guard tests.
- **259 scoped unit tests /18 files PASS**: new basis/HTTP/header/capacity tests, original1120 matching, receipt integrity/lookup, period/lifecycle/draft, fee/HWM/history and both migration identity companions. Selected changed-file ESLint and typecheck passed; no local full build/global unit run was performed by the author.
- Cleanup readback records0 sessions,0 disabled triggers,0 temporary fault triggers/functions/roles,0 browser grants on the new table; its RLS remains enabled. Native connections and test processes ended; sole54329 grant was released.

The40 native cases cover both actual public close paths, positive/loss/net-zero controls, preserved existing OPEN disclosure and actor, child reconstruction, source-only rows beyond event time and later Truth/events, foreign scope/literal account, real held-transaction refusal, RR/read-only/input capture, real admin handler,5 actual failure points plus preservation of existing OPEN/HWM, same-account competition and independent-account progress,675 held through basis/audit/DRAFT while a real source writer blocks, internal identical/conflicting insert behavior with ordinary public repeat refusal, SQL duplicated-field/OPEN rejection, ACL and independent RLS defenses, bounded body/source/projection loading, privileged reseal corruption and an RR snapshot stable across a concurrent committed tamper. Original1120's33-case native suite remains passing.

Evidence is retained outside Git under the audit's `evidence/dee-1125/`, with immutable source/blob manifest, exact command/environment/database/migration identities, raw logs and JSON assertion reports. The first combined17-suite run omitted the existing required `WAIA_RELEASE_SHA` in its author runner, so14 Forecast tests correctly refused; all40 new cases passed in that run. That failure is preserved separately. The successful repeat binds declared release metadata to the actual clean68cb implementation SHA, matching existing CI convention; this is attribution metadata, not an independent binary authenticity claim. Earlier fixture/setup failures remain preserved.

Author acceptance does not replace independent review, final current-base full readiness, canonical billing companions on their supported profile, new CI proof registration or authoritative PR checks. Any merged0219→0220 proof must use a NEW database; these author databases already carrying0220 must not be reused to apply the lower timestamp. Economic attribution/completeness/prior consumption remain `UNPROVEN`, fill finality remains operator verification, authority remains `NONE`, and fullP08 remains open. No venue/provider/production/C3/live action occurred.
