# DEE-110 — Per-request Postgres lifecycle on Cloudflare Workers · validation record

**Type:** Audit / validation record (durable). **Does not** change application code or runtime configuration.

**Audience:** Future debugging sessions, on-call, anyone validating or rolling back DEE-110 stabilization.

**Purpose:** Capture the post-merge **preview / dev** smoke result for [`DEE-110`](../../db/postgres-client.ts) (per-request `postgres.js` lifecycle on Cloudflare Workers) and the operational context needed to promote `dev` → `main` safely.

**Scope:** Cloudflare **preview / dev** deployment only. Production (`main`, `waia.life`) was **not** validated by this record and **had not received** the DEE-110 stack at the time of writing.

---

## 1. Validated state snapshot

| Field | Value |
|------|-------|
| Validated commit (`dev` HEAD) | **`b68145155efcea63b68d3807a0ff1d8b392f2ba2`** |
| Preview deployment URL | **`https://ef2e6fc7-waia-app.oumaster369.workers.dev`** |
| Cloudflare build UUID | **`86e5b116-8e05-4074-a025-bf1f71deaa04`** |
| Build branch | `dev` |
| Build status | **success** |
| Build deploy command | `npx wrangler versions upload` |
| Worker name / id | `waia-app` / `01e9b57766c7442db95db2b4146e8aca` |
| Cloudflare account | `47b767650f53b4bcf0d6c89fc1a56c30` (Oumaster369) |
| Production worker hostname (untouched) | `waia.life` / `waia-app.oumaster369.workers.dev` |
| `main` HEAD at validation time | `b6dc30c6876a3d8f5fb0f3d986fc9126241b0d81` |
| Local `dev` ↔ `origin/dev` | clean, fully synced, no pending commits |
| Working tree | clean |

### Linked changes

- PR **#127** — `fix(dee-110): per-request postgres.js client on Workers` (`99121f7`).
- PR **#128** — `fix(dee-110): dispose Postgres runtime in auth sync and dashboard RSC` (`b681451`).
- Together: 24 files changed, **+636 / -145**, **no** changes to `wrangler.jsonc`, env, schema, or observability config.

---

## 2. Smoke methodology

Each phase uses **curl** with explicit `%{http_code}` and `%{time_total}` capture. Authenticated phases use a disposable identity (`dee110.smoke.<epoch>@example.com`, random `openssl rand -hex 16` password — never logged).

