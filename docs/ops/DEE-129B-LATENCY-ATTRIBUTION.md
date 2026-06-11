# DEE-129b — Production Twin dialogue turn latency attribution

**Linear:** [DEE-150](https://linear.app/deepsense/issue/DEE-150/dee-129b-attribute-production-twin-dialogue-turn-latency) (child of [DEE-129](https://linear.app/deepsense/issue/DEE-129/partner-preview-hardening-and-runtime-performance-stabilization-parent))  
**Audit date:** 2026-06-11  
**Production origin:** `https://waia.life` · Worker `waia-app` · version `08166d50-033e-41df-a455-9e69f57f569a` (deployed 2026-05-16)  
**Method:** Live `wrangler tail` + authenticated `POST /api/dashboard/twin-dialogue/turn` probes. No prompt/model/config changes.

**Prerequisite:** [DEE-129A production branch state](DEE-129A-PRODUCTION-BRANCH-STATE.md).

---

## Executive summary

Partner preview cites **~10s Twin dialogue turn latency**. Production evidence from **2026-06-11** shows authenticated Twin turns completing in **~2.4–4.6s route-handler wall time** (`duration_ms`), with **~64–78%** of that time in the **OpenAI-compatible provider phase** (`ai_gateway_provider_phase_ms`). The remaining **~0.9–1.0s** per turn is non-provider handler work (Postgres persistence, continuity replay SQL, JSON assembly) on the **`postgres` + `per_request`** path.

**Primary attribution:** latency is **provider-bound**, not database-backend misconfiguration. Production is on **live AI Gateway** (`ai_gateway_foundation: live`, `openai-compatible`, `provider_outcome: ok`).

**Caveat:** `duration_ms` is **route-handler-local** and excludes edge RTT, browser rendering, and dashboard RSC hydrate ([DEE-95G runbook](../migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md)). Measured **curl client wall times** (~3.4–5.7s) are closer to partner perception than `duration_ms` alone but still below ~10s — the gap to ~10s may include **UI/network/cold-start** factors called out below.

**No code changes required** for telemetry — `waia_runtime_route` on `twin_dialogue_turn` is present and complete on the deployed Worker.

---

## Production context

| Field | Value |
|-------|--------|
| Worker | `waia-app` |
| Active version | `08166d50-033e-41df-a455-9e69f57f569a` |
| `WAIA_DB_BACKEND` (committed vars) | `postgres` |
| AI Gateway | `WAIA_AI_GATEWAY_FOUNDATION=1`, `WAIA_AI_PROVIDER=openai-compatible`, model `gpt-5.5` |
| Dialogue continuity | `WAIA_TWIN_DIALOGUE_CONTINUITY=replay_v1` |
| Code lag vs `dev` | ~224 commits behind integration tip per DEE-129A |

---

## Methodology

1. Confirmed Wrangler auth (`pnpm exec wrangler whoami`) and live log pipeline via `wrangler tail waia-app --format json`.
2. Created a **dedicated probe account** (email redacted; test-only) via `POST /api/auth/sign-up`.
3. Issued **three** substantive Twin dialogue turns via `POST /api/dashboard/twin-dialogue/turn` while tailing logs filtered with `--search twin_dialogue_turn`.
4. Redacted: user message text in samples below is **structure-only**; vendor `request_id` prefixes truncated.

**Reproduction commands (operator):**

```bash
# Terminal A — live telemetry capture
pnpm exec wrangler tail waia-app --format json --search twin_dialogue_turn

# Terminal B — after authenticated session (cookie jar from sign-up or browser)
curl -sS -b /tmp/waia-session.txt -H 'Content-Type: application/json' \
  -d '{"message":"<substantive test message>"}' \
  https://waia.life/api/dashboard/twin-dialogue/turn
```

**Cloudflare Observability note:** Query for `$metadata.trigger` including `twin-dialogue` returned **0 requests** over May–June 2026 before this probe — partner traffic may be sparse or UI-path dominated. Historical search for `$metadata.message` including `twin_dialogue_turn` also returned empty; **live tail** is the reliable capture path used here.

---

## Sample events (production, redacted)

### Sample A — first turn (no continuity replay)

```json
{
  "event": "waia_runtime_route",
  "route": "twin_dialogue_turn",
  "waia_db_backend": "postgres",
  "http_status": 200,
  "outcome": "success",
  "duration_ms": 4637,
  "ai_gateway_foundation": "live",
  "ai_gateway_provider": "openai-compatible",
  "ai_gateway_provider_outcome": "ok",
  "ai_gateway_provider_phase_ms": 3598,
  "ai_gateway_provider_prompt_tokens": 1870,
  "ai_gateway_provider_completion_tokens": 68,
  "ai_gateway_provider_total_tokens": 1938,
  "ai_gateway_provider_request_id": "chatcmpl-DpXYi…[redacted]",
  "dialogue_continuity_mode": "replay_v1",
  "dialogue_continuity_replay_roles_injected": 0,
  "pg_client_lifecycle": "per_request"
}
```

| Metric | Value |
|--------|-------|
| Client wall (curl) | **5.72s** |
| Worker `wallTime` (tail) | **5162ms** |
| Provider share | **3598 / 4637 = 77.6%** |
| Non-provider handler | **1039ms (22.4%)** |

### Sample B — second turn (2 replay roles)

```json
{
  "event": "waia_runtime_route",
  "route": "twin_dialogue_turn",
  "waia_db_backend": "postgres",
  "http_status": 200,
  "outcome": "success",
  "duration_ms": 3799,
  "ai_gateway_foundation": "live",
  "ai_gateway_provider": "openai-compatible",
  "ai_gateway_provider_outcome": "ok",
  "ai_gateway_provider_phase_ms": 2913,
  "ai_gateway_provider_prompt_tokens": 1948,
  "ai_gateway_provider_completion_tokens": 62,
  "ai_gateway_provider_total_tokens": 2010,
  "ai_gateway_provider_request_id": "chatcmpl-DpXYq…[redacted]",
  "dialogue_continuity_mode": "replay_v1",
  "dialogue_continuity_replay_roles_injected": 2,
  "dialogue_continuity_replay_chars": 214,
  "pg_client_lifecycle": "per_request"
}
```

| Metric | Value |
|--------|-------|
| Client wall (curl) | **4.61s** |
| Worker `wallTime` | **4247ms** |
| Provider share | **2913 / 3799 = 76.7%** |
| Non-provider handler | **886ms (23.3%)** |

### Sample C — third turn (4 replay roles)

```json
{
  "event": "waia_runtime_route",
  "route": "twin_dialogue_turn",
  "waia_db_backend": "postgres",
  "http_status": 200,
  "outcome": "success",
  "duration_ms": 2448,
  "ai_gateway_foundation": "live",
  "ai_gateway_provider": "openai-compatible",
  "ai_gateway_provider_outcome": "ok",
  "ai_gateway_provider_phase_ms": 1563,
  "ai_gateway_provider_prompt_tokens": 1991,
  "ai_gateway_provider_completion_tokens": 16,
  "ai_gateway_provider_total_tokens": 2007,
  "ai_gateway_provider_request_id": "chatcmpl-DpXYx…[redacted]",
  "dialogue_continuity_mode": "replay_v1",
  "dialogue_continuity_replay_roles_injected": 4,
  "dialogue_continuity_replay_chars": 394,
  "pg_client_lifecycle": "per_request"
}
```

| Metric | Value |
|--------|-------|
| Client wall (curl) | **3.38s** |
| Worker `wallTime` | **2922ms** |
| Provider share | **1563 / 2448 = 63.8%** |
| Non-provider handler | **885ms (36.2%)** |

### Aggregate (n=3)

| Field | Min | Median | Max |
|-------|-----|--------|-----|
| `duration_ms` | 2448 | 3799 | 4637 |
| `ai_gateway_provider_phase_ms` | 1563 | 2913 | 3598 |
| Non-provider (`duration_ms − phase`) | 885 | 886 | 1039 |
| Client curl wall | 3.38s | 4.61s | 5.72s |

---

## Attribution findings

### 1. Route wall time vs provider phase

On all three samples, **`ai_gateway_provider_phase_ms` dominates `duration_ms`** (64–78%). The handler measures provider phase as wall time around `provider.complete()` in [`lib/ai-gateway/twin-dialogue-completion-gateway.ts`](../../lib/ai-gateway/twin-dialogue-completion-gateway.ts); total route time starts at `getWaiaRuntimeDb()` through persistence ([`app/api/dashboard/twin-dialogue/turn/route.ts`](../../app/api/dashboard/twin-dialogue/turn/route.ts)).

### 2. Database backend

All samples show **`waia_db_backend: postgres`** and **`pg_client_lifecycle: per_request`**. Non-provider time (~0.9–1.0s) includes continuity tail read, twin seed/exchange persistence, and teardown — **not** indicative of Postgres misconfiguration (contrast: production `health_database` `duration_ms` ~169–219ms on same Worker during this audit).

### 3. Continuity replay

Later turns inject more replay roles/chars; **provider phase dropped** on sample C (shorter completion) while non-provider time stayed ~885ms — replay adds prompt tokens but is **not** the primary latency driver in these samples.

### 4. Partner ~10s vs measured ~3–6s

| Layer | In telemetry? | Observation |
|-------|---------------|-------------|
| OpenAI-compatible completion | **Yes** (`ai_gateway_provider_phase_ms`) | **Primary cost** |
| Postgres + handler | **Partially** (`duration_ms − phase`) | **Secondary (~1s)** |
| Edge / TLS / geographic RTT | **No** | curl vs `duration_ms` delta ~0.5–1.1s |
| Dashboard UI / fetch / JSON parse | **No** | Browser path not instrumented |
| Initial page / RSC hydrate | **No** (explicitly out of scope) | May explain partner “page load ~10s” confusion |

---

## Explicit gaps and follow-up owners

| Gap | Owner | Recommended follow-up |
|-----|-------|------------------------|
| Edge RTT + browser fetch not in `waia_runtime_route` | **infra** | Optional RUM or `Server-Timing` header spike — **new issue** |
| Dashboard RSC hydrate not instrumented | **backend** | Already documented in DEE-95G; no change in DEE-150 |
| `pg_close_outcome` omitted when deferred via `waitUntil` | **backend** | Observability polish — low priority |
| Sparse historical twin-dialogue traffic in Observability API | **infra** | Confirm log retention / query filters; use `wrangler tail` for investigations |
| Partner ~10s may blend page load + turn | **product** | Clarify measurement protocol with partners; link [DEE-151](https://linear.app/deepsense/issue/DEE-151) streaming posture |
| Provider latency optimization (model, tokens, streaming) | **ai** / **backend** | **Separate issue** after this attribution — **not** DEE-150 scope |

---

## Instrumentation assessment

**No telemetry gap proven.** Production emits full DEE-78/DEE-79 fields on `twin_dialogue_turn` for live OpenAI-compatible path. **No code PR required** for DEE-150.

---

## Conclusion (DEE-150 acceptance)

- [x] Summary distinguishes `duration_ms` vs `ai_gateway_provider_phase_ms` vs `waia_db_backend`
- [x] ≥3 production sample events cited (redacted)
- [x] Gaps listed with follow-up owners
- [x] No prompt/model changes
- [x] No code added

**Recommended next Linear work:** provider-phase latency reduction or streaming UX (see follow-up table) — **not** part of this issue.

---

## References

- [DEE-95G Runtime telemetry runbook](../migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md)
- [DEE-129A Production branch state](DEE-129A-PRODUCTION-BRANCH-STATE.md)
- [`lib/observability/waia-runtime-route-telemetry.ts`](../../lib/observability/waia-runtime-route-telemetry.ts)

---

## Document control

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 2026-06-11 | Initial DEE-150 attribution — production probes + wrangler tail |
