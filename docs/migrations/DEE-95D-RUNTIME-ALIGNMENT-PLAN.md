# DEE-95d — Runtime route alignment plan (verification + repeatability)

**Type:** Planning only. **Does not** migrate production API routes, change runtime behavior, or enable broad Postgres rollout.

**Purpose:** Define a safe strategy to align **prediction verification** routes, **repeatability** read route, and **related persistence writes/reads** with the same **runtime-aware backend policy** already used by the Twin Engine after **DEE-95c** (`getWaiaRuntimeDb()` + engine facade).

**Prerequisites on `dev`:** DEE-93 (repeatability audit), DEE-95 (strategy), DEE-95b (hardening), DEE-95c (Twin Engine route wired).

**Related documents:**

- Repeatability audit: [`DEE-93-REPEATABILITY-MIGRATION-AUDIT.md`](./DEE-93-REPEATABILITY-MIGRATION-AUDIT.md)
- Runtime routing strategy: [`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](./DEE-95-RUNTIME-ROUTING-STRATEGY.md)
- Facade hardening: [`DEE-95B-RUNTIME-FACADE-HARDENING.md`](./DEE-95B-RUNTIME-FACADE-HARDENING.md)
- Internal tracker: [`DEE-64-TRACKER.md`](./DEE-64-TRACKER.md)

**Related implementation (reference; not changed by this slice):**

- Twin Engine route (post-95c): [`app/api/dashboard/twin/engine/route.ts`](../../app/api/dashboard/twin/engine/route.ts)
- Verification POST: [`app/api/dashboard/twin/prediction/verification/route.ts`](../../app/api/dashboard/twin/prediction/verification/route.ts)
- Verifications GET: [`app/api/dashboard/twin/prediction/verifications/route.ts`](../../app/api/dashboard/twin/prediction/verifications/route.ts)
- Repeatability GET: [`app/api/dashboard/twin/repeatability/route.ts`](../../app/api/dashboard/twin/repeatability/route.ts)
- Runtime handle: [`db/waia-runtime-db.ts`](../../db/waia-runtime-db.ts), [`db/runtime-backend.ts`](../../db/runtime-backend.ts)
- Postgres twin boundary: [`lib/persistence/postgres/twin-persistence.ts`](../../lib/persistence/postgres/twin-persistence.ts)
- SQLite twin-persistence helpers: [`lib/twin-persistence/twin-prediction-verifications.ts`](../../lib/twin-persistence/twin-prediction-verifications.ts), [`lib/twin-persistence/twin-repeatability.ts`](../../lib/twin-persistence/twin-repeatability.ts)
- Twin Engine (personality inputs): [`lib/reasoning/twin-engine.ts`](../../lib/reasoning/twin-engine.ts), [`lib/reasoning/twin-engine-postgres.ts`](../../lib/reasoning/twin-engine-postgres.ts)

---

## 1. Current runtime state after 95c

- **`POST /api/dashboard/twin/engine`** resolves the active backend via **`getWaiaRuntimeDb()`** and runs the composite pipeline via **`runTwinEngineForRuntimeAsync(runtimeDb, input)`** ([`lib/reasoning/twin-engine-runtime.ts`](../../lib/reasoning/twin-engine-runtime.ts)).
- **Default production path** remains **SQLite** when `WAIA_DB_BACKEND` is unset or `sqlite` (same as pre-95c default intent).
- **Postgres path** is **env-gated**: `WAIA_DB_BACKEND=postgres` plus valid Postgres configuration (see [`db/runtime-backend.ts`](../../db/runtime-backend.ts)); the engine then uses **`runTwinEnginePostgresAsync`** + **`PostgresTwinPersistence`**.
- **Sibling dashboard routes** listed in §3 still call **`getDb()`** directly and use **SQLite-only** sync helpers for verification and repeatability. That is the **intentional gap** this document plans to close in a **future implementation slice** (not here).

---

## 2. Remaining consistency gaps

| Gap | Risk |
|-----|------|
| **Data-plane split** | If **`WAIA_DB_BACKEND=postgres`**, the Twin Engine reads verifications and repeatability from **Postgres**, while dashboard routes still **write and read** those surfaces on **SQLite**, the engine sees **empty or stale** verification lists and repeatability aggregates. |
| **Personality inputs** | `runTwinEngine` / `runTwinEnginePostgresAsync` feed **`buildTwinEnginePersonalityInput`** via **`repeatabilityOccurrenceSum`** and **`listTwinPredictionVerificationsForUser`**. Wrong store ⇒ wrong or zeroed **virtual memory boost** and verification signal shapes ([`twin-engine.ts`](../../lib/reasoning/twin-engine.ts)). |
| **Product / dashboard honesty** | **`GET /api/dashboard/twin/repeatability`** and **`GET /api/dashboard/twin/prediction/verifications`** would disagree with what the engine used on Postgres until aligned. |
| **Operational clarity** | Operators need a clear rule: **same backend** for engine + these routes in any Postgres canary, unless an explicit, documented exception is accepted (see [`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](./DEE-95-RUNTIME-ROUTING-STRATEGY.md) §9, §16). |

