# DEE-93 — DEE-72.5 Repeatability migration audit and planning

**Scope:** Audit repeatability as **consumed by the Twin Engine** on Postgres, post **DEE-72.6** (`runTwinEnginePostgresAsync`).  
**Out of scope:** Implementing routing, new orchestration APIs, or behavior changes (this document is audit/planning only).

**Related code (reference):**

- Analyzer: [`lib/reasoning/twin-repeatability-analyzer.ts`](../../lib/reasoning/twin-repeatability-analyzer.ts)
- Persistence helpers (hashing, pattern rules, SQLite append/list/count): [`lib/twin-persistence/twin-repeatability.ts`](../../lib/twin-persistence/twin-repeatability.ts)
- Postgres append + boundary: [`lib/persistence/postgres/twin-persistence.ts`](../../lib/persistence/postgres/twin-persistence.ts)
- Twin engine (sync SQLite): [`lib/reasoning/twin-engine.ts`](../../lib/reasoning/twin-engine.ts)
- Twin engine (async Postgres): [`lib/reasoning/twin-engine-postgres.ts`](../../lib/reasoning/twin-engine-postgres.ts)
- Schemas: [`db/schema.ts`](../../db/schema.ts), [`db/schema.postgres.ts`](../../db/schema.postgres.ts)

---

## 1. Current repeatability architecture

**Purpose (product):** After a user verifies a prediction (`POST /api/dashboard/twin/prediction/verification`), the system can **append** a repeatability row derived from scenario text (normalized hash, inferred `patternType`, optional prediction outcome). **Analysis** aggregates rows by `patternType` (counts + `max(createdAt)` per group), optionally filtered by scenario hash.

**Twin Engine usage:** Both `runTwinEngine` and `runTwinEnginePostgresAsync` call the analyzer **after** pattern summary and contradiction detection, **before** personality composition. The repeatability result feeds `buildTwinEnginePersonalityInput` via `repeatabilityOccurrenceSum` (extra virtual “memory items considered” boost from repeated patterns).

**Layers:**

| Concern | Location |
|--------|----------|
| API contract | `TwinRepeatabilityApiResponse`, `TWIN_REPEATABILITY_SCHEMA_VERSION` in [`lib/dashboard/twin-repeatability-api.types.ts`](../../lib/dashboard/twin-repeatability-api.types.ts) |
| Pure rules | `hashTwinScenarioRepeatabilityHex`, `inferRepeatabilityPatternType`, `TWIN_REPEATABILITY_DEDUP_WINDOW_MS` in `twin-repeatability.ts` (shared) |
| Read aggregation | `analyzeRepeatability` (SQLite) / `analyzeRepeatabilityForUserAsync` (Postgres `WaiaPostgresDb`) in `twin-repeatability-analyzer.ts` |
| SQLite writes | `appendRepeatabilityRecordForUser`, `recordRepeatabilityAfterVerification`, etc. in `twin-repeatability.ts` |
| Postgres writes | `appendRepeatabilityRecordForUserPg` (private) exposed as `PostgresTwinPersistence.appendRepeatabilityRecordForUser` |

**Data flow into Twin Engine (Postgres path):**

`runTwinEnginePostgresAsync` → `analyzeRepeatabilityForUserAsync(p.db, userId, { scenarioText: normalized ?? undefined })` → reads `twin_repeatability_records` only.

---

## 2. Sync vs async entry points

| Entry | DB type | Sync/async | Used by |
|-------|---------|------------|---------|
| `analyzeRepeatability(db, userId, options?)` | `WaiaSqliteDb` | Sync (Drizzle `.all()`) | `runTwinEngine`, `GET /api/dashboard/twin/repeatability` |
| `analyzeRepeatabilityForUserAsync(db, userId, options?)` | `WaiaPostgresDb` | Async (`await db.select…`) | `runTwinEnginePostgresAsync`, `PostgresTwinPersistence.analyzeRepeatabilityForUser` |
| `appendRepeatabilityRecordForUser` | `WaiaSqliteDb` | Sync | Verification route (via `recordRepeatabilityAfterVerification`), unit tests |
| `PostgresTwinPersistence.appendRepeatabilityRecordForUser` | Postgres (via Drizzle) | Async; dedup+insert inside `runWaiaPostgresTransaction` | Opt-in integration tests; **not** wired from production verification route today |

**Contract alignment:** The two analyzers implement the same filtering and aggregation semantics (user id ± scenario hash; `group by patternType`; sort pattern types lexicographically; `lastSeenAt` as ISO string from `max(createdAt)`).

---

## 3. Persistence / database dependencies

**Table:** `twin_repeatability_records` — defined in both SQLite and Postgres schemas with the same column *meaning* (ids differ by backend: text vs uuid).

