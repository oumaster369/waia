# DEE-125 — Twin social presence and Russian register

**Type:** Architecture / product doctrine (documentation + bounded system-template delta). **Does not** authorize retrieval, embeddings, pgvector, new persistence, streaming, tool calls, readiness inlined into prompts, **DEE-109** replay-cap changes, **DEE-112** stub changes, new envelope categories, language-switching UX (**DEE-120**), Twin workspace UI edits, **model or sampling changes** (deferred to **DEE-126**), or production deploy.

**Audience:** Product / Architect — sixth-pass calibration after **DEE-124**: add **positive social-presence permissions** and **Russian «ты» default** while preserving every DEE-121 / DEE-122 / DEE-123 / DEE-124 protection.

**Alignment:** [`DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](./DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md) (§2 product-owned system template), [`DEE-116-FIRST-ENCOUNTER-DOCTRINE.md`](./DEE-116-FIRST-ENCOUNTER-DOCTRINE.md), [`DEE-119-PRESENCE-CALIBRATION.md`](./DEE-119-PRESENCE-CALIBRATION.md), [`DEE-121-CONVERSATIONAL-GRAVITY.md`](./DEE-121-CONVERSATIONAL-GRAVITY.md), [`DEE-122-NON-INTERPRETIVE-REGISTER.md`](./DEE-122-NON-INTERPRETIVE-REGISTER.md), [`DEE-123-CONVERSATIONAL-CO-PRESENCE.md`](./DEE-123-CONVERSATIONAL-CO-PRESENCE.md), [`DEE-124-DIRECT-RESPONSE-INITIATION.md`](./DEE-124-DIRECT-RESPONSE-INITIATION.md) (extended here).

---

## 0. Linear tracking

**Linear identifier:** `DEE-125 — Twin social-presence permission + RU «ты» default (DEE-124 follow-up)`

---

## 1. Purpose

Post–DEE-124 walkthrough may still show **processing-before-presence**: quote → frame → inward exploration. Suppression-only stacking risks diminishing returns and sterile self-monitoring.

This slice adds **explicit permission to meet the user socially** without compulsively processing their experience, plus **Russian conversational register**: default **«ты»**, not customer-support **«вы»**. No new large forbidden lists; no personality gimmicks; no coaching or therapy cadence.

---

## 2. Calibration principles (additions — numbers 32–35)

Continuing DEE-119 (1–10), DEE-121 (11–19), DEE-122 (20–23), DEE-123 (24–27), DEE-124 (28–31):

32. **Presence before processing** — meeting the person in the reply is sufficient value; explaining or framing their experience is not required for the reply to count as present.
33. **Ordinary direct replies are permitted** — a short line that stays with what was said, without interpreting, recap-first, observer narration, or attributed feeling, is a complete and correct reply.
34. **With them, not about them** — if you would describe what is happening *to* them from outside, address them directly or omit it (co-presence caps preserved).
35. **Russian register** — default to **«ты»**; use **«вы»** only when the person establishes formal distance themselves; avoid slang, pet names, exclamatory warmth, feigned closeness, or service-agent corporate tone.

---

## 3. Light dedup (semantic-preserving)

Within `TWIN_DIALOGUE_SYSTEM_BASE`, redundant opener/recap phrasing between **Conversational gravity (DEE-121)** and **Direct response initiation (DEE-124)** may be collapsed so DEE-124 remains canonical for recap-first discipline while DEE-121 retains reflective-listener stem enumeration and quotation discipline.

Overlap between **Conversational co-presence (DEE-123)** and **Warmth through attention** on direct address may be trimmed so narration caps live primarily in DEE-123 and warmth bullets stay anti-coldness without repeating the same instruction.

---

## 4. Live provider system instruction

[`lib/ai-gateway/twin-dialogue-completion-gateway.ts`](../../lib/ai-gateway/twin-dialogue-completion-gateway.ts): `Social presence and register (DEE-125)` sits after **Direct response initiation (DEE-124)** and before **Warmth through attention**.

---

## 5. Post-deploy walkthrough verification

**Staging URL (DEE-114 walkthrough Worker):** `https://waia-app-dee114-walkthrough.oumaster369.workers.dev`

Parity probes (RU / EN):

**Russian**

1. «Привет»
2. «Тяжёлая неделя»
3. «Запустить сегодня или подождать»
4. «Опять открыл заметки три раза и забыл, что хотел записать»
5. «Расскажи, как ты работаешь»

**English**

1. Hi
2. Rough week
3. Launch now or wait
4. Made coffee twice and forgot to drink it both times
5. How do you work?

**Hard checks (additive to DEE-121–124):**

- RU: default **«ты»** register on neutral probes; no habitual **«вы»** / service-agent opener unless the user cues formality.
- RU / EN: no service-consultant cadence; at least one ordinary probe gets a **direct, low-processing** reply where meaning was already clear.
- All DEE-121 / DEE-122 / DEE-123 / DEE-124 protections remain (reflective stems, interpretive connectors, observer narration, auto-attributed feelings, recap-first habit).

Capture **one** real before/after pair per language on Linear **DEE-125**.

---

## 6. Forbidden deltas (this slice)

Same non-goals as DEE-124 §6 / DEE-119 §6: no new envelope categories, retrieval/embeddings, DEE-109 cap edits, DEE-112 stub edits, synthetic-turn persistence hacks, **no new env flags for model or temperature**.

**Additionally:** no model swap and no sampling (`temperature`) changes — **DEE-126** evaluates OpenAI-only model and sampling on the walkthrough Worker **after** DEE-125 evidence is captured.

---

## 7. Rollback

Revert the PR landing DEE-125: removes this doc, the DEE-124 §8 link line, the `Social presence and register (DEE-125)` block, light-dedup edits to prior blocks if any, and associated prompt anchor tests. No migrations — rollback is observation-clean.

---

## 8. Related docs

- Direct response initiation (DEE-124): [`DEE-124-DIRECT-RESPONSE-INITIATION.md`](./DEE-124-DIRECT-RESPONSE-INITIATION.md)
- Conversational co-presence (DEE-123): [`DEE-123-CONVERSATIONAL-CO-PRESENCE.md`](./DEE-123-CONVERSATIONAL-CO-PRESENCE.md)
- Non-interpretive register (DEE-122): [`DEE-122-NON-INTERPRETIVE-REGISTER.md`](./DEE-122-NON-INTERPRETIVE-REGISTER.md)
- Conversational gravity (DEE-121): [`DEE-121-CONVERSATIONAL-GRAVITY.md`](./DEE-121-CONVERSATIONAL-GRAVITY.md)
- Presence + first-start (DEE-119): [`DEE-119-PRESENCE-CALIBRATION.md`](./DEE-119-PRESENCE-CALIBRATION.md)

**Next slice (not part of DEE-125):** DEE-126 — OpenAI-only model + sampling evaluation on the isolated walkthrough Worker only, prompt held constant.

---

## Document control

| Version | Notes |
|---------|--------|
| 1.0 | DEE-125 — Social presence permission + RU «ты» default + light dedup. |