**Authoritative prior write-up:** DEE-93 §6 (“risks before production routing migration”) — especially **write/read split**.

---

## 3. Route-by-route migration inventory

| HTTP | Path | Auth | Request validation (summary) | Persistence operations today | Sync/async today | Target dispatch (implementation slice) |
|------|------|------|------------------------------|-------------------------------|------------------|----------------------------------------|
| POST | `/api/dashboard/twin/prediction/verification` | `getOptionalSessionUserId` → 401 | JSON: `scenario`, `verification`, optional `predictionId` / `correction`; length/type checks | `appendTwinPredictionVerificationForUser` + `recordRepeatabilityAfterVerification` on **`getDb()`** | Sync | **`await getWaiaRuntimeDb()`**; **`sqlite`** → existing sync helpers on `handle.db`; **`postgres`** → **`resolveTwinPersistence(handle)`** + **`PostgresTwinPersistence`** append + repeatability append (see library surface). |
| GET | `/api/dashboard/twin/prediction/verifications` | `getOptionalSessionUserId` → 401 | Optional `limit` query; positive number | `listTwinPredictionVerificationsForUser` on **`getDb()`** | Sync | Same runtime resolution; Postgres branch uses async **list** on persistence. |
| GET | `/api/dashboard/twin/repeatability` | `getOptionalSessionUserId` → 401 | Optional `scenario` query | `analyzeRepeatability` on **`getDb()`** | Sync | Same runtime resolution; Postgres branch uses **`analyzeRepeatabilityForUserAsync`** (or persistence wrapper — see analyzer / [`DEE-93`](./DEE-93-REPEATABILITY-MIGRATION-AUDIT.md)). |

**Response contracts:** Preserve existing JSON shapes, status codes, and headers (`Cache-Control: private, no-store`) unless a dedicated contract change is explicitly approved elsewhere.

---

## 4. Verification write-path analysis

**Current flow ([`verification/route.ts`](../../app/api/dashboard/twin/prediction/verification/route.ts)):**

1. Validate body (scenario non-empty, verification kind, correction length, etc.).
2. **`appendTwinPredictionVerificationForUser(db, userId, …)`** — persists verification row.
3. **`recordRepeatabilityAfterVerification(db, userId, …)`** — derives repeatability row from scenario + verification kind.

**Ordering:** Today both run **sequentially** on the same **`WaiaSqliteDb`**. A partial failure after (1) but during (2) is already a product edge case; implementation slices must document whether Postgres uses a **single transactional unit** for both operations or the same two-step policy as SQLite, and how errors map to HTTP.

**Postgres library:** `PostgresTwinPersistence` already implements **append** for verifications and **appendRepeatabilityRecordForUser** with **transactional** dedup semantics for repeatability (see [`DEE-93`](./DEE-93-REPEATABILITY-MIGRATION-AUDIT.md) §3, §6.3).

**Invariant:** Do not introduce **`Promise.all`** to parallelize these steps; keep **sequential** orchestration consistent with DEE-94 / DEE-95 guardrails.

---

## 5. Verification read-path analysis

**Current flow ([`verifications/route.ts`](../../app/api/dashboard/twin/prediction/verifications/route.ts)):**

- Parse optional **`limit`**; call **`listTwinPredictionVerificationsForUser(db, userId, limit)`**; return list DTO + schema version.

**Postgres:** `PostgresTwinPersistence.listTwinPredictionVerificationsForUser` exists ([`twin-persistence.ts`](../../lib/persistence/postgres/twin-persistence.ts)); route handler becomes **`async`** on the Postgres branch with **`await`**.

**Parity:** Ordering and field mapping should match SQLite list semantics already asserted in persistence tests where present; byte-identical JSON across backends is **not** a program guarantee (see DEE-95b §3).

---

## 6. Repeatability aggregation dependencies

- **Read path:** **`analyzeRepeatability`** (SQLite) vs **`analyzeRepeatabilityForUserAsync`** (Postgres DB) — same aggregation semantics per DEE-93 §2.
- **Write path:** Repeatability rows for the “verification” channel come primarily from **`recordRepeatabilityAfterVerification`** (SQLite) today; Postgres from **`PostgresTwinPersistence.appendRepeatabilityRecordForUser`**.
- **Engine dependency:** Engine runs analyzer **after** pattern + contradiction, **before** personality; **optional `scenarioText`** filter must stay consistent between **`GET /repeatability`** and engine’s normalized scenario options (see DEE-93 §1, §2).

