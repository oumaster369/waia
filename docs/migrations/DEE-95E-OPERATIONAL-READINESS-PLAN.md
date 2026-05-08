# DEE-95e — Operational readiness for staged Postgres rollout

**Type:** Planning only. **Does not** implement telemetry, metrics, logging, rollout automation, or change runtime behavior, env defaults, or SQLite removal.

**Purpose:** Define operational governance, telemetry expectations, rollback, rollout stages, and readiness criteria required before **broad Postgres production rollout** can be declared safe — building on DEE-95c / DEE-95d runtime alignment and DEE-95B / DEE-95D prior analysis.

**Prerequisites on `dev`:** DEE-95 (strategy), DEE-95a–d merged; Twin Engine + verification + repeatability routes share [`getWaiaRuntimeDb()`](../../db/waia-runtime-db.ts) policy; SQLite remains default when `WAIA_DB_BACKEND` is unset or `sqlite`; Postgres remains env-gated.

**Related documents:**

- [`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](./DEE-95-RUNTIME-ROUTING-STRATEGY.md)
- [`DEE-95B-RUNTIME-FACADE-HARDENING.md`](./DEE-95B-RUNTIME-FACADE-HARDENING.md)
- [`DEE-95D-RUNTIME-ALIGNMENT-PLAN.md`](./DEE-95D-RUNTIME-ALIGNMENT-PLAN.md)
- [`DEE-64-TRACKER.md`](./DEE-64-TRACKER.md)
- [`DEE-64-LINEAR-CLOSEOUT.md`](./DEE-64-LINEAR-CLOSEOUT.md)
- **DEE-95g (ops docs):** [`DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md`](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md), [`DEE-95G-LOG-DASHBOARD-SPEC.md`](./DEE-95G-LOG-DASHBOARD-SPEC.md), [`DEE-95G-STAGING-CHECKLIST.md`](./DEE-95G-STAGING-CHECKLIST.md)

**Related code:**

- Runtime handle: [`db/waia-runtime-db.ts`](../../db/waia-runtime-db.ts), [`db/runtime-backend.ts`](../../db/runtime-backend.ts)
- Facade: [`lib/reasoning/twin-engine-runtime.ts`](../../lib/reasoning/twin-engine-runtime.ts)
- Health probe: [`app/api/health/database/route.ts`](../../app/api/health/database/route.ts)
- **DEE-95f:** Route telemetry helper: [`lib/observability/waia-runtime-route-telemetry.ts`](../../lib/observability/waia-runtime-route-telemetry.ts)

**Implementation status:** **DEE-95f** adds **stdout JSON** backend attribution logs for Twin Engine, verification, verifications, repeatability, and health/database routes (see §4–§5). **DEE-95g** adds operator-facing **runbook**, **derived-metric spec**, and **staging checklist** for reading that telemetry (see Related documents) — **not** dashboards in product, **not** broad Postgres rollout. Full readiness still requires external log aggregation, thresholds with ops, and remaining route waves.

---

## 1. Current runtime architecture after 95d

Four **production** dashboard routes resolve the active backend via **`await getWaiaRuntimeDb()`** and branch on `handle.kind`:

| Route | Role |
|-------|------|
| `POST /api/dashboard/twin/engine` | `runTwinEngineForRuntimeAsync(runtimeDb, input)` (DEE-95c) |
| `POST /api/dashboard/twin/prediction/verification` | SQLite: [`twin-prediction-verifications`](../../lib/twin-persistence/twin-prediction-verifications.ts) + repeatability side effect; Postgres: `resolveTwinPersistence` → `PostgresTwinPersistence` (DEE-95d) |
| `GET /api/dashboard/twin/prediction/verifications` | List verifications from the same policy-selected store (DEE-95d) |
| `GET /api/dashboard/twin/repeatability` | `analyzeRepeatability` vs `analyzeRepeatabilityForUser` on persistence (DEE-95d) |

**Policy source:** [`getResolvedWaiaDbRuntimeConfig()`](../../db/runtime-backend.ts) — unset / `sqlite` → `{ kind: "sqlite", db: getDb() }`; `postgres` + non-empty `DATABASE_URL_POSTGRES` → Postgres Drizzle handle. **No silent cross-backend fallback** in the resolver.

**Library bodies:** Sync `runTwinEngine` (SQLite branch) and `runTwinEnginePostgresAsync` (Postgres branch) remain the orchestration authorities per DEE-72.6 / DEE-94.

---

## 2. Definition of “broad Postgres rollout”

**Slice-complete (95d surfaces):** For the **four routes above**, “Postgres-ready for this slice” means: same `getWaiaRuntimeDb` policy, no `getDb()` on those handlers for the data path when `WAIA_DB_BACKEND=postgres`, tests green, and **DEE-95e** observability/runbook work complete per [`DEE-95D-RUNTIME-ALIGNMENT-PLAN.md`](./DEE-95D-RUNTIME-ALIGNMENT-PLAN.md) §20.

**Broad / product-wide Postgres rollout:** Extends beyond that slice: customer-facing or operator-declared “WAIA AI-Twin data plane is Postgres-backed” with **ops sign-off**, **staged promotion**, and **either** migration of remaining high-traffic `getDb()` routes **or** explicit written risk acceptance where SQLite + Postgres split remains. Includes observability sufficient to detect mis-routing, regression, and connection failures without guessing.

This document treats **broad rollout** as the **program gated outcome** — not implied by merging 95d code alone.

---

## 3. Operational readiness goals

- **Safe canary:** Operators can turn Postgres on for an environment with measurable signals and a defined rollback path.
- **Attribution:** Every runtime-dispatched request can be traced (in logs/metrics) to `sqlite` vs `postgres` and to success vs classified failure modes.
- **No silent degradation:** Misconfiguration and backend failures **fail loud**; no unlogged fallback from Postgres to SQLite.
- **Rollback confidence:** Primary lever (`WAIA_DB_BACKEND` / deploy revert) documented, tested in staging, and time-bounded.
- **Incident readiness:** Runbooks and ownership exist before production traffic depends on Postgres.

---

## 4. Required telemetry

**Minimum structured fields** (per request or per sampled request, per product/ops policy):

| Field | Purpose |
|-------|---------|
| `waia_db_backend` | `sqlite` \| `postgres` (from resolved runtime) |
| `route` or `handler` | Identifies API (e.g. `twin_engine`, `prediction_verification`) |
| `outcome` | e.g. `success`, `client_error`, `config_error`, `internal_error` (taxonomy aligned with DEE-95B §9) |
| `duration_ms` | Wall time for dispatch + handler work (where measurable at route layer) |
| `http_status` | Final status |

**Optional but valuable:** counters by `backend` × `outcome`; latency histogram / p95; **request correlation id** when platform supports it.

**Privacy:** Do **not** log raw scenario / diary text in production unless explicitly approved ([`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](./DEE-95-RUNTIME-ROUTING-STRATEGY.md) §11; DEE-95B §8).

