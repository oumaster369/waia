# DEE-95 — Runtime routing strategy for backend migration (planning)

**Type:** Planning / documentation only (this slice). **Does not** wire production routes, implement dispatch, or change runtime behavior.

**Prerequisites on `dev`:** DEE-72.6 (`runTwinEnginePostgresAsync`), DEE-93 (repeatability audit), DEE-94 (orchestration / facade plan), DEE-97 (Linear closeout handoff).

**Related code and docs:**

- Twin Engine route (production): [`app/api/dashboard/twin/engine/route.ts`](../../app/api/dashboard/twin/engine/route.ts)
- Sync engine: [`lib/reasoning/twin-engine.ts`](../../lib/reasoning/twin-engine.ts)
- Postgres async engine: [`lib/reasoning/twin-engine-postgres.ts`](../../lib/reasoning/twin-engine-postgres.ts)
- Runtime handle: [`db/waia-runtime-db.ts`](../../db/waia-runtime-db.ts)
- Backend config: [`db/runtime-backend.ts`](../../db/runtime-backend.ts)
- Persistence resolution: [`lib/persistence/runtime.ts`](../../lib/persistence/runtime.ts)
- Health probe (runtime example): [`app/api/health/database/route.ts`](../../app/api/health/database/route.ts)
- Orchestration plan: [`DEE-94-ASYNC-TWIN-ENGINE-ORCHESTRATION-PLAN.md`](DEE-94-ASYNC-TWIN-ENGINE-ORCHESTRATION-PLAN.md)
- Repeatability audit: [`DEE-93-REPEATABILITY-MIGRATION-AUDIT.md`](DEE-93-REPEATABILITY-MIGRATION-AUDIT.md)
- Facade hardening (pre-95c): [`DEE-95B-RUNTIME-FACADE-HARDENING.md`](DEE-95B-RUNTIME-FACADE-HARDENING.md)

---

## 1. Current production routing architecture

**Twin Engine HTTP entry:** `POST /api/dashboard/twin/engine` in [`app/api/dashboard/twin/engine/route.ts`](../../app/api/dashboard/twin/engine/route.ts).

**Pattern today:**

1. Session: `getOptionalSessionUserId()`
2. Request body validation (scenario, `includePrediction`)
3. **Database:** `const db = getDb()` — **always** the SQLite Drizzle singleton ([`db/client.ts`](../../db/client.ts))
4. **Orchestration:** `runTwinEngine(db, { userId, scenario, includePrediction })` — **synchronous** on the request thread
5. Errors: `TwinEngineScenarioTooLongError` → 400 `SCENARIO_TOO_LONG`; other → 500 `INTERNAL_ERROR`

**There is no branch on `WAIA_DB_BACKEND` or `getWaiaRuntimeDb` in this route.** Runtime resolution exists elsewhere (health route) but **not** for Twin Engine.

---

## 2. Current SQLite runtime flow

| Step | Mechanism |
|------|-----------|
| Config default | `getResolvedWaiaDbRuntimeConfig()` → `{ backend: "sqlite" }` when `WAIA_DB_BACKEND` unset or `sqlite` |
| App DB for twin routes | `getDb()` → better-sqlite3 + Drizzle |
| Transactions (other callers) | `runWaiaSqliteLegacyTransaction` / legacy facade per DEE-64 |
| Twin Engine | Direct `WaiaSqliteDb` to `runTwinEngine` |

---

## 3. Current additive Postgres flow

| Component | Role |
|-----------|------|
| `WAIA_DB_BACKEND=postgres` + `DATABASE_URL_POSTGRES` | Validates Postgres mode in [`runtime-backend.ts`](../../db/runtime-backend.ts) |
| `getWaiaRuntimeDb()` | Returns `{ kind: "sqlite", db }` or `{ kind: "postgres", db: getPostgresDrizzle() }` |
| `resolveTwinPersistence(handle)` | Maps `WaiaRuntimeDb` → `SqliteTwinPersistence` or `PostgresTwinPersistence` |
| `runTwinEnginePostgresAsync(p, input)` | Full async orchestration when caller holds `PostgresTwinPersistence` |

**Production Twin Engine route does not call these.** Postgres engine is validated via **opt-in** integration tests and any internal caller that wires persistence explicitly.

---

## 4. Recommended runtime dispatch boundary

**Single conceptual boundary:** *Given an authenticated Twin Engine request, choose **one** backend and **one** orchestration entry, then return `TwinEngineApiResponse`.*

**Recommended split of responsibilities:**

| Layer | Responsibility |
|-------|----------------|
| **Route** | HTTP: auth, JSON parse/validate, status codes, `Cache-Control`, map known errors |
| **Runtime dispatch (library)** | `getWaiaRuntimeDb()` (or cached-per-request variant), branch on `handle.kind`, invoke **facade** per DEE-94 — **not** re-implement orchestration steps |
| **Orchestration** | `runTwinEngine` / `runTwinEnginePostgresAsync` (unchanged bodies; DEE-94) |

**Routing** = *which DB handle and which orchestration path*; **orchestration** = *ordered steps inside* Twin Engine. Do not blend routing policy into `twin-engine.ts` internals.