| Phase | Endpoint(s) | Volume | Notes |
|-------|------------|-------|-------|
| Sequential health | `GET /api/health/database` | 15 | 0.4s gap between probes |
| Concurrent burst | `GET /api/health/database` | 10 then 20 in parallel (`xargs -P10`, `-P20`) | + extra 20-probe status distribution |
| Auth (sign-up) | `POST /api/auth/sign-up` | 1 | Disposable identity, cookie jar |
| Authenticated API | `GET /api/dashboard/readiness`, `/api/dashboard/twin-dialogue/turns`, `/api/dashboard/diary/entries` | 3 | Session cookie |
| RSC | `GET /dashboard` | 1 | Validates `loadDashboardPageDataForUser` (PR #128) |
| Telemetry | Cloudflare Observability MCP | n/a | HTTP-level events; structured stdout (`waia_runtime_route`) not ingested because `wrangler.jsonc` has no `observability` block |

---

## 3. Raw probe summaries

### 3.1 Sequential health (15 / 15 success)

```text
probe 01..15: HTTP 200, body={"backend":"postgres","ok":true}
latency: 1.76s – 2.70s
```

### 3.2 Concurrent burst (40 / 40 success)

| Burst | Count | All 200 | Wall | Latency band |
|------|------|---------|------|--------------|
| `-P10` | 10 | ✓ | 3 s | 1.77 – 2.94 s |
| `-P20` | 20 | ✓ | 2 s | 1.75 – 2.40 s |
| Status distribution (`-P20` ×20) | 20 | `20× 200` | — | — |

### 3.3 Auth

| Step | HTTP | Latency | Body summary |
|------|------|---------|--------------|
| `POST /api/auth/sign-up` | **201** | 5.52 s | `{"ok":true,"redirect":"/dashboard"}` |

### 3.4 Authenticated APIs (post sign-up)

| Endpoint | HTTP | Latency | Body summary |
|---------|------|---------|--------------|
| `GET /api/dashboard/readiness` | **200** | 6.15 s | `readinessResult` with full indicator keys |
| `GET /api/dashboard/twin-dialogue/turns` | **200** | 5.99 s | `turnCount: 0`, `error: null` |
| `GET /api/dashboard/diary/entries` | **200** | 5.60 s | `entryCount: 0`, `error: null` |

### 3.5 Dashboard RSC

| Endpoint | HTTP | Latency | Body |
|---------|------|---------|------|
| `GET /dashboard` | **200** | 10.30 s | 25 313 bytes, `<title>Dashboard | WAIA</title>` |

### 3.6 Aggregate

| Phase | Probes | 200/201 | Other | Latency notes |
|------|-------|---------|-------|---------------|
| Sequential health | 15 | 15 | 0 | 1.76 – 2.70 s |
| Concurrent burst | 50 | 50 | 0 | 1.75 – 2.94 s, wall 2–3 s |
| Auth | 1 | 1 | 0 | 5.52 s |
| Authenticated APIs | 3 | 3 | 0 | 5.60 – 6.15 s |
| Dashboard RSC | 1 | 1 | 0 | 10.30 s |
| **Total** | **70** | **70** | **0** | — |

### 3.7 Cloudflare Observability (HTTP-level)

- Service: `waia-app`. Window: 2026-05-12 17:00 UTC → 2026-05-13 08:00 UTC (covers PR #127 + PR #128 deploys + all smoke probes).
- **Events with `status >= 500`: 0.**
- Structured `waia_runtime_route` lines (with `pg_client_lifecycle`, `pg_close_outcome`) **not** ingested — `wrangler.jsonc` has no `observability` block. Direct verification of those fields requires either `wrangler tail` or a future config change (out of scope).

---

## 4. Hypotheses conclusions

| ID | Hypothesis | Outcome | Evidence |
|----|------------|---------|---------|
| **H1** | Workers still hang / 1101 under concurrency | **REFUTED** | 70/70 success across sequential + 10-burst + 20-burst + auth + dashboard; 0 events ≥ 500 in 15h Observability window |
| **H2** | Lifecycle silently falls back to singleton | **INCONCLUSIVE (telemetry)**, **INDIRECTLY REFUTED** | No `observability` ingest, but pre-DEE-110 singleton produced systematic 1101s; their absence is strong indirect evidence the per-request path is active |
| **H3** | Bounded teardown frequently hits 200 ms budget | **INCONCLUSIVE (telemetry)**, **NOT USER-VISIBLE** | Same observability gap; HTTP tail latencies bounded and stable |
| **H4** | Dashboard RSC hangs (PR #128 dispose path) | **REFUTED** | `GET /dashboard` returned 200, 25 KB HTML, valid `<title>` |
| **H5** | Auth sync hangs (PR #128 `syncAppUserRowFromSupabaseAuth` dispose) | **REFUTED** | `POST /api/auth/sign-up` returned 201 in 5.5 s; all subsequent authenticated calls succeeded |

---

## 5. Rollout constraints

- **Do not** introduce Hyperdrive in this rollout.
- **Do not** modify Cloudflare env vars or secrets in this rollout.
- **Do not** add observability instrumentation in this rollout (separate hardening task).
- **Do not** perform opportunistic cleanup / refactors during promotion.
- **Do not** merge `dev → main` without explicit operator confirmation.
- Production rollout must consist of **only** the validated 2-commit DEE-110 stack (#127 + #128) plus any required mechanical merge commit.

---

## 6. Remaining operational risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Pooler-side transient overload independent of DEE-110 | Low | Single-client per request bounded by `max: 1`, `prepare: false`; retry policy unchanged. |
| RSC cold-start latency on preview (~10 s `GET /dashboard`) | Informational | Reflects transaction pooler RTT + isolate cold start; not a lifecycle regression. |
| No structured `waia_runtime_route` ingest on this account | Operational | `pg_client_lifecycle` / `pg_close_outcome` only inspectable via `wrangler tail` until a separate hardening task enables `observability` in `wrangler.jsonc`. |
| Production `main` does not yet contain DEE-110 stack | Known | Controlled promotion PR (separate task) is the remediation. |

---

## 7. Rollback semantics

### 7.1 Preferred: `git revert` of the promotion merge

The DEE-110 stack on `dev` consists of **two focused commits** (`99121f7`, `b681451`) and **no** env / schema / wrangler changes. Reverting the promotion merge on `main` is clean, traceable, and triggers a normal Cloudflare build.

```bash
# operator, with main checked out
git revert -m 1 <merge_sha>
git push origin main
```

Expected effect: Cloudflare automatically builds the reverted state; production returns to pre-DEE-110 code.

### 7.2 Secondary: env-flag rollback

The flag **`WAIA_POSTGRES_PER_REQUEST_CLIENT=false`** restores the legacy global singleton path (known unstable on Workers — documented as emergency-only).

The flag is **not** present in `wrangler.jsonc.vars` on either `dev` or `main`. To use it as a rollback, an operator must either:

1. Set it via the Cloudflare dashboard (out of scope for this rollout), or
2. Push a `wrangler.jsonc` PR adding it under `vars` (separate task).

**`git revert` is therefore the recommended emergency path** for this rollout.

---

## 8. Final verdict

**PASS** — DEE-110 stabilization holds on the preview / dev deployment. Eligible to **prepare** a controlled `dev → main` promotion PR.

This record does **not** authorize merge to `main`. Promotion remains a separate, explicitly confirmed operator step.

---

## 9. References

- Plan: [`.cursor/plans/dee-110_per-request_postgres_client_c251b7b4.plan.md`](/Users/legco/.cursor/plans/dee-110_per-request_postgres_client_c251b7b4.plan.md) (operator-side, not in repo).
- Telemetry contract: [`docs/migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md`](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md) (extended with `pg_client_lifecycle` / `pg_close_outcome`).
- Staging context: [`docs/ops/DEE-75-STAGING-CHECKLIST.md`](../ops/DEE-75-STAGING-CHECKLIST.md).
- Linear comment summarising this validation: [DEE-75 comment `42d88736-12b9-4e8c-9495-29a01c0cc635`](https://linear.app/deepsense/issue/DEE-75/42-deploy-staging-and-verify-platform).
