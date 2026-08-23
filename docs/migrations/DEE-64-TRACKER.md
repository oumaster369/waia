# DEE-64 Internal Slice Tracker

## Purpose

DEE-64 is not merely “replace SQLite client”. It is a **staged migration** to disentangle SQLite-specific assumptions from WAIA’s runtime and persistence architecture, while keeping production behavior honest until Postgres-backed paths are genuinely supported (async transactions, rollback, schema-bound repositories).

**DEE-675 / R675-B** adds the Postgres-only Reality V2 source-reference, truth,
event, and projection ledgers in the single additive migration `0160`, together
with one immutable raw-source admission relation and one protected knowledge-frontier
state relation. All six relations are organization/account-scoped and service-only
behind deny RLS. The four canonical ledgers and admission relation are append-only,
bitemporal/content-addressed where applicable; the frontier relation is mutable only
through its narrow protected allocator/consumer functions. Raw bytes and secrets
remain exclusively in the existing encrypted raw-capture storage; `0160` stores only
immutable lineage digests and references. This does not apply production SQL, change
retention/security policy, or enable new connector/source classes.

**DEE-680 / M680-B** adds the Postgres-only canonical gateway PIT and inert
Measurement lineage contract in the single additive migration `0161`. It extends
the existing MI Observation enum for the six Human-ratified external primitive kinds,
binds external rows to the existing organization-scoped Source and exact trust-as-of
revision, and adds append-only gateway admission receipts plus content-addressed inert
MeasurementDefinition/MeasurementValue lineage. New relations are service-only behind
authenticated/anon deny RLS. No formula, unit/window choice, economic evaluator, raw
bytes, retention/security-policy change, SQLite migration, production SQL apply, live
or capital authority is included.

This tracker records **what shipped**, **what must not regress**, and **what remains** so future agents and contributors do not collapse the program into fake backend-neutral abstractions or premature SQLite removal.

## Current Status

