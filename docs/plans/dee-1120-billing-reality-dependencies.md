---
integrationIssue: DEE-1120
integrationTitle: "Require durable Reality dependencies before reporting-period close"
branch: dee-1120-billing-reality-dependencies
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1120
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
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Independent exact-head implementation review, root readiness and additive mandatory CI registration; full P08 remains open."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1120 — durable Reality dependencies before period close

## Context and goal

Parent DEE-638, existing completion-audit C02/P08 gap. Accepted implementation base is `2565e1a23741d0042096fd8209cd9793e8aa7e19`. The user authorized technical fixes, tests, independent review, normal checked PR merge and nontrading deployment. This does not ratify financial policy or activate live trading. New reporting-period close commands must prove that every submitted dependency matches the current persisted Reality chain before their first financial effect. Full P08 remains open.

## Scope, files, and acceptance

One work package WP-1 implements the frozen contract below. Relevant files are the existing billing admin handler, period-close orchestrator, lifecycle service, a focused server-side billing/v2 admission module, the live reporting bridge and all actual callers and affected test fixtures. Preserve every incoming mandatory native suite and add a mandatory no-skips proof for this package. The precise case matrix and before-effect, transaction, current-head, compatibility and source identity obligations are in the contract. Root readiness and independent exact-code review are required before PR publication.

## Do NOT and dependencies

No new fee/HWM/settlement/finality rules, allocation producer, automatic issuance, historical rewrite, schema repair, production database mutation, provider or trading operation. Existing CLOSED history is not retroactively qualified. Preserve authentication, tenant isolation, append-only audit, Reality guards and source lock protocol; no optional callback bypass. Coordinate native PostgreSQL acceptance with the root controller and use a fresh isolated local test database. Dependencies: existing RealityV2 contracts and scope lock, manual billing canon LD-9/LD-10 and ADR0008, accepted DEE1112 whole-command rollback. Later accepted-base integrations require additive reconciliation and renewed affected proofs.

## Validation commands

`pnpm lint`, `pnpm typecheck`, `pnpm build`, scoped `pnpm test --run` for changed and mandatory companion suites with the existing native proof environment, `pnpm validate:canon`, `pnpm validate:pr-governance`, both existing graph validators and rendered PR governance preflight. The implementation handoff must record exact command arguments, SHA, native migrations/runtime, counts, zero skips, failures/retries and teardown. Root owns full readiness and publication; the author must not run uncoordinated full unit, database or build jobs.

## Author implementation and local acceptance (2026-09-26)

Implementation is based on accepted `2565e1a23741d0042096fd8209cd9793e8aa7e19` and preimplementation plan commit `7a0df60a70e01172eb1148c8302dab0303d97b32`. Independent implementation acceptance, root full readiness and PR CI are still pending; the unchanged frozen planning report below must not be mistaken for an implementation verdict.

The two public PostgreSQL close factories own their transaction. Their first SQL sets READ COMMITTED; membership is checked with that bound executor, followed by strict caller-side binding validation, the existing Reality675 account mutex, current stored readers/full fold and the financial effects. A caller-held Drizzle transaction is refused. Nested input, dates and authorization context are copied before awaits; the trusted membership function is captured consistently for the factory lifetime. The HTTP wrapper delegates transaction ownership and preserves account bytes. Canonical UUID spelling retains the existing Reality `contracts.ts` version/variant vocabulary; it does not broaden UUID support. SQLite new-close and legacy caller-array live proof paths refuse before effects. Historical materialize-draft/issuance is unchanged.

The audit proof is named `dependenciesMatched`; economic attribution, period completeness and prior consumption are explicitly `UNPROVEN`, and realized-fill finality still requires operator verification. Synthetic tests enter through actual native raw-capture/source writers with their guards enabled. A non-superuser service role with explicit grants exercises both ingestion and close; this is an inert fixture, not proof that HTX currently emits a complete commercial lifecycle.

Local evidence under completion-audit `evidence/dee-1120/`:

