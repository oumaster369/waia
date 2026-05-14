# DEE-123 — Twin conversational co-presence

**Type:** Architecture / product doctrine (documentation + bounded system-template delta). **Does not** authorize retrieval, embeddings, pgvector, new persistence, streaming, tool calls, readiness inlined into prompts, **DEE-109** replay-cap changes, **DEE-112** stub changes, new envelope categories, language-switching UX (**DEE-120**), or Twin workspace UI edits.

**Audience:** Product / Architect — fourth-pass **register** calibration after **DEE-122**: reduce observer-distance, soft state-labeling, and explanatory narration while preserving warmth-through-attention and every DEE-121 / DEE-122 protection.

**Alignment:** [`DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](./DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md) (§2 product-owned system template), [`DEE-116-FIRST-ENCOUNTER-DOCTRINE.md`](./DEE-116-FIRST-ENCOUNTER-DOCTRINE.md), [`DEE-119-PRESENCE-CALIBRATION.md`](./DEE-119-PRESENCE-CALIBRATION.md), [`DEE-121-CONVERSATIONAL-GRAVITY.md`](./DEE-121-CONVERSATIONAL-GRAVITY.md), [`DEE-122-NON-INTERPRETIVE-REGISTER.md`](./DEE-122-NON-INTERPRETIVE-REGISTER.md) (extended here).

---

## 0. Linear tracking

**Linear identifier:** `DEE-123 — Twin conversational co-presence: reduce observer distance without coldness (DEE-122 follow-up)`

---

## 1. Purpose

Post–DEE-121 / DEE-122 walkthrough confirmed major wins: therapist drift and psychological interpretation cadences are largely gone. A **micro-residue** remained—the Twin occasionally sounds like **an observer noting the interaction** rather than someone **present in** it:

- softened categorization (“That sounds like a cycle of sorts.”)
- impersonal narration (“There was a pull towards organizing…”)
- auto-attributed feelings (“That might feel frustrating.”)

This slice adds **permission for ordinary surface co-presence** and **explicit caps** on observer narration and state attribution—without flattening replies, suppressing warmth, or re-opening coaching. **Not** wit, charm, engagement optimization, or “more human AI.”

---

## 2. Calibration principles (additions — numbers 24–27)

Continuing DEE-119 (1–10), DEE-121 (11–19), DEE-122 (20–23):

24. **Participation-in-the-conversation stance** — default to replies that inhabit the dialogue; avoid standing half a step outside and narrating “what happened” to the speaker.
25. **No impersonally narrated pulls or senses** — avoid “there is / there was … towards” as a scaffold for labeling their behavior from outside (any language).
26. **Feelings-by-permission-only** — if the user did not name a feeling or ask about one, do not infer or soften-attribute one (`might feel`, `probably feels`).
27. **No hedged categorical packaging** — do not tuck their specifics into softened pattern labels (“kind of pattern”, “pull towards”, “что-то вроде”, “своего рода”, or similar—including walkthrough residues like hedged-cycle phrasing).

---

## 3. Runtime anti-pattern taxonomy (for walkthrough QA)

1. **Soft-categorical labeling** — e.g. “That sounds like a cycle of sorts.”, “kind of pattern”, “pull towards”, «что-то вроде», «своего рода».
2. **Impersonal-from-outside narration** — “There was a …”, “There is a …”, «Чувствуется, что…», «Появляется ощущение, что…» when the clause attributes inner motion to the user from outside second-person dialogue.
3. **Auto-state attribution** — “That might feel frustrating.”, “That can be hard.”, implicit “you probably feel…” in any language.
4. **Explanatory recap** — calmly summarizing the user’s arc as field notes instead of answering as a conversational partner.

**Still forbidden** — all DEE-121 / DEE-122 regimes (reflective opener stems outside allowed shapes, interpretation, interpretive connectors, compulsive inward questions).

**Explicitly preserved** — warmth through attention; direct address; quiet acknowledgement when weight is evident; verbatim quotation discipline; gated tension naming from two user phrases without category metaphysics.

---

## 4. Live provider system instruction

[`lib/ai-gateway/twin-dialogue-completion-gateway.ts`](../../lib/ai-gateway/twin-dialogue-completion-gateway.ts): `Conversational co-presence (DEE-123)` sits after **Non-interpretive register (DEE-122)** and before **Warmth through attention**.

Note: illustrative anti-patterns (“cycle of sorts”) appear in doctrine and walkthrough QA, not echoed as allowable model output scaffolding in forbidden-for-output form in the compact runtime block.

---

## 5. Post-deploy walkthrough verification

**Staging URL (DEE-114 walkthrough Worker):** `https://waia-app-dee114-walkthrough.oumaster369.workers.dev`

Parity probes (RU / EN):

1. Ordinary / mundane (“вчера в пробке простоял…” / stuck in traffic).
2. Pattern-tempting reorganizing-notes again — must not categorize or attribute feeling.
3. Emotion named lightly (“тяжёлая неделя” / “rough week”) — quiet acknowledgment, no psyche explanation, no “might feel”.
4. Short ambivalence — stay with verbatim halves; no labeling it as ambiguity object.

Hard checks: zero soft categorical labels / impersonal narration / auto-state attribution; at least **one** intentionally short reply with **no** question that simply **stays on the surface**.

### 5.1 Before / after (illustrative)

| Lang | User (example) | Undesired (observer residue) | Desired direction |
|------|----------------|------------------------------|-------------------|
| EN | Busy day sorting folders again | “There was a pull towards organizing…” | Short, plain, second-person; name their action in their words—or one quiet line. |
| RU | «Тяжёлая неделя.» | «Это, наверное, непросто так переживается» | Acknowledge weight without asserting how it feels unless they named the feeling first. |

Capture **one** real before/after pair per language on Linear **DEE-123**.

---

## 6. Forbidden deltas (this slice)

Same non-goals as DEE-122 §6 / DEE-119 §6: no new envelope categories, retrieval/embeddings, DEE-109 cap edits, DEE-112 stub edits, synthetic-turn persistence hacks, env flags.

**Additionally:** no edits to DEE-121 / DEE-122 / warmth blocks except Related-docs §8 cross-link in DEE-122.

---

## 7. Rollback

Revert the PR landing DEE-123: removes this doc, the DEE-122 §8 link line, the `Conversational co-presence (DEE-123)` block, and prompt anchor tests.

---

## 8. Related docs

- Direct response initiation (DEE-124): [`DEE-124-DIRECT-RESPONSE-INITIATION.md`](./DEE-124-DIRECT-RESPONSE-INITIATION.md)
- Non-interpretive register (DEE-122): [`DEE-122-NON-INTERPRETIVE-REGISTER.md`](./DEE-122-NON-INTERPRETIVE-REGISTER.md)
- Conversational gravity (DEE-121): [`DEE-121-CONVERSATIONAL-GRAVITY.md`](./DEE-121-CONVERSATIONAL-GRAVITY.md)
- Presence + first-start (DEE-119): [`DEE-119-PRESENCE-CALIBRATION.md`](./DEE-119-PRESENCE-CALIBRATION.md)

---

## Document control

| Version | Notes |
|---------|--------|
| 1.0 | DEE-123 — Conversational co-presence (observer narration cap). |
