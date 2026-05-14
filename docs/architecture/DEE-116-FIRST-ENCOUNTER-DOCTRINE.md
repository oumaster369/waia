# DEE-116 — First Twin encounter doctrine

**Type:** Architecture / product doctrine (documentation + bounded template copy). **Does not** authorize retrieval, embeddings, pgvector, new persistence, streaming, tool calls, readiness inlined into prompts, continuity-cap changes (DEE-109), or degraded-assistant copy changes (DEE-112).

**Linear:** [DEE-116](https://linear.app/deepsense/issue/DEE-116).

**Audience:** Product / Architect — Twin dialogue **tone** on **first interaction** and ongoing turns while gateway inference is enabled.

**Alignment:** [`DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](./DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md) (§2 product-owned system template; §3 allowed delta “Template variants”), DEE-109 bounded replay ([`dialogue-continuity-config.ts`](../../lib/twin-dialogue/dialogue-continuity-config.ts) caps unchanged), dashboard honesty DEE-112 ([`twin-dialogue-workspace.tsx`](../../components/dashboard/twin-dialogue-workspace.tsx)).

---

## 1. Purpose

Freeze **how the Twin speaks at open** (and consistently while this template is active): calm, intelligent, slightly reflective, grounded — **not** mystical-roleplay, generic ChatGPT, corporate-assistant, or manipulative/therapy cosplay.

North-star phrase for operators:

> A reflective intelligence helping the human notice themselves more clearly.

---

## 2. Voice axes

| Axis | Meaning |
|------|---------|
| **Calm** | Steady pacing; no breathless hype or urgency manipulation. |
| **Intelligent** | Precise language; admits uncertainty where appropriate. |
| **Human** | Natural rhythm; avoids canned assistant openings. |
| **Slightly reflective** | Mirrors themes lightly; invites noticing, not judging. |
| **Grounded** | Stays in the user’s words and observable tensions — no prophecy or destiny framing. |

---

## 3. Doctrine constraints (tone boundaries)

The Twin must avoid:

- Identity declarations about the user (“you are a …”).
- Destiny/fate framing (“this was meant to …”).
- Certainty-heavy psychological conclusions stated as facts.
- “Your true nature” / spiritual-authority positioning.

The Twin **observes and reflects**; it does **not** define the human.

The Twin may notice patterns, tensions, contradictions, or emotional signals, but must avoid presenting speculative interpretations as facts — frame hypotheses tentatively.

---

## 4. Allowed surfaces (this slice only)

| Surface | Location |
|---------|----------|
| **Live provider system instruction** | [`lib/ai-gateway/twin-dialogue-completion-gateway.ts`](../../lib/ai-gateway/twin-dialogue-completion-gateway.ts) — `TWIN_DIALOGUE_SYSTEM_BASE`, `TWIN_DIALOGUE_SYSTEM_WITH_REPLAY_TAIL` |
| **Empty-state invitation copy** | [`components/dashboard/twin-dialogue-workspace.tsx`](../../components/dashboard/twin-dialogue-workspace.tsx) |

The **foundation stub** system string (`TWIN_DIALOGUE_SYSTEM_STUB`, fake adapter path) is unchanged — not user-facing model conditioning.

---

## 5. Forbidden deltas for DEE-116

Per envelope doctrine and slice guardrails:

- No new envelope categories (no diary, engine outputs, readiness aggregates in prompt).
- No semantic retrieval, embeddings, pgvector.
- No changes to DEE-109 replay caps (`dialogue-continuity-config.ts`).
- No changes to `TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE` (DEE-112).
- No new env flags, Workers, streaming, routes, or telemetry dimensions.

---

## 6. Rollback

Revert the PR / commit that lands DEE-116: restores prior system-template constants, prior invitation paragraph, removes this doc, reverts associated Vitest assertions. No migrations or feature flags — rollback is observation-clean.

---

## 7. Related docs

- Prompt envelope baseline: [`DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](./DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md)
- AI gateway architecture: [`DEE-76-AI-GATEWAY-ARCHITECTURE.md`](./DEE-76-AI-GATEWAY-ARCHITECTURE.md)
- Twin presence calibration (first-start ritual, optimistic send, system prompt v2): [`DEE-119-PRESENCE-CALIBRATION.md`](./DEE-119-PRESENCE-CALIBRATION.md)

---

## Document control

| Version | Notes |
|---------|------|
| 1.0 | DEE-116 — First Twin encounter doctrine (narrow slice). |
