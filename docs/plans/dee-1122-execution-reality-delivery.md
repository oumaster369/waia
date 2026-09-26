---
integrationIssue: DEE-1122
integrationTitle: "Deliver committed Execution reports into Reality with bounded source proof"
branch: dee-1122-execution-reality-delivery
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: [WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: fa3c0ad43444c41504023fbdb09348ed1b101fc7
  lastValidationAt: "2026-09-26T15:41:39.045482+00:00"
  blockedReason: null
  nextAction: "Complete independent final review, publish one PR and require all exact-head CI before normal merge. Full P08 remains open."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1122 — bounded committed-report delivery

Parent DEE-638. Controller approved the exact contract below after independent
M01 design review. Source base is accepted `1a59b31b620af81b727d28b24f3ddbf9cb953074`.
Frozen contract SHA256 is
`5b6bd1e72005b05940730cb8842a3533ab4703583b586373dccd5d39d4609cc6`.
The proposal-status text in the embedded source is preserved verbatim for provenance;
this issue authorizes its implementation, not any financial-source qualification.

## WP-1 — bounded PostgreSQL command and exact delivery witnesses

Implement root-owned READ COMMITTED and675 scope lock, bounded immutable
attempt/report readers, complete head checks, pre-write existing-ledger/projection
admission, existing held-ingester composition and exact delivery witnesses.
Keep resource/input/bigint/refusal and uncertainty semantics of the frozen contract.
No caller-supplied report or replaceable writer/admission capability.

## WP-2 — executable DB-only CLI and process ownership

Wire the real package command/parser to the owner, with an owned fresh PostgreSQL
client, exact-once awaited close, safe structured results and explicit commit-
acknowledgement uncertainty. Preserve capability/import boundaries and graph checks.

## WP-3 — adversarial, native and restart acceptance

Add focused unit/CLI tests and actual PostgreSQL proof for source provenance,
limits, projection/duplicate baselines, rollback, same-scope serialization and
recreated-process replay. Native/PG and heavy checks require controller resource
coordination; no unexecuted proof is claimed. Controller owns additive native
CI registration, full readiness, nonauthor review, PR and merge.

## Validation commands and boundaries

Run focused `pnpm test --run` on the added delivery/CLI suites and affected existing
Reality/Execution companions; scoped ESLint during author work. After resource
coordination, execute native acceptance on the approved isolated test database
with existing schema/guards, then controller runs `pnpm lint`, `pnpm typecheck`,
`pnpm build`, `pnpm validate:canon`, `pnpm validate:pr-governance`, both consumer
graphs and required final-head CI. Exact commands/counts/SHAs follow actual runs.

No provider/credential access, production/C3/live operation, schema or financial
policy change. Full P08 and source-finality/allocation/attribution/consumption remain
open. Inert local tests of recorded observations never constitute a real trade.

## Frozen accepted implementation contract (verbatim)

# P08: bounded delivery of committed Execution reports into Reality — revision 2

Status: **proposed engineering contract, awaiting root acceptance; no implementation or native execution performed here**. Immutable source base: `1a59b31b620af81b727d28b24f3ddbf9cb953074`. This is a separate refinement of the frozen `P08-POSITIVE-PRODUCER-GAP-8f60cb29.md` (SHA256 `d8cb5077f2baf0f27ed3fa83598535f42f9a9924865adb73b25cb816f6b65dfc`); that report is unchanged. It incorporates the root's `P08-REPORT-DELIVERY-ROOT-DESIGN-NOTES-1a59b31b.md`. Revision2 supersedes the proposed25be contract without changing that frozen file. It resolves M01's two pre-code findings: pre-existing projection lag must be checked before a DUPLICATE ingestion can persist a projection, and selected stored projection JSON requires its own SQL size preflight.

The deliverable is one actual PostgreSQL command and executable CLI that load one supported persisted attempt's complete captured report prefix and deliver its observations through the existing Reality adapter and held writer. Completion means **observation delivery through a stated stored report head**. It does not mean successful order execution, a complete venue history, source authentication beyond existing durable provenance, SETTLED fills, realized cashflow, lifecycle attribution, period completeness, consumedness, settlement or billability. Full P08 remains open.

## 1. Source evidence and preserved boundaries

The immutable evidence directory `p08-report-delivery-1a59/` records 29 source files with Git blobs and SHA256, a PostgreSQL migration-definition inventory and a TypeScript AST runtime-import inventory. The latter traces 22 first-party files reachable from the proposed reused entry roots, with no unresolved/nonliteral runtime imports in that bounded graph. It does not execute application modules or prove third-party runtime behavior. No DB, provider, network, secret, host or production command was used.

Current mechanisms:

- `execution/v2/repository-postgres.ts:readExecutionAttemptProjectionV2Postgres` returns the sealed attempt, decimal-string `nextReportSequence` and last report digest. `listExecutionReportsV2Postgres` currently loads an **unbounded** ordered attempt history. The new command must not call it first and truncate afterward.
- `0157_trader_execution_v2.sql:waia_execution_v2_validate_attempt_insert` binds attempt to exact scoped plan, allowance and order. Its report-insert guard serializes report sequence/head under an attempt row lock; reports and attempt identity fields are immutable. The report row/body and attempt/plan validators remain mandatory. No new submit/recovery/claim path is introduced.
- `reality/v2/ingress.ts:routeRealityIngressV2` routes the stored report through `adaptExecutionReportV2ToReality`. The adapter emits ORDER and/or FILL; FILL is OBSERVED. It emits a fallback VENUE_EVENT only when it produced no other draft. It does not emit an extra event for every report, cashflow or SETTLED finality.
- `0160_trader_reality_v2.sql:waia_reality_v2_guard_source_report_insert` verifies exact scoped stored report ID/digest, report sequence/type in their existing provenance positions, and HTX attempt venue. It does **not** reconstruct the primitive from raw report JSON and does not check order execution mode. Therefore the command must reload the immutable report, derive the draft internally and check stored order metadata; a caller's correct checksum is insufficient.
- The truth/event SQL guards retain exact source linkage, DB-authored knowledge reservation, contiguous event chain, explicit supersession and quarantine causality. The migration inventory found their definitions in0160 and no later replacement among the inspected accepted migrations. This is a source observation, not a live schema verification.
- `ingestRealitySourceReportV2FromWriter` uses scope lock675. It can return DUPLICATE for an exact pre-existing source, or for a newly inserted source semantically equivalent to an earlier truth. Neither return alone proves an admission event exists. Its public per-draft wrapper owns separate transactions and is **not** the composition boundary for this command.
- `persistCanonicalRealityProjectionV2FromWriter` reads the complete account source/truth/event ledger. `foldRealityProjectionV2` folds at the last event's knowledge time. A legitimate later semantic-alias source may not be visible in that projection; its persisted body and its earlier admission witness must be proved separately. Do not claim every source has an event or appears as a stable projection entry.

## 2. Actual entry and API

Add a focused server owner `catchUpExecutionRealityV2Postgres(db, input)` under `lib/trader/reality/v2/` and a dedicated `scripts/trader/reality-execution-report-catch-up.ts`. The script is wired by an actual package command, proposed name `trader:reality:catch-up-execution`, using the existing `WAIA_TRADER_CLI=1`, tsx, server-only prelude and react-server condition convention. A library export or hook in the currently unwired ExecutionV2 factory does not satisfy this deliverable.

Input consists only of `organizationId`, `accountId`, `executionAttemptId`. There is no report/body/source input, result callback, replacement validator/ingester, since/cursor option, caller head, limit override, credential resolver, venue adapter callback, retry-submit option or live permission flag. Copy these identity values before the first await. The public command requires a root transaction-capable PostgreSQL database and owns its transaction; reject SQLite, unsupported handles and actual Drizzle transaction/savepoint handles before any source query or effect. A transaction-bound implementation is private and nonreplaceable.

Organization must use the canonical lowercase hyphenated spelling supported by existing Reality UUID validation (its existing version/variant vocabulary is retained). Reject uppercase/braced/hyphenless/space aliases before acquiring675. Account bytes are exact: require nonempty `accountId === accountId.trim()` and refuse unsupported whitespace spellings instead of silently selecting another account. Use the same frozen values in lock key and every comparison. Attempt ID likewise uses the canonical supported UUID spelling. The CLI rejects unknown/repeated/missing flags and validates the environment/identity shape before allocating a DB client.

This is a local operational DB-capability entry, not a new anonymous/admin HTTP route or new RBAC grant. The command does not read the exchange credential table, API keys, AI-TWIN memory, provider settings or account balances.

## 3. Exact root transaction, scope and captured target

1. Own one explicit READ COMMITTED transaction, set isolation before its first in-transaction query, then acquire the existing `lockRealityScopeV2` advisory transaction lock675. The key must equal SQL's canonical `organization_id::text || ':' || account_id`. No session lock, attempt/order/allowance `FOR UPDATE`, Execution writer or active authority check is added. Existing SQL insertion guards may acquire their existing locks; preserve their protocol.
2. Under675, read the exact attempt and its projection metadata, exact plan and the order identified by the attempt. Use bounded metadata reads before loading variable-sized attempt/plan JSON (§4). Validate the existing sealed attempt and plan bodies and compare all identities/digests: org/account, plan, allowance ID/content digest, order ID, client order ID and immutable exact request values. Read the stored allowance's scoped ID/content-digest reference as needed for the exact join; do not reevaluate/renew its present eligibility.
3. The order must carry the matching V2 plan and attempt ID/digest bindings and matching allowance/client-order/request identity. `trader_orders` has no independent accountId column: account proof comes through the exact attempt/plan/allowance scope, not a guessed order column, credential ID or current default account. Require order `execution_mode = 'live'`, `historical_run_id IS NULL`, `historical_account_key IS NULL`, and stored order/attempt/plan venue matching HTX under existing `upper(venue) = 'HTX'` semantics (no trimming or arbitrary remapping); the existing plan's supported SPOT grammar remains in force. Paper/history/other venue is a typed unsupported scope with no Reality writes.
4. Order mode/history are checked current stored metadata, not silently elevated to fields sealed by ExecutionAttempt. No trigger protecting those particular metadata fields was found in the literal accepted migration inventory. This package does not claim their immutable historical attestation, change their writer policy or authenticate a live venue interaction. It preserves the trusted DB owner boundary and refuses current unsupported metadata.
5. Capture attempt ID/digest, `nextReportSequence` and `lastReportDigestHex` from one read. Require canonical positive decimal sequence text within PostgreSQL bigint range, use `BigInt` for subtraction/comparison, and set target sequence to `next − 1`. Never convert an arbitrary sequence/head to JavaScript Number. Head0 requires a null digest; a nonzero head requires the exact sealed digest shape.
6. Read exactly reports1…capturedTarget, with org/account/attempt predicates and `report_sequence <= capturedTarget` in SQL, ordered by the bigint column. All report bodies must validate and match the captured attempt's ID/digest and scope. Verify contiguous sequence, first previous digest null, complete previous-digest chain and final digest equal to the captured head. One complete selected prefix is required, not a latest report or partial page.
7. A concurrently committed report above the captured head is outside this invocation. The bounded reader excludes it. Do not turn it into a missing/extra-report failure, acquire an attempt lock to prevent it, or claim current-at-return completeness. Next invocation captures its new head.
8. A supported attempt with head0 returns `NO_REPORTS`, exact attempt identity, target `"0"`/null digest, zero selected/delivered counts and `projection: null`. It does not run ingestion, allocate Reality knowledge, invent an empty source/projection or declare the account clean. This status says nothing about existing account Reality or successful execution; it is valid for BOUND, SUBMIT_STARTED or another otherwise valid reportless state.

READ COMMITTED plus675 is a coherent view under the existing cooperative Reality writer/SQL-lock protocol. It is not a serializable snapshot of all order, Risk, HWM or invoice state. The command does not introduce an inverse attempt→675/675→attempt row-lock cycle or promise protection from arbitrary privileged DB rewrites.

## 4. Fixed operational capacity and bounded queries

These are conservative **new command resource limits**, not ratified financial thresholds or performance claims. No environment/CLI override in this slice. Exceeding a limit refuses the whole target without committing new observations. A later separately reviewed batching design may extend coverage; silently truncating or moving a cursor is forbidden.

| Constant | Initial bound |
|---|---:|
| Complete selected attempt prefix | 256 reports |
| Individually loaded attempt/plan sealed row | 1,048,576 PostgreSQL JSON-text bytes |
| Individually selected report row | 1,048,576 PostgreSQL JSON-text bytes |
| Sum of selected report rows | 8,388,608 PostgreSQL JSON-text bytes |
| Total routed drafts across that prefix | 512 |
| One routed draft | 65,536 canonical JSON UTF-8 bytes |
| Sum of routed drafts | 4,194,304 canonical JSON UTF-8 bytes |
| Existing plus reserved new account source rows | 4,096 |
| Existing plus reserved new account truth rows | 4,096 |
| Existing plus reserved new account event rows | 4,096 |
| One existing source/truth/event row before materialization | 1,048,576 PostgreSQL JSON-text bytes |
| Sum of existing source/truth/event rows before materialization | 33,554,432 PostgreSQL JSON-text bytes |
| Exact selected latest stored projection row before materialization | 16,777,216 PostgreSQL JSON-text bytes |

The distinct byte measures are deliberate: SQL measures `octet_length(to_jsonb(row)::text)` for the explicitly selected DB row shape; the application measures its canonical serialized draft. Do not compare one measure as though it were the other. These caps bound admitted materialized input and number of fold operations; they are not a total RSS, query CPU, total output serialization or latency/SLO guarantee. Stored new source/truth envelopes and projection add fixed schema/identity overhead and repeated primitives; no exact memory claim is made.

Before any full report payload is loaded, reject target >256 using bigint. Query the exact bounded prefix's metadata/size, ordered by bigint sequence with `LIMIT 257`; require its exact row count to equal the target and every per-row/sum bound. Load the same scoped head-constrained rows only after that check. Reports are immutable, so new appends cannot increase this target's payload. Narrow order/allowance projection reads contain only the required identity/mode fields, not arbitrary metadata. Attempt/plan variable bodies are measured before existing full-body mappers receive them.

Before calling any full account ledger list/fold, count up to4097 IDs per source/truth/event table under675; then, only if within bound, compute row-byte maxima and total bytes in SQL without returning those JSON bodies to JavaScript. These are scoped indexed reads; final SQL should use bounded subqueries/CTEs, not load-and-count or an unbounded application list. Knowledge reservations and the entire projection-history table are not materialized. Before fetching any existing latest-projection JSON, use the existing reader's exact ordering (frontier_sequence DESC, knowledge_as_of DESC, id DESC) with LIMIT1 to select only its identity/frontier metadata and `octet_length(to_jsonb(row)::text)`; refuse if the row exceeds16,777,216 bytes. Do not first call `readLatestRealityProjectionV2` and measure its already loaded stable_entries/uncertainties. Under675, read and validate that exact selected row only after the metadata/size admission; verify its selected identity is unchanged. This projection-body bound is separate from source/truth/event ledger bytes and does not depend on arrays merely satisfying SQL type checks.

Route all selected reports first, validate/count/measure every draft, then reserve **one source + one truth + one event per draft** against the respective4096 limits before first write. This intentionally overestimates duplicates/quarantines; refusal is allowed even when a clever exact accounting could fit. Existing held ingestion creates at most that many source/truth/event rows per input; retain and test that invariant. Its repeated full ledger folds are now bounded by this reservation. If implementation discovers another write shape or source input which breaks that bound, stop for contract revision, do not silently lift the cap or skip a draft.

Return a typed capacity refusal naming the bound and safe numeric/string observed count, never a partial success. The count/head tests include `9007199254740993` and bigint maximum as synthetic metadata controls: capacity refusal must precede report-body loading, with exact values preserved. No enormous fixture or real long history is needed to test integer safety. This conservative design can refuse an otherwise valid large account or attempt; availability beyond the bound remains explicitly unsupported.

## 5. Routing, atomic delivery and time

### Mandatory existing-ledger gate before the first writer

For a nonempty captured target, after scope/675 and all bounded metadata checks, load the existing bounded source/truth/event ledger through validated readers, and the size-admitted exact latest projection. Complete this gate **before calling any held ingestion, knowledge allocation, source append or projection persistence**. It is a read-only gate; `persistCanonicalRealityProjectionV2FromWriter` is not a substitute for comparing the stored state.

- If sources, truths and events are all empty and no stored projection exists, the account is an admissible empty baseline for first delivery. This is not a pre-existing source-completeness certificate.
- If there are no events but any source/truth row or stored projection exists, refuse `DELIVERY_INCOMPLETE`; this slice does not repair unexplained no-frontier artifacts. A legitimate semantic alias needs an earlier admitted witness, which requires events, and a legitimate quarantine also has an event.
- If events exist, validate the full contiguous event chain and its exact linked source/truth bodies, fold at the actual last event knowledge time, and require the selected stored projection to exist and equal that complete canonical fold in identity/body/digest/frontier. Missing projection, lagged frontier, different head/digest/body, corrupt chain or unavailable dependencies refuse `REALITY_BASELINE_INVALID` before any write. A later duplicate must not silently create/refresh a missing/lagged projection and mask this refusal.
- A verified alias source newer than the last event can remain outside the fold, as detailed in§6; selected-source admission witnesses are checked separately. This gate does not require an event for every source or impose current active truth on every historical delivered observation.
- `NO_REPORTS` follows§3 before this gate: it leaves account Reality explicitly unexamined and returns no projection/witness or clean-state assertion, with no writer invoked. Tests must distinguish this deliberate empty-target result from acceptance of an inconsistent account baseline for a nonempty target.

After each delivery sequence the final persisted projection must again equal the current complete event-head fold under the held lock. This postcondition complements the mandatory baseline check; it cannot replace it. New projections are constructed internally from the admitted bounded ledger, not accepted as arbitrary caller/stored JSON. No selected pre-existing projection body may be loaded before its size check.

For a nonempty accepted target, call existing `routeRealityIngressV2({kind: 'EXECUTION_REPORT_V2', report})` on the internally reloaded reports. Preserve exact report order and adapter draft order. The caller cannot supply a body to this route through the new public API. No alternative primitive mapper, source kind, report reinterpretation, synthetic native revision, SETTLED promotion or REALIZED_CASHFLOW is added.

Within the already held owner transaction, invoke `ingestRealitySourceReportV2FromWriter` for each validated draft. Do not call the public per-draft transaction wrapper or acquire a nested savepoint as a substitute for root ownership. All newly created Reality sources/truths/events/projections/reservations in this command commit together or roll back together. Existing Execution attempt/report/order/claim and prior Reality rows are never rewritten. Legacy partly delivered targets are replayed from report1, reusing exact existing immutable observations and adding only genuinely missing drafts.

Preserve report observedAt/source validAt exactly. Existing DB knowledge allocator authors delivery knowledge; no backdating to execution time, invented collector receipt or new venue-source authority. Exact repeats reuse their persisted original source knowledge timestamp. Source identity is re-derived using that stored timestamp for equality, as the existing append helper does.

Complete every route, scope, prefix, capacity and pre-existing selected-source witness check possible before writes. A later admission/storage/witness mismatch must throw inside the owner transaction so its new work rolls back; returning an ordinary failure value from inside a transaction must not accidentally commit a prefix.

## 6. Exact delivery witnesses, legitimate duplicates and quarantine

Derive each selected draft's exact existing source identity by the current factory with the stored knowledge timestamp, then compare the complete source body/content digest and stored Execution lineage. Source-only input is not repaired simply because an old helper returns DUPLICATE. Verify selected sources after the command's ingestion and before commit against validated persisted source/truth/event bodies and the complete current event chain. Also precheck the corresponding already present sources before effects.

A selected source is represented only by one of the following existing outcomes:

| Witness | Required proof | Meaning |
|---|---|---|
| Own admitted truth | Exact source↔truth body/digest/scope linkage plus its exact OBSERVED or SUPERSEDED event and valid chain/correction linkage. | Historically admitted fact; it need not still be the latest stable truth after a valid supersession. |
| Own contradictory truth | Exact marked source↔truth linkage and SOURCE_CONTRADICTION event to the then-current stable related truth, with any later exact RELEASED/supersession history replayed. | Recorded contradiction; release never promotes that candidate into stable authority. |
| Explicit source-only quarantine | Exact source's QUARANTINED event, permitted existing reason/attribution/verification/revision conditions, truth/related null as SQL requires, and valid complete ledger replay. | Recorded uncertainty, not missing delivery; no new truth is manufactured. |
| Semantic duplicate alias | Existing helper's exact `sameNativeFact` conditions plus equality of its exact semantic body (below), and an **actually admitted** equivalent truth with its own valid source/event witness. | New/existing source is an observation-equivalent alias; it legitimately may have no own truth/event. Not current active economic authority. |

Semantic equality must match the existing algorithm, not just subject or amount: same sourceKind; full sourceNativeIdentity (including identityKind, nativeId, nativeRevision and supersedesNativeRevision); subject; primitiveAssertion; structuralVerification VERIFIED; empty verificationReasonCodes. `sameNativeFact` also matches subject and native kind/ID/revision. Provenance/lineage/knowledge/valid time are intentionally not part of that helper's semantic digest; each selected source's own complete stored body/lineage remains independently checked. Reuse/factor this existing predicate narrowly if needed; do not silently create a second meaning.

The equivalent truth must have a real admission witness (OBSERVED/SUPERSEDED or recorded contradiction as applicable), not only an orphan truth row or a stable-looking object. Pick a deterministic witness for output when several qualify. A superseded or released historical witness still demonstrates recorded delivery; it does not requalify that assertion as current truth. Current uncertainty is reported independently from the final projection. If a source matches no exact witness, return `DELIVERY_INCOMPLETE` and roll back the command's new work. In particular, source-only unexplained rows, orphan truths, wrong source linkage, forged semantic equality, missing events or altered chain are not fixed automatically.

Current Execution adapter always produces VERIFIED attributed drafts with no native revision. Its current source-only correction quarantine is therefore generally unreachable from this entry. Native/pure fixtures of that general admissible ledger case must be labeled as compatibility verification, not a demonstrated current Execution producer output. Do not fabricate a new Execution revision or mark a valid execution source unverified merely to force a green test. Genuine semantic-alias reachability likewise depends on exact adapter/source identity: if only general held-ingester fixtures can express it, label that limit honestly.

Replay the complete currently captured Reality event chain under675 at its final head knowledge time and compare the exact persisted projection identity/body/digest/frontier. Never accept merely a self-sealed old projection. Later source-only aliases beyond the last event knowledge time are validated separately; they do not force a fake event or a new projection frontier. Empty event history cannot establish a successful nonempty delivered prefix. Existing unrelated ledger uncertainty remains visible; a delivery result never claims the account is free from uncertainty outside this target.

Repeated report observations for the same order/fill preserve existing contradiction behavior. The report-derived native identity and absence of supersession revisions are not permission to choose the newest observation as truth. A current projection with uncertainties yields `DELIVERED_WITH_UNCERTAINTY`; otherwise use `DELIVERED` with explicit `authority: OBSERVATION_DELIVERY_ONLY`, never `SOURCE_COMPLETE`, `SETTLED` or `READY_TO_TRADE`.

## 7. Result, restart, failure and process ownership

A committed nonempty result includes exact scope/attempt digest, captured report head sequence/digest, selected report/draft counts, source identities and deterministic witness identities/classifications, newly inserted versus existing source/event counts obtained from actual before/after observations, resulting projection ID/content digest/frontier, and account projection uncertainty count. Aggregate counts must come from this complete bounded target, not a truncated result list. Do not expose report JSON, exact request payload, secret-bearing environment values or provider keys. The result is not a newly persisted commercial receipt or whole-account source completeness certificate.

Re-run after commit, process death or recreated connection targets the same prefix again (or a strictly extended captured head if reports were added) and converges through exact immutable identity. It must not submit, query a venue, cancel, repair Execution, rearm claims or mutate any financial/runtime authority. No global delivery cursor or new table is needed.

A known rollback gives a typed refusal/failure with `newDeliveryCommitted: false`. A connection failure around commit is **COMMIT_OUTCOME_UNKNOWN**, not a proven rollback; return a safe retry instruction for this idempotent report-delivery command only. Never tell an operator to retry order submission. Existing committed reports remain stored irrespective of delivery failure. An after-commit CLI output/close error likewise must not imply the committed delivery was rolled back.

Use `getResolvedWaiaDbRuntimeConfig` to require postgres and a nonempty URL before allocation, then call `createPerRequestPostgresRuntime` directly for one owned fresh client. Avoid `getWaiaRuntimeDb`: it imports SQLite runtime and can honor a singleton override. Avoid the long-running campaign/session helper; this command uses a bounded transaction and a transaction advisory lock, not a multi-hour session lock. Do not change other callers' runtime behavior.

The script keeps sole ownership of the created `_sql` and invokes **one** `await _sql.end({timeout: POSTGRES_CLOSE_GRACE_TIMEOUT_S})` in finally, using the existing constant/driver API. Do not also call the HTTP disposal helper: its200ms inline race can return before Node closure and a second close would obscure exact ownership. If close fails, emit a sanitized cleanup status while preserving whether delivery committed; set exitCode without forced `process.exit`. No client exists for argument/backend refusal; all success/refusal/query-error/output-error paths after allocation attempt exactly one close. If implementation needs a tiny Node-specific shared helper for this exact owner, it may wrap the same operation without changing HTTP disposal semantics.

Exit status:0 for committed DELIVERED/DELIVERED_WITH_UNCERTAINTY or NO_REPORTS;2 for typed precondition/capacity/incomplete refusal;1 for unexpected failure, unknown commit or cleanup failure. Output keeps the structured command status separate from process cleanup status, so a nonzero exit after successful commit cannot be mistaken for no observation delivery.

The immutable import study shows no connector resolver, credential/master-key, live-cycle, Execution recovery/submit or billing factory in the chosen reused roots; HTX reality-adapter is a pure mapper, not an exchange client. It does include schema declarations and third-party Drizzle/postgres/Cloudflare imports. This is not a runtime no-network proof. Final actual CLI startup/dispatch tests must forbid fetch, credential lookup and venue construction and exercise the real parser/entry. Update the exact existing Reality consumer-graph registration only as needed; retain negative bypass detection and do not hide new source authorship behind renamed literals.

## 8. Required acceptance and implementation scope

One coherent package may add the public owner, private bounded readers/witness verifier, CLI/script, focused tests, canonical plan and narrow graph registration. Reuse the existing immutable report validators/adapter, Reality constructors, held writer, fold and SQL guards. No new schema, migration, financial policy, source kind, execution mode, release/activation path or automatic scheduler. Do not wire a provider recovery hook in this slice.

| Acceptance | Required actual observation |
|---|---|
| Baseline vertical gap | Controlled native canonical bind/report shows persisted report but no automatic Reality delivery. Do not label initial fixture/setup errors as production RED; keep independent source trace that the existing unused factory hook would be insufficient. |
| Real entry | Actual CLI parser/dispatcher reaches the public owner and local PostgreSQL with inert supported live-mode metadata; reports create exact observed Reality source/truth/event/projection, no provider capabilities or unrelated table writes. |
| Stored provenance | Wrong org/account, attempt/plan/order binding/digest, unsupported venue/mode/history, forged caller-shaped body, malformed valid-time/report body or missing allowance reference refuses without effects. Retain actual0157/0160 native guard negative tests. |
| Head/limits |0/null head; sequence gaps; incorrect terminal digest; exact256/257 report boundary;512/513 draft boundary; exact byte/row limits; bigint beyond2^53; complete prefix versus concurrent report above head. Prove metadata/cap refusal occurs before unrestricted bodies/list/folds. |
| Exact duplicate | Existing complete prefix plus new drafts, full repeat, repeated connection and child-process replay preserve original identities/knowledge; classifications alone are insufficient. Check source/event/attempt/claim snapshots before/after. |
| Partial/alias/quarantine | Unexplained source-only and orphan-truth artifacts refuse; admitted semantic alias succeeds with exact witness; explicit admissible quarantine stays uncertain; changed native revision/primitive/provenance mismatch refuses. Label general compatibility fixtures separately from actual adapter reachable cases. |
| Projection | Missing/lagged/mismatched existing projection, no-event artifacts and corrupt chain refuse **before** any ingestion/knowledge/source/projection write; genuinely empty baseline permits first delivery; NO_REPORTS leaves Reality unexamined. Test an existing exact duplicate so its built-in persist path cannot mask lag. Exact16MiB/over-limit selected-latest-projection metadata controls precede any full JSON read. Final complete fold/head still required; source alias after head needs no invented event; historical supersession/release and unrelated uncertainty remain visible. |
| Transaction/faults | Native failures at source, truth/event and projection stages roll back newly delivered prefix, including knowledge allocation. Previously committed partial sources are not deleted. Simulated lost commit acknowledgement returns unknown, not false rollback. |
| Concurrency | Real two-session675 contention serializes same account; other account progresses; concurrent report append after captured head is ignored until next invocation. Prove no explicit Execution/Risk/order FOR UPDATE or execution callback. |
| Ownership/isolation | Actual Drizzle tx handle refused before reads; root DB with inherited RR setting is explicitly RC before first query; input mutation during awaited lock cannot change scope/attempt; no nested public ingestion. |
| Capability/disposal | Actual entry no-client invalid/backend case; acquired-client success/refusal/error closes once; close rejection preserves committed status; no singleton even if per-request env saysfalse; no credential/provider/fetch or forced process exit. |
| Integrity/compatibility | Existing SQL RLS/append-only/source-lineage companion suites stay intact; exact graph gate and required native CI execution proof added by root after independent review. Do not weaken guards or use synthetic body bypasses to retain green companions. |

Actual counts, limits, fault behavior and test commands must be recorded only after execution on an exact implementation SHA and approved isolated native database. This design task ran no native/test suite and supplies no acceptance PASS for the proposed code. Root retains implementation authorization, issue creation, independent review, required full readiness/CI and publication.

## 9. Deliberately unresolved broader P08

This contract makes progress on committed-report delivery without choosing cost basis, allocation, trade/strategy ownership, automatic source finality, currency conversion, billing period membership, source completeness or prior consumption. Those remain the exact missing producer/data/policy contracts catalogued in the older frozen report. Source data merely queued in Execution can become recorded observations here; recorded observations still do not establish successful canonical live execution or commercial settlement. No real venue command, C3 modification or live enablement is authorized or required by this package.

## WP-3 — author acceptance and remaining integration gates

Author implementation/testing remains based on accepted
`1a59b31b620af81b727d28b24f3ddbf9cb953074`. The contract above is preserved
verbatim. No SQL/schema, provider, financial, runtime activation or C3 change was
made. The mandatory PostgreSQL workflow and its 15 incoming suites are unchanged;
additive registration and accepted-base integration belong to the root controller.

Executed locally against implementation snapshot
`8ee929726029a3da1ba9390dc7e7bc4ca66445f9`:

- Fresh isolated loopback PostgreSQL 16.14 database, 219 existing migrations.
  `pnpm test --run --no-file-parallelism
  tests/integration/postgres-execution-reality-delivery.test.ts
  tests/integration/postgres-execution-v2.test.ts
  tests/integration/postgres-reality-v2.test.ts`: **78 passed, 3 files, zero skipped**
  (35 new delivery cases; 34 Execution and 9 Reality companion cases).
- Real CLI child and recreated connection replay; root-owned RC with actual
  held-transaction refusal; 675 lock blocking under a repeatable-read session
  default; distinct-account progress; captured prefix with a later report;
  synthetic lost commit acknowledgement and exact retry; late-prefix native
  source/truth/event/projection/knowledge failures; original partial-prefix
  preservation; source-only/missing/lagged projection refusal; oversized report
  and latest-projection guards; unchanged execution/risk snapshots; existing
  append-only and deny-RLS controls. Tests use synthetic persisted observations
  without a venue callback.
- Teardown confirmed zero remaining test sessions, disabled triggers, injected
  fault triggers/functions and fixture organizations. The DB grant was released.

After that native run, the integration test changes only an assertion argument
from a readonly array to its spread copy. **No fresh native run is claimed for
that later test byte**; root/PR current-base native acceptance remains required.
The other test-only corrections type the stdout spy and wrap `it.each` flag arrays
as explicit objects, so each invalid CLI case actually passes its entire flag
array. Production implementation bytes remain identical to the native snapshot.

Final scoped command (three new unit files plus Reality projection/ingress/graph
companions): **80 passed, 6 files, zero skipped**. Scoped ESLint, `git diff --check`
and the explicitly granted `pnpm typecheck` pass. The graph check passes with
155 sources, 140 consumers and 26 connector references; only the specific new
DB-only routing/CLI boundary is registered. Full lint/build/PR CI have not been
run by this author and remain root-owned gates.

Evidence is retained in the project audit directory `evidence/dee-1122/`:
`author-native-acceptance.log`, `author-scoped-acceptance.log`,
`author-typecheck-confirmed.log`, `author-scoped-eslint-confirmed.log`,
`author-database-setup.json`, `author-teardown.json`, and the handoff manifest.
Earlier setup/fixture/typecheck failures are preserved separately and do not count
as demonstrated production defects. The real initial CLI top-level-await CJS
failure was corrected in the new executable and is covered by an actual child.

This proves bounded observation delivery only. General semantic alias and
source-only revision quarantine fixtures are explicitly compatibility fixtures,
not new Execution-adapter producers. Current fills remain `OBSERVED`; no cashflow,
commercial finality, lifecycle allocation or complete P08 readiness is inferred.

## WP-3 — accepted-base refresh and additive CI registration

Normal merge `8da3412247177dfb12d454fddb4e0a6ef97f0618` integrates accepted
`21a60ec38573f0ca5c535992e9e09392c2aa78c9` into author freeze
`98bf79a858d1f0ab9ba617b837d24084637d1a15`, without conflicts. Both binary patch
directions are identical: all17 author paths and all5 incoming DEE-1114 paths
retain their exact blobs at the merge. No production delivery or native-test
implementation changed during this refresh.

The actual capital-authority job now adds
`postgres-execution-reality-delivery.test.ts` to the existing15 mandatory native
suites. The proof validator requires all16 to execute successfully; its negative
tests retain missing/skipped/failed/empty/duplicate refusals for every suite.
Exact workflow filters cover the new native fixture/test, CLI script, CLI package
entry and scoped unit tests. No native schema/profile or guard exemption is added.

Executed scoped acceptance on this refreshed source: **155 tests /11 files passed,
zero skipped**, including all three incoming numeric/billing companions and17
proof-guard tests. A final18-test proof/profile replay checks the subsequently
added exact package-entry/filter assertions. Scoped ESLint and diff check pass.
The actual CI endpoint (`waia_it` on127.0.0.1:5432) and all three existing execution
flags are read from the workflow; the new offline CI-profile test exercises the
real configuration/argument parsers without connecting to a database. The native
child explicitly selects PostgreSQL and uses the real CLI entry.

No PostgreSQL, full typecheck, full lint or build was run during this refresh.
The earlier78-native acceptance remains attributed only to8ee92972 on the former
base. Root must run the fresh combined16-suite native proof and full readiness
on the refreshed integration before publication. Existing unrelated canonical
profile suites were neither added nor waived. Source/patch/hash evidence and
raw scoped logs are in `evidence/dee-1122/accepted-base-21a60ec3/`.


## WP-3 — root current-base acceptance

On accepted base21a60ec3 and sourceb8f5e013, root applied219 migrations to a fresh
isolated PostgreSQL16.14 database and executed315 assertions in all16 mandatory
native suites, zero skipped. The new delivery suite contributes35 assertions;
all15 incoming suites are preserved. Final readback found no other sessions,
injected fault triggers/functions or disabled public user guards. No production
or provider action was performed.

Root155 assertions/11 scoped files, full lint/typecheck/build, canon, PR governance
and both consumer graphs passed atb8f5e013. The final base diff check found one
duplicate EOF newline in the new test helper. Commitfa3c0ad4 removes exactly that
one byte; independently recorded TypeScript emitted JavaScript remains identical.
The corrected base diff check passes. Initial failed output is preserved, and
native/test execution is attributed to b8f rather than retroactively relabeled.
Evidence: project audit evidence/dee-1122/accepted-base-21a60ec3/acceptance.json,
root-readiness-combined.json and eof-only-identity.json. Final independent review,
publication and all current-head PR CI remain required; these are not full P08,
financial-finality or live-readiness claims.
