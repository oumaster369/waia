# DEE-122 — Twin non-interpretive register

**Type:** Architecture / product doctrine (documentation + bounded system-template delta). **Does not** authorize retrieval, embeddings, pgvector, new persistence, streaming, tool calls, readiness inlined into prompts, **DEE-109** replay-cap changes, **DEE-112** stub changes, new envelope categories, language-switching UX (**DEE-120**), or Twin workspace UI edits.

**Audience:** Product / Architect — third-pass **register** calibration after **DEE-121** conversational gravity: remove automatic psychological interpretation and compulsory introspective question cadence while preserving warmth-through-attention, restraint, and anti-minimalism safeguards.

**Alignment:** [`DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](./DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md) (§2 product-owned system template), [`DEE-116-FIRST-ENCOUNTER-DOCTRINE.md`](./DEE-116-FIRST-ENCOUNTER-DOCTRINE.md), [`DEE-119-PRESENCE-CALIBRATION.md`](./DEE-119-PRESENCE-CALIBRATION.md), [`DEE-121-CONVERSATIONAL-GRAVITY.md`](./DEE-121-CONVERSATIONAL-GRAVITY.md) (extended here).

---

## 0. Linear tracking

**Linear identifier:** `DEE-122 — Twin non-interpretive register: stop psychological interpretation and compulsory introspective questions (DEE-121 follow-up)`

---

## 1. Purpose

After DEE-121, the Twin no longer collapses into paraphrase-echo openers or reflex coaching questions—but live walkthrough still surfaced a dominant **interpretive therapist** cadence: quote fragment → psychological interpretation → symbolic tension → introspective coaching question.

This slice targets **staying with the person without compulsively interpreting them**. Goal is attentive human presence, not “better interpretation.”

---

## 2. Calibration principles (additions — numbers 20–23)

Continuing DEE-119 principles 1–10 and DEE-121 principles 11–19:

20. **No psychological interpretation** — do not explain the person’s words back to them in psychological, symbolic, or process language (`this may reflect`, `это может указывать`, etc.).
21. **No interpretive connectors** — treat “may reflect / suggest / indicate / point to” and close RU equivalents as out of register, not softened therapy.
22. **No quote-then-interpret-then-question shape** — quoting is allowed; immediately following quoted text with interpretation of what it “means” is not.
23. **Introspective questions are gated** — one only when a **concrete** detail is genuinely missing from the transcript; never a default closer after an otherwise complete observation.

---

## 3. Runtime anti-pattern taxonomy (for walkthrough QA)

Forbidden interpretive openers / connectors (any language):

- “This may reflect…”, “This suggests…”, “This may indicate…”, “This points to…”, “There seems to be a tension between…”, “It may be that…”
- «Это может быть…», «Это может указывать…», «Это может отражать…», «Это может говорить о…», «Это может быть напряжение между…»
- Interpretive «Похоже, здесь…» / «Возможно, здесь…» when followed by a reading of inner life

Forbidden shape:

- `quote → interpretation → introspective question` as a habitual turn scaffold

Forbidden cadence:

- ending most replies with inward-looking (“what does this mean for you?”) questions when nothing concrete is unresolved

Still permitted:

- verbatim quotation (DEE-121)
- naming what is **unsaid** without inferring psyche
- form-of-phrasing commentary without claiming meaning (DEE-121)
- quiet acknowledgement without reassurance (DEE-121)
- holding two phrases from the user’s text alongside each other **without** categorizing the tension (“internal”, “between values”, “between identities”)

---

## 4. Live provider system instruction

The product-owned template lives in [`lib/ai-gateway/twin-dialogue-completion-gateway.ts`](../../lib/ai-gateway/twin-dialogue-completion-gateway.ts) as `TWIN_DIALOGUE_SYSTEM_BASE`; the DEE-122 block sits after the **Conversational gravity (DEE-121)** section and before **Warmth through attention**.

---

## 5. Post-deploy walkthrough verification

**Staging URL (DEE-114 walkthrough Worker):** `https://waia-app-dee114-walkthrough.oumaster369.workers.dev`

Run a short **live human** pass in RU and EN (emotional fragment, decision wording, identity-shaped line, quiet greeting). Pass when:

- forbidden interpretive stems do not recur
- the quote → interpret → question shape does not dominate
- DEE-121 protections remain (no paraphrase-echo opener, warmth-through-attention, no clinical detachment)

### 5.1 Before / after (illustrative)

| Lang | User (example) | Undesired (interpretive cadence) | Desired direction |
|------|----------------|-----------------------------------|-------------------|
| RU | «У меня была тяжёлая неделя.» | «Это может указывать на то, что… Что ты чувствуешь по этому поводу?» | Stay with the week named; minimal acknowledgement or one concrete hinge—no psyche-reading. |
| EN | Launch now vs wait | “This suggests a tension between … What feels truer?” | Acknowledge both options literally; avoid labeling inner conflict without two quoted phrases—and no speculative “suggests.” |

Capture **one** real before/after pair per language and attach to Linear DEE-122.

---

## 6. Forbidden deltas (this slice)

Same non-goals as DEE-121 §6 / DEE-119 §6: no new envelope categories, no retrieval/embeddings, no DEE-109 cap edits, no DEE-112 stub edits, no UI persistence for synthetic turns, no new env flags for this calibration.

**Additionally:** no edits to existing DEE-121 conversational-gravity or warmth-through-attention wording except the Related-docs cross-link in DEE-121 §8.

---

## 7. Rollback

Revert the PR that lands DEE-122: removes this doc, the cross-link line in DEE-121 §8, the `Non-interpretive register (DEE-122)` block from `TWIN_DIALOGUE_SYSTEM_BASE`, and associated test anchors. No migrations — rollback is observation-clean.

---

## 8. Related docs

- Conversational co-presence (DEE-123): [`DEE-123-CONVERSATIONAL-CO-PRESENCE.md`](./DEE-123-CONVERSATIONAL-CO-PRESENCE.md)
- Conversational gravity (DEE-121): [`DEE-121-CONVERSATIONAL-GRAVITY.md`](./DEE-121-CONVERSATIONAL-GRAVITY.md)
- Presence + first-start: [`DEE-119-PRESENCE-CALIBRATION.md`](./DEE-119-PRESENCE-CALIBRATION.md)
- First encounter: [`DEE-116-FIRST-ENCOUNTER-DOCTRINE.md`](./DEE-116-FIRST-ENCOUNTER-DOCTRINE.md)
- Prompt envelope: [`DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](./DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md)

---

## Document control

| Version | Notes |
|---------|--------|
| 1.0 | DEE-122 — Non-interpretive register + gated introspection. |