- `author-native-red-complete-fixture.log`: the two initial public-boundary regressions fail on the preimplementation code because invented sealed references are accepted. The earlier direct-lifecycle fixture lacked HWM and is separately retained in `author-native-red.log`; that setup failure is not the defect proof.
- `author-native-final-freeze.log`: **164 tests / 6 suites PASS, zero skipped**, using PostgreSQL16.14 at loopback54329, fresh isolated `waia_dee1120_2565e1a2`, all219 repository migrations. It includes33 new source-dependency cases,13 period-command cases,20 invoice-command cases,9 existing Reality cases,85 actual membership cases and4 console workflows. New cases cover both writer-lock orderings, SQL-canonical lock key, repeatable-read session defaults, input/configuration mutation during await, genuine caller-held transactions, separate process reconstruction, selected quarantine/contradiction/release/supersession, unsummarized current event head, monetary resealing, schema absence, limited grants/append-only, direct rollback and actual HTTP invoice/close contention. Existing command rollback and duplicate refusal expectations remain precise.
- `author-targeted-accepted.log`: **362 tests / 17 scoped suites PASS, zero skipped**, including49 new pure consistency cases and the unchanged real ingress refusal companion. The cross-subject exact-relatedTruth uncertainty case is general fold-valid vocabulary; the current high-level ingest does not claim to emit that shape. Reconstructed adversarial objects are independently validated under their fresh seals.
- Scoped ESLint and diff checks pass. An explicitly authorized earlier full typecheck passed after fixture-only type repairs (`author-typecheck-initial.log` preserves failures, `author-typecheck-confirmed.log` the pass); later adversarial tests and the final membership-function capture await root's final typecheck. No author full build/global unit/full lint was run.
- `author-teardown-readback.json` confirms unchanged219 migration identities,12 enabled native Reality source guards, no temporary injected triggers/functions/roles, no renamed table and no other database connection. Synthetic append-only records remain in the disposable database. The initial readback compared the PostgreSQL Result subclass to JSON Array; the read-only comparison was corrected without any database modification. Canonical `waia_validate` was not repaired or changed.

Historical fee/issuance/repository fixtures now explicitly compose the lower-level services in `tests/helpers/historical-billing-lifecycle-fixture.ts`. These tests preserve financial arithmetic/state behavior and do not stand in for production admission. Actual public close behavior is proved by the new native suite and the migrated period/invoice command suites. Canonical-profile guarded historical parity/idempotency suites were adapted but not falsely reported as locally executed against this custom database; their guards are unchanged. All13 incoming mandatory native registrations/proof manifests remain unchanged; root owns additive registration of this new suite and final combined-base validation.

Full P08/C02 remains open: economic cause/strategy and completed-lifecycle attribution, period eligibility/completeness, cross-period reuse, late unseen venue sources, source-revocation policy and finality are not solved by this dependency guard. It uses the existing cooperative Reality writer mutex, not a universal snapshot or HWM/invoice mutex. No new policy, rates, migration, provider, production, C3 or live action is included.

## Root integration and mandatory CI proof

The author freeze is d1367f7732c26028c276676104a9185703d3085b. Root normally integrates accepted main8f60cb297d1bf080b419f4a6724050e3e0a298e5, preserving original implementation and all15 incoming native suites, then adds the new dependency suite as the16th mandatory executed proof. No source or financial semantics are changed by this integration.

The existing canonical-profile CI job additionally executes reporting-period and invoice-issuance historical parity alongside billing idempotency, serially, with a separate three-suite no-skips result guard and negative guard tests. This profile remains the exact documented loopback54329/waia_validate identity; existing connection protections are not relaxed. Those historical fixtures are compatibility evidence, distinct from new public admission proof. Local custom-database native results must not be relabelled as canonical-profile parity runs. These mandatory CI results are required before merge. Root full current-head readiness and independent final integration review remain pending until their exact evidence is recorded.

## Frozen contract provenance

The remainder is the verbatim independently reviewed contract, SHA256 `216aa2f16dfd77eafb6575586e39966ead59d670d8ac724e660118f78add438a`. It was frozen before implementation. Independent engineering-design review: `parallel-runtime-owner/P08-DURABLE-SOURCE-CONTRACT-REVIEW-2565e1a2.md` in the completion-audit workspace. Design approval is not implementation acceptance, scientific qualification or Human financial ratification.

---

# P08 — concrete next durable Reality dependency contract

Read-only planning, 2026-09-26. Repository source is pinned to **2565e1a23741d0042096fd8209cd9793e8aa7e19**, inspected with immutable Git objects in `/Users/legco/Projects/waia`. This report is a proposed implementation contract, not implementation acceptance, a new finding, or a financial-policy ratification. No tests, database, provider, host, C3, production or financial commands were executed. Only this audit artifact was written.