**Implementation note:** **DEE-95f** implements **minimal** structured logs (`event: waia_runtime_route`) from the **`getWaiaRuntimeDb`-aware API routes** at that slice (initially five handlers; route keys expand as migration waves land — see [`WaiaRuntimeRouteKey`](../../lib/observability/waia-runtime-route-telemetry.ts)) via [`lib/observability/waia-runtime-route-telemetry.ts`](../../lib/observability/waia-runtime-route-telemetry.ts): backend (from resolved handle), route key, outcome, `duration_ms`, `http_status`, `error_class` (`Error.prototype.name` only). **No** raw scenario/diary text, **no** external vendors. **DEE-95g** documents how operators use these logs ([runbook](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md), [dashboard spec](./DEE-95G-LOG-DASHBOARD-SPEC.md), [staging checklist](./DEE-95G-STAGING-CHECKLIST.md)). **Remaining:** live dashboards in your log stack, sampling, correlation IDs, numeric SLOs with ops, and broader route coverage per §4 / §11.

**Log vs HTTP triage:** Some **`config_error`** logs (e.g. invalid `WAIA_DB_BACKEND`) may still map to **HTTP 500** on routes that use a generic error envelope — logs are **triage-forward** until response mapping is refined in a later slice.

---

## 5. Backend attribution logging requirements

