# DEE-95g — Staging checklist (runtime telemetry + migration waves)

**Type:** Operational checklist (documentation only).

**Use before:** Expanding Postgres routing to additional routes or promoting runtime changes toward production.

**Companion:** [`DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md`](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md), [`DEE-95G-LOG-DASHBOARD-SPEC.md`](./DEE-95G-LOG-DASHBOARD-SPEC.md), [`DEE-95E-OPERATIONAL-READINESS-PLAN.md`](./DEE-95E-OPERATIONAL-READINESS-PLAN.md).

---

## A. Environment and config

- [ ] `WAIA_DB_BACKEND` and `DATABASE_URL_POSTGRES` match staging intent (sqlite vs postgres).
- [ ] Secrets match between app and Postgres instance (URL, TLS if required).
- [ ] `GET /api/health/database` returns `ok: true` and `backend` consistent with env.

## B. Telemetry presence (instrumented routes only)

- [ ] Exercise `POST /api/dashboard/twin/engine` (authenticated smoke) — **one** `waia_runtime_route` line with `route: "twin_engine"`.
- [ ] Exercise prediction verification POST and verifications GET — lines with `prediction_verification` / `prediction_verifications`.
- [ ] Exercise **`POST /api/dashboard/twin-dialogue/turn`** and **`GET /api/dashboard/twin-dialogue/turns`** (after **DEE-95h**) — lines with `twin_dialogue_turn` / `twin_dialogue_turns`.
- [ ] Health check produces `route: "health_database"`.
- [ ] Confirm **`waia_db_backend`** matches expected `sqlite` or `postgres`.

## C. Telemetry sanity

- [ ] Log pipeline shows newline JSON (not double-encoded).
- [ ] No expectation of `waia_runtime_route` on **`getDb()`-only** routes (diary, auth, standalone prediction APIs, dashboard RSC `getDb()` reads, etc.) until migrated.
- [ ] After **DEE-95h:** smoke `POST /api/dashboard/twin-dialogue/turn` and `GET /api/dashboard/twin-dialogue/turns` — each success emits `route: "twin_dialogue_turn"` / `"twin_dialogue_turns"` with expected `waia_db_backend`. (**Also listed in §B**.)
- [ ] CI noise understood — filter test workers if needed.

## D. Before a migration wave PR merges to staging

- [ ] Baseline capture: save rough counts or screenshots from log queries (optional but recommended).
- [ ] Smoke tests green: `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run` on the PR branch.
- [ ] Rollback path documented: unset postgres / set `sqlite` / revert deploy per [strategy](./DEE-95-RUNTIME-ROUTING-STRATEGY.md).

## E. During canary / soak

- [ ] Monitor outcome mix (`success` vs errors) — qualitatively first; formal SLOs per [dashboard spec](./DEE-95G-LOG-DASHBOARD-SPEC.md).
- [ ] Watch **`config_error`** — should stay near zero in steady state.
- [ ] Compare **`duration_ms` distributions** to baseline for regressions (handler-level).

## F. Rollback signals (stop and reassess)

- [ ] Sustained **`internal_error`** on `waia_db_backend: "postgres"` for primary routes.
- [ ] Burst **`config_error`** after config/deploy change.
- [ ] **`health_database`** failures or `ok: false` (if exposed) alongside user-facing errors.
- [ ] Ops decision: flip `WAIA_DB_BACKEND`, revert deploy, or fix forward — document in incident channel.

## G. Post-wave validation

- [ ] Re-run sections B–C on staging.
- [ ] Confirm new routes (if any) emit telemetry with correct `route` keys and backend attribution.

---

## Document control

| Version | Slice | Notes |
|---------|--------|------|
| 1.0 | DEE-95g | Initial staging checklist for stdout telemetry + waves. |