Prior evidence reconciled: `P08-DURABLE-SOURCE-NEXT.md`, `P08-BILLING-ACCEPTANCE-MATRIX.md`, `parallel-billing-acceptance/P08-REALITY-LIFECYCLE-BOUNDARY.md`, full-plan P08/addenda and FINDINGS. The accepted delta from ded58378 to 2565 contains DEE1112 command/input atomicity and DEE1115 live-permission atomicity. Reality, settlement, receipt, lookup and lifecycle source contracts are unchanged. The accepted command transactions must be preserved. D12–D14, D19/D20 and D21–D24 are not proposed again.

## 1. Recommended bounded package

**Require actual persisted Reality dependencies for every newly submitted receipt-based period-close command, before that command can bootstrap HWM, open/close a period, append close audit or generate a draft.** Reject invented, missing, inactive, uncertain, differently scoped or differently valued references. Use the current stored Reality frontier and one transaction spanning validation and effects.

This package is implementable without a new cashflow producer, allocation method, fee formula, schema or finality policy. It narrows an existing input path. It does not make the supplied settlement lifecycle, strategy label, period assignment or completeness authoritative. It does not close C02/P08 or qualify live billing. The positive acceptance is **durable dependency matching**, not proof that every profit in the period is correctly attributable and unbilled.

Do not ship only an optional validator. Integrate it into actual PostgreSQL effect factories and remove the pre-effect bypass in the live reporting helper. Keep pure sealed-object arithmetic available for offline use, explicitly separate from production effect admission.

The remaining decisions in §7 prevent full positive commercial-source acceptance. They do not prevent this necessary negative guard from being implemented and proved now.

## 2. Identities actually present at this SHA

All paths below are repository-relative, at the pinned SHA.

| Object | Exact existing identity and producer/reader | What it proves / does not prove |
|---|---|---|
| Source report | `reality/v2/contracts.ts:createRealitySourceReportV2`; ID and `contentDigestHex` are the stable-JSON body digest. Scoped org/account, source kind/native identity/revision, subject, primitive, lineage, provenance, valid/knowledge time. `repository-postgres.ts:mapSource` validates it. | Stored source content and declared lineage; a digest alone does not establish venue authenticity. |
| Truth | `createTruthRecordV2`, `validateTruthRecordV2`, `mapTruth`; `truthRecordId = contentDigestHex`, exact `sourceReportId` and `sourceReportDigestHex`, optional `supersedesTruthRecordId`. | Verified body and exact source dependency. Historical existence does not mean currently active. |
| Event frontier | `RealityEventV2.eventSequence`, `contentDigestHex`, `previousEventDigestHex`, `knowledgeAtUtc`; `listRealityEventsV2`, `foldRealityProjectionV2`. Sequence is a decimal string, compared with BigInt. | A scoped append-only causal frontier, not financial finality. |
| Stored projection | `RealityProjectionV2`: `projectionId = contentDigestHex`, `projectionPolicyVersion`, `knowledgeAsOfUtc`, `frontierSequence`, `frontierEventDigestHex`, org/account, stable entries and uncertainties. `readLatestRealityProjectionV2` validates the stored body. | Exact stored read-model identity; must also equal a replay of the exact stored ledger. A correctly hashed invented projection is not enough. |
| Settlement | `billing/v2/closed-trade-settlement-v2.ts:ClosedTradeSettlementV2`: complete body seal using `computeSemanticSha256Hex`, source fact digests, caller lifecycle/strategy, `realityFrontierDigestHex`, optional prior-settlement digest. | Content integrity and deterministic arithmetic. No persisted lifecycle or prior-billing membership is checked. |
| Receipt | `realized-strategy-profit-receipt-v2.ts:RealizedStrategyProfitReceiptV2`: complete semantic body digest, settlement digest set, non-profit facts, scope label and `realityFrontierDigestHex`. | Same-body identity and within-receipt uniqueness. Not durable source authority or cross-period uniqueness. |
| Period label | `admit-realized-profit-receipt-v2.ts:billingPeriodReportingScopeIdV2` → `billing-period/v2:<org>:<account>:<start ISO>/<end ISO>`. | Exact equality to the requested/open period window. It does not derive a settlement's eligible period from a finality event. |

Reality uses its existing stable-JSON validators; billing uses its existing semantic-hash/rebuild validators. Do not substitute one hash function or compare unrelated hash domains merely because both are 64 hex characters.

The current lookup is an explicit compatibility trap: `lookup-closed-trades-from-reality-v2.ts:frontierDigest` returns the **latest supplied individual TruthRecord digest**, ordered by knowledge time then digest. It is neither an event frontier digest nor a projection content digest. `groupFills` also groups by one venue order ID, labels `closed-trade/<orderId>` and copies the supplied strategy. The new durable guard must not turn this helper into the canonical cross-order lifecycle producer.

