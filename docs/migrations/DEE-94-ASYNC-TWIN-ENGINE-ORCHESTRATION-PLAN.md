# DEE-94 — Async Twin Engine orchestration migration (planning)

**Type:** Planning / documentation only. **Does not** implement routing, facades, or `Promise.all`.  
**Prerequisites:** DEE-72.6 (Postgres async engine), DEE-93 (repeatability audit).  
**Successor:** DEE-95 (runtime routing strategy — env, flags, rollout, aligned writers).

**Source references:**

- Sync engine: [`lib/reasoning/twin-engine.ts`](../../lib/reasoning/twin-engine.ts)
- Postgres async engine: [`lib/reasoning/twin-engine-postgres.ts`](../../lib/reasoning/twin-engine-postgres.ts)
- API types: [`lib/dashboard/twin-engine-api.types.ts`](../../lib/dashboard/twin-engine-api.types.ts)
- Runtime handle: [`db/waia-runtime-db.ts`](../../db/waia-runtime-db.ts)
- Persistence resolution: [`lib/persistence/runtime.ts`](../../lib/persistence/runtime.ts)
- Repeatability audit: [`DEE-93-REPEATABILITY-MIGRATION-AUDIT.md`](DEE-93-REPEATABILITY-MIGRATION-AUDIT.md)

---

## 1. Current sync SQLite orchestration contract

**Entry:** `runTwinEngine(db: WaiaSqliteDb, input: TwinEngineRunInput): TwinEngineApiResponse`

**Input (`TwinEngineRunInput`):** `userId`, optional `scenario`, optional `includePrediction` (boolean).

**Ordered steps (strictly sequential, synchronous):**

1. Normalize scenario via `normalizeTwinEngineScenario` (throws `TwinEngineScenarioTooLongError` if over limit).
2. **pattern_summary** — `getTwinPatternSummaryForUser(db, userId)`
3. **contradiction_detector** — `runTwinContradictionDetectorForUser(db, userId, opts)` with scenario object when normalized non-null
4. **repeatability_analyzer** — `analyzeRepeatability(db, userId, { scenarioText: scenarioFilter })`
5. List verifications — `listTwinPredictionVerificationsForUser(…)`
6. **personality_model** — `buildTwinPersonalityModelFromSignals(buildTwinEnginePersonalityInput(…))`
7. **prediction** (conditional) — only if `includePrediction === true` **and** normalized scenario non-null — `runTwinPredictionForUser(db, userId, normalized)`

**Output:** `TwinEngineApiResponse` — `schemaVersion`, `patternSummary`, `contradictions`, `personalityModel`, `repeatability`, `prediction` (null when not run), `engineMeta` (`scenarioUsed`, `predictionRequested`, `modulesRun`, `generatedAt: null`).

**Base modules:** `pattern_summary`, `contradiction_detector`, `repeatability_analyzer`, `personality_model`. **`prediction`** appended only when the conditional branch runs.

**Layer contract** documented in `twin-engine.ts` module comment (memory vs pattern vs contradiction vs personality vs prediction vs feedback/repeatability).

---

## 2. Current async Postgres orchestration contract

**Entry:** `runTwinEnginePostgresAsync(p: PostgresTwinPersistence, input: TwinEngineRunInput): Promise<TwinEngineApiResponse>`

**Same input/output types** as sync engine; **same normalization** and `TwinEngineScenarioTooLongError` behavior (shared `normalizeTwinEngineScenario`).

**Ordered steps (strictly sequential `await` chain; no cross-step parallelization):**

1. Build memory + verification **ports** from `p` (`createTwinMemorySearchPortPostgres`, `createTwinVerificationListPortPostgres`).
2. **pattern_summary** — `await getTwinPatternSummaryForUserAsync(memoryPort, userId)`
3. **contradiction_detector** — `await runTwinContradictionDetectorForUserAsync(memoryPort, verificationPort, userId, opts)`
4. **repeatability_analyzer** — `await analyzeRepeatabilityForUserAsync(p.db, userId, { scenarioText })`
5. Verifications — `await p.listTwinPredictionVerificationsForUser(…)`
6. **personality_model** — same pure `buildTwinPersonalityModelFromSignals` / `buildTwinEnginePersonalityInput` as sync
7. **prediction** (conditional) — `await runTwinPredictionForUserAsync(memoryPort, userId, normalized)` under same gate as sync

**Documented non-goals:** No claim of string-level parity with SQLite; same **contract types** and **orchestration order**, independent storage.

---

## 3. Proposed future facade / entrypoint design

**Goal:** One **request-scoped** way for the Twin Engine HTTP handler (and future callers) to obtain a `TwinEngineApiResponse` without duplicating orchestration logic, while **preserving** today’s explicit `runTwinEngine` / `runTwinEnginePostgresAsync` implementations as the authoritative bodies.

**Recommended shape (conceptual — implementation is a later slice, not DEE-94):**