**DEE-671** adds Postgres-only Treasury category group text and effective-month budget
history in migrations `0158`/`0159` (`0157` is reserved by active AI-TRADER PR #477).
It derives month/year category and group budget truth from verified Treasury transactions;
it does not change broad runtime routing, apply production/Supabase SQL, touch the walkthrough
database, or mutate financial rows.

**DEE-651 / E651-A** adds the Postgres-only Execution V2 policy, plan, attempt, and raw
report substrate in migration `0157`, plus nullable V2 projection identities on
`trader_orders`. It is additive, service-only behind deny-by-default RLS, and does not
apply production SQL or change the staged runtime backend policy.

**DEE-650 / R650-C+D** adds the Postgres-only Risk V2 verdict, allowance lifecycle,
per-account reservation/accounting projection, and append-only digest-chained enforcement ledger
in migration `0156`, plus the exact order-authority binding seam. It is additive: legacy Risk/order
rows are not rewritten, and production/Supabase SQL apply remains explicitly excluded.

**DEE-656** adds Postgres-only generic raw-capture and record-only validation receipts in migration
`0153`: private-object references, separate content identities, transaction-authored capture/
validation knowledge times, composite tenant integrity, append-only guards, and deny RLS. Raw body
bytes, production policy defaults/storage/SQL apply, providers, Observation/Measurement semantics,
runtime routing, and capital authority remain excluded. See
[`DEE-656-MI-RAW-CAPTURE.md`](DEE-656-MI-RAW-CAPTURE.md).

**DEE-654 Split A** adds Postgres-only three-time PIT compatibility and trust-as-of receipts:
nullable `available_at` on existing MI trust/Observation rows plus append-only,
content-addressed `trader_mi_trust_as_of_receipt_v1` in migration `0152`. Existing rows remain
unknown until truthful availability exists; V1 digests, SQLite paths, providers, Measurements,
and runtime routing are unchanged. No production SQL was applied. See
[`DEE-654-MI-PIT-TRUST-AS-OF.md`](DEE-654-MI-PIT-TRUST-AS-OF.md).

**D1, D2, D3, D3b, D4, D5a, and D6-pre are complete and merged** on `dev`.

**D6-core** adds **explicit Postgres transaction runner** (`db/waia-postgres-transaction.ts`, async-only callback, rollback integration tests). **Still no** `runWaiaTransaction`, **still no** production route migration to Postgres persistence.

**DEE-72.1** adds **`PostgresTwinPersistence`** / **`createPostgresTwinPersistence(db)`** in `lib/persistence/postgres/*`, transactional writes via **`runWaiaPostgresTransaction`**, and **`resolveTwinPersistence`** overloads so a Postgres **`WaiaRuntimeDb`** handle resolves to the Postgres boundary. **DEE-72.2** adds **prediction verification** append/list on **`PostgresTwinPersistence`**. **DEE-72.3** adds **read-only** **`searchTwinMemoriesByText`** (full-scan + JS cosine; **no transactions** on the read path). **DEE-72.4** adds **reasoning-local** **`TwinMemorySearchPort`** + **`TwinVerificationListPort`** with SQLite + **`PostgresTwinPersistence`** adapters under `lib/reasoning/*`, **shared memory fusion** (`fuseMemorySearchSlices`), and **additive `*Async`** entrypoints (`getTwinPatternSummaryForUserAsync`, `runTwinContradictionDetectorForUserAsync`, `runTwinPredictionForUserAsync`) — **`runTwinEngine`** library body remains SQLite/sync; **`runTwinEngineAsync`** remains deferred. **DEE-72.4b** adds **opt-in** integration coverage (`tests/integration/postgres-twin-reasoning-prediction.test.ts`) for **`runTwinPredictionForUserAsync`** and **`getTwinPatternSummaryForUserAsync`** on real Postgres **without** SQLite `getDb()` — still **no** blanket production route migration. **DEE-72.5** adds **Postgres repeatability** on **`PostgresTwinPersistence`** (`appendRepeatabilityRecordForUser`, `analyzeRepeatabilityForUser`) and **`analyzeRepeatabilityForUserAsync`** in `lib/reasoning/twin-repeatability-analyzer.ts`; **`runTwinPredictionForUserAsync` runs outside** **`runWaiaPostgresTransaction`** for append (no reasoning inside the DB transaction callback). **DEE-95d** (implementation) wires **prediction verification** and **repeatability** **dashboard** routes to **`getWaiaRuntimeDb()`** so engine + those routes share runtime policy when `WAIA_DB_BACKEND=postgres`; other SQLite-first routes are unchanged unless individually migrated.

**DEE-72.6** adds **`runTwinEnginePostgresAsync`** in `lib/reasoning/twin-engine-postgres.ts`: **sequential, additive** async orchestration that mirrors **`runTwinEngine`** call order and response shape using **`PostgresTwinPersistence`** + existing async reasoning APIs (pattern, contradiction, repeatability, verifications, personality, optional prediction). **Non-goals:** no production API route wiring, no **`runWaiaTransaction`**, no changes to **`lib/persistence/runtime.ts`** or sync **`runTwinEngine`**; no promise that Postgres output text matches SQLite. Opt-in integration: `tests/integration/postgres-twin-engine.test.ts` (`WAIA_PG_INTEGRATION=1` + `DATABASE_URL_POSTGRES`).

**DEE-93** adds the repeatability migration **audit** (Postgres as consumed by the Twin Engine): [`DEE-93-REPEATABILITY-MIGRATION-AUDIT.md`](DEE-93-REPEATABILITY-MIGRATION-AUDIT.md). **Does not** implement routing or repeatability writer migration; verification / repeatability **GET** alignment with the engine store is deferred to **DEE-95+**.

**DEE-94** adds the planning document for a **future runtime-dispatched Twin Engine** facade (async boundary, SQLite wrap + Postgres `await`, sequential guarantee, parallelization policy): [`DEE-94-ASYNC-TWIN-ENGINE-ORCHESTRATION-PLAN.md`](DEE-94-ASYNC-TWIN-ENGINE-ORCHESTRATION-PLAN.md). **Does not** implement routing or new orchestration code.

**DEE-95** adds the **runtime routing strategy** for backend migration (dispatch boundary, env/rollback, alignment requirements, phased implementation — **planning**): [`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](DEE-95-RUNTIME-ROUTING-STRATEGY.md). **95c** implements Twin Engine route wiring per that strategy; the doc itself does not change production code.

**DEE-95a** adds **`runTwinEngineForRuntimeAsync(handle, input)`** in [`lib/reasoning/twin-engine-runtime.ts`](../../lib/reasoning/twin-engine-runtime.ts): async **library** dispatch (SQLite → sync `runTwinEngine`, Postgres → `resolveTwinPersistence` + `runTwinEnginePostgresAsync`). **Does not** change the production Twin Engine route by itself (**DEE-95c** wires the route to the facade).

**DEE-95b** adds [**runtime facade hardening / pre-95c planning**](./DEE-95B-RUNTIME-FACADE-HARDENING.md): risks, parity limits, test and observability recommendations, rollback, and go/no-go criteria before Twin Engine route wiring. **Does not** wire production routes or change runtime behavior by itself.

**DEE-95c** wires **`POST /api/dashboard/twin/engine`** to **`getWaiaRuntimeDb()`** + **`runTwinEngineForRuntimeAsync`**: runtime facade dispatch with **SQLite default** when `WAIA_DB_BACKEND` is unset or `sqlite`. **Does not** migrate verification or repeatability routes (**DEE-95d** still required before treating Postgres-backed Twin Engine traffic as fully aligned with those writers; see DEE-93 / strategy §9).

**DEE-95d** — **Planning** merged as [`DEE-95D-RUNTIME-ALIGNMENT-PLAN.md`](./DEE-95D-RUNTIME-ALIGNMENT-PLAN.md) (Linear: DEE-98). **Implementation** wires **`POST …/prediction/verification`**, **`GET …/prediction/verifications`**, and **`GET …/repeatability`** through **`getWaiaRuntimeDb()`** (SQLite default unchanged; Postgres env-gated via `WAIA_DB_BACKEND` / `DATABASE_URL_POSTGRES`). **Does not** enable broad Postgres rollout — ops/observability sign-off remains required (DEE-95e / strategy). Implementation tracked in Linear **DEE-99**.

**DEE-95e** adds [**operational readiness planning**](./DEE-95E-OPERATIONAL-READINESS-PLAN.md): telemetry expectations, rollback/kill-switch, rollout stages, gating criteria, health/integration strategy, remaining `getDb()` route inventory, success criteria for Postgres production readiness — **planning only**; **does not** implement observability code, change runtime behavior, or enable broad Postgres rollout.

**DEE-95f** adds **backend attribution telemetry** for `getWaiaRuntimeDb`-aware routes: one **stdout JSON** line per handled request (`waia_runtime_route`) with `waia_db_backend`, route key, outcome, `duration_ms`, `http_status`, optional `error_class` — [`lib/observability/waia-runtime-route-telemetry.ts`](../../lib/observability/waia-runtime-route-telemetry.ts) + Twin Engine / verification / verifications / repeatability / health/database handlers (**route keys expanded in DEE-95h / DEE-104:** twin-dialogue turn + turns; **DEE-105 / PR #104:** **`dashboard_readiness`**, **`diary_entries`**). **Does not** enable broad Postgres rollout, migrate remaining `getDb()` routes, add external observability vendors, or change response JSON contracts (beyond adding instrumented handlers).

**DEE-95g** adds **operational scaffolding** for that telemetry (docs only): operator [**runbook**](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md), [**log-derived dashboard spec**](./DEE-95G-LOG-DASHBOARD-SPEC.md) (implementation TBD), and [**staging checklist**](./DEE-95G-STAGING-CHECKLIST.md). **Does not** add vendors, metric backends, tracing, or route migrations.

**DEE-95h** (Linear **DEE-104**) wires **`POST /api/dashboard/twin-dialogue/turn`** and **`GET /api/dashboard/twin-dialogue/turns`** through **`getWaiaRuntimeDb()`** + **`resolveTwinPersistence`** (aligned with Twin Engine when `WAIA_DB_BACKEND=postgres`), and emits **`waia_runtime_route`** for route keys **`twin_dialogue_turn`** / **`twin_dialogue_turns`**. **Does not** migrate auth, **`diary/scenario-answers`**, or standalone reasoning APIs; **dashboard read-plane** closure for SSR + **`GET /api/dashboard/readiness`** + **`diary/entries`** is **DEE-105** (below).

**DEE-105 / dashboard read-plane** (**merged `dev`:** **`fef1e83`**, GitHub **PR #104**; pre-squash tip **`2515db9`**): **`lib/dashboard/dashboard-readiness-source.ts`** uses **`getWaiaRuntimeDb()`** + **`resolveTwinPersistence`** for readiness payloads (`getDashboardReadinessPayloadForUser`, shared by **`GET /api/dashboard/readiness`** with **`dashboard_readiness`** telemetry). **`loadDashboardPageDataForUser`** serves **`app/dashboard/page.tsx`** with one runtime resolve for readiness + dialogue + diary lists (no `getDb()` on dashboard hydrate). **`GET`/`POST /api/dashboard/diary/entries`** use the same runtime policy + **`diary_entries`** telemetry.

**Post–DEE-105 / Twin cognition + diary scenario HTTP alignment:** **`POST /api/dashboard/twin/prediction`**, **`GET /api/dashboard/twin/pattern-summary`**, **`POST /api/dashboard/twin/contradictions`**, and **`GET`/`POST /api/dashboard/diary/scenario-answers`** use **`getWaiaRuntimeDb()`** + **`resolveTwinPersistence`** (SQLite sync helpers / Postgres async ports for reasoning routes), with **`waia_runtime_route`** keys **`twin_prediction`**, **`twin_pattern_summary`**, **`twin_contradictions`**, **`diary_scenario_answers`**. **Deferred:** auth/OAuth **`getDb()`** routes per program scope.

## Completed Slices

### D1

- Introduced `db/waia-transaction.ts`
- Added `runWaiaSqliteLegacyTransaction`
- Delegates to `runSqliteTransaction`
- No runtime behavior change

### D2

- Migrated production runtime transaction callers to `runWaiaSqliteLegacyTransaction`
- Removed direct runtime caller dependency on `runSqliteTransaction`
- No caller behavior change

### D3

- Added `docs/architecture/transactions.md`
- Ratified transaction architecture contract
- No code/runtime/type changes

### D3b

- Added `WaiaSqliteTransactionCallback<T>`
- Clarified SQLite-only synchronous callback semantics
- Aligned transaction docs
- No runtime behavior change

### D4

- Added `runWaiaTransactionOnRuntime`
- SQLite branch delegates to legacy facade
- Postgres branch rejects explicitly (`Promise.reject` with a stable `[waia]` message; callback is never invoked)
- No production callers migrated

### D5a

- Added `lib/persistence/sqlite/twin-persistence.ts` with `createSqliteTwinPersistence(db)` delegating to `lib/twin-persistence/*` (no behavior change; explicit SQLite naming).
- Added `resolveTwinPersistence(handle: WaiaRuntimeDb)` in `lib/persistence/runtime.ts`: SQLite returns the SQLite boundary (D5a); **DEE-72.1** extends resolution so Postgres returns **`createPostgresTwinPersistence(handle.db)`** with **twin/diary** surface matching D5a (**async** Postgres semantics). **DEE-72.2** adds **Postgres-only** prediction verification methods; **DEE-72.3** adds **Postgres-only** **`searchTwinMemoriesByText`** (read-only; SQLite memory retrieval stays in `lib/twin-persistence/twin-memory-retrieval.ts` until route migration). **DEE-72.5** adds **Postgres-only** repeatability append/analyze on the same boundary.
- SQLite transaction orchestration remains in `db/waia-transaction.ts`. Postgres twin/diary **writes** in the Postgres boundary use **`runWaiaPostgresTransaction`** (explicit Postgres ownership); no `runWaiaTransaction`.

## Current Runtime Transaction Path

**Production path today:**

```
production callers
  → runWaiaSqliteLegacyTransaction
    → runSqliteTransaction
      → sync SQLite db.transaction (better-sqlite3)
```

**Also available (not used by production callers yet):**

- `runWaiaTransactionOnRuntime(handle, fn)` — `handle` from `getWaiaRuntimeDb()` / `WaiaRuntimeDb`; **`fn` remains `WaiaSqliteTransactionCallback` (SQLite-shaped, synchronous)**. SQLite delegates to the legacy facade; Postgres rejects before `fn` runs.

## Remaining Work

### AI Gateway (Twin dialogue)

- **DEE-76** defines bounded **AI Gateway** architecture for OpenAI-class Twin dialogue completion (provider port, runtime placement, lifecycle, observability, kill-switch, token/memory boundaries): [`../architecture/DEE-76-AI-GATEWAY-ARCHITECTURE.md`](../architecture/DEE-76-AI-GATEWAY-ARCHITECTURE.md). **Does not** implement SDK wiring, schema changes, or autonomous agent loops beyond explicitly scoped slices.
- **DEE-77** lands thin **runtime foundation** under `lib/ai-gateway/*`: `CompletionProviderPort`, no-network `FakeCompletionProvider`, `resolveTwinDialogueAssistantText`, env **`WAIA_AI_GATEWAY_FOUNDATION`** (default off = legacy inline stub path; opt-in exercises gateway + fake adapter with **identical stub UX**). Extends **`waia_runtime_route`** for `twin_dialogue_turn` with content-free `ai_gateway_*` fields. **Does not** add OpenAI/SDK, outbound HTTP, retrieval, or cognition.
- **DEE-78** adds a **`fetch()`-based OpenAI-compatible** completion adapter (`OpenAiCompatibleCompletionProvider`), env **`WAIA_AI_PROVIDER`** (`fake` default; unknown → `fake`; **`openai-compatible`** second-key egress with **`WAIA_AI_OPENAI_*`** secrets), and additive **`ai_gateway_provider`** / **`ai_gateway_provider_outcome`** telemetry on **`twin_dialogue_turn`**. Stub fallback on any provider failure; **zero retries**, **no SDK**. **Does not** add AI-gateway DB tables — persistence slice tracked separately (**Linear DEE-107**), streaming, tool calls, or quotas.
- **DEE-79** adds optional **`ai_gateway_provider_*_tokens`** + **`ai_gateway_provider_request_id`** on **`twin_dialogue_turn`** when adapters return usage/metadata; threads **`Request.signal`** into the gateway for client disconnect propagation; operator staging activation procedure — [`DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md`](./DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md). **Does not** enable production inference by itself or start **DEE-107**.
- **DEE-80** (planning decomposition — documentation **Slices A + C**): **Slice A** [`../architecture/DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](../architecture/DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md) freezes Twin dialogue **prompt envelope v1** (single-turn baseline + explicit bounded-read deltas policy — **no** retrieval/embeddings/engine fusion/readiness-in-route); **Slice C** [`DEE-80-AI-GATEWAY-PRODUCTION-INFERENCE-ROLLOUT.md`](./DEE-80-AI-GATEWAY-PRODUCTION-INFERENCE-ROLLOUT.md) production rollout scaffold. **Slice B** (runtime envelope implementation **only** as Slice A authorizes) remains backlog engineering — **does not** start **DEE-107**.

### Runtime HTTP layer (post–DEE-105)

- Dashboard **`page.tsx`** hydrate uses **`loadDashboardPageDataForUser`** — **`getWaiaRuntimeDb()`** + **`resolveTwinPersistence`** (aligned with twin-dialogue/diary APIs when Postgres is enabled).
- **`app/api/dashboard/diary/scenario-answers`** and standalone Twin reasoning routes (**`twin/prediction`**, **`pattern-summary`**, **`contradictions`**) use the same runtime resolver + telemetry (see **DEE-95e** §19, **DEE-95G** runbook route table).

### D5 (remainder after D5a)

- Backend-specific repositories / runtime-aware persistence boundaries
- Do not create fake backend-neutral persistence
- Prepare validated paths for future Postgres behavior

### D6 (remainder after D6-core)

- Consider routing `runWaiaTransactionOnRuntime` Postgres branch (separate slice; optional)
- Consider neutral `runWaiaTransaction` only after explicit policy + both backends validated

### DEE-72

- **DEE-72.1 / DEE-72.2 / DEE-72.3:** Postgres-specific **`PostgresTwinPersistence`** (twin/diary + **prediction verifications** + **read-only memory search**) + resolver enablement + opt-in integration tests. **DEE-72.4:** narrow **reasoning retrieval ports** + **`*Async`** reasoning functions (additive; callers opt in). **DEE-72.4b:** **Postgres-only** opt-in integration tests for **async prediction** + **async pattern summary** via ports (`postgres-twin-reasoning-prediction.test.ts`). **DEE-72.5:** **`PostgresTwinPersistence`** repeatability append + analyze + **`analyzeRepeatabilityForUserAsync`**; opt-in coverage in **`postgres-twin-persistence.test.ts`**. **DEE-72.6:** additive **`runTwinEnginePostgresAsync`** (`twin-engine-postgres.ts`) — **not** production-wired. **DEE-93:** repeatability migration audit — [`DEE-93-REPEATABILITY-MIGRATION-AUDIT.md`](DEE-93-REPEATABILITY-MIGRATION-AUDIT.md). **DEE-94:** async Twin Engine orchestration **plan** — [`DEE-94-ASYNC-TWIN-ENGINE-ORCHESTRATION-PLAN.md`](DEE-94-ASYNC-TWIN-ENGINE-ORCHESTRATION-PLAN.md). **DEE-95:** runtime routing **strategy** (planning) — [`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](DEE-95-RUNTIME-ROUTING-STRATEGY.md). **Still not done:** **implementation** of production route migration / unified async facade per DEE-94 + DEE-95 phases; Postgres writer paths for verification/repeatability GET aligned with engine reads; neutral `runWaiaTransaction`.

### DEE-85

- Remove SQLite from codebase only after Postgres runtime is fully validated

## Forbidden Shortcuts

- Do not introduce `runWaiaTransaction` before real Postgres transaction support exists
- Do not widen `WaiaSqliteTransactionCallback` to Promise-returning
- Do not migrate production callers to `runWaiaTransactionOnRuntime` before D5/D6 readiness
- Do not call Postgres `db.transaction` before Postgres persistence and rollback semantics are validated
- Do not reuse SQLite callback types for Postgres semantics
- Do not add casts to fake backend compatibility
- Do not remove SQLite until DEE-85

## Invariants

- `runWaiaTransaction` absent in TypeScript source until D6 or later
- `runWaiaTransactionOnRuntime` limited to the transaction seam module and tests until caller migration is explicitly approved (D5a may add `lib/persistence/runtime.ts` for persistence resolution only; it must not broaden transaction callback semantics).
- `runSqliteTransaction` limited to `db/types.ts` and `db/waia-transaction.ts`
- `WaiaSqliteTransactionCallback` remains SQLite-shaped and synchronous
- Postgres branch must reject before callback execution (callback must never run for `kind: "postgres"`)
- Production callers remain on the SQLite legacy facade until a migration slice explicitly changes that

## Final Closure Criteria for DEE-64

- Runtime transaction boundary is explicit (facade + optional runtime seam; no hidden routing in callers)
- SQLite assumptions are isolated (typed callbacks, documented sync semantics, low-level `runSqliteTransaction` not imported by app code)
- Production callers no longer depend directly on low-level SQLite transaction helper (`runSqliteTransaction` re-exported only through `db/waia-transaction.ts` policy)
- Future Postgres transaction path is sequenced and guarded (reject until D6; no neutral API until honest)
- Remaining Postgres persistence work is clearly delegated to DEE-72 / D5 / D6 as applicable
- No fake neutral transaction API exists

## Related Docs

- [Linear closeout handoff (DEE-72.6 / DEE-93 / DEE-94)](DEE-64-LINEAR-CLOSEOUT.md)
- [Runtime routing strategy (DEE-95 planning)](DEE-95-RUNTIME-ROUTING-STRATEGY.md)
- [Postgres development / migrations (D6-pre)](../postgres-development.md)
- [Transaction architecture contract](../architecture/transactions.md)