## 3. Freeze one explicit new input contract

Recommended engineering representation: add a required **sidecar to the effectful close input**, not a silent rewrite of the existing sealed receipt/settlement schemas. Illustrative names below are new names to implement, not claims that they exist:

```ts
type BillingRealityDependenciesV1 = Readonly<{
  schemaVersion: "waia.trader.billing_reality_dependencies.v1";
  frontierBinding: "REALITY_PROJECTION_CONTENT_DIGEST_V2";
  receiptContentDigestHex: string;
  closedTradeSettlementDigests: readonly string[];
  projection: Readonly<{
    projectionId: string;
    contentDigestHex: string;
    projectionPolicyVersion: typeof REALITY_PROJECTION_POLICY_V2;
    knowledgeAsOfUtc: string;
    frontierSequence: string;
    frontierEventDigestHex: string;
  }>;
}>;
```

The sidecar is an untrusted locator and optimistic concurrency assertion. It is not an authentication credential, an operator attestation or a new economic policy. Org/account come from the authorized service context and explicit account input, then are compared to the loaded objects; do not trust a second caller-provided authority scope.

Required admission steps:

1. Copy all input identities, arrays, monetary text and dates before any await. Require the authorized organization ID to be the canonical lowercase hyphenated UUID text accepted by the existing Reality contract **before obtaining the source lock**; refuse an alternate textual spelling rather than normalize it after locking. Preserve the account ID's exact bytes (it is nonblank text, not a UUID alias). Validate a strict versioned sidecar, canonical timestamps, digest syntax, exact integer sequence syntax and known policy literal. Re-run current complete receipt/settlement validation and deterministic reconstruction. Sidecar receipt/settlement digests must exactly match those validated objects; no omitted/extra settlement or duplicate descriptor entry.
2. This new close-input version explicitly requires **both the receipt and every settlement's sealed `realityFrontierDigestHex` to equal the loaded projection's content digest**. The binding discriminator makes the convention explicit. Require projection ID/content digest equality as the current Reality contract does, but validate its full body too. Do not mutate either submitted sealed body to make it fit.
3. A missing sidecar, unsupported discriminator or legacy latest-truth frontier gets a typed unsupported/missing-binding refusal. Existing pure builders and historical records retain their exact representation and digests. Add old/new consumer tests: a lookup-generated legacy packet is not automatically upgraded; a newly built packet explicitly targeting the saved projection is only a candidate for durable matching.
4. The effect path reads the latest scoped ledger and latest persisted projection **after acquiring the scope lock**. The projection tuple must exactly equal the descriptor and the current event head. Fold actual source/truth/event rows through the existing function at that head's canonical knowledge time; require canonical full-body equality to the saved projection. Missing projection, event gap, corrupt record, projection lag, newer frontier or policy mismatch refuses. Do not persist/repair a projection from the billing reader. A historical as-of projection is appropriate for inspection, not an alternative to the current correction-aware close gate.
5. Build the dependency set from all opening, closing and partial-fill digests, every cashflow/cost fact, and every non-profit fact. Resolve digests to scoped **active stable entries** and their complete validated TruthRecords and source reports. Check the exact subject, primitive body, source kind/native identity/revision, source ID/digest and timestamps across source → truth → projection entry. Reuse existing admission invariants; do not trust a caller's supplied TruthRecord array or fetch raw secrets/capture bodies.
6. Reject selected `UNATTRIBUTED`/`SOURCE_CONTRADICTION` facts and any active projection uncertainty concerning a selected dependency's subject/source or an event's exact related stable truth. Checking the selected truth's markers alone is insufficient: a contradiction conserves the older stable truth. A later `RELEASED` removes its exact uncertainty but does not promote the contradictory record. A superseded old fact is never active merely because its immutable row remains present.
7. Match the primitive kinds and supported monetary values exactly with existing decimal primitives. For a claimed cashflow require an actual REALIZED_CASHFLOW, existing USD denomination and amount signed by its stored direction. For a claimed whole fill cost require its actual FILL fee amount; nonzero non-USD costs still need unavailable conversion evidence, while an actual zero fee keeps the existing zero-cost rule. Fill references must match the claimed symbol and existing settled-fill requirement. Do not calculate gross profit from fill prices, copy operational net PnL into gross cashflow, subtract fees twice, or create SETTLED from OBSERVED.
8. Name the successful internal result `dependenciesMatched` (or equivalent), carrying the exact receipt/settlement/projection/frontier identifiers, never `billable`, `final`, `periodComplete` or `unbilled`. Existing commercial/manual controls remain independently required. No `true` in this result supplies an issuance attestation.