**Columns used by Twin Engine read path:** `user_id`, `scenario_hash` (when scenario filter applied), `pattern_type`, `created_at` (for `count` and `max`).

**Indexes (both backends):** `(user_id, created_at)`, `scenario_hash`, `pattern_type` — sufficient for typical per-user aggregation; no new requirement identified for engine read path.

**Postgres append path:** Uses `runWaiaPostgresTransaction` for **dedup check + insert** atomically. Prediction outcome (if not overridden) is computed **before** the transaction using `runTwinPredictionForUserAsync` + memory search port, matching the documented DEE-72.5 constraint (“no reasoning inside the DB transaction callback” for that heavy work).

---

## 4. SQLite-specific assumptions

| Assumption | Notes |
|------------|--------|
| `WaiaSqliteDb` sync query API | `analyzeRepeatability` uses `.all()`; not portable to Postgres without async. **Handled** by separate `analyzeRepeatabilityForUserAsync`. |
| `appendRepeatabilityRecordForUser` dedup | **Pre-check** (`hasRecentDedupDuplicate`) then **insert** — **not** wrapped in `db.transaction`. Under concurrent writers, a narrow race could theoretically double-insert; Postgres path closes this with a transactional check+insert. |
| Verification route | [`app/api/dashboard/twin/prediction/verification/route.ts`](../../app/api/dashboard/twin/prediction/verification/route.ts) uses `getDb()` + `recordRepeatabilityAfterVerification` → **SQLite only** today. |
| Repeatability REST read route | [`app/api/dashboard/twin/repeatability/route.ts`](../../app/api/dashboard/twin/repeatability/route.ts) uses `getDb()` + `analyzeRepeatability` → **SQLite only** today. |
| `SqliteTwinPersistence` | [`lib/persistence/sqlite/twin-persistence.ts`](../../lib/persistence/sqlite/twin-persistence.ts) does **not** surface repeatability methods; repeatability SQLite APIs are **free functions** on `WaiaSqliteDb`. Postgres boundary **does** surface `appendRepeatabilityRecordForUser` / `analyzeRepeatabilityForUser` — intentional asymmetry at D5a/DEE-72 scope, but worth remembering when designing a future runtime facade. |
| Helper functions in `twin-repeatability.ts` | Import `twinRepeatabilityRecords` from **SQLite** schema for list/count/append; Postgres uses `pgSchema` inside `twin-persistence.ts` / analyzer. Shared **logic** (hash, pattern rules) is backend-agnostic. |

---

## 5. Postgres readiness assessment (Twin Engine consume path)

| Criterion | Status |
|-----------|--------|
| Schema present and migrated | **Ready** — `twin_repeatability_records` in `schema.postgres.ts` with indexes. |
| Read aggregator implemented | **Ready** — `analyzeRepeatabilityForUserAsync` mirrors SQLite semantics. |
| Compose into `runTwinEnginePostgresAsync` | **Ready** — DEE-72.6 wires scenario-normalized options the same way as sync engine. |
| Opt-in integration coverage for append+analyze | **Ready** — [`tests/integration/postgres-twin-persistence.test.ts`](../../tests/integration/postgres-twin-persistence.test.ts) (DEE-72.5 cases). |
| Opt-in integration for engine shape including repeatability | **Partial** — [`tests/integration/postgres-twin-engine.test.ts`](../../tests/integration/postgres-twin-engine.test.ts) asserts schema version and empty-array safety, not rich seeded repeatability → personality coupling. |

**Verdict for “can the engine **read** repeatability on Postgres?”** **Yes** — code path is consistent and tested at the persistence and shallow engine levels.

---

## 6. Risks before production routing migration

1. **Write/read split:** If Twin Engine (or repeatability GET) is routed to Postgres **while verification append stays on SQLite**, Postgres `twin_repeatability_records` stays empty → **repeatability_analyzer** always returns empty aggregates; personality `memoryItemsConsidered` boost from repeatability **vanishes** vs SQLite. This is a **product correctness** risk, not a crash risk.

2. **Operational confidence:** Postgres integration tests are **opt-in** (`WAIA_PG_INTEGRATION`, `DATABASE_URL_POSTGRES`). Default CI does not exercise repeatability on Postgres unless a job sets those env vars.

3. **Dedup semantics drift awareness:** SQLite append has a **non-transactional** dedup window; Postgres is **transactional**. Under concurrency, backends could behave slightly differently; Twin Engine only sees aggregates, so impact is numeric, not structural.

4. **Auxiliary SQLite-only APIs:** `listRepeatabilityRecordsForUser` / `countRepeatabilityForPattern` exist only for SQLite helpers/tests. Twin Engine does not need them; any future admin/debug Postgres tools would need new surface area.

