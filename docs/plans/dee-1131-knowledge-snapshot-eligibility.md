---
integrationIssue: DEE-1131
integrationTitle: "Preserve Knowledge known-at and retired lifecycle in public snapshots"
parentIssue: DEE-639
branch: dee-1131-knowledge-snapshot-eligibility
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [lint, typecheck, targeted-unit, native-postgres, build, validate-canon, validate-pr-governance, validate-canonical-graph, validate-master-build-graph]
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
  remainingWorkPackages: [WP-3, WP-4]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Root/M01 review the coherent five-module correction and scoped evidence; request one typecheck and a separately scheduled native resource grant. Native suite is prepared but unexecuted."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1131 — Knowledge snapshot eligibility

## Admission and exact starting point

Single issue [DEE-1131](https://linear.app/deepsense/issue/DEE-1131), parent DEE-639; related DEE-771, DEE-629 and DEE-1126. Root admitted plan preparation after independently verifying the actual-reader native reproduction. Implementation, native resources and publication remain separate gates.

Accepted base is **`3c8b7b98ed7a16205e0e0a368ac4dc9922b86b07`**, the normal merged result of PR688. The clean completed1126 checkout was reused; branch `dee-1126-saved-research-understanding` remains at `1a2ff32ffb155dd12a1ff05ca2d7f9c412462218`. Ignored evidence/build artifacts remain preserved. No running process depended on the checkout at branch change. This branch starts directly from accepted3c8b; no pending source is imported.

Current schema has **222** journal entries through0221. This issue adds no migration and changes none of those SQL files, hashes, `when` values or compatibility lists. Current critical native lane contains22 suites; separate3 billing,2 payment and4 PostgreSQL17 lane registrations remain distinct.

The five proposed production modules below are byte-identical between native-reproduced82cf and accepted3c8b. Source-only inventory: external `parallel-runtime-owner/dee1131-plan-3c8b7b98/source-inventory.json`, SHA256 `1f06253d60cfbbc90e1f5c86db5b09954b2b89d80709a3985db659c6247ea208`.

## Confirmed problem and one complete result

An ordinary public Knowledge snapshot at12:00 currently admits a correction whose event is11:00 but recorded time is13:00. A latest RETIRED version also loses its lifecycle in domain projection and remains `RESOLVED_CORRECT` support. Native evidence on immutable82cf exercised actual insert/append writers, PostgreSQL rows, public read model and canonical fold: five correctness RED and eleven passing controls, with all221 then-accepted migrations and unchanged roles/guards/RLS.

Frozen evidence remains historical and unchanged:

- `parallel-runtime-owner/p10-mkb-reader-native-82cf05c9/REPORT.md`: SHA256 `67797f6673e167e5eb612d303ee78cc2af138e947a1947507d60174a3b943eeb`.
- Its `FREEZE.json`: SHA256 `7d60fe1803951d812a89d2f9738342c0de9d8d1f3525bdbf1f7e62cd7d005c51`.
-339 hashed artifacts,39 immutable runtime modules,196 actual SQL traces, five expected RED and eleven controls. Initial external fixture UUID/idempotency mistakes are preserved separately; none is a product defect.

The delivered result must be the **existing public writer→snapshot→read-model/fold chain** selecting only versions visible at its supplied cutoff and retaining restrictive retirement through its actual consumers. It is not a new wrapper, an ordinary semantic producer, a qualified hypothesis, or full P10 completion.

## Exact domain and temporal compatibility

### Version selection

In `createMkbReadModelSourcePostgres.loadSnapshot`, retain all current base-row tenant/created/updated/query restrictions and version-descending order. A version is eligible only when both `pitEventAt <= asOf` and `recordedAt <= asOf`. Apply both predicates before selecting the latest eligible version for an edge. Later versions outside either boundary must not suppress an eligible earlier version. Boundary equality remains included. No host clock, changed record time, rescan, row rewrite or future-current fallback is introduced.

The public source still takes one cutoff, not an invented second argument. In ordinary `foldCanonicalRuntimeIntelligenceStateV1`, `epistemicRecordCutoff` defaults to `input.asOf`. Existing historical first/next-cycle composition deliberately calls this source with a ratified record cutoff distinct from market `asOf`. Preserve that distinction, its existing bound-authority checks and the independent market-time checks on prediction/evidence/observation. Do not change the historical callers to pass market time as record time or require equality of the two clocks.

The latest-version repository methods without an `asOf` argument remain latest-state APIs; this issue does not silently turn them into PIT APIs.

### Lifecycle and legacy rows

Add an optional domain projection `KnowledgeEdge.lifecycleState?: "ACTIVE" | "RETIRED"`, reusing the existing lifecycle type where appropriate. It is projected from the selected stored version, not accepted as a new insert/update authority field. `applyKnowledgeEdgeVersion` must carry the selected version's lifecycle. A null version preserves the existing legacy edge unchanged.

Missing lifecycle remains the legacy ACTIVE-compatible case. This is supported by current base-row shape, initial-version `contentFromEdge(..., "ACTIVE")`, migration0211's ACTIVE backfill, and existing in-memory/SQLite objects without a lifecycle field. There is no unknown→qualified conversion or new lifecycle value. Existing writers, mutation refusals, reasons, expectedVersion, content/receipt digests and terminal-state rules are unchanged. Raw `verified`, confidence and strength are not rewritten to manufacture restriction.

`classifyKnowledgeEdgeState` returns existing `INELIGIBLE` for explicit RETIRED before verified/staleness classification. Existing read-model entries remain diagnostic history, but `verifiedKnowledge` excludes them. Pattern-discovery metadata retains raw facts while its existing `knowledgeState` becomes INELIGIBLE. The canonical ordinary fold already filters INELIGIBLE references and therefore cannot retain RETIRED as `RESOLVED_CORRECT` support.

The sealed historical fold must **explicitly reject** a selected RETIRED edge in its existing `assertSealedKnowledgeRows` boundary. Merely losing support later is not sufficient for a sealed-authority check. Do not add a new staleness or confidence threshold to that check.

### Digests and stored identity

`sealHistoricalKnowledgeEdgeV1` explicitly enumerates its V1 fields. Preserve that function's domain and field set, as well as market-prediction seals, sealed snapshot identity and stored bootstrap receipts. A selected RETIRED edge is denied separately even if those legacy immutable fields still produce the old seal. No re-sealing or historical authority repair is allowed.

The fold's current `snapshotDigest` also uses explicit projections. Include a restrictive RETIRED marker only for retired rows so its Knowledge semantic digest cannot conceal that change. Omit the marker for both missing legacy lifecycle and explicit ACTIVE. Thus ACTIVE/legacy replay digests remain byte-identical, while retirement changes the consumed semantic state. This is a restrictive projection of existing stored meaning, not a new digest check against version rows.

In particular, do **not** recompute/reject every stored version digest: migration0211's legacy backfill convention differs from the current writer's full-content seal. This package preserves both layouts and does not rewrite them. Current-writer hashes remain tested as evidence, not a newly invented universal admission rule.

## Actual consumer map

| Existing boundary | Effect of this package | Required compatibility proof |
|---|---|---|
| `insertKnowledgeEdgePostgres` → initial version; `appendKnowledgeEdgeVersionPostgres` | Writers unchanged; returned version projection carries existing lifecycle | Valid initial/correction/retirement, current-version idempotency, stale-version refusal and existing seals |
| `queryMarketKnowledgeReadModel` in `knowledge/market-memory.ts` → public source/read model; called by `epistemic-closure-runtime.ts` | Correct known-at and verifiedKnowledge eligibility reaches an actual registered composition | Earlier/later cutoff and retired read-model controls; no new capital consumer |
| Canonical fold and existing provider | RETIRED references excluded; restricted lifecycle included in Knowledge semantic projection | Ordinary FOR-evidence case ceases to become/remain SUPPORTED through the inadmissible edge; deterministic replay |
| Historical `production-first-cycle-bootstrap-v2.ts` and `production-next-cycle-forecast-v2.ts` | Same source/fold, same distinct ratified record cutoff and sealed binding | Bound dual-time positive, unbound/mismatched cutoff refusal, unchanged active historical seals; RETIRED sealed edge refuses |
| `historical-prerun-knowledge-bootstrap-v2.ts` | Existing new ACTIVE insert and seal remain unchanged | Active returned lifecycle does not change its explicitly projected V1 seal or final snapshot digest |
| In-memory source, read-model queries and legacy objects | Optional lifecycle is carried without inventing version history | Missing/ACTIVE parity; explicit RETIRED INELIGIBLE; existing date/staleness rules unchanged |
| Knowledge Navigator V2 | Already has explicit ACTIVE/RETIRED candidate semantics; no new wiring | Existing Navigator unit/inventory controls stay unchanged and passing |

The low-level get/list repository functions are not themselves a live/financial authority. Their domain projection improves observability; this issue does not add a consumer that bypasses Navigator, Predictive Admission, Risk or Execution. Existing protected live cycle remains unchanged.

## WP-1 — Regression fixtures and exact current-source baseline

After root admits this plan, add meaningful failing unit/native regressions for the two confirmed causes. Preserve immutable pre-fix outputs rather than translating the old native reproduction into a current PASS. Fixtures must use actual valid writer inputs; any setup/schema errors are separately classified. No direct UPDATE/DELETE, trigger disabling or whole-registry cleanup is permitted to manufacture adverse data. Use separate immutable histories for future-event and tenant controls.

Unit work may use real pure projection/classifier/fold and inert query ports; SQL behavior still requires real native proof. Historical controls must label synthetic authority objects accurately, never claim ratification or a completed historical campaign.

## WP-2 — Minimal reader and lifecycle correction

Implement only the temporal predicate, optional lifecycle projection, restrictive classification, sealed-retirement check and compatibility-preserving snapshot projection described above. Preserve all prior SQL, source authority, writer semantics, raw facts, schema versions and public temporal signatures. No caller-selected callback/digest authority, generic eligibility service, new scientific profile or lifecycle transition is added.

## WP-3 — Real writer/reader/fold native and consumer compatibility

On a root-granted isolated local database, verify actual profile, initial freshness and every current222 SQL/when identity. Run the dedicated actual PostgreSQL suite serially with exact current source and retained append-only fixtures. Preserve roles, memberships, guards, RLS and historical tables; close all clients and report zero sessions/faults. No local native grant is conveyed by this plan.

Turn the original five expected RED into actual regression PASS and retain all eleven controls. Add cutoff equality/+1ms, late retirement not-yet-visible, older eligible fallback, tenant/history-order, explicit ACTIVE/legacy parity, deterministic replay and sealed RETIRED rejection with unchanged V1 seal. Include no-version legacy fallback and current-writer hash compatibility without blanket stored-hash enforcement.

Root owns mandatory CI registration and resource scheduling. Proposed lane addition is the new dedicated suite, preserving current22 and producing23 mandatory suites only after root admits/registers it. Separate3 billing/2 payment/4 PG17 lists remain intact. Existing broader native companions run only if root explicitly selects a safe fixture/profile; do not repoint guarded old suites or inherit their cleanup helpers to obtain a PASS.

## WP-4 — Exact-source review, readiness and publication

Freeze source/scoped/native evidence and receive independent nonauthor review. Root coordinates whole lint/typecheck/build/canon/governance/Reality/Execution checks, any source-derived inventory adjustment, rendered PR preflight and current-head CI. No automatic graph pin changes or weakened validators. Any necessary additional path is reported before edit. No full local unit suite duplicates authoritative GitHub CI.

Final report separates historical82cf RED, current-source regression/native acceptance, compatibility evidence and current-head CI. Author cannot self-accept or publish merely from test counts. Rollback is one code revert with no schema/data reversal; such a revert would knowingly reintroduce the two documented reader defects.

## Finite affected-file map

### Author-owned production edits — five files

1. `lib/trader/knowledge/knowledge.types.ts` — optional existing lifecycle projection with explicit legacy compatibility.
2. `lib/trader/knowledge/knowledge-edge-version-repository-postgres.ts` — retain selected lifecycle in `applyKnowledgeEdgeVersion`; writer/planner/hash contracts unchanged.
3. `lib/trader/knowledge/mkb-read-model-postgres.ts` — constrain selected versions by both event and recorded cutoff, preserving latest eligible selection.
4. `lib/trader/knowledge/mkb-knowledge-state.ts` — RETIRED→existing INELIGIBLE; preserve other classifications.
5. `lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1.ts` — restrictive snapshot marker and sealed RETIRED refusal; preserve historical seals and dual-time API.

### Author-owned tests — five files

1. New `tests/unit/trader-knowledge-snapshot-eligibility.test.ts` — real version projection and legacy/ACTIVE/seal/digest compatibility; focused SQL predicate boundary where meaningful.
2. `tests/unit/trader-wp15-knowledge-state.test.ts` — explicit retirement with existing verified/stale/unverified controls.
3. `tests/unit/trader-wp15-mkb-read-model.test.ts` — actual in-memory read-model retirement/history and legacy parity.
4. `tests/unit/trader-canonical-runtime-intelligence-fold-v1.test.ts` — ordinary reference restriction, unchanged active digests, distinct historical cutoffs and sealed retirement.
5. New `tests/integration/postgres-knowledge-snapshot-eligibility.test.ts` — actual writer→PostgreSQL→public source/readmodel/fold. Keep fixture ownership/guard local to this suite; no shared cleanup change.

The eleventh author-owned path is this canonical plan. No production caller, source API, SQLite adapter, Navigator, schema, migration, parameter, authority or arithmetic file outside the five above is planned for change.

### Root-owned CI coordination — three prospective files

- `.github/workflows/postgres-integration.yml`
- `scripts/postgres-validation/assert-capital-test-results.mjs`
- `tests/unit/postgres-capital-proof-guard.test.ts`

Only root edits/registers these after the implementation handoff or explicit delegation. Any Reality/Execution content pin needs separately reviewed source-derived evidence; this plan does not authorize an opportunistic graph edit.

## Validation selection and Acceptance Criteria

After implementation admission, focused unit selection includes the four changed/new unit files (native suite separate), plus existing `trader-knowledge-edge-version-v2`, `trader-legacy-mkb-mutation`, `trader-canonical-runtime-intelligence-consumer-closure`, `trader-runtime-knowledge-authority-v1`, all existing `trader-wp15-*` companions, `historical-forecast-knowledge-bootstrap-v2`, `historical-simulation-production-next-cycle-forecast-v2`, and Knowledge Navigator V2/inventory units. No unit assertion is rewritten merely to hide a changed active digest.

Acceptance requires:

- Both confirmed causes corrected through actual public production functions, with no disconnected helper acceptance.
- Prior known-at exclusion/later inclusion, event and record equality/+1ms, eligible earlier version fallback and exact tenant/version controls.
- RETIRED remains observable history but is never verifiedKnowledge or resolved-correct fold support; sealed authority refuses it independently of unchanged V1 hashes.
- Undefined legacy lifecycle and explicit ACTIVE preserve prior classification, read-model/fold digests and historical seals; initial/append writers and migration0211 legacy compatibility remain intact.
- Historical market-time and separately authorized record-time remain distinct; bound positive and unbound/mutated-negative paths survive without provenance invention.
- Current222 migration identities and all incoming proof registrations preserved; no schema/role/guard/session residue. Native counts only claim assertions actually executed on their pinned source.
- Scoped units/native proof, independent exact-head review, root readiness/preflight and all required current-head GitHub checks completed before publication/merge.

## WP-1/WP-2 implementation checkpoint

Root released implementation after exact plan-only `1c7edeba95b0bb81de84cc80a73dfeef61d65d18` / SHA256 `516abadc14d5fbf186c06e0a59594e1a11c145a934264dfba5cdc588b7fd55bc`. The five production edits and five test paths remain within that admitted map. No schema, write-authority type, CI or graph file changed.

Initial affected units on unchanged production3c8b produced **8 RED /22 PASS** across4 files. The failures cover the missing version lifecycle projection/record predicate and unrestricted retired classifier/readmodel/ordinary/sealed fold. They are not eight separately claimed product defects. Raw logs, JSON, original test bytes and patch are external and retained.

After the correction, the same4 files pass30 tests. The wider planned scope passes **80 tests /19 files**, and scoped ESLint/diff checks pass. Exact ACTIVE baseline Knowledge digest, full runtime-state digest and historical V1 edge seal were obtained from actual unchanged3c8b functions and pinned in controls; explicit ACTIVE and missing legacy lifecycle retain them. RETIRED changes the restrictive snapshot/consumer state and causes the separate sealed-authority refusal without changing V1 seal bytes.

The dedicated12-case native suite is source-prepared only. It uses actual initial/append writers and real MI repository composition, separate immutable temporal histories and retained rows; no trigger-disabling cleanup. It has **not executed**. New typecheck, native222-migration/23-suite proof, current-source independent review, full readiness and current-head CI remain unproven and separately scheduled. No database, host, provider or financial action occurred during WP-1/WP-2.

External checkpoint evidence: `parallel-runtime-owner/dee1131-implementation-3c8b7b98/`. The historical82cf native report and all prior frozen evidence remain unchanged.

## Root native disposition and exact CI registration admission

The separate dedicated run at immutable9a554b98560d4f91c8d05ef2ccdf1be311139b82 completed12 assertions/1 PostgreSQL file, zero skipped. Root independently verified all244 artifact hashes,16 source/config identities, all222 applied SQL hashes/when values, unchanged roles/memberships/full trigger definitions/RLS/policies, and zero sessions/faults/disabled guards. Evidence: external `parallel-runtime-owner/dee1131-native-9a554b98/FREEZE.json`, SHA256 `badc44841ec7abdf8f67211bf69154a958f89851d75d46bd76dd0131c35a299d`; root receipt is separate. Initial exact-head typecheck passed. The earlier unexecuted checkpoint is preserved as historical attribution, superseded only for these observed checks.

Independent nonauthor source report `milestone-audits/M01/review-DEE1131-source-9a554b98.md` SHA256 `31bc91462d9f4eb53c03a184d8548444c99cb972c4e3668ff9a8d25c6736a7e5` found no actionable source blocker. That report predates the native result and is not final package acceptance.

Before implementation, root admits the three already enumerated CI paths: append `postgres-knowledge-snapshot-eligibility.test.ts` to the actual capital-authority command and strict required-file guard, preserving all22 current entries and producing23 mandatory files. Extend the existing guard control to23 and retain its missing/skipped/failed/empty/duplicate negatives for every file. Add exact workflow path filters for all five changed production files, four changed/new unit files and the new native file, so later reader/fold-only changes cannot avoid this lane. Preserve every separate job, its prerequisites and3 billing/2 payment/4 PostgreSQL17 proof registrations. No authority, native skip waiver, schema or validation-threshold change is admitted.

Root owns these edits. A separately reviewed source-derived graph adjustment may follow; no pin change is authorized by this paragraph. The cumulative23-file native lane, scoped guard proof, final readiness, nonauthor final review and current-head CI remain pending.
