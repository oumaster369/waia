# DEE-95g — Log-derived dashboard specification

**Type:** Canonical metric and panel specification (**no implementation**). **Does not** add dashboards, vendors, or code.

**Purpose:** Define **what** operators and future tooling should compute from [`waia_runtime_route`](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md) stdout JSON so migration waves and Postgres canaries are comparable over time.

**Input assumption:** Log pipeline can filter and parse newline-delimited JSON with field names matching [`WaiaRuntimeRouteTelemetryPayload`](../../lib/observability/waia-runtime-route-telemetry.ts).

---

## Base filter

- Include rows where `event == "waia_runtime_route"`.
- Exclude CI/test streams if they pollute production dashboards (optional filter by environment label from your platform).

---

## Dimensions (group-by / breakdown)

| Dimension | Source field | Notes |
|-----------|--------------|--------|
| Route | `route` | Keys from [`WaiaRuntimeRouteKey`](../../lib/observability/waia-runtime-route-telemetry.ts) — e.g. `twin_engine`, `twin_prediction`, `twin_pattern_summary`, `twin_contradictions`, `twin_dialogue_turn`, `twin_dialogue_turns`, `dashboard_readiness`, `diary_entries`, `diary_scenario_answers`, `prediction_verification`, `prediction_verifications`, `repeatability`, `health_database` |
| Outcome | `outcome` | `success`, `client_error`, `config_error`, `internal_error` |
| Backend | `waia_db_backend` | May be **empty / null** in ingest when field omitted — bucket as `unknown` or `unspecified` |
| HTTP status | `http_status` | Useful for reconciling with edge/access logs |
| Error class | `error_class` | Sparse; only `Error.name` |

---

## Measures

| Measure | Definition |
|---------|------------|
| `request_count` | Count of lines matching filter in time window |
| `request_rate` | `request_count / window_minutes` (derive in query tool) |

**Latency (distribution):** Use numeric `duration_ms`. Report **p50, p95, p99** (or p90) per `route` and optionally per `waia_db_backend`. **Not** full user-facing latency — route handler block only.

---

## Proposed panels (specification only)

1. **Requests per route** — Time series: sum of `request_count` grouped by `route`.
2. **Outcome distribution** — Stacked bar or multi-series: share of each `outcome` (overall and faceted by `route`).
3. **Error rate by route** — `sum(outcome != "success") / request_count` (or exclude `client_error` if product treats it as expected — **ops decision**).
4. **`config_error` rate** — Count or ratio of `outcome == "config_error"`; alert candidate when env broken.
5. **`waia_db_backend` distribution** — Sanity after setting `WAIA_DB_BACKEND=postgres` in staging; expect `postgres` on instrumented routes.
6. **Latency percentiles** — p50/p95/p99 of `duration_ms` by `route` (and by `backend` during comparisons).
7. **Migration-wave comparison** — For a **baseline window** (pre-change) vs **post-deploy window** (same length): compare panels 1–6. Align windows by UTC and exclude deploy cutover minutes if noisy. **Not** automated inside WAIA — manual or external BI.

---

## Thresholds and alerting

**All numeric thresholds are TBD** with ops (SLOs differ by environment). This spec intentionally avoids hard-coded percentages until traffic baselines exist.

Recommended **starting heuristics** (tune per env):

- **Config error:** Any sustained non-zero `config_error` rate after a config change warrants immediate rollback review.
- **Internal error:** Spike relative to **7-day baseline** on the same `route` + `backend` cohort.

---

## Out of scope

- Traces, spans, OpenTelemetry.
- Live metric exporters inside the Node process.
- PII-enriched joins (telemetry has no user key).

---

## Related documents

- [`DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md`](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md) — field definitions and triage.
- [`DEE-95G-STAGING-CHECKLIST.md`](./DEE-95G-STAGING-CHECKLIST.md) — when to use this spec in staging.
- [`DEE-95E-OPERATIONAL-READINESS-PLAN.md`](./DEE-95E-OPERATIONAL-READINESS-PLAN.md) — program-level gates.

---

## Document control

| Version | Slice | Notes |
|---------|--------|------|
| 1.0 | DEE-95g | Initial derived-metrics spec for stdout telemetry. |
