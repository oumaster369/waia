# DEE-80 — Prompt envelope doctrine v1

**Type:** Architecture planning (documentation only). **Does not** authorize retrieval systems, embeddings, new persistence tables, streaming, retries, tool calls, autonomous agents, or readiness/contradiction logic inside the Twin dialogue completion path.

**Linear:** [DEE-80](https://linear.app/deepsense/issue/DEE-80) — execution label `ai`.

**Audience:** Architect / AI-track owners sizing bounded Twin dialogue inference **after** DEE-78 / DEE-79 gateway plumbing and **after** staging smoke sign-off per [`DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md`](../migrations/DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md).

**Alignment:** [`DEE-76-AI-GATEWAY-ARCHITECTURE.md`](./DEE-76-AI-GATEWAY-ARCHITECTURE.md), AI-Twin product canon [`docs/product/ai-twin-user-flow.md`](../product/ai-twin-user-flow.md), telemetry discipline [`docs/migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md`](../migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md).

---

## 1. Purpose

Freeze **what categories of text may enter** the normalized completion request for **`POST /api/dashboard/twin-dialogue/turn`** on each turn, **without** semantic search, vector stores, or Twin Engine fusion unless a **future** issue explicitly authorizes it.

This document is **Slice A** of the DEE-80 decomposition: **policy prose only**. Runtime changes (**Slice B**) must implement **only** what this doctrine explicitly allows.

---

## 2. Envelope v1 (current posture — authoritative baseline)

As of gateway implementation aligned with DEE-79 staging activation:

| Category | Allowed in envelope | Trust tier |
|----------|---------------------|------------|
| **System instruction** | Fixed Twin-dialogue training-assistant role text defined server-side in [`lib/ai-gateway/twin-dialogue-completion-gateway.ts`](../../lib/ai-gateway/twin-dialogue-completion-gateway.ts) | Product-owned template |
| **User turn text** | The **current** request’s validated user message string (single turn) | User-authored |
| **Prior dialogue transcript** | **Not** included | N/A |
| **Diary content** | **Not** included | N/A |
| **Twin Engine outputs** (patterns, predictions, readiness aggregates) | **Not** included | N/A |
| **Hidden chain-of-thought** from vendor | Must **not** be persisted or forwarded to the client as biography | Never |

**Operational implication:** First controlled outbound inference proves egress + telemetry + kill-switch — **not** “full twin context” in the ML sense.

---

## 3. Allowed future deltas (policy placeholders — not implemented here)

Any **Slice B** implementation PR may **only** add envelope material from this list, with **explicit Architect-approved bounds** recorded in the Slice B issue / PR description:

1. **Bounded dialogue read:** A **finite prefix or sliding window** of **already persisted** user + assistant turns from the existing Twin dialogue store — **read-only**, character and/or turn-count ceilings named in the PR. This is **not** long-term memory retrieval; it is **explicit transcript replay** with hard caps.
2. **Template variants:** Alternate **system** strings for A/B policy testing — **no** change to trust tiers without product review.

**Forbidden deltas for DEE-80 slices:** pgvector / embeddings, cross-user context, tool outputs, streaming transcripts, automatic retries, readiness or contradiction outputs inlined into the completion prompt, DEE-107 AI-gateway tables as a prerequisite.

---

## 4. Persistence vs transient semantics

- **Persisted** today: user turn + assistant reply text through existing Twin dialogue persistence (unchanged by this doctrine).
- **Transient:** Provider request/response handling, parsing buffers, and anything not covered by an explicit persistence contract — discarded after the HTTP response completes unless product/backend issues say otherwise.

---

## 5. Verification boundary

Readiness signals, contradiction handling, and indicator scoring remain **outside** this envelope doctrine — routed through their existing product/backend pipelines. **Do not** merge readiness extraction into the dialogue completion handler under DEE-80.

---

## 6. Rollback and telemetry

- Kill-switch and provider selection remain **env-driven** per [`DEE-76`](./DEE-76-AI-GATEWAY-ARCHITECTURE.md) and [`DEE-79` staging runbook](../migrations/DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md).
- Any Slice B expansion must preserve **content-free** stdout telemetry discipline; new observability dimensions require Architect review against [`DEE-95G`](../migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md).

---

## 7. Related operational docs

- Staging activation: [`DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md`](../migrations/DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md)
- Production inference rollout record (when authorized): [`DEE-80-AI-GATEWAY-PRODUCTION-INFERENCE-ROLLOUT.md`](../migrations/DEE-80-AI-GATEWAY-PRODUCTION-INFERENCE-ROLLOUT.md)

---

## Document control

| Version | Slice | Notes |
|---------|--------|------|
| 1.0 | DEE-80 Slice A | Initial prompt envelope doctrine v1 (docs only). |