---

## 5. Where dispatch belongs: route vs facade vs “adapter”

| Option | Verdict |
|--------|---------|
| **Route layer only** | Acceptable **only** as a **short** interim; debt if duplicated when a second caller appears. Prefer thin route + library facade. |
| **Facade layer (recommended)** | New **async** function (name TBD in implementation slice) in `lib/reasoning/` (or adjacent): `(handle: WaiaRuntimeDb, input) => Promise<TwinEngineApiResponse>`. Route calls `await facade(...)`. Matches DEE-94. |
| **Runtime adapter object** | Optional later if many strategies; **overkill** for one HTTP route today. |

**Conclusion:** Primary ownership in **facade layer**; route stays HTTP-thin.

---

## 6. `getDb` vs `getWaiaRuntimeDb` strategy

| Helper | Use when |
|--------|----------|
| **`getDb()`** | **Default production** SQLite path; every route that is **not** yet migrated; guarantees current behavior. |
| **`getWaiaRuntimeDb()`** | **Dispatch** paths that must support both backends from **one** code path; **async**; requires `await`. |

**Migration strategy:** Routes targeted for Postgres **stop** calling `getDb()` for that handler’s data path and **start** using `await getWaiaRuntimeDb()` + facade. **Do not** replace global `getDb()` with runtime resolver in unrelated routes without an explicit slice.

**Config:** Reuse `WAIA_DB_BACKEND` + `DATABASE_URL_POSTGRES` as already validated in [`runtime-backend.ts`](../../db/runtime-backend.ts). Additional **feature** flags (e.g. kill-switch) are a DEE-95 **implementation** concern — document intent here only.

---

## 7. Rollback strategy

**Operational rollback** (no code deploy required if designed with env):

1. Set **`WAIA_DB_BACKEND=sqlite`** (or unset) and redeploy/restart — Twin Engine should use SQLite path **if** implementation respects config.
2. **Dual-write / migration** phases (if introduced later) need their own playbook; **not** required for first “read path on Postgres” experiments if product accepts read-only risk.

**Code rollback:** Revert deploy or feature PR; **default** must remain SQLite-safe.

**Squash / audit:** Record PR # and merge commit on `dev` for each routing slice; Linear comment with SHA.

---

## 8. Feature-flag / env strategy (planning intent)

**Minimum env surface (existing):**

- `WAIA_DB_BACKEND`: `sqlite` | `postgres`
- `DATABASE_URL_POSTGRES`: required when postgres

**Recommended extensions (implementation slice):**

- Optional **`WAIA_TWIN_ENGINE_BACKEND`** (or similar) **only if** global `WAIA_DB_BACKEND` is too coarse — e.g. migrate Twin Engine before other routes. Prefer **one** coherent backend policy unless product demands split.
- **Kill-switch:** ability to force SQLite for Twin Engine regardless of Postgres readiness (defense in depth).

**Default:** Absent env → SQLite → **zero** behavior change for existing deployments.

---

## 9. Verification + repeatability alignment (DEE-93)

**Problem:** Twin Engine on Postgres reads **`twin_repeatability_records`** via `analyzeRepeatabilityForUserAsync`. Today, **`POST …/prediction/verification`** and **`GET …/repeatability`** use **`getDb()`** + SQLite paths.

**If** Twin Engine routes to Postgres **without** migrating those writers:

- Repeatability aggregates on Postgres can be **empty** or **stale** vs user actions.
- Personality inputs that depend on repeatability **skew**.

**Requirement for any Postgres-first Twin Engine rollout:** Either (**a**) migrate verification + repeatability **read** routes in the **same program phase** as the engine, or (**b**) document **explicit** product acceptance of wrong/stale repeatability until follow-up (not recommended for production without sign-off).

---

## 10. Dependency on DEE-94 orchestration contract

Implementation **must:**

- Keep **sequential** step order until a future performance slice revisits parallelism (DEE-94 policy).
- Use a **single async facade** at the dispatch boundary; **`runTwinEngine`** and **`runTwinEnginePostgresAsync`** remain the bodies.
- Preserve **input/output** types, **`TwinEngineScenarioTooLongError`**, **`modulesRun`** semantics.

DEE-94 is the **non-negotiable** design reference for the **next** implementation PR(s).

---

## 11. Observability / logging requirements

**Before or with first routing PR:**

- Structured log (level appropriate) per request: **`backend`** (`sqlite`|`postgres`), **`userId`** (hashed or omitted per privacy policy), **latency**, **outcome** (success / scenario_too_long / error class).
- **Metrics (optional):** counter by backend; error rate; p95 latency — aligns with rollback decisions.
- **Do not** log raw scenario text in production unless product/security approves.

---

## 12. Failure-mode analysis

| Failure | Mitigation |
|---------|------------|
| `DATABASE_URL_POSTGRES` wrong / DB down | Surface **5xx** or dedicated error envelope; health route already probes Postgres when in postgres mode — extend monitoring. |
| `getWaiaRuntimeDb` throws on invalid env | Fail fast at startup or first request — validate in deployment pipeline. |
| Partial migration (engine Postgres, writers SQLite) | **Product bug** per §9 — block or document. |
| Async route without `await` facade | TypeScript + review; tests for both branches. |
| Transaction misuse on Postgres | **No** `runWaiaTransaction` fake neutral API; use existing Postgres transaction patterns per DEE-64. |