- Emit **`sqlite` \| `postgres`** from the **same** source of truth as [`getWaiaRuntimeDb`](../../db/waia-runtime-db.ts) (or resolved config) — not a duplicate env read that could drift.
- **Primary emission point:** HTTP route or a **thin** shared helper invoked immediately after `await getWaiaRuntimeDb()` — keeps [`runTwinEngineForRuntimeAsync`](../../lib/reasoning/twin-engine-runtime.ts) free of noisy default logging (DEE-95B §9).
- **Taxonomy alignment:** Use the same outcome labels as runbooks and dashboards.
- **Debug:** Any verbose library logging behind an explicit env flag (e.g. `WAIA_DEBUG_RUNTIME_DISPATCH=1`), off by default.

---

## 6. Error observability requirements

| Class | Examples | Operator signal |
|-------|----------|-----------------|
| **4xx / client** | Invalid body, `SCENARIO_TOO_LONG`, auth | Expected; rate-limit noise vs abuse |
| **5xx / config** | Invalid `WAIA_DB_BACKEND`, missing `DATABASE_URL_POSTGRES`, Postgres unreachable at connection | **Deploy/config** — distinct from application bugs |
| **5xx / internal** | Unhandled exceptions in engine/persistence | **Application** — needs code path / stack in secure logs |

**Twin Engine route** maps `TwinEngineScenarioTooLongError` → 400 and generic errors → 500 without echoing internals ([`app/api/dashboard/twin/engine/route.ts`](../../app/api/dashboard/twin/engine/route.ts)); logging should still record **class** + **backend** + **duration** server-side.

**Distinguish:** `getWaiaRuntimeDb()` / Postgres client failures vs validation errors vs orchestration errors — required for on-call triage.

---

## 7. Runtime backend visibility requirements

- **Today:** [`GET /api/health/database`](../../app/api/health/database/route.ts) returns JSON `{ backend, ok }` and runs `select 1` on Postgres when applicable — suitable for **liveness/readiness** probes once environments set env consistently.
- **Future (implementation):** Optional **response headers** (e.g. `X-Waia-Db-Backend`) for internal debugging — policy must avoid caching leaks and **must not** replace structured logs for operators.
- **Debug endpoints:** Any admin-only debug surface must be gated and documented; not part of MVP rollout.

---

## 8. Kill-switch strategy

**Primary kill-switch:** Set **`WAIA_DB_BACKEND=sqlite`** or **unset** `WAIA_DB_BACKEND` so [`getResolvedWaiaDbRuntimeConfig()`](../../db/runtime-backend.ts) resolves to SQLite; redeploy if env is build-time baked.

**Defense in depth (optional future):** A separate feature flag (see DEE-95 §7 “kill-switch”) forcing SQLite for Twin subsystem **even if** `WAIA_DB_BACKEND=postgres` — requires **explicit implementation slice** and must **log loudly** when active.

**Policy:** Kill-switch use is **configuration + deploy**, not silent in-process fallback on error.

---

## 9. Rollback strategy

- **Fast path:** Revert env to SQLite default; confirm health checks return `backend: sqlite`, `ok: true`.
- **Code path:** Revert bad deployment (image / commit) if the failure is code-related.
- **Data:** SQLite and Postgres are **not** auto-reconciled; rollback is **routing/config**, not automatic data repair ([`DEE-95D-RUNTIME-ALIGNMENT-PLAN.md`](./DEE-95D-RUNTIME-ALIGNMENT-PLAN.md) §11).
- **Communication:** Operators document which store held writes during the canary window.

---

## 10. Rollout stages

Suggested progression (tune with ops):

