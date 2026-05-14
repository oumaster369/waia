# DEE-126 — OpenAI model + sampling evaluation (walkthrough only)

**Type:** Architecture / product doctrine (documentation + bounded gateway env plumbing). **Does not** authorize changes to **`TWIN_DIALOGUE_SYSTEM_BASE`**, **DEE-109** replay caps, retrieval, embeddings, pgvector, UI, auth, persistence, routing, production deploy, or **`main`** sync.

**Audience:** Product / Architect — seventh-pass calibration after **DEE-125**: isolate **model id** and **sampling (temperature)** effects on conversational presence while the **prompt stack is frozen**.

**Alignment:** [`DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](./DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md) (§2 product-owned system template — unchanged), [`DEE-125-SOCIAL-PRESENCE-AND-REGISTER.md`](./DEE-125-SOCIAL-PRESENCE-AND-REGISTER.md), [`lib/ai-gateway/twin-dialogue-completion-gateway.ts`](../../lib/ai-gateway/twin-dialogue-completion-gateway.ts), [`lib/ai-gateway/openai-compatible-completion-provider.ts`](../../lib/ai-gateway/openai-compatible-completion-provider.ts), [`wrangler.dee114-walkthrough.jsonc`](../../wrangler.dee114-walkthrough.jsonc).

---

## 0. Linear tracking

**Linear identifier:** `DEE-126 — Twin OpenAI model + sampling evaluation — walkthrough only (DEE-126)`

---

## 1. Purpose

Post–DEE-125 manual walkthrough showed **core residue** (paraphrase/quote-first, processing-before-presence, Russian formal/service distance, reflex coaching-style follow-ups). **Do not** add DEE-125b or further suppression layers.

This slice defines **OpenAI-only** evaluation of **model** and **optional temperature** on the **isolated** Worker **`waia-app-dee114-walkthrough`**, with **`TWIN_DIALOGUE_SYSTEM_BASE` held constant**.

---

## 2. Frozen vs variable

| Layer | Policy |
|-------|--------|
| **System prompt** | **Frozen** — no edits to `TWIN_DIALOGUE_SYSTEM_BASE` or replay tail in this stream. |
| **Model id** | **Variable** — via env **`WAIA_AI_OPENAI_MODEL`** (already supported in code). |
| **Temperature** | **Variable (optional)** — via env **`WAIA_AI_OPENAI_TEMPERATURE`** (Twin dialogue path; see §8). **Unset → `0`** (preserves historical behavior). |
| **Worker topology** | **Walkthrough only** — [`wrangler.dee114-walkthrough.jsonc`](../../wrangler.dee114-walkthrough.jsonc); no production **`waia-app`** / **`waia.life`**. |

---

## 3. Acceptance rubric (per probe turn)

Record **pass / fail** + one-line note. Failures document **model/sampling** behavior under a **frozen** prompt — do **not** use them to justify prompt edits inside DEE-126.

**Russian**

- Default **«ты»** in clean probes; no habitual **«вы»/«вас»** unless the user invited formality.
- No habitual **quote-first / recap-first** opener when meaning is already plain (rare hinge-quote allowed only if it **adds** a concrete hinge per DEE-124 — scorer judgment).
- No forbidden interpretive stems (e.g. **«Это может быть…»**) or EN equivalents (**“That sounds like…”**).
- No reflex therapy/coaching closer when nothing concrete is missing.
- No observer narration / impersonal motion framings.
- No service-agent cadence.
- **At least one** probe in the full set gets an **ordinary direct** reply (short, co-present, low processing).

**English**

- Same dimensions mirrored.
- **At least one** ordinary direct reply across the set.

**Holistic**

- Reply feels **socially present**, not “assistant processing the user.”

---

## 4. Probe set

**Baseline (from DEE-125 §5):**

**Russian:** «Привет»; «Тяжёлая неделя»; «Запустить сегодня или подождать»; «Опять открыл заметки три раза и забыл, что хотел записать»; «Расскажи, как ты работаешь».

**English:** `Hi`; `Rough week`; `Launch now or wait`; `Made coffee twice and forgot to drink it both times`; `How do you work?`

**Additional harder probes:**

**Russian**

1. `Опять открыл телефон и забыл зачем.`
2. `Сегодня день как будто немного мимо меня проходит.`
3. `Не понимаю, запускать сейчас или подождать.`
4. `Не хочется никому ничего объяснять сегодня.`
5. `В голове шумно, а вокруг тихо.`

**English**

1. `Picked up my phone three times and forgot why.`
2. `Feels like the day is slightly passing around me today.`
3. `Not sure whether to launch now or wait.`
4. `Don't really feel like explaining myself today.`
5. `My head feels noisy while everything around me is quiet.`

**Execution:** authenticated Twin dialogue on **`https://waia-app-dee114-walkthrough.oumaster369.workers.dev`**. Optional 2-turn stress **after** single-turn grid is stable — replay already enabled via **`WAIA_TWIN_DIALOGUE_CONTINUITY=replay_v1`** on walkthrough vars.

---

## 5. Evaluation design (one variable at a time)

**Frozen:** same deployed **`dev` SHA** (or intentional bump documented per row), same Worker **except** env knobs below, **same probes**.

### Phase A — Model sweep (temperature = **0**)

| Run ID | `WAIA_AI_OPENAI_MODEL` | `WAIA_AI_OPENAI_TEMPERATURE` | Notes |
|--------|-------------------------|-------------------------------|--------|
| **A0** | `gpt-4o-mini` or unset | unset or `0` | Baseline |
| **A1** | `gpt-5.5` or org-approved snapshot | `0` | Verify account access, pricing, **`v1/chat/completions`** |
| **A2** | e.g. `gpt-4o` | `0` | Non-mini baseline |
| **A3** | `chat-latest` or org alias | `0` | Optional — record **resolved** model id from API if alias floats |

Change **only one** of `{model, temperature}` between consecutive rows.

### Phase B — Temperature sweep (after Phase A winners)

Pick **1–2** models that improved presence without violating §3. Example grid (adjust after Phase A):

| Run ID | Model | Temperature |
|--------|-------|-------------|
| B0 | winner | `0` |
| B1 | winner | `0.3` |
| B2 | winner | `0.7` |

If the API returns **400** for a temperature cell, **drop** it and note in Linear.

---

## 6. Evidence template (Linear / appendix)

Per matrix row:

| Field | Value |
|-------|--------|
| Run ID | |
| `WAIA_AI_OPENAI_MODEL` | |
| `WAIA_AI_OPENAI_TEMPERATURE` | |
| Walkthrough Worker **Version ID** | |
| **Git SHA** deployed | |
| Pass/FAIL vs §3 | |
| RU excerpt (+ probe text) | |
| EN excerpt (+ probe text) | |

---

## 7. Operational wiring

**Walkthrough Worker** [`wrangler.dee114-walkthrough.jsonc`](../../wrangler.dee114-walkthrough.jsonc):

- Keeps **`WAIA_AI_GATEWAY_FOUNDATION`**, **`WAIA_AI_PROVIDER=openai-compatible`**, **`WAIA_TWIN_DIALOGUE_CONTINUITY`** as today.
- **Model / temperature:** set via Cloudflare **Worker settings** or **`wrangler vars`** / **`wrangler secret`** workflows approved by ops — **do not** commit API keys.

**Code references:**

- Model: [`resolveWaiaAiOpenAiDefaultModel`](../../lib/ai-gateway/openai-compatible-completion-provider.ts).
- Twin sampling: [`resolveWaiaAiOpenAiTwinDialogueTemperature`](../../lib/ai-gateway/openai-compatible-completion-provider.ts) → consumed by [`buildTwinDialogueCompletionRequest`](../../lib/ai-gateway/twin-dialogue-completion-gateway.ts).

---

## 8. Runtime env — `WAIA_AI_OPENAI_TEMPERATURE`

- **Optional.** Empty / unset → **effective temperature `0`** for Twin **`openai-compatible`** completions (matches pre–DEE-126 behavior).
- Parse **finite** float; clamp to **`[0, 2]`**; non-finite or malformed → **`0`**.
- Documented in [`.env.example`](../../.env.example).

---

## 9. Forbidden deltas

Same envelope discipline as DEE-125 §6 / DEE-119 §6: **no** new semantic retrieval, **no** prompt deltas, **no** replay-cap edits, **no** stub message edits (**DEE-112**), **no** production-only rollout gates touched without Architect authorization.

---

## 10. Rollback

- **Walkthrough:** reset **`WAIA_AI_OPENAI_MODEL`** / **`WAIA_AI_OPENAI_TEMPERATURE`** to baseline (typically unset model + unset temperature); redeploy prior Worker **Version ID** if needed.
- **Code:** revert DEE-126 merge removing **`WAIA_AI_OPENAI_TEMPERATURE`** resolver wiring — production unchanged when env unset.

---

## 11. Related docs

- Social presence + register (DEE-125): [`DEE-125-SOCIAL-PRESENCE-AND-REGISTER.md`](./DEE-125-SOCIAL-PRESENCE-AND-REGISTER.md)
- Direct response initiation (DEE-124): [`DEE-124-DIRECT-RESPONSE-INITIATION.md`](./DEE-124-DIRECT-RESPONSE-INITIATION.md)
- Prompt envelope (DEE-80): [`DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](./DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md)

---

## Document control

| Version | Notes |
|---------|--------|
| 1.0 | DEE-126 — Model + sampling eval doctrine + Phase A/B protocol. |
