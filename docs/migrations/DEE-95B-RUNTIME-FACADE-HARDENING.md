# DEE-95b — Runtime facade hardening (planning)

**Type:** Program / planning slice. **Does not** wire production routes, change default runtime, or implement observability code unless a follow-up PR explicitly does so.

**Purpose:** Strengthen confidence in [`runTwinEngineForRuntimeAsync`](../../lib/reasoning/twin-engine-runtime.ts) before **DEE-95c** (`POST /api/dashboard/twin/engine` runtime dispatch). This document defines risks, parity limits, test gaps, observability expectations, rollback posture, and **go/no-go** criteria for route wiring.

**Prerequisites on `dev`:** DEE-93, DEE-94, DEE-95 (strategy), **DEE-95a** (facade implementation and unit tests).

**Related code and docs:**

- Runtime facade: [`lib/reasoning/twin-engine-runtime.ts`](../../lib/reasoning/twin-engine-runtime.ts)
- Facade unit tests: [`tests/unit/twin-engine-runtime-facade.test.ts`](../../tests/unit/twin-engine-runtime-facade.test.ts)
- Postgres engine integration (opt-in): [`tests/integration/postgres-twin-engine.test.ts`](../../tests/integration/postgres-twin-engine.test.ts)
- Routing strategy: [`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](DEE-95-RUNTIME-ROUTING-STRATEGY.md)
- Orchestration contract: [`DEE-94-ASYNC-TWIN-ENGINE-ORCHESTRATION-PLAN.md`](DEE-94-ASYNC-TWIN-ENGINE-ORCHESTRATION-PLAN.md)
- Repeatability / writer alignment audit: [`DEE-93-REPEATABILITY-MIGRATION-AUDIT.md`](DEE-93-REPEATABILITY-MIGRATION-AUDIT.md)

---

## 1. Current runtime facade state after 95a

**Library entry:** `runTwinEngineForRuntimeAsync(handle: WaiaRuntimeDb, input: TwinEngineRunInput): Promise<TwinEngineApiResponse>`.

**Dispatch:**

| `handle.kind` | Behavior |
|---------------|----------|
| `sqlite` | Calls synchronous `runTwinEngine(handle.db, input)` inside an `async` function — return value is the same `TwinEngineApiResponse` as today. |
| `postgres` | Calls `resolveTwinPersistence(handle)` → `PostgresTwinPersistence`, then `runTwinEnginePostgresAsync(persistence, input)`. |

**Production:** [`app/api/dashboard/twin/engine/route.ts`](../../app/api/dashboard/twin/engine/route.ts) uses **`getWaiaRuntimeDb()`** and **`runTwinEngineForRuntimeAsync`** (**DEE-95c**). Sibling routes (verification, repeatability) remain on their prior SQLite/runtime paths until **DEE-95d**.

**Before 95c (historical):** the route used `getDb()` and `runTwinEngine` directly.

**Tests shipped in 95a:** SQLite parity (empty scenario path) vs direct `runTwinEngine`; SQLite `TwinEngineScenarioTooLongError`; Postgres delegation via mocked `runTwinEnginePostgresAsync`; Postgres scenario-too-long via real async path after persistence resolution.

---

## 2. Remaining risks before route wiring (95c)

| Risk | Why it matters |
|------|----------------|
| **Data-plane split (DEE-93)** | If the Twin Engine reads repeatability / verifications from **Postgres** while **`POST …/prediction/verification`** and **`GET …/repeatability`** still write/read **SQLite**, aggregates and personality inputs can be **stale or empty** on Postgres. |
| **Env / connection failures** | `getWaiaRuntimeDb()` (future route) depends on [`runtime-backend.ts`](../../db/runtime-backend.ts) validation and Postgres client lifecycle; mis-configured `DATABASE_URL_POSTGRES` or backend flips can surface as hard failures or confusing 5xx. |
| **Silent mis-configuration** | Any future “fallback” from Postgres to SQLite without logging **masks** outages and breaks audit expectations (see DEE-95 anti-patterns). |
| **Missing observability** | Without structured logs/metrics at the dispatch boundary, operators cannot tell **which backend** served traffic or distinguish scenario limits from internal errors during rollout. |
| **Semantic parity assumptions** | DEE-72.6 explicitly does **not** promise that Postgres returns the **same text** as SQLite for the same logical input — only compatible **contracts** and orchestration order. |

---

## 3. SQLite / Postgres parity guarantees still missing

**What is already aligned (by design):**

- **Type-level contract:** `TwinEngineApiResponse`, `TwinEngineRunInput`, `TWIN_ENGINE_SCHEMA_VERSION`.
- **Orchestration policy:** Sequential steps; same high-level module order; no `Promise.all` fan-out inside engine bodies (DEE-94).
- **`engineMeta` fields:** `scenarioUsed`, `predictionRequested`, `modulesRun`, `generatedAt: null` — asserted in integration tests for Postgres **shape**, not cross-db string equality.

**What is *not* guaranteed:**

- **Byte-identical or copy-identical JSON** between SQLite and Postgres for the same user and scenario.
- **Identical cardinalities** of derived lists where storage or retrieval differs between backends.
- **Identical timing** — Postgres path is async end-to-end; SQLite path is sync inside the worker.

**Program hygiene:** Future tests should label **contract / shape / modulesRun** assertions separately from any optional “golden” SQLite ↔ Postgres comparison experiments.

---

## 4. Additional unit coverage opportunities

| Area | Idea |
|------|------|
| **SQLite parity expansion** | `includePrediction: true` with seeded memory — compare `await runTwinEngineForRuntimeAsync` vs `runTwinEngine` for same `db` and input (mirrors [`twin-engine.test.ts`](../../tests/unit/twin-engine.test.ts)). |
| **Input matrix** | `scenario: undefined` vs omitted vs `""` vs whitespace-only; `includePrediction` false vs true; ensure facade tracks `runTwinEngine` exactly on SQLite. |
| **Determinism** | Two sequential `await facade(handle, input)` vs two `runTwinEngine` calls — same equality expectation as existing engine tests. |
| **Error object shape** | Assert `TwinEngineScenarioTooLongError` and `.code === "SCENARIO_TOO_LONG"` on rejected facade promises (SQLite and Postgres paths). |
| **Postgres delegation** | Spy on `resolveTwinPersistence` from [`lib/persistence/runtime.ts`](../../lib/persistence/runtime.ts) to ensure the **same** `WaiaRuntimeDb` handle is used as passed to `runTwinEnginePostgresAsync`’s persistence. |
| **Exhaustiveness** | If `WaiaRuntimeDb` gains a third `kind`, TypeScript should fail until the facade is updated — document as a maintenance invariant. |

---

## 5. Integration-test opportunities

**Existing pattern:** [`postgres-twin-engine.test.ts`](../../tests/integration/postgres-twin-engine.test.ts) uses `WAIA_PG_INTEGRATION=1`, real `DATABASE_URL_POSTGRES`, and avoids `getDb()` / SQLite.

**Recommended extension (follow-up PR):**

- Add cases that call **`runTwinEngineForRuntimeAsync({ kind: "postgres", db: drizzle }, input)`** with the same migrations and teardown discipline.
- Assertions: `schemaVersion`, sub-schema versions, `engineMeta.modulesRun` rules (base modules + optional `prediction`), and scenario-too-long — aligned with current integration expectations.
- **Do not** require SQLite for these tests; keep them opt-in so default CI stays Postgres-free.

**CI matrix (documentation):** Default job — unit + skipped integration; optional job — `WAIA_PG_INTEGRATION=1` + secret `DATABASE_URL_POSTGRES`.

---

## 6. Error propagation invariants

**SQLite path:**

- `runTwinEngine` can throw **synchronously** (e.g. `TwinEngineScenarioTooLongError` from `normalizeTwinEngineScenario`).
- Inside `async function runTwinEngineForRuntimeAsync`, that throw becomes a **rejected Promise** when the caller uses `await` — consistent with future route `try/catch` / `instanceof` checks.

**Postgres path:**

- `resolveTwinPersistence(handle)` runs **before** `runTwinEnginePostgresAsync`.
- `runTwinEnginePostgresAsync` calls `normalizeTwinEngineScenario` first — scenario length errors surface **without** hitting async I/O in the engine body.
- **Today:** `createPostgresTwinPersistence` / boundary creation is expected to be safe for valid handles; if construction ever gains side effects, revisit ordering relative to normalization (future refactor — not required for this planning slice).

**Route responsibility (95c):** Map `TwinEngineScenarioTooLongError` → 400 `SCENARIO_TOO_LONG`; do not swallow unknown errors as generic 500 without logging.

---

## 7. modulesRun / engineMeta consistency guarantees

**Authoritative bodies:** [`lib/reasoning/twin-engine.ts`](../../lib/reasoning/twin-engine.ts) and [`lib/reasoning/twin-engine-postgres.ts`](../../lib/reasoning/twin-engine-postgres.ts).

**Invariants to preserve:**

- Base `modulesRun` includes `pattern_summary`, `contradiction_detector`, `repeatability_analyzer`, `personality_model` in order when all run.
- `prediction` appears **only** when a non-empty scenario is normalized **and** `includePrediction === true`.
- `engineMeta.scenarioUsed` tracks whether a scenario was used for the contradiction path; `predictionRequested` tracks the prediction flag.
- `generatedAt` remains `null` for deterministic JSON tests (see [`twin-engine-api.types.ts`](../../lib/dashboard/twin-engine-api.types.ts)).

**Facade role:** Dispatch only — it must **not** rewrite `engineMeta` or reorder modules.

---

## 8. Runtime dispatch observability requirements

Before enabling **95c** in any environment that can hit Postgres:

| Dimension | Requirement |
|-----------|----------------|
| **backend** | Discreet value: `sqlite` \| `postgres` (from `handle.kind` or resolved config). |
| **outcome** | `success` \| `scenario_too_long` \| `error` (or structured error class). |
| **latency** | Wall time for facade completion (route-level timer recommended). |
| **Privacy** | **Do not** log raw scenario text in production unless explicitly approved (DEE-95 §11). |
| **correlation** | Optional request id once the route is wired — helps trace multi-service incidents. |

---

## 9. Logging / metrics recommendations before 95c

- **Primary emission point (95c+):** HTTP route, after `await runTwinEngineForRuntimeAsync` — owns status codes and can log outcome + backend + duration.
- **Facade:** Avoid noisy logs in the library by default; if debug is needed, guard behind explicit env (e.g. `WAIA_DEBUG_TWIN_ENGINE_DISPATCH=1`) and keep payloads minimal.
- **Metrics (optional but valuable):** Counters by `backend` + outcome; histogram or p95 latency for facade duration — supports rollback decisions (DEE-95 §7).
- **Consistency:** Log the same **outcome taxonomy** used in runbooks (success / scenario_too_long / internal_error classes).

---

## 10. Rollback expectations

**Operational:**

- Set **`WAIA_DB_BACKEND=sqlite`** or unset — Twin Engine must use SQLite path **once 95c respects config**.
- Revert deployment or feature commit if a bad build ships.

**Policy:**

- **No** silent automatic fallback from Postgres to SQLite in production without explicit product/ops sign-off and logging strategy.

**Audit:** Record merge commit and PR on `dev`; Linear comment with SHA (DEE-64 / DEE-92 discipline).

---

## 11. Edge cases not yet covered

- **Concurrency:** Same `userId`, parallel requests — no new isolation guarantees beyond underlying DB semantics.
- **Persistence before normalize (Postgres):** Long scenario still allocates `PostgresTwinPersistence` before throw — acceptable today; worth monitoring if construction becomes heavier.
- **Mock vs real Drizzle:** Unit tests use `drizzle.mock`; integration uses real clients — occasional gaps if mocks differ from production drivers.
- **Clock / timezone:** `generatedAt` is null for v1 contract; no wall-clock dependency in engine output for determinism tests.
- **Exhaustive `kind`:** TypeScript exhaustiveness — document manual review if union grows.

---

## 12. Contract-level assertions to preserve

- `TWIN_ENGINE_SCHEMA_VERSION` and nested schema versions for sub-objects consumed by the dashboard.
- `TwinEngineModuleId` union and ordering semantics for `modulesRun`.
- `MAX_SCENARIO_CHARS` and `TwinEngineScenarioTooLongError` behavior unchanged at the HTTP boundary mapping (400 envelope today).
- JSON field presence compatible with existing clients — avoid removing or renaming fields without a version bump strategy.

---

## 13. Test data strategy

**SQLite unit tests:**

- Temporary directory + `migrateDatabaseFromEnv` + dedicated user ids (pattern in [`twin-engine-runtime-facade.test.ts`](../../tests/unit/twin-engine-runtime-facade.test.ts) and [`twin-engine.test.ts`](../../tests/unit/twin-engine.test.ts)).
- `beforeEach` cleanup of twin/diary/verification tables to avoid bleed.

**Postgres integration:**

- Dedicated stable `userId` constant per suite; `afterEach` SQL cleanup as in [`postgres-twin-engine.test.ts`](../../tests/integration/postgres-twin-engine.test.ts).
- Avoid sharing one mutable `DATABASE_URL` across parallel workers without isolation.

---

## 14. CI / runtime validation recommendations

- **Mandatory on every PR:** `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run` — current default passes with integration tests **skipped** when env absent.
- **Optional gated job:** `WAIA_PG_INTEGRATION=1` + `DATABASE_URL_POSTGRES` for Postgres facade/engine integration — document expected **skip vs pass** counts in CI README or team wiki.
- **No** requirement to run Postgres integration for docs-only PRs unless touching code paths under test.

---

## 15. What must be proven before 95c route wiring

Checklist (program gate — adjust per team ceremony):

- [ ] Facade unit tests green on `dev`; optional expanded coverage from §4 landed or explicitly deferred with written risk.
- [ ] If Postgres engine is enabled beyond local dev: opt-in integration through **facade** exercised at least once (§5).
- [ ] Observability plan for §8–9 agreed (fields, no scenario PII, where logs emit).
- [ ] **DEE-93 alignment decision** recorded: internal canary with acceptance **or** **95d** writer alignment scheduled **before** broad production Postgres engine traffic.
- [ ] Feature flag / kill-switch semantics per DEE-95 §8 — default **SQLite**; no surprise flip.

---

## 16. Anti-patterns to avoid during 95c

- Introducing **`Promise.all`** (or other parallel orchestration) inside Twin Engine bodies or facade — violates DEE-94 until a dedicated performance program approves it.
- Introducing **`runWaiaTransaction`** or **backend-neutral repositories** — violates DEE-64 guardrails.
- **Duplicating** orchestration logic in the route instead of calling the facade.
- **`await` omissions** — TypeScript and review must enforce `await runTwinEngineForRuntimeAsync`.
- **Merging** Postgres-backed engine for general users **without** tracker update, ops awareness, and (unless accepted) **95d** alignment for verification/repeatability.

---

## 17. Recommended implementation sequencing

| Step | Deliverable |
|------|-------------|
| **A** | Land **this** DEE-95b planning document on `dev` (docs + tracker links). |
| **B** | Optional small PR(s): extra unit tests §4; opt-in integration §5. |
| **C** | Optional PR: observability helpers or route-only logging skeleton — **default off** / no behavior flip. |
| **D** | **95c:** Wire `POST …/twin/engine` to `getWaiaRuntimeDb()` + `runTwinEngineForRuntimeAsync` behind env/feature flag; **default SQLite**. |
| **E** | **95d:** Migrate verification + repeatability routes to match engine backend before promoting Postgres engine to mainstream production (DEE-95 §9). |

---

## 18. Explicit go / no-go criteria for 95c

**Go** when all apply:

- Facade and agreed tests are green; checklist §15 satisfied for the **intended rollout scope**.
- Default configuration remains **SQLite-first**; flags/kill-switch documented.
- Stakeholders explicitly accept repeatability/verification split risk **or** **95d** is locked in parallel for production Postgres engine.

**No-go** when:

- Postgres engine would serve **production** users while verification and repeatability routes remain SQLite-only **without** documented product/security acceptance (DEE-95 §9).
- Observability and rollback story are undefined.
- Silent fallback or ambiguous backend logging would prevent operators from detecting mis-routing.

---

## Document control

| Version | Slice | Notes |
|---------|--------|------|
| 1.0 | DEE-95b | Initial facade hardening / pre-95c planning. |
