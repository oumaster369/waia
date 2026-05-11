# DEE-76 — AI Gateway architecture (bounded planning slice)

**Type:** Architecture + documentation only (T1 planning). **Does not** implement SDK calls, new HTTP routes, dependencies, database tables, autonomous loops, or agent-memory systems.

**Linear:** [DEE-76](https://linear.app/deepsense/issue/DEE-76/51-define-ai-gateway-architecture) — `ai` execution label.

**Purpose:** Specify provider-facing boundaries so subsequent implementation issues can wire AI-Twin Twin dialogue to an external model **without** reopening core separation-of-concerns decisions—while preserving MVP-first evolution, rollback culture, provider replaceability, auditability, and operational parity with existing runtime doctrine (`getWaiaRuntimeDb`, stdout telemetry, staged Postgres).

---

## 1. Alignment (operational resynchronization)

This slice assumes and preserves:

| Source | What matters for the gateway |
|--------|------------------------------|
| [`AGENTS.md`](../../AGENTS.md) | `dee-*` branches, validation canon, single execution label per issue, **AI label owns** prompts / inference contracts—not UI or raw route ergonomics alone. |
| [`WAIA-DEV-OS.md`](../waia-governance/WAIA-DEV-OS.md) | Auditable increments, human merge authority, migration memory discipline. |
| [`EXECUTION-CONTRACT.md`](../waia-governance/EXECUTION-CONTRACT.md) | Architect gates for vendors/infra scope; **STOP** on semantic ambiguity between product specs and code. |
| [`DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) | Split-runtime honesty—gateway **must not** invent neutral DB transaction bridges or silent SQLite↔Postgres reconciliation. |
| [`DEE-95E-OPERATIONAL-READINESS-PLAN.md`](../migrations/DEE-95E-OPERATIONAL-READINESS-PLAN.md) | Structured telemetry, **no raw user text in logs** without explicit approval, kill-switch = **config + deploy** not silent in-process fallback. |
| [`CORE-PRINCIPLES.md`](../waia-governance/CORE-PRINCIPLES.md) | Reversible incrementalism, trust/audit trail, product canon wins. |
| [`CONSTITUTIONAL-DOCTRINE.md`](../waia-governance/CONSTITUTIONAL-DOCTRINE.md) | Event-triggered product semantics; **human meaning primacy**; WAIA DEV OS is not the product—gateway serves AI-Twin v1 dialogue only within approved scope. |

**Audit conclusion encoded here:** The dominant MVP gap after runtime migration work is **dialogue-side model integration**; persistence and Twin reasoning stacks already exist. The gateway is the **narrow seam** between “HTTP + persistence already decided” and “vendor-specific completion API.”

---

## 2. Current implementation anchor (facts, not targets)

- Twin dialogue HTTP handlers persist user turns and emit **`waia_runtime_route`** telemetry via [`lib/observability/waia-runtime-route-telemetry.ts`](../../lib/observability/waia-runtime-route-telemetry.ts); assistant replies currently use a **stub** (`TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE`), not a provider.
- Twin **reasoning** libraries orchestrate deterministic modules (pattern, contradiction, personality, prediction, repeatability) per [`lib/reasoning/twin-engine.ts`](../../lib/reasoning/twin-engine.ts)—orthogonal to the **dialogue completion** path unless a future issue explicitly fuses them.

The gateway **does not** subsume the Twin Engine; it **may consume** read-only summaries produced elsewhere if a separate issue defines contracts.

---

## 3. Definitions

| Term | Meaning |
|------|---------|
| **AI Gateway** | Server-owned boundary that prepares prompts, calls a **completion provider**, interprets responses, and hands results to persistence/UI contracts—without owning product UX or DB schema. |
| **Completion provider** | External inference vendor/SDK implementing a thin **provider port** (below). |
| **Turn context** | Bounded material assembled for one user-visible dialogue step (messages + optional retrieval snippets + metadata). Not “agent memory” or long-lived autonomy state. |

---

## 4. Provider abstraction boundaries

**Invariant:** Application code depends on a **provider port**, not on a vendor SDK type surface.

**Port responsibilities (conceptual):**

- Accept a **normalized completion request**: ordered chat messages (roles + text), model identifier string, sampling/stop parameters as allowed by policy, optional JSON/tool schema hooks **only if** a future issue enables structured outputs.
- Return a **normalized completion result**: assistant text (or structured payload), usage tokens if supplied, provider request id if supplied, and a **stable error taxonomy** for the gateway to map.

**Anti-patterns:**

- Leaking OpenAI-specific message shapes into UI or persistence layers.
- Importing vendor SDKs from React client bundles or shared “utils” used by the browser.

**Replaceability:** Swapping vendors = new adapter implementing the same port + configuration change + rollout checklist—not prompt rewiring scattered across the codebase.

---

## 5. AI Gateway responsibilities

The gateway **owns**:

1. **Credentialed access** to the provider (reading server-side secrets only).
2. **Request shaping**: assembling prompt envelopes from **approved templates** + **sanitized** dialogue history slices + optional server-side retrieval snippets.
3. **Policy enforcement**: max tokens per layer, max turns retrieved, refusal to emit when kill-switch or budget exceeded.
4. **Observability hooks**: duration, outcome class, token accounting **metadata**—not raw user content by default (§11).
5. **Resilience behavior**: bounded retries, backoff, circuit-breaking cooperation with kill-switch (§13–§14).

The gateway **does not own**:

- Readiness math, Diary unlock logic, or Society semantics (product layer).
- SQLite/Postgres routing (`getWaiaRuntimeDb` remains authoritative).
- Long-horizon autonomous planning, tool-running agents, or multi-agent orchestration.

---

## 6. Runtime placement

**Placement:** **Server-only** module invoked from **existing** Next.js Route Handlers or Server Actions that already enforce auth—**no** browser-direct vendor calls.

Recommended layering (conceptual):

```
HTTP handler (auth + validation + telemetry envelope)
  → Twin persistence (read/write dialogue via resolveTwinPersistence / runtime policy)
  → AI Gateway (assemble context → provider port → normalize output)
  → Persistence (persist assistant turn) + HTTP response
```

**Why here:** Keeps secrets off the client, preserves single request correlation with `waia_runtime_route`, aligns with DEE-95-style backend attribution patterns.

**Explicit non-goal:** Edge middleware as primary inference surface—avoid premature placement complexity.

---

## 7. Request lifecycle

One **user submit** maps to:

1. **Authenticate & authorize** session user (existing helpers).
2. **Resolve runtime DB** (`await getWaiaRuntimeDb()`)—gateway logic remains unaware of SQLite vs Postgres beyond **whatever persistence APIs** the handler passes in.
3. **Validate input** (length, rate limits, idempotency semantics unchanged from current routes).
4. **Persist user turn** (existing persistence contracts)—ordering must remain deterministic if provider fails later.
5. **Build turn context** within prompt/memory budgets (§9–§10).
6. **Call provider** via port—unless kill-switch routes to stub (§14).
7. **Normalize & validate model output** (non-empty, length caps, strip unsafe control chars per policy).
8. **Persist assistant turn**; **emit telemetry** with outcome + durations + token metadata.
9. **Return HTTP response** with the same JSON contracts the dashboard expects—or explicit error envelope without leaking provider internals.

**Failure ordering principle:** If step 6 fails after step 4, product semantics must define whether the UI shows an **error without assistant message**, a **retry-safe client behavior**, or a **stub fallback**—but **must not** silently drop user persistence.

---

## 8. Prompt boundaries

Layers (conceptual separation **must** exist in code organization):

| Layer | Owner | Content |
|-------|-------|---------|
| **System policy** | Architecture + security/product review | Safety rails, role definition (“assistant helping user build AI-Twin”), tone constraints, **no-PII logging** reminders to downstream ops. |
| **Product dialogue doctrine** | Product / AI label | Training modes vocabulary alignment ([`docs/DIALOGUE_MODES_V1.md`](../DIALOGUE_MODES_V1.md)), indicator/evidence language consistent with readiness docs—**no** clinical labels beyond existing product bans. |
| **Dynamic session prefix** | Gateway | Short, bounded summary lines derived **only from approved retrieval sources** (see §9)—never whole-database dumps. |
| **User messages** | User-authored | Passed through sanitization & length enforcement only; **do not** rewrite meaning silently except redacting disallowed content categories defined by product/security issues. |

**Invariant:** Prompt templates live **versioned** (file constants + changelog entry or ADR reference); hotfixes adjust templates via PR, not scattered string edits.

---

## 9. Memory boundaries

Three buckets—confusion between them is a **security and cost** bug:

| Bucket | Description | Sent to provider? |
|--------|--------------|-------------------|
| **Authoritative memory** | Persisted twin/diary stores via `resolveTwinPersistence` | Only via **explicit retrieval** subset chosen by gateway policy—not automatic full history. |
| **Ephemeral context** | Current turn + N prior turns + optional retrieved snippets | Yes, bounded by §12. |
| **Derived reasoning artifacts** | Pattern summaries, contradiction findings, etc. | **Optional** future fusion—requires separate contract issue; default **off** to prevent leakage and token explosion. |

**Invariant:** Retrieval is **purpose-bound** (`TwinMemorySearchPort`-style seams already exist for Postgres paths)—gateway queries must use **parameterized** retrieval modes (e.g., “recent dialogue” vs “semantic snippets”), not ad hoc SQL from prompt code.

---

## 10. No-PII policy (gateway-specific operational minimum)

**Baseline:** Follow [`DEE-95-RUNTIME-ROUTING-STRATEGY.md`](../migrations/DEE-95-RUNTIME-ROUTING-STRATEGY.md) privacy posture—**no raw Twin/Diary text in production logs** unless explicitly approved.

Gateway additions:

- **Logs / traces:** Record route key, outcome, duration, token counts, provider request ids (if safe), **hashed user ids only if already standard** elsewhere—avoid introducing new identifiers into logs in this slice’s implementations.
- **Vendor retention:** Assume provider **may** retain per vendor defaults until enterprise agreements exist—design prompts under **minimum necessary** principle; prefer accounts with zero-retention where commercially viable (**implementation issue**, not this doc).
- **Training opt-out:** Prefer vendor settings/API flags that exclude content from training when available—track as operational checklist item.

**Human meaning primacy:** Automated summarization must not **contradict** stored user declarations without explicit product behavior defining reconciliation—until then, summaries are **assistive text**, not overwriting authority.

---

## 11. Token budgeting philosophy

**Goals:** Predictable cost, bounded latency, graceful degradation.

Policies (architecture-level):

- **Hard ceilings** per request for: model max output tokens, retrieved context characters, and count of historical turns included.
- **Progressive truncation** order: drop oldest middle turns before dropping **session anchor** system layers; never silently drop **current user** message.
- **Admission control:** If estimated prompt tokens exceed ceiling, return a **defined error or shortened mode**—not an unbounded split session across hidden automatic continuation (multi-step continuations require explicit product approval).

**Instrumentation:** Persist token usage metadata alongside telemetry events **when provider returns it**—used for finance oversight and abuse detection, not end-user display unless product asks.

---

## 12. Model routing philosophy

**MVP:** **Single primary chat model** per environment via configuration; optional **fallback model** only if explicitly approved (different failure class handling).

**Routing dimensions** (future-friendly but not implemented here):

| Dimension | MVP stance |
|-----------|------------|
| Task type | Same model for Twin dialogue v1; specialized routing deferred |
| Safety tier | Handled via prompts + provider safety layers—not arbitrary routing trees |
| Cost tier | Environment-level choice (staging vs prod smaller/faster models) |

**Invariant:** Routing policy is **data-driven config**, not `if (vendor === …)` sprinkled across handlers.

---

## 13. Observability expectations

Extend—not replace—existing **`waia_runtime_route`** emission:

| Signal | Purpose |
|--------|---------|
| Existing route telemetry | Backend attribution + HTTP outcome |
| **Additional gateway fields** (future implementation) | `provider_outcome` (`success`, `rate_limited`, `provider_error`, `timeout`, `killed`, `budget_exceeded`), `latency_provider_ms`, `prompt_tokens`, `completion_tokens`, optional `provider_request_id` |

**Privacy guard:** Structured logs remain **content-free** by default (§10).

**Correlation:** Prefer reusing the same request timeline as the HTTP handler’s telemetry window—avoid orphaned nested spans without linking identifiers.

---

## 14. Retry / failure behavior

**Classification:**

| Class | Behavior |
|-------|----------|
| **Client faults** (4xx validation) | No retry at gateway; surface to UI |
| **Rate limits / 429** | Bounded exponential backoff + **max attempts**; jitter; respect `Retry-After` when present |
| **Timeouts / network** | Same bounded retry policy if idempotent **from provider’s perspective**—dialogue completions may be non-idempotent; **prefer no auto-retry on POST completion** unless dedupe tokens exist |
| **5xx provider** | Limited retries; escalate to `provider_error` telemetry |

**Invariant:** Retries **must not** multiply persisted assistant duplicates—tie persistence to **idempotency keys** already present in dialogue routes or introduce them in the implementing issue.

---

## 15. Kill-switch strategy

**Primary:** Configuration flag (e.g., env-based) **disables live provider calls** in production/staging independently of code removal.

When **active**:

- Gateway short-circuits to **stub assistant path** (today’s behavior) or returns a defined operational error—choice is **implementation issue** but must be **explicitly documented** per environment.
- Emit **`killed` or `disabled`** outcome in telemetry for audit visibility.

**Secondary:** Vendor-side disablement (revoke key / drain deployment)—standard ops playbook.

**Forbidden:** Silent downgrade without telemetry; switching providers **without** config audit trail.

---

## 16. Future multi-model extensibility boundaries

Allowed later **without** rewriting this architecture:

- Additional **adapters** implementing the same provider port.
- **Routing table** mapping `(feature, environment)` → `(adapterId, modelId, limits)`.
- **Structured outputs** for constrained JSON extraction behind feature flags.

Explicit **deferrals** (require new Linear issues + ADR if policy-changing):

- Tool-using agents with arbitrary side effects.
- Always-on background inference jobs.
- Cross-user retrieval or federation.
- Automatic prompt optimization pipelines touching production traffic.

---

## 17. Conceptual interfaces (contracts only)

Illustrative TypeScript shapes—**not** shipped code:

```ts
// Provider boundary — vendor-neutral
export type ChatRole = "system" | "user" | "assistant";

export type ProviderMessage = { role: ChatRole; content: string };

export type CompletionRequest = {
  model: string;
  messages: ProviderMessage[];
  maxOutputTokens: number;
  temperature?: number;
};

export type CompletionResult =
  | {
      ok: true;
      text: string;
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      providerRequestId?: string;
    }
  | { ok: false; code: "RATE_LIMIT" | "TIMEOUT" | "PROVIDER_ERROR" | "CONFIG"; retryable: boolean };

export interface CompletionProviderPort {
  complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult>;
}

// Gateway boundary — server-internal
export type GatewayTurnInput = {
  userId: string;
  runtime: import("@/db/waia-runtime-db").WaiaRuntimeDb;
  latestUserMessage: string;
  idempotencyKey?: string | null;
};

export type GatewayTurnOutput =
  | { ok: true; assistantText: string }
  | { ok: false; reason: "KILL_SWITCH" | "BUDGET" | "VALIDATION" | "PROVIDER"; retryable?: boolean };
```

**Note:** Real signatures must incorporate existing persistence types—define only in implementation PRs.

---

## 18. Operational invariants (checklist for implementers)

1. **Server-only secrets** for provider credentials.
2. **No silent cross-backend DB fallback** inside gateway—persists via existing runtime-resolved paths only.
3. **Telemetry first-class** for kill-switch and provider failures.
4. **Minimal prompts**—avoid embedding entire JSON dumps of twin state.
5. **Bounded autonomy**—single-request completion unless explicitly approved otherwise.
6. **Rollback = config flip + stub path**, consistent with DEE-95e doctrine.

---

## 19. Architectural decisions (summary)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Placement | Server-side route/module | Secrets + telemetry cohesion |
| Provider coupling | Port + adapter | Replaceability / test doubles |
| Twin Engine relation | Orthogonal default | Avoid merging deterministic engine with dialogue completion prematurely |
| Logging default | Content-free structured logs | Align DEE-95e privacy posture |
| Kill-switch | Env-driven disable + telemetry | Ops rollback culture |

---

## 20. Risks detected (planning-level)

| Risk | Mitigation |
|------|------------|
| **Duplicate assistant turns** on flaky retries | Idempotency keys + single-writer semantics in persistence |
| **Token cost spikes** | Hard ceilings + admission errors + monitoring token telemetry |
| **Accidental PII in logs** | Schema review on any new log fields; redaction helpers |
| **Prompt drift** | Central versioned templates + PR review |
| **Vendor lock-in creep** | Strict port boundary + adapter isolation |

---

## 21. Scope boundaries (explicit)

**In scope for DEE-76:** This document and repository cross-links strictly necessary for discoverability.

**Out of scope:** Routes, SDK deps, schema migrations, autonomous agents, cross-module marketplace/trader logic, Postgres rollout decisions.

---

## 22. Validation (this slice)

Documentation-only change—repo validation canon still applies before PR:

```bash
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
```

---

## Document control

| Version | Slice | Notes |
|---------|--------|------|
| 1.0 | DEE-76 | Initial bounded AI Gateway architecture (planning only). |
| 1.1 | DEE-78 | Bounded network slice: OpenAI-compatible **`fetch`** adapter behind `CompletionProviderPort`, **`WAIA_AI_PROVIDER`** selector (default non-network), additive stdout telemetry fields — documented in code + **DEE-95G** runbook. Does not decide persistence for usage/events (deferred). |
| 1.2 | DEE-79 | Pre-activation hardening: optional **`ai_gateway_provider_*_tokens`** + **`ai_gateway_provider_request_id`** on **`twin_dialogue_turn`**; client **`AbortSignal`** propagation from route handler; staging activation runbook (**[`DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md`](../migrations/DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md)**). |
| 1.3 | DEE-80 | Bounded inference decomposition (**planning docs**): prompt envelope doctrine v1 — **`../architecture/DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`**; production inference rollout scaffold — **`../migrations/DEE-80-AI-GATEWAY-PRODUCTION-INFERENCE-ROLLOUT.md`**. Runtime envelope expansion (**Slice B**) remains issue-scoped; no retrieval/tables mandate. |