The predicate verifies only claims representable in the stored primitives. `causeNativeId` is an opaque string; it does not prove STRATEGY_REALIZED or DEPOSIT/WITHDRAWAL/TRANSFER classification. The result must explicitly leave economic-cause/lifecycle/period attribution unproven. Do not infer non-profit classification from INFLOW/OUTFLOW. If implementation exposes a broader “all submitted claims verified” result, it must instead refuse these unsupported claims; it may not silently upgrade this dependency result into that stronger claim.

An empty settlement set is not evidence of a complete zero-profit period. No ledger/head or no applicable dependency set yields typed `source unavailable/coverage unproven`, not authenticated zero. Existing REALIZED_CASHFLOW primitives require a **positive magnitude** and carry direction separately (`contracts.ts`, 504–505); a zero primitive is invalid. A valid negative signed cashflow comes from OUTFLOW, while a valid zero aggregate/net may arise from offsetting facts or costs. Preserve these cases and actual zero fees; do not add a positive aggregate-profit threshold. Omitted losses and completeness of a nonempty set remain outside this guard, explicitly unproved.

Proposed typed error categories should distinguish malformed input, absent source/schema, stale frontier, inactive/uncertain fact, value/asset mismatch and unsupported binding. Map them through the existing command envelope; do not leak stored bodies, return a false zero or substitute a generic success. Stale input should be refreshed by the caller, never automatically re-signed inside billing.

## 4. Exact transaction and lock protocol

Existing Reality writers already share this database transaction lock:

```sql
pg_advisory_xact_lock(hashtextextended(organization_id::text || ':' || account_id, 675))
```

Evidence: `reality/v2/repository-postgres.ts:lockRealityScopeV2` (139), `ingest-postgres.ts:ingestRealitySourceReportV2FromWriter` (82); migration `0160_trader_reality_v2.sql` allocation (457), source insert (532), truth insert (601), event insert (658), projection insert (873). The allocator acquires that advisory lock **before** its knowledge-frontier row `FOR UPDATE` (467). Source/truth/event guards enforce exact source lineage and explicit correction; projection guard checks the exact event sequence/digest/knowledge time. Do not add a new independent mutex keyed only by a receipt hash.

**Exact key spelling is an implementation prerequisite.** The TypeScript helper hashes the supplied `${organizationId}:${accountId}`; `requireOrgContext` only trims, whereas SQL casts the UUID to its canonical `::text` spelling. Equivalent PostgreSQL UUID spellings could otherwise hash differently. The new boundary must apply the canonical-organization rule in §3 before calling this helper and use that captured scope throughout; account text remains exact. Do not claim textual alias safety from UUID equality in a later query. This is a guard design obligation, not a claim of an observed production incident or authorization to broaden this package into rewriting every existing Reality caller.

New close operation ordering:

1. Snapshot inputs and preserve existing request authorization. Own a real PostgreSQL transaction at the public effect boundary. Set **READ COMMITTED before its first data query**, including membership checks inside that transaction. A connection default of REPEATABLE READ must not retain a pre-wait snapshot.
2. Obtain the existing Reality org/account advisory lock before reading the ledger or taking any period/HWM/invoice write lock. No pre-lock read supplies admission values. After a blocked lock is granted, read the current frontier, projection and source bodies afresh.
3. Perform the mandatory guard, then current cap/window/period checks and existing HWM/bootstrap/open/close/audit/draft steps using that same bound executor. Hold the Reality lock until commit/rollback. An admission object created in another transaction or earlier call cannot authorize a later write.
4. No source lock is acquired after a billing invoice/account lock. No autonomous retry under a new frontier. If a correction wins first, an old descriptor is rejected; if the close holds the lock first, the correction waits until close commits. The latter is an ordered concurrent history, not a promise that facts can never change after billing.

`runWaiaPostgresTransaction` currently delegates to `db.transaction(fn)` without an isolation option. The existing DEE1112 period handler starts an outer transaction at `admin-route-handler.ts:698`, but does not set an isolation mode. Put the setting at the owning transaction entry, not in an already-used nested/savepoint transaction. Follow the already accepted local explicit-isolation pattern; do not change global defaults.

