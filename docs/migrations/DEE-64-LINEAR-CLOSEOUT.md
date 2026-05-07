# DEE-64 migration — Linear closeout handoff (reconciliation)

**Purpose:** Reconcile **repository truth** with **Linear** for **DEE-64–era** migration slices (including **DEE-72.x**, **DEE-93**, **DEE-94**, and **DEE-95** phases **through 95d**). Copy comments below into each issue when moving status. **Automation:** This file does not change Linear; an operator updates Linear manually.

**Baseline (verify before closeout):** `origin/dev` should include at least:

| Slice | Merge evidence (typical) |
|-------|---------------------------|
| DEE-72.6 | `2f087b4` — PR **#88** |
| DEE-93 | `a85fa78` — on `dev` |
| DEE-94 | `c170fb6` — PR **#89** (squash; local feature SHA `4da75f8` is not on first-parent line) |
| DEE-95 (strategy doc) | `3e247eb` — PR **#91** |
| DEE-95a | `3c1fd5e` — PR **#92** |
| DEE-95b | `7d87896` — PR **#93** |
| DEE-95c | `517f887` — PR **#94** |
| DEE-95d (implementation) | `b70e044` — PR **#96** |

Run: `git fetch origin && git log origin/dev -10 --oneline`

---

## 1. Recommended **Done** (if Definition of Done = merged to `origin/dev`)

### DEE-72.6

- **Why Done:** `runTwinEnginePostgresAsync` shipped; opt-in integration tests; **this slice did not** wire the production Twin Engine API route (that landed later in **DEE-95c**).
- **Paste as Linear comment:**

```text
Merged on dev: 2f087b4 / PR #88. Additive runTwinEnginePostgresAsync (twin-engine-postgres.ts); production route still SQLite/sync for this slice. Opt-in: postgres-twin-engine.test.ts (WAIA_PG_INTEGRATION + DATABASE_URL_POSTGRES). Later: POST …/twin/engine wired via getWaiaRuntimeDb + runTwinEngineForRuntimeAsync in DEE-95c (517f887 / PR #94).
```

### DEE-93

- **Why Done:** Audit deliverable merged on `dev`.
- **Paste as Linear comment:**

```text
Closed on dev: a85fa78. Deliverable docs/migrations/DEE-93-REPEATABILITY-MIGRATION-AUDIT.md. Twin Engine repeatability read path on Postgres OK for future routing; verification/repeatability GET writer alignment deferred to DEE-95+ per audit. Later closed on dev by DEE-95d implementation (b70e044 / PR #96): POST prediction verification, GET verifications, GET repeatability share getWaiaRuntimeDb with the engine.
```

### DEE-94

- **Why Done:** Orchestration **plan** merged on `dev` (squash commit on GitHub may differ from pre-merge feature SHA).
- **Paste as Linear comment:**

```text
Merged on dev: c170fb6 / PR #89. Deliverable docs/migrations/DEE-94-ASYNC-TWIN-ENGINE-ORCHESTRATION-PLAN.md — planning only; no facade/routing code in this PR. Next at the time: DEE-95 runtime strategy; runtime facade then landed in DEE-95a–95c.
```

---

## 2. DEE-95 runtime routing — **current truth** (after 95c / 95d)

**DEE-95 (planning issue / strategy document):** **Done** when Definition of Done = strategy merged to `dev`. Authoritative doc: [`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](./DEE-95-RUNTIME-ROUTING-STRATEGY.md) (`3e247eb` / PR **#91**). Summary: [`DEE-64-TRACKER.md`](./DEE-64-TRACKER.md).

**Phases merged on `dev`:**

| Phase | What shipped | Merge evidence |
|-------|----------------|----------------|
| **95a** | Library facade `runTwinEngineForRuntimeAsync` ([`lib/reasoning/twin-engine-runtime.ts`](../../lib/reasoning/twin-engine-runtime.ts)) | `3c1fd5e` — PR **#92** |
| **95b** | Facade hardening **planning**: [`DEE-95B-RUNTIME-FACADE-HARDENING.md`](./DEE-95B-RUNTIME-FACADE-HARDENING.md) | `7d87896` — PR **#93** |
| **95c** | **Twin Engine route** uses **`getWaiaRuntimeDb()`** + **`runTwinEngineForRuntimeAsync`** (not `getDb()` + sync `runTwinEngine` at the route boundary) | `517f887` — PR **#94** |
| **95d** | **Verification** POST, **verifications** GET, **repeatability** GET use the **same** runtime backend policy as the engine; planning: [`DEE-95D-RUNTIME-ALIGNMENT-PLAN.md`](./DEE-95D-RUNTIME-ALIGNMENT-PLAN.md) (Linear **DEE-98**); implementation closeout **DEE-99** | `b70e044` — PR **#96** |

**Umbrella / program:** **DEE-92** (WAIA architectural migration log) remains **In Progress**.

**Broad Postgres rollout:** **Still blocked** pending **DEE-95e**-style observability, runbooks, staged rollout, **ops sign-off**, and **broader route alignment** (many APIs under `app/api` still call `getDb()` directly — see strategy doc and tracker). DEE-95c/95d **do not** imply production Postgres promotion without that work.

**Paste as Linear comment (95c):**

```text
Merged on dev: 517f887 / PR #94. POST /api/dashboard/twin/engine uses getWaiaRuntimeDb + runTwinEngineForRuntimeAsync; default SQLite when WAIA_DB_BACKEND unset or sqlite; Postgres when WAIA_DB_BACKEND=postgres with valid DATABASE_URL_POSTGRES.
```

**Paste as Linear comment (95d implementation):**

```text
Merged on dev: b70e044 / PR #96. POST …/prediction/verification, GET …/prediction/verifications, GET …/repeatability use getWaiaRuntimeDb + sqlite helpers or resolveTwinPersistence; same runtime policy as Twin Engine. Broad Postgres rollout still requires DEE-95e / ops / observability and broader route alignment.
```

---

## 3. DEE-96 — verify in Linear (not in DEE-64 tracker)

- If issue = pgvector / memory retrieval research: status **Backlog** or **In Progress** per actual work; add tracker cross-link when scope is ratified.

---

## Related

- Migration tracker: [`DEE-64-TRACKER.md`](./DEE-64-TRACKER.md)
- Runtime routing strategy (phases, guardrails): [`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](./DEE-95-RUNTIME-ROUTING-STRATEGY.md)
- Truth reconciliation rationale: Cursor plan “Migration truth reconciliation” (same content as issue closeout tables).