1. **Local / dev** — Postgres optional; parity with CI.
2. **Staging** — `WAIA_DB_BACKEND=postgres` with production-like URLs; full telemetry ON; run integration + manual smoke.
3. **Production canary** — Subset of traffic or internal-only tenants (product choice); elevated monitoring.
4. **Production full** — Declared only after gating criteria (§11) and sign-off.

Align with phased implementation intent in [`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](./DEE-95-RUNTIME-ROUTING-STRATEGY.md) §13 / §17.

---

## 11. Rollout gating criteria

**No-go to broad customer Postgres** until:

- Structured **backend + outcome** telemetry is **live** in the target environment for all four runtime-wired routes (implementation slice).
- **Health** checks pass for Postgres mode in staging with realistic load.
- **Opt-in** CI job (or equivalent) exercises Postgres coherence for the slice (verification → list → repeatability → engine) — see §14.
- **DEE-93** write/read split is **closed** for the migrated routes (already true for engine + verification + repeatability when on postgres).
- **Runbooks** reviewed and owners assigned.
- **Written ops sign-off** recorded (Linear / change ticket).

---

## 12. SQLite/Postgres divergence monitoring

- **Contract parity:** JSON schema versions, `modulesRun` order, status codes — enforce in tests.
- **Semantic parity:** **Not** guaranteed byte-identical text or counts (DEE-95B §3, DEE-72.6 non-goals).
- **Monitoring focus:** Sudden shifts in error rate, latency p95, verification/list/repeatability **cardinality** vs baseline, and engine `personality` / repeatability signal drift — tune thresholds with ops.
- **Dedup/concurrency:** SQLite vs Postgres repeatability dedup may differ under concurrency (DEE-93 / DEE-95D notes) — document as known variance, not necessarily alert-worthy.

---

## 13. Health-check strategy

- Use [`GET /api/health/database`](../../app/api/health/database/route.ts) in orchestration readiness probes when Postgres mode is enabled.
- **Failure modes:** `ok: false` or non-200 — Postgres down, wrong credentials, network, or migration drift; **do not** treat as “fallback to SQLite” automatically.
- **SQLite mode:** Returns `{ backend: "sqlite", ok: true }` without remote I/O — fast probe.
- **Staging/production:** Ensure probe frequency avoids thundering herd; document timeout alignment with connection pool tuning (future ops doc).

---

## 14. Integration-test strategy

- **Pattern:** Opt-in `WAIA_PG_INTEGRATION=1` + `DATABASE_URL_POSTGRES` — see [`tests/integration/postgres-twin-engine.test.ts`](../../tests/integration/postgres-twin-engine.test.ts), [`postgres-twin-persistence.test.ts`](../../tests/integration/postgres-twin-persistence.test.ts).
- **Coherence chain (recommended extension in implementation slice):** Append verification → GET verifications → GET repeatability → POST engine — assert data flows on **one** backend ([`DEE-95D-RUNTIME-ALIGNMENT-PLAN.md`](./DEE-95D-RUNTIME-ALIGNMENT-PLAN.md) §14).
- **CI matrix:** Default job — unit + skipped integration; optional job — secrets + Postgres service or external URL per org policy.

---

## 15. Production validation checklist

- [ ] Staging promoted with `WAIA_DB_BACKEND=postgres` and valid `DATABASE_URL_POSTGRES`.
- [ ] Health endpoint green; synthetic auth’d calls hit all four runtime routes successfully.
- [ ] Telemetry dashboard shows expected `postgres` ratio and error breakdown.
- [ ] Rollback drill: flip to sqlite, confirm traffic recovers; document elapsed time.
- [ ] On-call notified and runbook link distributed.

---

## 16. Staging / pre-production expectations

- **Parity:** Staging should mirror production for env var **names** and connection patterns; use isolated DB clusters.
- **Secrets:** `DATABASE_URL_POSTGRES` managed via platform secrets manager; rotation procedure documented.
- **Migrations:** Postgres schema migrations applied in lockstep with app version expectations (existing WAIA migration process).

---

## 17. Runtime misconfiguration detection

[`getResolvedWaiaDbRuntimeConfig()`](../../db/runtime-backend.ts) **throws** when:

- `WAIA_DB_BACKEND=postgres` but `DATABASE_URL_POSTGRES` empty.
- `WAIA_DB_BACKEND` set to an invalid value.

**Failure mode:** Typically first request or first `getWaiaRuntimeDb()` call — surfaces as 500 unless caught and mapped (product decision per route). **Pipeline:** Validate env in CI/CD or infra templates **before** deploy to reduce production surprises.

---

## 18. Incident response / runbook expectations

- **Ownership:** Engineering + ops — define primary on-call for database backend incidents.
- **First actions:** Confirm current `WAIA_DB_BACKEND`, health endpoint, Postgres connectivity, error logs (classified).
- **Escalation:** When to invoke DBA / hosting provider; when to execute kill-switch (§8).
- **Comms:** Template for “Postgres mode degraded — falling back to SQLite routing” (internal / customer per policy).
- **Artifact:** Central internal runbook (wiki / Notion / repo doc) — **link from Linear DEE-95e implementation issues** when created.

---

## 19. Route migration inventory (runtime vs `getDb()`)

**HTTP routes still using `getDb()` directly** — **split-brain risk** when other Twin paths use Postgres via **`getWaiaRuntimeDb()`**:

| Area | Paths | Notes |
|------|-------|--------|
| Auth | `sign-in`, `sign-up`, `sign-out` | Session/user store; intentionally deferred from runtime waves |
| OAuth | OAuth start/callback helpers | Deferred per program scope |

**Twin / dashboard HTTP surfaces aligned to `getWaiaRuntimeDb()`** (non-exhaustive; see tracker): Twin Engine; **`twin/prediction`**, **`twin/pattern-summary`**, **`twin/contradictions`** (async reasoning ports on Postgres); prediction verification / verifications; repeatability; twin-dialogue turn(s); **`GET /api/dashboard/readiness`**; **`GET`/`POST /api/dashboard/diary/entries`**; **`GET`/`POST /api/dashboard/diary/scenario-answers`**; health/database. Telemetry keys include **`twin_prediction`**, **`twin_pattern_summary`**, **`twin_contradictions`**, **`diary_scenario_answers`**, plus earlier DEE-95f keys. **`app/dashboard/page.tsx`** hydrate uses **`loadDashboardPageDataForUser`** (no `getDb()` on that SSR path).

Prioritization for further waves: migration tracker / Linear; auth and OAuth remain **explicitly deferred** unless escalated.

---

## 20. Remaining architectural debt

- **Partial runtime coverage:** Twin Engine, standalone **Twin reasoning** routes (`twin/prediction`, `twin/pattern-summary`, `twin/contradictions`), prediction verification / verifications, repeatability, health/database, **twin-dialogue turn + turns**, **`GET /api/dashboard/readiness`**, **`GET`/`POST` diary **`entries`** and **`scenario-answers`**, and **dashboard `page.tsx` hydrate** (`loadDashboardPageDataForUser`) use **`getWaiaRuntimeDb`** / **`resolveTwinPersistence`** at their HTTP or SSR boundaries. Auth, OAuth helpers, and other **`getDb()`** routes (see tracker inventory) remain SQLite-singleton assumptions until migrated.
- **No `runWaiaTransaction`:** By design (DEE-64); SQLite + Postgres transaction helpers remain separate.
- **No backend-neutral repositories:** `SqliteTwinPersistence` / `PostgresTwinPersistence` via `resolveTwinPersistence` — intentional.
- **Naming / orchestration debt:** “`runTwinEngineAsync`” as a future umbrella rename remains deferred; facade is `runTwinEngineForRuntimeAsync`.

---

## 21. Deferred items

- **pgvector** and advanced retrieval — deferred per DEE-92 / tracker.
- **Backend-neutral repositories** — rejected pattern.
- **Broad diary/dialogue runtime alignment** — separate slices after 95e telemetry.
- **DEE-64 D6+ evolution** — `runWaiaTransaction` policy if ever introduced — explicitly **not** part of 95e.

---

## 22. Success criteria for declaring Postgres production-ready

Engineering and ops **jointly** record sign-off when:

1. Telemetry and alerting meet §4–§6.
2. Staging exercises and production validation checklist (§15) passed.
3. Rollback drill executed successfully.
4. Remaining **high-risk** routes (§19) are migrated **or** explicitly risk-accepted in writing for the promotion window.
5. No open **P0** defects on Postgres path for the slice.

---

## 23. Anti-patterns to avoid

- Silent SQLite fallback from Postgres errors without logging ([`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](./DEE-95-RUNTIME-ROUTING-STRATEGY.md) §19).
- `Promise.all` fan-out for verification + repeatability writes ([`DEE-95D-RUNTIME-ALIGNMENT-PLAN.md`](./DEE-95D-RUNTIME-ALIGNMENT-PLAN.md)).
- Backend-neutral “one DB” abstraction replacing typed persistence facades.
- Big-bang production flip without staging canary or observability.
- Logging raw user scenario content without approval.