Public PostgreSQL effect factories must require a transaction-capable `WaiaPostgresDb`; keep a private bound implementation for the command's subordinate services. Do not pass a plain `select/insert/update` executor and claim it owns isolation/lock lifetime. Ensure the legacy handler does not open one transaction and then invoke a new public wrapper that opens another: either it delegates ownership to that public wrapper, or calls its deliberately internal bound composition inside its own correctly initialized transaction. This is a local ownership refactor preserving DEE1112 whole-command rollback, not nested independent transactions.

Do **not** extend `lockInvoiceCommandAccountPostgres` to this guard. Issuance already orders `invoice FOR UPDATE → stable HWM BOOTSTRAP FOR UPDATE`; cancel uses invoice only. The source-guard package needs Reality serialization, not a new HWM lock or replacement of those accepted rules. Existing close creates a draft and reads HWM, but does not issue or ratchet it. No current Reality writer obtains billing locks and neither invoice command surface takes the Reality lock, so the inspected explicit orders introduce no inversion. That bounded trace does not prove freedom from every implicit foreign-key/unique lock or future correction writer; concurrent native tests must cover the actual composed paths. Do not claim universal billing serialization.

Read-only `replayRealityProjectionV2FromLedger`/`readCurrentRealityProjectionV2Postgres` do not establish their own transaction boundary. Reuse their fold/reader logic on the bound executor; do not run a separate snapshot and then trust its result during a later financial commit.

This is consistency under the existing Reality writer protocol, not a repeatable snapshot of all HWM/invoice tables. Low-level `FromWriter` functions still require their documented caller-held transaction. An externally supplied already-used transaction must not silently inherit stale isolation through the new public boundary. Pending raw/source observations not yet represented in an event, absent venue data and later source revocation are not made complete or final by holding this lock. The package adds no new retroactive source-revocation policy.

## 5. Actual consumer coverage and minimal file scope

| Existing consumer / file | Required change in this package |
|---|---|
| `app/api/trader/admin/reporting-periods/commands/route.ts` → `billing/admin-route-handler.ts:parseCanonicalProfitEvidence`, `handleAdminReportingPeriodCommandPost` | Parse explicit sidecar for close-and-materialize after existing auth, pass captured input, map refusals. Preserve accepted whole-command rollback and current permissions. No console UI or extra action is needed merely to prove this guard. |
| `billing/billing-period-close-orchestrator.ts:closeAndMaterialize`, `createPostgresBillingPeriodCloseOrchestrator` | Durable guard before first HWM/bootstrap/open effect; transaction-owned production factory and internal bound services. Missing durable dependency port must fail, never fall back to pure admission. |
| `billing/reporting-period-lifecycle-service.ts:closeReportingPeriod`, `createPostgresReportingPeriodLifecycleService`; `reporting-period-repository.types.ts` | Independently callable close also requires guard before close/audit/draft. Preserve a transaction-bound internal composition to avoid re-opening transactions. Public SQLite close must report that durable PostgreSQL source evidence is unavailable, rather than accept supplied arrays as equivalent. Existing read/open-only behavior need not change. |
| `live/reporting-bridge.ts:proveLiveFillReportingReadable`; `live/build-live-cli-deps.ts:129`; `live/run-live-cycle.ts:306` | Actual cycle currently omits canonicalProfit and fails before effects; preserve it. The optional supplied-array branch bootstraps HWM/opens before calling lifecycle.close. A close-only guard is too late. In this bounded package, refuse that legacy packet before those effects unless the entire operation is explicitly delegated to the same guarded transaction-owning command. Do not enable it by minting a descriptor from the array or by relabeling lookup's frontier. |
| New focused server module under `billing/v2/` | Strict sidecar parser, stored Reality dependency admission on an already bound executor, typed failures. Reuse contracts/readers/fold. No new source writer, cashflow generator or raw-data transport. |
| Existing period close audit | It may add validated descriptor/receipt/settlement **identifiers** to existing immutable metadata, in the same transaction, to identify the checked basis. This is trace evidence, not a substitute for a future full persisted basis/consumption repository. Do not write a fake historical audit or retrofit old periods. |

The read-only factory methods remain read-only. `materializeDraft` on an already closed legacy period has no receipt/source basis to reconstruct: this package cannot pronounce that history source-verified. Preserve historical bytes and record this remaining P08 boundary; do not infer an authoritative source set from its stored numeric PnL. Existing invoice issuance/manual-finality and settlement boundaries are not rewritten here.

Pure dependency-injected factories can remain useful for calculation/contract tests, but an exported production factory must not accept a user-controlled optional `admit = () => true` bypass. Re-scan all production callers after the local factory signature change. Native acceptance must call real factories, not only the new helper.