---

## 7. Personality-model dependency risks

- **`repeatabilityOccurrenceSum`** boosts **virtual memory items considered** in personality signal input; if repeatability read returns **empty** on Postgres while SQLite had data (split-brain), persona shifts toward **under-counting** repeatability signal.
- **Verification DTOs** (`verification` + `correction`) drive **`sourceSignals.verificationItemsConsidered`** and shape contradiction/verification facets; split stores yield **wrong persona inputs** without crashing.
- **Non-risk:** Contradiction/pattern modules have their own ports; this plan focuses on **verification + repeatability surfaces** called out in DEE-93 / DEE-95 §16.

---

## 8. Runtime policy propagation requirements

- **Single policy source:** Implementation should use **`getResolvedWaiaDbRuntimeConfig()`** / **`getWaiaRuntimeDb()`** the same way the Twin Engine route does — no alternate env interpretation for these routes.
- **No silent cross-backend usage:** If runtime is Postgres, **do not** read verification/repeatability from **`getDb()`** for these routes.
- **Explicit failure:** Misconfigured Postgres should **fail loudly** (5xx + stable envelope where applicable), not **fall back** to SQLite without logs (DEE-95 §19).
- **Optional observability:** Response header or structured log line indicating **`sqlite` vs `postgres`** for operator correlation (DEE-95b observability sections).

---

## 9. SQLite / Postgres divergence risks

| Topic | Notes |
|-------|-------|
| **Dedup / concurrency** | SQLite repeatability append uses **pre-check + insert** outside a SQLite transaction; Postgres uses **transactional** check+insert — numeric differences possible under concurrency; engine only sees aggregates (DEE-93 §6.3). |
| **Semantic parity** | Same **contract** and module order; not guaranteed **identical** text or counts across backends (DEE-95b §3, DEE-72.6 non-goals). |
| **Async boundary** | Postgres path is **async** end-to-end; SQLite remains **sync** inside route unless wrapped **without** violating transaction architecture. |

---

## 10. Ordering constraints

1. **Planning (this document)** merges first — **no** behavior change.
2. **Implementation:** Prefer an **atomic flip** (single release) of all three routes for a Postgres canary so there is **no window** where the engine reads Postgres while writers still target SQLite.
3. If atomic flip is impossible, document a **risk acceptance** window and minimize duration (align with DEE-95 §9 “constrained internal Canary”).
4. **POST verification** must target the **same** store the engine uses **before** operators trust repeatability / verification-driven personality on Postgres.

---

## 11. Rollback requirements

- **Primary rollback lever:** Revert **`WAIA_DB_BACKEND`** to **`sqlite`** or unset; redeploy previous build if needed.
- **Code rollback:** Revert implementation PR(s); maintain compatibility with **SQLite-first** default.
- **No silent rollback:** If a runtime error triggers fallback to SQLite without logging, that is a **policy violation** (DEE-95 anti-patterns).
- **Data:** Postgres and SQLite **do not** magically sync; rollback is **routing/config**, not data repair.

---

## 12. Observability / logging requirements

- Log or trace **`waia_db_backend`** (or equivalent) at **route entry** for the three routes once wired — mirror patterns discussed in DEE-95b.
- Separate **client errors (4xx)** from **infrastructure / config errors (5xx)**.
- **`getWaiaRuntimeDb()`** failures (invalid env, connection) should be distinguishable from **application validation** errors in logs/metrics.

---

## 13. Test strategy (future implementation)

- **SQLite default:** Existing unit tests ([`twin-prediction-verification-route.test.ts`](../../tests/unit/twin-prediction-verification-route.test.ts), [`twin-repeatability-route.test.ts`](../../tests/unit/twin-repeatability-route.test.ts)) must keep **passing** with **`WAIA_DB_BACKEND` unset** and temp file DBs.
- **Runtime dispatch:** Add tests that **spy** `getWaiaRuntimeDb` + Postgres handle and assert the **persistence** path is invoked (pattern: [`twin-engine-route.test.ts`](../../tests/unit/twin-engine-route.test.ts), [`health-database-route.test.ts`](../../tests/unit/health-database-route.test.ts)).
- **Errors:** Preserve current validation behavior; add coverage for `getWaiaRuntimeDb` rejection mapping if routes adopt a unified **try/catch** like the engine route.

---

## 14. Integration-test requirements

- **Opt-in Postgres** (`WAIA_PG_INTEGRATION=1`, `DATABASE_URL_POSTGRES`): extend or add coverage so that **append verification → list verifications → repeatability GET → engine** observe **coherent** data on **one** backend (build on [`postgres-twin-persistence.test.ts`](../../tests/integration/postgres-twin-persistence.test.ts), [`postgres-twin-engine.test.ts`](../../tests/integration/postgres-twin-engine.test.ts)).
- **Gap called out in DEE-93 §5:** rich seeded repeatability → personality coupling on Postgres is **partial**; future integration may add a **narrow** scenario — optional, not a blocker for **route** alignment itself.

