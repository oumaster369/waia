# DEE-95g — Runtime route telemetry runbook

**Type:** Operator runbook (documentation only). **Does not** change application code, logging format, or env defaults.

**Audience:** On-call engineers, staging owners, and anyone triaging Twin dashboard + health paths during SQLite → Postgres migration waves.

**Prerequisites:** [`DEE-95f`](../../lib/observability/waia-runtime-route-telemetry.ts) is merged — structured **`waia_runtime_route`** events exist on runtime-aware routes only. [`DEE-95E-OPERATIONAL-READINESS-PLAN.md`](./DEE-95E-OPERATIONAL-READINESS-PLAN.md) remains the program-level rollout plan; this document narrows to **reading and acting on stdout telemetry**.

**Split-runtime context:** Routes not yet wired through **`getWaiaRuntimeDb()`** (auth, OAuth helpers, and other legacy `getDb()` surfaces per migration inventory) **do not** emit `waia_runtime_route`. **Twin cognition** (`twin_prediction`, `twin_pattern_summary`, `twin_contradictions`) and **`diary/scenario-answers`** are runtime-wired and emit. **`app/dashboard/page.tsx`** RSC hydrate uses runtime persistence **without** emitting **`waia_runtime_route`** (instrumentation is HTTP-route-only today).

---

## Where logs appear

- The app emits **one JSON object per line** via `console.info` (stdout).
- In production/staging, your platform (Cloudflare, container runtime, etc.) **collects stdout** into a log stream. WAIA does not ship a log agent.
- **Tests** (`pnpm exec vitest run`) also print these lines when route handlers run — filter them out when analyzing staging/production.

---

## Event structure

All emitted objects use `event: "waia_runtime_route"` (stable filter key).