- A **single async** public entry that callers **`await`**, because the Postgres path is inherently async.
- **Dispatch** on `WaiaRuntimeDb` (or a pre-resolved persistence handle derived from it):
  - `kind === "sqlite"`: internally call existing **`runTwinEngine(db, input)`** and **wrap** the synchronous result in `Promise.resolve(…)` so the facade stays uniformly async at the boundary.
  - `kind === "postgres"`: `resolveTwinPersistence(handle)` → **`PostgresTwinPersistence`**, then **`await runTwinEnginePostgresAsync(p, input)`**.

**Naming:** Fix in the implementation slice; avoid implying this doc adds a symbol. Candidate names: `runTwinEngineForRuntime`, `executeTwinEngineForUser`, or `runTwinEngineUnifiedAsync` — **not** introduced in DEE-94.

**Alternative (narrower):** Keep two functions public and use a **thin route helper** only — see §4–5.

---

## 4. New function vs route-level branch vs adapter

| Approach | Summary |
|---------|---------|
| **New library function (preferred)** | Centralizes dispatch, normalization, error mapping, and future logging/metrics. Route stays thin: resolve runtime → `await` facade → JSON. Tests target one entry. |
| **Route-level branch only** | `if (handle.kind === "sqlite") runTwinEngine… else await runTwinEnginePostgresAsync…` inline in `route.ts`. Fast to ship, **duplicates** dispatch rules in every future caller (second route, server action, job). |
| **Runtime-specific adapter object** | e.g. `TwinEngineRunner` interface with `sqlite` / `postgres` implementations. Useful if many call sites need injectable strategy; **more boilerplate** for a single HTTP entry today. |

**Recommendation:** **Primary: new async facade function** in `lib/reasoning/` (or adjacent orchestration module) that takes `(handle: WaiaRuntimeDb, input)` or `(handle, input)` after validation. **Do not** only branch in the route if avoidable — but see §5 for when a small route-level branch is acceptable as an interim step.

---

## 5. Route-level branching — debt or not?

**When it is acceptable temporarily:** A **single** Twin Engine route with ~5–10 lines of dispatch, **if** accompanied by a **tracked follow-up** to extract the facade before a second caller appears.

**Why it tends to create debt:**

- **Duplication:** normalization, `TwinEngineScenarioTooLongError` → HTTP mapping, and `modulesRun` expectations must stay aligned across call sites.
- **Testing burden:** route tests mock `getDb()` today; Postgres path needs `getWaiaRuntimeDb` + async patterns — duplicated setup without a facade.
- **Observability:** metrics/tracing hooks are easier to add once in a library entry.

**Mitigation:** Even with a facade, the route still performs **HTTP concerns** (session, JSON parse, status codes) — only **orchestration dispatch** should avoid living solely in the route.

---

## 6. Required input/output contract stability

**Must remain stable across backends:**

- **`TwinEngineRunInput`** fields and interpretation (`scenario` trim/empty → null; `includePrediction` default false).
- **`TwinEngineApiResponse`** shape, **`TWIN_ENGINE_SCHEMA_VERSION`**, and nested schema versions from child modules.
- **`TwinEngineMeta`:** `scenarioUsed`, `predictionRequested`, `modulesRun` list semantics, `generatedAt: null` for deterministic tests unless product explicitly changes.

**Explicit non-promise:** **No cross-backend textual parity** for LLM-derived or retrieval-dependent strings — only **structural** API contract stability (already stated in DEE-72.6).

---

## 7. Error handling and scenario-too-long behavior

**Today:** `normalizeTwinEngineScenario` throws **`TwinEngineScenarioTooLongError`** for over-length scenarios; production route maps it to **400** with `SCENARIO_TOO_LONG`.

**Facade requirement:** Surface the same **throw type** from both branches so the route (or caller) keeps **one** `catch` mapping. Sync branch wraps `runTwinEngine` in async boundary — errors propagate naturally; ensure no accidental swallowing.

**Other errors:** Internal failures remain generic **500** / `INTERNAL_ERROR` at HTTP layer unless a future slice introduces typed errors — out of scope for DEE-94.

---

## 8. Prediction behavior and `modulesRun` behavior

**Rules (must stay aligned):**

- `prediction === null` when `includePrediction` is false **or** normalized scenario is null.
- **`modulesRun`** always includes base four modules; **`prediction`** appears **only** when prediction actually ran (same gate as non-null `prediction`).

**Postgres:** Uses `runTwinPredictionForUserAsync` with same memory port as pattern/contradiction — **must not** run prediction inside an unrelated transaction that would contradict DEE-72 persistence rules.

---

## 9. Sequential orchestration guarantee

**Current guarantee (both paths):** Steps run **one after another** in the order in §1 and §2. Dependencies are real:

- Personality consumes pattern, contradictions, repeatability, verifications.
- Contradiction and pattern may use scenario for retrieval/rules.
- Repeatability filter uses normalized scenario text.

**Facade and future routing must preserve** this order unless a **future slice** proves independence and updates this document — see §10.