---

## 15. Migration sequencing

| Step | Deliverable |
|------|-------------|
| **A (this slice)** | Merge **`DEE-95D-RUNTIME-ALIGNMENT-PLAN.md`** + tracker/strategy cross-links; **zero** production code changes. |
| **B (implementation)** | Optional **library facades** (e.g. thin `*ForRuntimeAsync` helpers) to avoid duplicated multi-line `if (sqlite)… else …` in routes — mirror Twin Engine facade style (DEE-95 §19). |
| **C (implementation)** | Wire **`POST /prediction/verification`** through runtime dispatch. |
| **D (implementation)** | Wire **`GET /prediction/verifications`** and **`GET /repeatability`** (together preferred). |
| **E (follow-up)** | DEE-95e — observability, runbooks, staged rollout (per strategy §17). |

---

## 16. Go / no-go rollout criteria

**Go** to enable **Postgres-backed production** for this slice of the product when:

- All three routes use **`getWaiaRuntimeDb()`** (or documented equivalent) and never **`getDb()`** for verification/repeatability **when** `WAIA_DB_BACKEND=postgres`.
- **Unit + opt-in integration** tests cover SQLite default and Postgres paths.
- **DEE-93 write/read split** is closed for these routes (engine + dashboard agree on store).
- **Ops sign-off** and **Linear/tracker** updated; **no** silent fallback.

**No-go** if:

- Only the engine is on Postgres while verification/repeatability routes remain SQLite **without** written risk acceptance (DEE-95 §16).
- **`runWaiaTransaction`**, **`Promise.all`**, or **backend-neutral** repositories are introduced to “paper over” the migration.

---

## 17. Anti-patterns to avoid

- **Silent SQLite fallback** from Postgres errors without logging.
- **Neutral “one DB type” repository** replacing **`SqliteTwinPersistence` / `PostgresTwinPersistence`**.
- **`Promise.all`** fan-out for verification + repeatability writes.
- **“Big bang”** route flip without tests or rollback story.
- **Touching unrelated routes** (scope stays verification + repeatability dashboard APIs).

---

## 18. Recommended implementation slicing

| Option | Pros | Cons |
|--------|------|------|
| **Single implementation PR** | One atomic flip; shortest split-brain window | Larger review; higher merge conflict risk |
| **Two PRs** | (1) optional facades + unit tests; (2) all three routes | Still need coordinated deploy for Postgres |
| **Three PRs** | Smaller reviews | **Higher split-brain risk** between PRs if Postgres is toggled mid-stream — **discouraged** unless `WAIA_DB_BACKEND` stays sqlite until the last PR |

**Recommendation:** **One planning PR (this doc)** → **one or two implementation PRs**, with **no Postgres env promotion** until the **final** route PR merges; optionally land **facades first** behind unused exports if that reduces risk.

---

## 19. Safe fallback behavior

- **Default** remains **SQLite** when env is unset — **no** user-visible change for typical production until Postgres is explicitly enabled.
- **Explicit logging** on backend selection in implementation slices.
- **Fail closed** on misconfiguration (do not guess cross-DB).

---

## 20. Definition: “broad Postgres rollout ready”

For the **AI-Twin dashboard surfaces covered by DEE-95d**, the program is **broad Postgres rollout ready** when:

1. **`POST /api/dashboard/twin/engine`**, **`POST /api/dashboard/twin/prediction/verification`**, **`GET /api/dashboard/twin/prediction/verifications`**, and **`GET /api/dashboard/twin/repeatability`** all honor **`getWaiaRuntimeDb()`** / the same runtime config as the engine.
2. **Writes** (verification + repeatability append) and **reads** (list + analyze) target the **same logical store** as the engine for a given deployment.
3. **DEE-93** write/read split for these paths is **resolved** (or explicitly superseded by a signed risk doc).
4. **Tests:** default SQLite CI green; **documented** opt-in Postgres job exercises coherence for this slice.
5. **DEE-95e** (or equivalent) **observability and runbooks** are available before treating customer traffic as fully migrated.

**Out of scope for this definition:** Other SQLite-first routes (pattern summary, contradictions, prediction, diary, etc.), **`main` vs `dev` promotion**, Supabase/Cloudflare specifics — tracked separately.

---

## Document control

| Version | Slice | Notes |
|---------|--------|------|
| 1.0 | DEE-95d | Initial runtime alignment **planning** (verification + repeatability routes + persistence; implementation deferred). |