| Field | Type | Meaning |
|-------|------|--------|
| `event` | string | Always `waia_runtime_route` |
| `route` | string | Route key (see mapping table below) |
| `waia_db_backend` | `"sqlite"` \| `"postgres"` | Present when [`getWaiaRuntimeDb`](../../db/waia-runtime-db.ts) returned a handle before the request finished or threw in the instrumented block |
| `http_status` | number | Intended HTTP status for the client response when known (often matches log); **500** is typical for logged `config_error` / `internal_error` even when some handlers **rethrow** and the edge formats the body |
| `outcome` | string | See [Outcome semantics](#outcome-semantics) |
| `duration_ms` | number | Wall time (ms) for the instrumented `try` block at the route layer — **not** full edge RTT |
| `error_class` | string (optional) | **`Error.prototype.name` only** — never stack or message text |
| `ai_gateway_foundation` | string (optional) | **`twin_dialogue_turn` only** (DEE-77 / DEE-78). `off` — legacy inline stub path; `fake_stub` — gateway foundation path using fake provider or stub fallback; `live` — OpenAI-compatible adapter returned model text (no user/content fields). |
| `ai_gateway_provider` | string (optional) | **`twin_dialogue_turn` only** when foundation ≠ `off`. `fake` \| `openai-compatible` — which completion backend was selected (content-free). |
| `ai_gateway_provider_outcome` | string (optional) | **`twin_dialogue_turn` only** when foundation ≠ `off`. See [Twin dialogue provider outcome](#twin-dialogue-provider-outcome-d78). |
| `ai_gateway_provider_phase_ms` | number (optional) | **`twin_dialogue_turn` only** when foundation ≠ `off`. Wall time for the provider `complete` call. |
| `ai_gateway_degraded` | boolean (optional) | **`twin_dialogue_turn` only**. `true` when assistant text fell back to the product stub after a provider failure (still HTTP 200). |

### Twin dialogue provider outcome (DEE-78)

When `route === "twin_dialogue_turn"` and AI Gateway foundation is enabled (`ai_gateway_foundation` ≠ `off`), `ai_gateway_provider_outcome` is content-free and reflects the **completion phase** (never raw messages):

| Value | Meaning |
|-------|--------|
| `ok` | Provider returned acceptable assistant text. |
| `config` | Misconfiguration (e.g. missing **`WAIA_AI_OPENAI_API_KEY`** when **`WAIA_AI_PROVIDER=openai-compatible`**). |
| `rate_limit` | HTTP **429** from provider. |
| `timeout` | Request aborted due to **`WAIA_AI_OPENAI_REQUEST_TIMEOUT_MS`** (or equivalent timeout path). |
| `provider_error` | Parse / HTTP / network-class failure from the adapter (including client **`AbortSignal`** on the fake provider path). |

When the handler still returns HTTP **200** but assistant text fell back to the product stub after a provider failure, **`ai_gateway_degraded: true`** is set alongside the outcome above (the outcome stays **`config`** / **`provider_error`** / etc., not a separate `"degraded"` enum value).

### Route key ↔ HTTP path

| `route` | HTTP |
|---------|------|
| `twin_engine` | `POST /api/dashboard/twin/engine` |
| `twin_prediction` | `POST /api/dashboard/twin/prediction` |
| `twin_pattern_summary` | `GET /api/dashboard/twin/pattern-summary` |
| `twin_contradictions` | `POST /api/dashboard/twin/contradictions` |
| `twin_dialogue_turn` | `POST /api/dashboard/twin-dialogue/turn` |
| `twin_dialogue_turns` | `GET /api/dashboard/twin-dialogue/turns` |
| `dashboard_readiness` | `GET /api/dashboard/readiness` |
| `diary_entries` | `GET` / `POST /api/dashboard/diary/entries` |
| `diary_scenario_answers` | `GET` / `POST /api/dashboard/diary/scenario-answers` |
| `prediction_verification` | `POST /api/dashboard/twin/prediction/verification` |
| `prediction_verifications` | `GET /api/dashboard/twin/prediction/verifications` |
| `repeatability` | `GET /api/dashboard/twin/repeatability` |
| `health_database` | `GET /api/health/database` |

**Source of truth for `waia_db_backend`:** [`WaiaRuntimeDb.kind`](../../db/waia-runtime-db.ts) after successful `await getWaiaRuntimeDb()` — not a second env read.

---

## Outcome semantics

| `outcome` | Typical meaning |
|-----------|-----------------|
| `success` | `http_status` 2xx; handler completed without throwing |
| `client_error` | **Twin Engine only today:** handled validation / domain client error (e.g. scenario too long) with **4xx** response. Other instrumented routes return 4xx **before** `getWaiaRuntimeDb()` when possible — **no** `waia_runtime_route` line for those early exits |
| `config_error` | `getWaiaRuntimeDb()` failed **before** a handle was assigned, and the thrown error is classified as WAIA misconfiguration: `instanceof Error` and `message` starts with `[waia]` (see [`isWaiaConfigError`](../../lib/observability/waia-runtime-route-telemetry.ts)) |
| `internal_error` | Unhandled throw after handle resolved, or runtime failure not classified as `config_error`, or generic 500 path |

**HTTP vs log (Twin Engine):** For some misconfig paths the log may show `config_error` while the API still returns **500** with a generic `INTERNAL_ERROR` envelope — use logs for **triage**, HTTP for **client contract**.

**Rethrow routes:** `prediction_verification`, `prediction_verifications`, `repeatability`, `health_database` log `internal_error` / `config_error` with `http_status: 500`, then **rethrow** — the framework may format the final HTTP response. Treat the log line as the **authoritative structured signal** for that failure.

**JSON 500 routes (no rethrow):** `twin_engine`, `twin_dialogue_turn`, `twin_dialogue_turns`, **`dashboard_readiness`**, **`diary_entries`**, **`twin_prediction`**, **`twin_pattern_summary`**, **`twin_contradictions`**, **`diary_scenario_answers`** emit telemetry then return a generic **`INTERNAL_ERROR`** JSON envelope — HTTP status matches the log’s `http_status`.

---

## Example emitted lines

Success (SQLite):

```json
{"event":"waia_runtime_route","route":"twin_engine","waia_db_backend":"sqlite","http_status":200,"outcome":"success","duration_ms":42}
```

Client error (engine — scenario length):

```json
{"event":"waia_runtime_route","route":"twin_engine","waia_db_backend":"sqlite","http_status":400,"outcome":"client_error","duration_ms":1,"error_class":"TwinEngineScenarioTooLongError"}
```

Config-style failure logged before handle (pattern; exact `error_class` depends on throw):

```json
{"event":"waia_runtime_route","route":"twin_engine","http_status":500,"outcome":"config_error","duration_ms":0,"error_class":"Error"}
```

Internal error after backend resolved:

```json
{"event":"waia_runtime_route","route":"health_database","waia_db_backend":"postgres","http_status":500,"outcome":"internal_error","duration_ms":3,"error_class":"SomeDbErrorName"}
```

---

## Staging expectations

- **`WAIA_DB_BACKEND` unset or `sqlite`:** Expect `waia_db_backend: "sqlite"` on instrumented routes under normal operation.
- **Staging Postgres:** Set `WAIA_DB_BACKEND=postgres` and valid `DATABASE_URL_POSTGRES`; expect `waia_db_backend: "postgres"` on the **same** routes. Other APIs may still hit SQLite via `getDb()` — **split brain** until those routes are migrated (**e.g.** auth, **`diary/scenario-answers`**, standalone reasoning APIs).
- **Health:** `GET /api/health/database` returns `{ backend, ok }` in JSON; telemetry should **agree** with `backend` on success paths.

---

## Triage guide

| Signal | Likely cause |
|--------|----------------|
| Burst of `config_error` | Invalid env (`WAIA_DB_BACKEND`, missing `DATABASE_URL_POSTGRES`, typos) — see [`runtime-backend.ts`](../../db/runtime-backend.ts) |
| `internal_error` + `waia_db_backend: "postgres"` | DB connectivity, Drizzle/query, or app bug on Postgres path |
| `internal_error` + no `waia_db_backend` | Failure during `getWaiaRuntimeDb()` not matching `[waia]` prefix, or edge case — inspect platform stack traces |
| No lines for a traffic spike | Wrong log filter, stdout not shipped, or traffic only hitting **uninstrumented** routes |
| High `client_error` on `twin_engine` | Legit bad input volume or abuse — compare to product metrics |

---

## Known limitations and caveats

- **No** user id, session id, request id, or correlation id in the payload.
- **No** logging of scenario text, corrections, or query strings.
- Early **401** and **400** returns that happen **before** `getWaiaRuntimeDb()` produce **no** `waia_runtime_route` line.
- `duration_ms` is route-handler-local; load balancer / worker overhead is excluded.
- Percentiles and error budgets require **external** aggregation — WAIA does not compute them in-process (see [`DEE-95G-LOG-DASHBOARD-SPEC.md`](./DEE-95G-LOG-DASHBOARD-SPEC.md)).

---

## stdout-only architecture

WAIA intentionally keeps telemetry **vendor-neutral**: one JSON line per event. Any future SaaS or self-hosted pipeline should **tail or ship stdout** (or the platform’s forwarder of it) and parse JSON. No WAIA-side SDK is required for migration safety.

### Future vendor integration (placeholder)

- Filter: `event == "waia_runtime_route"`.
- Field names in this runbook are **stable contracts** for ingest mapping — changes should be versioned in migration docs.
- Sampling, retention, and alert thresholds are **ops decisions**, not defined here.

---

## Related documents

- [`DEE-95E-OPERATIONAL-READINESS-PLAN.md`](./DEE-95E-OPERATIONAL-READINESS-PLAN.md) — rollout gates, inventory, anti-patterns.
- [`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](./DEE-95-RUNTIME-ROUTING-STRATEGY.md) — kill-switch, env, sequencing.
- [`DEE-95G-LOG-DASHBOARD-SPEC.md`](./DEE-95G-LOG-DASHBOARD-SPEC.md) — derived metrics spec.
- [`DEE-95G-STAGING-CHECKLIST.md`](./DEE-95G-STAGING-CHECKLIST.md) — pre-flight checks before route waves.

---

## Document control

| Version | Slice | Notes |
|---------|--------|------|
| 1.0 | DEE-95g | Initial runbook for stdout `waia_runtime_route` telemetry. |
| 1.1 | DEE-95h | Route keys `twin_dialogue_turn`, `twin_dialogue_turns`; clarify JSON-500 vs rethrow handlers; split-runtime note reflects twin-dialogue HTTP migrated. |
| 1.2 | DEE-105 | Route keys **`dashboard_readiness`**, **`diary_entries`**; JSON-500 list extended; split-runtime note — dashboard RSC hydrate is runtime-aligned but **not** stdout-instrumented. **Merged:** GitHub **PR #104** → **`dev`** **`fef1e83`**. |
| 1.3 | DEE-78 | Optional **`ai_gateway_*`** fields on **`twin_dialogue_turn`** (`ai_gateway_foundation`, provider id/outcome, phase ms, degraded flag); provider outcome taxonomy ([Twin dialogue provider outcome (DEE-78)](#twin-dialogue-provider-outcome-dee-78)). |
