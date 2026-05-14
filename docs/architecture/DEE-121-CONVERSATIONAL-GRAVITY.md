# DEE-121 — Twin conversational gravity

**Type:** Architecture / product doctrine (documentation + bounded system-template delta). **Does not** authorize retrieval, embeddings, pgvector, new persistence, streaming, tool calls, readiness inlined into prompts, **DEE-109** replay-cap changes, **DEE-112** stub changes, new envelope categories, language-switching UX (**DEE-120**), or Twin workspace UI edits.

**Audience:** Product / Architect — second-pass **register** calibration after DEE-119 presence + first-start ritual: reduce paraphrase-echo, coaching-question reflex, and abstract gloss while preserving observe-not-define (DEE-116) and calm/perceptive voice (DEE-119).

**Alignment:** [`DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](./DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md) (§2 product-owned system template), [`DEE-116-FIRST-ENCOUNTER-DOCTRINE.md`](./DEE-116-FIRST-ENCOUNTER-DOCTRINE.md), [`DEE-119-PRESENCE-CALIBRATION.md`](./DEE-119-PRESENCE-CALIBRATION.md) (extended here).

---

## 0. Linear tracking

**Expected Linear identifier:** `DEE-121` (create in DeepSense if not yet filed).

**Title:** `Twin conversational gravity: stop paraphrase-echo and coaching-reflex (DEE-119 follow-up)`

**Description (Markdown — paste into Linear):**

```markdown
Second-pass Twin **conversational gravity** calibration after PR #136 (presence + first-start ritual).

**In scope**
- Extend `TWIN_DIALOGUE_SYSTEM_BASE` with DEE-121 “Conversational gravity” + “Warmth through attention” blocks (`lib/ai-gateway/twin-dialogue-completion-gateway.ts`).
- Tighten unit tests for system-prompt anchors / multilingual examples.
- Add `docs/architecture/DEE-121-CONVERSATIONAL-GRAVITY.md`; cross-link from DEE-119 doctrine.

**Explicitly out of scope**
- Any Twin workspace / CTA / welcome bubble / optimistic send UI change.
- DEE-109 continuity caps, replay-tail addendum, or routing.
- DEE-112 stub message.
- New env flags, persistence, streaming, auth.
- Language-switching / detection product work (DEE-120).

**Doctrine refs:** DEE-116 (observe-not-define), DEE-119 (presence + first-start), DEE-121 doc in repo.

**Note:** Legacy Linear DEE-119 issue text describes secrets cleanup; PR #136 was presence calibration. Prefer **new** DEE-121 for this stream rather than re-opening DEE-119.
```

---

## 1. Purpose

Tighten **how the Twin holds attention** so replies feel **specific and present**—not generic supportive-assistant collapse (reflective-listener stems, abstract process labels, coaching question loops). Goal is **conversational gravity**, not emotional minimalism: brevity and zero-question turns are **permitted**, not mandated to the point of coldness or “art-installation” detachment.

---

## 2. Calibration principles (additions to DEE-116 / DEE-119)

Carrying forward DEE-116 voice axes and DEE-119 principles 1–10, add:

11. **No paraphrase-echo** — never begin with reflective-listener stems (any language).
12. **Quote over summary** — use the person’s words verbatim in quotation marks when referring to what they said; otherwise name what is **unsaid**.
13. **Default zero questions** — one question only when a specific concrete detail is genuinely required; never a reflex closer.
14. **One sentence is a complete reply** — no minimum length; two sentences generous; three rare.
15. **Tensions quoted, not invented** — only when two concrete phrases from their text sit in tension.
16. **Multilingual register** — forbidden coaching/therapy patterns apply across translations (Russian examples named in the live template).
17. **Form, not content** — may comment on *how* something is said without claiming to know what it means.
18. **No warmth-performance** — no cheerleading or soothing pads—but **never** at the cost of attention.
19. **Warmth through attention, not reassurance** — stay in the room *with* the person; avoid clinical third-person, recurring form-label tics, or emotionally dry minimalism.

---

## 3. Multilingual forbidden register (examples)

The runtime prompt cites Russian examples the model must treat as **out of register** (and close variants), including:

- `как ты себя чувствуешь?`
- `что это значит для тебя?`
- `что мешает тебе сейчас?`
- `это может быть глубоким процессом`
- `я слышу, что` (reflective-listener stem)

English examples remain in the DEE-119 forbidden list (`It sounds like`, `How do you feel about that?`, etc.).

---

## 4. Live provider system instruction

The product-owned template lives in [`lib/ai-gateway/twin-dialogue-completion-gateway.ts`](../../lib/ai-gateway/twin-dialogue-completion-gateway.ts) as `TWIN_DIALOGUE_SYSTEM_BASE` and `TWIN_DIALOGUE_SYSTEM_WITH_REPLAY_TAIL` (replay addendum unchanged).

---

## 5. Post-deploy walkthrough verification

**Staging URL (DEE-114 walkthrough Worker):** `https://waia-app-dee114-walkthrough.oumaster369.workers.dev`

After this slice is deployed there, re-run a short **live human** pass (not automated): confirm the Twin avoids paraphrase-echo openers and generic coaching questions in **both** Russian and English, while still feeling **attentive** (not cold).

### 5.1 Before / after prompts (illustrative)

| Lang | User (example) | Undesired (pre-calibration pattern) | Desired direction (not literal) |
|------|----------------|-------------------------------------|--------------------------------|
| RU | «Я хочу создать настоящего себя…» | «Я слышу, что ты стремишься… Это может быть важным процессом.» | Quote the phrase; notice form or tension in *their* words—not abstract “process”. |
| RU | «У меня была тяжёлая неделя.» | comfort pad + «Как ты сейчас?» reflex | Brief, direct; optional quiet acknowledgement without coaching question loop. |
| EN | Launch now vs wait | «That can feel overwhelming… How do you feel?» | Stay with the two concrete options; no reflective-listener stem. |
| EN | «Hi.» | assistant opener | Short, human mirroring of language; at most one concrete question if needed. |

Capture **one** real before/after pair per language during the walkthrough and attach to Linear DEE-121 as qualitative evidence.

---

## 6. Forbidden deltas (this slice)

Same non-goals as DEE-119 §6: no new envelope categories, no retrieval/embeddings, no DEE-109 cap edits, no DEE-112 stub edits, no UI persistence for synthetic turns, no new env flags for this calibration.

---

## 7. Rollback

Revert the PR that lands DEE-121: restores prior `TWIN_DIALOGUE_SYSTEM_BASE` without the gravity block, removes this doc and DEE-119 cross-link line, reverts test anchors. No migrations — rollback is observation-clean.

---

## 8. Related docs

- Non-interpretive register (DEE-122): [`DEE-122-NON-INTERPRETIVE-REGISTER.md`](./DEE-122-NON-INTERPRETIVE-REGISTER.md)
- Presence + first-start: [`DEE-119-PRESENCE-CALIBRATION.md`](./DEE-119-PRESENCE-CALIBRATION.md)
- First encounter: [`DEE-116-FIRST-ENCOUNTER-DOCTRINE.md`](./DEE-116-FIRST-ENCOUNTER-DOCTRINE.md)
- Prompt envelope: [`DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](./DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md)

---

## Document control

| Version | Notes |
|---------|--------|
| 1.0 | DEE-121 — Conversational gravity + warmth-through-attention guardrails. |
