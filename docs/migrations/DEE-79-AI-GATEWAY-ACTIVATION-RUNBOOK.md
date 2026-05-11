# DEE-79 — AI Gateway staging activation runbook

**Type:** Operator runbook (documentation only). **Does not** change application defaults, env allowlists, or production posture.

**Audience:** Architect / staging owners validating **first controlled outbound inference** for Twin dialogue.

**Prerequisites:** DEE-77 / DEE-78 merged; this document assumes familiarity with [`DEE-76-AI-GATEWAY-ARCHITECTURE.md`](../architecture/DEE-76-AI-GATEWAY-ARCHITECTURE.md) and [`DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md`](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md).

---

## 1. Scope

- **In scope:** A **single staging environment** where operators deliberately enable OpenAI-compatible completion for **`POST /api/dashboard/twin-dialogue/turn`** only, observe **stdout `waia_runtime_route`** telemetry, then disable egress again.
- **Out of scope:** Production activation (requires a **separate** Architect sign-off and change record). CI live integration tests, retries, streaming, tool calls, retrieval, new routes, and AI-gateway DB tables (DEE-107).

---

## 2. Pre-flight

1. **Environment identity:** Confirm the deployment is **not** production (origin / hostname / internal naming). `NEXT_PUBLIC_SITE_URL` should reflect the staging origin you intend.
2. **Secrets:** `WAIA_AI_OPENAI_API_KEY` is **server-only** — never commit, never paste into Linear/GitHub. Rotate if exposed. See [`.env.example`](../../.env.example) for the full `WAIA_AI_*` key set.
3. **Two-key gate (unchanged defaults):**
   - `WAIA_AI_GATEWAY_FOUNDATION` — truthy allowlist token (`1`, `true`, `yes`, `on`).
   - `WAIA_AI_PROVIDER=openai-compatible` — required for network egress; any other value (including unset) resolves to **fake** (no network).
4. **Optional tuning:** `WAIA_AI_OPENAI_BASE_URL`, `WAIA_AI_OPENAI_MODEL`, `WAIA_AI_OPENAI_REQUEST_TIMEOUT_MS` — documented in `.env.example`.
5. **Runtime DB:** Staging SQLite vs Postgres policy is orthogonal — follow [`DEE-95G-STAGING-CHECKLIST.md`](./DEE-95G-STAGING-CHECKLIST.md) for `waia_db_backend` expectations.

---

## 3. Smoke procedure

1. Sign in as a **test user account** created for this validation — **not** the Architect’s primary Twin unless intentionally accepted (see §7–§8).
2. Issue **one** authenticated `POST /api/dashboard/twin-dialogue/turn` with a short benign message (e.g. `"staging inference smoke"`).
3. Expect **HTTP 200** and JSON consistent with existing Twin dialogue contracts (`assistantTurn.content` reflects provider output when live path succeeds; degraded responses keep stub assistant text — unchanged product semantics).

---

## 4. Observation window (stdout)

Locate the **`waia_runtime_route`** line for `route: "twin_dialogue_turn"`.

**Live-path success signals:**

| Field | Expected |
|-------|-----------|
| `ai_gateway_foundation` | `"live"` |
| `ai_gateway_provider` | `"openai-compatible"` |
| `ai_gateway_provider_outcome` | `"ok"` |
| `ai_gateway_provider_phase_ms` | Non-negative wall time for provider phase |
| `ai_gateway_provider_prompt_tokens` | Number when vendor returned usage |
| `ai_gateway_provider_completion_tokens` | Number when vendor returned usage |
| `ai_gateway_provider_total_tokens` | Number when vendor returned usage |
| `ai_gateway_provider_request_id` | Vendor correlation id when returned |

**Degraded success (HTTP 200, stub assistant text):** `ai_gateway_degraded: true` plus `ai_gateway_provider_outcome` reflecting failure class (`config`, `rate_limit`, `timeout`, `provider_error`).

Full field taxonomy: [`DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md`](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md).

---

## 5. Kill-switch (rollback)

**Operational rollback (no deploy):**

1. Remove **`WAIA_AI_PROVIDER=openai-compatible`** or set **`WAIA_AI_PROVIDER`** to any value other than `openai-compatible` (unknown values collapse to fake).
2. Optionally unset **`WAIA_AI_GATEWAY_FOUNDATION`** to revert entirely to the legacy inline stub path (pre-DEE-77 semantics).

**Verify:** Repeat §3 smoke; telemetry should show `ai_gateway_foundation: "off"` **or** `fake_stub` with `ai_gateway_provider: "fake"` and **no** new egress.

---

## 6. Failure-class triage

| `ai_gateway_provider_outcome` | Typical meaning | Operator action |
|-------------------------------|-----------------|-----------------|
| `config` | Missing/invalid API key or vendor auth (`401`/`403`) | Fix secrets / base URL; recheck deployment env injection |
| `rate_limit` | HTTP **429** | Back off; reduce test frequency; vendor quota |
| `timeout` | Local deadline exceeded | Increase timeout cautiously or investigate vendor latency |
| `provider_error` | Parse / transport / empty response / client abort | Inspect vendor status; retry manually later (**no auto-retry** in WAIA) |

---

## 7. Privacy acknowledgement (mandatory before first flip)

Enabling **`openai-compatible`** sends the **current user message text** (single turn) to the external provider inside the bounded prompt envelope defined in [`lib/ai-gateway/twin-dialogue-completion-gateway.ts`](../../lib/ai-gateway/twin-dialogue-completion-gateway.ts). **No** prior dialogue turns, diary content, or Twin-engine artifacts are included in this slice.

Stdout telemetry remains **content-free** — see [DEE-76 §10–§11](../architecture/DEE-76-AI-GATEWAY-ARCHITECTURE.md).

---

## 8. Hallucination & persistence acknowledgement

Assistant text returned on success is **persisted** through existing Twin dialogue persistence and participates in **`hasMeaningfulExchange`** / user-turn counting. Treat first activations as **data-plane writes**: use disposable test accounts when validating vendor behavior.

---

## 9. Sign-off block

```
Environment name:
Architect / operator:
Timestamp (UTC):
WAIA commit SHA deployed:
Smoke outcome (live / degraded / aborted):
Kill-switch drill performed (y/n):
Notes:
```

---

## Document control

| Version | Slice | Notes |
|---------|--------|------|
| 1.0 | DEE-79 | Initial staging activation runbook (docs only). |