---

## 13. Safe migration sequencing

1. **Planning / strategy** — this document (DEE-95); merge to `dev`, no runtime change.
2. **Tests** — extend unit tests for facade with mocked `WaiaRuntimeDb` (implementation slice).
3. **Facade implementation** — library only; still **not** called from Twin Engine route.
4. **Route wiring** — opt-in via env/flag; default SQLite; staged deploy.
5. **Sibling routes** — verification + repeatability alignment (same phase or before engine flip).
6. **Hardening** — observability, runbooks, kill-switch drills.

---

## 14. What must remain SQLite-first initially

**Default production config** until explicitly promoted.

**All routes not in the migration slice** continue **`getDb()`** unless individually approved.

**`main` promotion policy** (per WAIA workflow): `dev` integrates first; `main`/Cloudflare only after stabilization — **do not** conflate this doc with deploy runbooks.

---

## 15. What can migrate first

- **Library facade** + tests (no user-visible change if unused).
- **Observability** hooks behind no-op or debug (careful with noise).
- **Internal** or **non-production** environments with `WAIA_DB_BACKEND=postgres` for parity testing.

---

## 16. What must NOT migrate together

- **Postgres Twin Engine dispatch** without **verification / repeatability** alignment (DEE-93), unless explicitly accepted.
- **Route dispatch** + introduction of **`runWaiaTransaction`** or **`Promise.all`** orchestration refactors (forbidden per current program guardrails).
- **Global** “neutral repository” replacing `SqliteTwinPersistence` / `PostgresTwinPersistence` with untyped stores.

---

## 17. Proposed implementation phases (after DEE-95 merge)

| Phase | Deliverable |
|-------|-------------|
| **95a** | Implement async **facade** `(WaiaRuntimeDb, TwinEngineRunInput) => Promise<TwinEngineApiResponse>` per DEE-94 — **landed** in [`lib/reasoning/twin-engine-runtime.ts`](../../lib/reasoning/twin-engine-runtime.ts) (library only; route wiring remains **95c**). |
| **95b** | Facade **hardening program** + parity/observability criteria: [`DEE-95B-RUNTIME-FACADE-HARDENING.md`](DEE-95B-RUNTIME-FACADE-HARDENING.md); optional follow-up PRs for extra unit/integration tests; default path still SQLite |
| **95c** | Wire `POST …/twin/engine` behind env/flag; **default off** |
| **95d** | Migrate **`POST …/prediction/verification`** + **`GET …/repeatability`** to match engine backend |
| **95e** | Observability, runbooks, staged rollout, kill-switch validation |

Exact PR boundaries are team choice; **phases must not skip** writer alignment unless risk is accepted.

---

## 18. Invariants to preserve

- Default **SQLite** behavior when env unset.
- **No** `runWaiaTransaction` until D6 policy allows honest neutral API.
- **No** widening `WaiaSqliteTransactionCallback` to async Promise for “compatibility.”
- **`resolveTwinPersistence`** remains explicitly typed per `kind` — no fake unified persistence type.
- **Orchestration order** and **API contracts** per DEE-94.
- **`runTwinEngine`** and **`runTwinEnginePostgresAsync`** remain authoritative bodies until a deliberate refactor slice replaces them (not DEE-95).

---

## 19. Explicit anti-patterns

- Inline **10+ line** `if (sqlite) … else …` orchestration in the route **without** a facade (duplication debt).
- **Silent** fallback from Postgres failure to SQLite in production without logging (masks outages).
- **Treating** `getWaiaRuntimeDb` as permission to bypass DEE-64 transaction rules.
- **Merging** engine route to Postgres **without** Linear + tracker update and ops sign-off.

---

## 20. Go / no-go for future runtime implementation

| Question | Verdict |
|----------|---------|
| **Go** to **plan** implementation PRs using this strategy? | **Yes** — after this doc is merged and reviewed. |
| **Go** to **immediate** production route flip in the same PR as this doc? | **No** — this slice is planning-only. |
| **Go** if sibling routes stay SQLite-only? | **No** for full production honesty — see §9; **maybe** for constrained internal Canary with written risk acceptance |

**Conclusion:** **Green-light** the **next engineering slices** (facade + controlled route wiring + aligned writers) **per phases** above; **red-light** any “Big Bang” migration or neutral-repo shortcut.

---

## Document control

| Version | Slice | Notes |
|---------|--------|------|
| 1.0 | DEE-95 | Initial runtime routing strategy (planning only). |
| 1.1 | DEE-95a | **95a facade** implemented (`runTwinEngineForRuntimeAsync`); production route unchanged. |
| 1.2 | DEE-95b | **95b planning:** [`DEE-95B-RUNTIME-FACADE-HARDENING.md`](DEE-95B-RUNTIME-FACADE-HARDENING.md) (pre-95c criteria; no route wiring). |