Existing positive close fixtures in native invoice, console and parity suites often submit synthetic receipts without durable Reality (for example `postgres-billing-invoice-command-atomicity.test.ts` and `postgres-invoice-issuance-parity.test.ts`). This package must update those fixture dependencies explicitly: use an admitted synthetic stored Reality chain when testing the real close path, or deliberately seed lower-level already-closed history when a separate issuance test requires historical input. Do not add an optional production bypass or skip the affected companions to keep them green. The internal bound factory stays private/nonreplaceable. Pure builders and low-level repositories remain infrastructure, not a claim that every possible direct database writer is protected by the command guard.

No shared numeric parser changes, migrated financial records, new fee/HWM threshold, automatic settlement, rate or governance changes belong here. Pending independent fixes must enter only through their accepted base; this report does not authorize importing their branches.

## 6. Bounded acceptance required before merging this package

All following are proposed tests, **not runs performed for this report**.

| Group | Required proof |
|---|---|
| Genuine positive source fixture | Persist a scoped native Reality source/truth/event/projection chain through the actual existing writer/limited roles, then submit explicitly projection-bound valid sealed objects. Exact values and identities match after reconnect and separate process. It is a synthetic stored-source fixture, not a claim that HTX currently emits a billable complete lifecycle. Preserve valid zero net/aggregate, zero fees, signed negative OUTFLOW and equal-valued distinct facts; never create an invalid zero cashflow primitive. |
| Invented and cross-scope input | Correctly re-sealed but nonexistent truth/source, wrong org/account, source/truth body mismatch, wrong primitive, swapped projection or old latest-truth frontier must fail before HWM bootstrap, period open/close, close audit or draft writes. Include direct lifecycle, orchestrator, handler and live helper's pre-close effect ordering. |
| Complete descriptor integrity | Every tuple component changed independently; missing/extra/duplicate settlement, changed receipt during an await, copied array mutated during a lock wait; full-body replay mismatch despite a self-consistent supplied hash. Unsupported legacy input is refused, never transformed. |
| Current versus historical state | Superseded selected fact, active contradiction concerning the preserved stable truth, quarantine and exact release, stale/lagging projection, event-chain gap and absent ledger. An unrelated uncertainty is not silently relabeled as uncertainty about a selected dependency; the result still does not claim complete period coverage. |
| Money and source vocabulary | Amount/sign/currency/cost differences, nonzero non-USD cost, observed-only fill, missing cashflow. No synthesized conversion, finality or economic cause. Empty evidence cannot produce source-proven zero. Keep existing denomination/manual-finality controls. |
| Real concurrency | Two connections under a REPEATABLE READ session default prove the public wrapper uses READ COMMITTED, actually blocks on the shared account advisory lock and reads the winning correction after blocking. Reverse ordering proves a writer waits for the command. Same-account close contenders serialize on the source lock; other-account work progresses. Exercise invoice/close contention without adding an invoice/HWM lock inversion. |
| Lock-key spelling | Canonical UUID control proves blocking against the actual SQL writer's key. Uppercase, braced and hyphenless aliases that PostgreSQL would treat as the same UUID are refused before lock/effects; caller mutations cannot change the captured key. Exact different account text must not silently normalize into another scope. |
| Transaction effects | Inject faults in source load, audit and draft; actual native persisted HWM/open/close/audit/draft state rolls back together. Clean retry works under the existing repeat rules, without adding guessed idempotency semantics. Preserve accepted DEE1112 tests. |
| Permission/storage truth | Unauthorized requests unchanged. Limited-role source reads remain scoped; native source lineage and append-only guards remain enabled. No privileged fixture that inserts arbitrary source rows while bypassing canonical guards may stand in for the positive provenance case. |
| Honest remaining gap | Show that the dependency result has no `periodComplete`, `final` or `unbilled` authority. Retain C02 as open: same legitimate fact re-labelled into another period, omitted losing lifecycle and unknown finality-to-period rule are not resolved by a hash/frontier check. Do not assert a green full-period financial acceptance for these cases. |

Existing companions: `postgres-reality-v2.test.ts`, `trader-reality-v2-htx-ingress.test.ts`, `postgres-billing-period-command-atomicity.test.ts`, `postgres-billing-invoice-command-atomicity.test.ts`, receipt/content/uniqueness/history/lookup billing unit suites and existing native invoice parity. Use the repository's existing `pnpm test --run <files>` and established, root-authorized native PostgreSQL validation profile. Native execution must be real, non-skipped and current-head; require independent non-author review and root-controlled readiness/CI. No actual venue or financial command is part of testing.