---

## 10. Explicit policy for future `Promise.all` / parallelization

**Current policy:** **Do not** introduce `Promise.all` (or other cross-step parallelism) in Twin Engine orchestration **in the same slice as first production Postgres routing.**

**Rationale:**

- Steps share **scenario** and **user** context; subtle ordering and shared cache effects are not yet characterized.
- Repeatability and personality depend on prior outputs; parallelism would require a **provable DAG** and could break **determinism** expectations in tests.

**Future gate (when to revisit):**

1. **Prove** candidate parallel groups (e.g. pattern vs contradiction***) with a written dependency graph and **golden** or contract tests that lock ordering of **modulesRun** and intermediate invariants — not only wall-clock speed.
2. **Feature-flag** parallel mode separately from first routing migration.
3. **Never** parallelize **inside** `runWaiaPostgresTransaction` callbacks with heavy reasoning (existing DEE-72.5 constraint).

*\*Note: today contradiction depends on memory port; “parallel pattern + contradiction” may still be invalid — any proposal must re-verify against code.*

---

## 11. Dependency on DEE-93 findings

DEE-93 confirms **`analyzeRepeatabilityForUserAsync` is fit** for Twin Engine reads on Postgres **when data exists**. It also flags a **product gap:** verification and repeatability **GET** routes still write/read SQLite; if the engine reads Postgres **without** migrating those writers, **repeatability aggregates and personality boost** can be **wrong or empty**.

**Implication for orchestration migration:**

- The **facade** is still **correct** to call the Postgres analyzer.
- **DEE-95 / routing slice** must schedule **aligned writer/reader migration** (or an explicit interim tolerance documented at product level) so orchestration results are meaningful.

---

## 12. What DEE-95 must decide (routing / runtime — not DEE-94)

DEE-94 defines **orchestration** unification; **DEE-95** should decide:

- When to call **`getWaiaRuntimeDb()`** vs `getDb()` at the Twin Engine route boundary.
- **Feature flags / env** (`WAIA_DB_BACKEND`, `DATABASE_URL_POSTGRES`, future kill-switch).
- **Rollback:** revert env or deploy; default remains SQLite until explicitly flipped.
- **Observability** and **SLO** expectations per backend.
- **Scope of route migration** in one PR vs phased (engine first, then sibling routes).
- **Alignment** with DEE-93: verification + repeatability GET on same store as engine.

---

## 13. Invariants to preserve

- **Do not** add **`runWaiaTransaction`** or fake neutral transaction APIs (DEE-64 forbidden shortcuts).
- **Do not** widen **`WaiaSqliteTransactionCallback`** to Promise-based for Twin Engine.
- **`runTwinEngine`** remains the **canonical sync** implementation for SQLite; **avoid** rewriting it into async unless a separate refactor slice justifies risk.
- **`runTwinEnginePostgresAsync`** remains **canonical** for Postgres persistence tuple `(PostgresTwinPersistence, input)`.
- **`resolveTwinPersistence`** stays typed per backend — facade **calls** it; DEE-94 does not change `runtime.ts`.
- **Layer boundaries** in `twin-engine.ts` comment remain the product contract.
- **`engineMeta.generatedAt`** stays `null` until a product decision defines timestamps.

---

## 14. Risks and rollback notes

| Risk | Mitigation |
|------|------------|
| Behavioral drift between dispatch paths | Single facade; shared normalization; identical `TwinEngineRunInput`; contract tests. |
| Accidental partial migration (engine Postgres, writers SQLite) | DEE-93; document explicit acceptance or block in DEE-95. |
| Async route handler mistakes (missing `await`) | TypeScript `Promise` return on facade; lint/review. |
| Performance regression on SQLite | Sync path wrapped in `Promise.resolve` adds negligible cost. |

**Rollback:** If production routing ships behind a flag, **disable Postgres** → SQLite only; no schema rollback required for orchestration-only toggle if data is still written to both stores per migration strategy (DEE-95 defines).

---

## 15. Go / no-go for proceeding to DEE-95

| Question | Verdict |
|----------|---------|
| Is orchestration **well-enough** specified to design **routing**? | **Go.** Two backends, explicit order, shared types, known errors. |
| Should DEE-95 implement the facade **before** or **with** route flip? | **Recommendation:** Implement facade in the **same or preceding** implementation slice as route wiring to avoid route-only duplication (exact PR split is DEE-95). |
| Any blocker from DEE-94 planning alone? | **None** — blockers are **product/ops** (writer alignment, flags, CI Postgres), not orchestration theory. |

**Conclusion:** **Go** to **DEE-95** (runtime routing strategy) with this plan as the orchestration reference. **Do not** merge Postgres production routing without addressing DEE-93’s writer/reader alignment decision in DEE-95 scope.

---

## Document control

| Version | Slice | Notes |
|---------|-------|------|
| 1.0 | DEE-94 | Initial async orchestration migration plan (docs only). |