---

## 7. Required future implementation slices (if any)

Not mandatory for **documenting** DEE-93; recommended before **Postgres-first production**:

1. **Verification route (and any other repeatability writers) on Datapath** — Migrate `recordRepeatabilityAfterVerification` equivalent to `PostgresTwinPersistence.appendRepeatabilityRecordForUser` when runtime is Postgres (same session of work as broader routing slice; **explicit slice**, not implied here).

2. **Repeatability GET route** — Same as today: must use Postgres analyzer when runtime is Postgres, or dashboard will show wrong repeatability.

3. **Optional: CI job** — Run opt-in Postgres integration (or a slimmer repeatability-only suite) on merge/schedule.

4. **Optional: transactional dedup on SQLite** — If SQLite/Postgres behavioral symmetry under concurrency matters, wrap SQLite dedup+insert in `runWaiaSqliteLegacyTransaction` (policy change; separate slice).

5. **Optional: boundary parity** — Expose repeatability through `SqliteTwinPersistence` for symmetry with Postgres (refactor-only; low urgency).

---

## 8. Required tests

**Already present:**

- Unit: [`tests/unit/twin-repeatability.test.ts`](../../tests/unit/twin-repeatability.test.ts) — hashing, pattern inference, append, dedup, `analyzeRepeatability`, scenario filter (SQLite).
- Unit: [`tests/unit/twin-repeatability-route.test.ts`](../../tests/unit/twin-repeatability-route.test.ts) — GET repeatability + verification integration on SQLite.
- Unit: [`tests/unit/twin-prediction-verification-route.test.ts`](../../tests/unit/twin-prediction-verification-route.test.ts) — repeatability row counts on SQLite after POST.
- Integration (opt-in): `postgres-twin-persistence.test.ts` — Postgres append, dedup, `analyzeRepeatabilityForUser` including scenario filter.
- Integration (opt-in): `postgres-twin-engine.test.ts` — engine response includes repeatability envelope.

**Gaps to schedule before trusting Postgres routing:**

| Gap | Rationale |
|-----|------------|
| Postgres integration: engine run **with seeded repeatability rows** | Assert personality / `memoryItemsConsidered` path responds to non-empty aggregates (regression guard for Twin Engine wiring). |
| After verification route migration | Route-level tests against Postgres (or contract tests on persistence) so append + GET + engine share one DB. |
| Optional: concurrent dedup stress | Only if SQLite transactional dedup is implemented. |

---

## 9. Invariants to preserve

- **`TWIN_REPEATABILITY_SCHEMA_VERSION` and DTO shape** for API responses used by Twin Engine and dashboard clients.
- **Scenario normalization + hash** must stay aligned between append and analyze paths (`hashTwinScenarioRepeatabilityHex` + `normalizeTwinPredictionScenario`).
- **Dedup window** `TWIN_REPEATABILITY_DEDUP_WINDOW_MS` — single constant for product consistency across backends.
- **Postgres append:** keep **heavy reasoning / prediction** outside `runWaiaPostgresTransaction` callback (DEE-72.5 pattern).
- **Do not** widen `WaiaSqliteTransactionCallback` or introduce `runWaiaTransaction` as part of repeatability fixes; use explicit backend helpers per DEE-64 tracker.
- **Twin Engine orchestration order** — repeatability after pattern + contradiction, before personality (already identical in sync and Postgres async engines).

---

## 10. Go / no-go: repeatability inside future Postgres runtime routing

**Go — for the analyzer as used by `runTwinEnginePostgresAsync`:**  
The Postgres read path is implemented, schema-backed, and covered by opt-in integration tests. There are no identified blockers *within the repeatability read layer* that should prevent a *future* Twin Engine route from calling this code **once** routing strategy (DEE-95) and orchestration plan (DEE-94) are approved.

**No-go — for “Postgres production” as a complete product slice without additional work:**  
Do **not** treat repeatability as “migration-complete” when **only** the Twin Engine reads Postgres. **Verification (and repeatability GET)** must target the same persistence store; otherwise repeatability data in Postgres is stale or empty and the engine’s personality signal silently degrades.

**Summary signal:**

| Question | Answer |
|----------|--------|
| Is repeatability **analysis** Postgres-safe for Twin Engine? | **Yes (go).** |
| Is repeatability **end-to-end** Postgres-safe for users without writer migration? | **No (no-go until verification/read routes align).** |

---

## Audit closure

- **DEE-93 (this document)** records findings only; **no runtime or routing changes** were made as part of producing it.
- Next planned steps in program order: **DEE-94** (async Twin Engine orchestration plan), **DEE-95** (runtime routing strategy), with repeatability **writer** migration explicitly in the routing scope.