---

## 24. Recommended execution sequencing after 95e

1. **Implementation slice (partial — DEE-95f):** Structured **stdout JSON** logging for Twin Engine, verification, verifications, repeatability, health/database + shared helper. **Still open:** metrics, sampling, correlation IDs, staging dashboards.
2. **Staging hardening:** Dashboards, alerts, health integration — **partial:** DEE-95g dashboard **spec** + staging **checklist**; **implementation** in log stack remains with ops.
3. **Route migration waves:** Dialogue / prediction / pattern / contradictions / diary — one slice per PR where possible.
4. **Expand integration CI:** Coherence chains and optional nightly Postgres job.
5. **Production canary:** Limited promotion → full promotion after §11 criteria.

Each step is a **separate PR** to `dev`; this planning doc does **not** implement them.

---

## 25. Explicit definition of what still keeps SQLite as default

- When **`WAIA_DB_BACKEND`** is **unset** or set to **`sqlite`**, [`getResolvedWaiaDbRuntimeConfig()`](../../db/runtime-backend.ts) returns `{ backend: "sqlite" }` and [`getWaiaRuntimeDb()`](../../db/waia-runtime-db.ts) returns `{ kind: "sqlite", db: getDb() }`.
- **No code change in this planning slice** alters that default; production deployments that **omit** Postgres env continue to behave as **SQLite-first** for all routes.
- **Postgres** is an **explicit** operator choice: set `WAIA_DB_BACKEND=postgres` and provide **`DATABASE_URL_POSTGRES`**.