Serialization may make a same-period losing orchestrator command observe the now-closed window and return the existing duplicate-window refusal, rather than race the final OPEN update and return not-open. Test the deterministic applicable code explicitly, exactly one complete set of effects and unchanged normal CLOSED-repeat refusal; do not weaken an assertion to accept arbitrary failures. Historical materialize-draft/issuance remain outside this new-close proof, and an honest PostgreSQL-source refusal on SQLite is not native SQLite provenance support.

## 7. What is derivable now and what still needs an explicit decision

**Already ratified, not a new Human decision:** canonical algorithm Steps16/19 require Reality-owned actual facts and forbid caller-authored commercial authority. LD9's current correction-aware projection, append-only source/event chain and explicit uncertainty are reusable. LD10 §§4–5 require completed round-trip net realized profit, account-scoped cumulative HWM in MVP and no unrealized/deposit profit. ADR0008 plus LD10§7 preserve manual issuance and separate realized-fill finality. Software may enforce these existing negative boundaries without inventing a rate or bypassing the operator.

**Engineering that follows this guard, but cannot be claimed done by it:** exact stored lifecycle/order/fill/attempt/plan/report joins; persisted receipt/settlement basis linked to a reporting period; append-only consumed-economic-fact identity; cross-period replay and correction ancestry; complete-set/omitted-loss proof; restart/crash/RLS acceptance. Migration0211 is already Knowledge/Forecast storage and may not be repurposed. A later schema identity belongs to integration, not this report.

**Precise missing positive-source decisions or contracts:**

1. **Real cashflow producer and attribution.** The present Reality primitive permits REALIZED_CASHFLOW but the inspected production adapters do not author it; fill adapters emit OBSERVED. Specify which existing authoritative venue event/receipt supplies gross realized cashflow and its exact lifecycle linkage, or ratify a separate derivation contract. An HTX order acknowledgement, fill price difference or operational `legPnl` is not that contract. `causeNativeId` must gain an applicable persisted meaning before it is used as lifecycle/strategy/DEPOSIT classification.
2. **Shared fills and costs.** Choose/locate an applicable accounting/allocation contract if one source fact contributes to several lifecycles or lots. Existing operational FIFO/leg allocation was not a billing cost-basis ratification; LD9§19/LD10§10 explicitly reserve full cost basis. Whole fact consumed once is an identity invariant; a newly invented split percentage is policy. Unsupported allocation can remain unavailable rather than blocking unrelated engineering.
3. **Period attribution by closed-trade finality.** LD10§4 supplies the governing rule but not an exact stored event/receipt field, boundary convention or late-correction assignment. Specify the authoritative finality observation/attestation identity, which time selects the period, treatment of equality at boundaries, late-known completion and a supersession after a billed period. Do not substitute `TruthRecord.validAtUtc`, `knowledgeAtUtc`, execution close time or the receipt's caller label without that decision. A fixed month label is not a proof of attribution.
4. **Currency/cost conversion where needed.** Native USD evidence can be checked without a new conversion policy. HTX USDT/non-USD profit or fees need an approved conversion receipt and valuation method before positive billing attribution. Settlement payment's stablecoin-par rule is not permission for market/accounting parity.
5. **Corrections after consumption.** Existing Billing/HWM§§11.4–11.5 require append-only correction and a recorded operator credit/refund/HWM decision. Specify the exact correcting entry/reference workflow before new facts superseding a consumed settlement can be treated economically. Renaming a lifecycle or changing the digest does not make the same profit new. Do not reverse HWM or rewrite an issued invoice automatically.

Automatic provisional→final and automatic issuance are still reserved. The package above needs no new Human financial decision because it only adds a necessary durable dependency check and refuses unsupported input. **A task demanding complete positive Reality→lifecycle→receipt→period authority cannot honestly be declared implementable until the exact applicable contracts in this section are found or ratified.** Its software design may proceed in parallel, with unknown inputs explicitly unavailable.

## 8. Completion boundary

One next package, one reviewable result: existing close commands cannot use nonexistent, stale, inactive, mismatched or uncertain Reality references for their effects. Freeze the sidecar compatibility convention and transaction ownership before coding. Preserve all accepted controls and current live refusal. Do not enable trading, alter C3, create financial facts or treat these planning notes as a new ratification.

Full P08 remains open for authenticated lifecycle/economic attribution, complete period selection, correction-aware cross-period consumption and the final end-to-end billing/settlement acceptance. No ready percentage or estimated production profit is implied.