---

## Document control

| Version | Slice | Notes |
|---------|--------|------|
| 1.0 | DEE-95e | Initial **operational readiness planning** (governance, telemetry expectations, rollout/rollback, inventory — **no** code changes). |
| 1.1 | DEE-95f | **Backend attribution telemetry:** stdout JSON from runtime-aware routes + helper; **no** broad Postgres rollout or `getDb()` migration. |
| 1.2 | DEE-95g | **Telemetry ops docs:** runbook, log-derived dashboard spec, staging checklist — **no** vendors, **no** in-app dashboards. |
| 1.3 | DEE-95h | Twin-dialogue **`turn` / `turns`** runtime wiring + telemetry route keys; inventory §19 / §20 alignment; dashboard SSR residual split-brain called out. |
| 1.4 | DEE-105 | Dashboard read-plane: readiness API + diary **`entries`** + **`page.tsx`** hydrate via runtime resolver; telemetry keys **`dashboard_readiness`**, **`diary_entries`**; **`scenario-answers`** still `getDb()`. |
| 1.6 | Twin cognition + scenario-answers runtime | **`twin/prediction`**, **`pattern-summary`**, **`contradictions`**, **`diary/scenario-answers`** — `getWaiaRuntimeDb` + telemetry keys **`twin_prediction`**, **`twin_pattern_summary`**, **`twin_contradictions`**, **`diary_scenario_answers`**; inventory §19 / §20 refresh. |
