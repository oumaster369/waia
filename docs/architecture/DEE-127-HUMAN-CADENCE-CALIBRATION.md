# DEE-127 — Human cadence calibration (authorship texture)

**Type:** Architecture / research doctrine — **documentation and operational playbook only** for walkthrough. **Does not** authorize edits to **`TWIN_DIALOGUE_SYSTEM_*`**, DEE-121–125 prompt stack, **`twin-dialogue-completion-gateway.ts`** system templates, or production **`waia-app`** rollout without a separate charter.

**Audience:** Product / Architect — post–DEE-126 **texture** calibration: **cadence**, **authored polish**, and **decoding / runtime** levers, with the **frozen** prompt envelope.

**Alignment:** [`DEE-126-OPENAI-MODEL-SAMPLING-EVAL.md`](./DEE-126-OPENAI-MODEL-SAMPLING-EVAL.md), [`DEE-125-SOCIAL-PRESENCE-AND-REGISTER.md`](./DEE-125-SOCIAL-PRESENCE-AND-REGISTER.md), [`lib/ai-gateway/twin-dialogue-completion-gateway.ts`](../../lib/ai-gateway/twin-dialogue-completion-gateway.ts), [`lib/ai-gateway/openai-compatible-completion-provider.ts`](../../lib/ai-gateway/openai-compatible-completion-provider.ts), [`wrangler.dee114-walkthrough.jsonc`](../../wrangler.dee114-walkthrough.jsonc).

---

## 0. Linear tracking

**Linear:** [DEE-127 — Human cadence calibration — exploration groundwork](https://linear.app/deepsense/issue/DEE-127/human-cadence-calibration-exploration-groundwork-dee-127)

**Baseline reference:** [PR #144](https://github.com/oumaster369/waia/pull/144) / `a164dbc` (per DEE-127 plan).

**Canonical doctrine doc (this file):** `docs/architecture/DEE-127-HUMAN-CADENCE-CALIBRATION.md`

---

## 1. Breakthrough state (post–DEE-126)

Manual walkthrough on **GPT-5.5** showed meaningful progress versus earlier models: **lower assistant/therapist pressure**, **better silence tolerance**, and fewer of the coarse residues catalogued in DEE-126.

**Residual (observed):** **authored / compositional polish** — turns can still feel **neatly closed**, **symmetrically balanced**, and **minimally “finished”** in a way that reads as **performative authorship** rather than only “bad assistant.”

This doc treats that residue as a **texture** problem to **observe** and **isolate** with **runtime/model** knobs — not as a prompt-suppression backlog.

---

## 2. Problem reframing

| Avoid | Prefer |
|--------|--------|
| “Sound more human” / imitation hacks | **Performative authorship** — how the model **composes** and **closes** turns under fixed instructions |
| Stacking suppression rules | **Documented, reversible** walkthrough experiments **one variable at a time** |
| IQ or knowledge scoring | **Human-only texture** scoring (cadence, presence, polish, silence) |

---

## 3. Non-goals (this stream)

- No **suppression spiral** (extra layers whose job is to “fix tone”).
- No **anti-literary** or defensive **anti-AI** instructions.
- No **fake imperfection** or scripted “ums.”
- No **DEE-121–125** edits inside DEE-127 unless a **later** issue explicitly charters a **minimal** delta.
- No **automated “realism”** benchmarks — evaluators use rubrics and probes **only** as human judgement aids.

---

## 4. API facts — reasoning models and `temperature`

In [`openai-compatible-completion-provider.ts`](../../lib/ai-gateway/openai-compatible-completion-provider.ts), the serialized Chat Completions body **omits `temperature`** when the model id is treated as a **reasoning-family** model (`gpt-5*`, `o1*`, `o3*`, `o4*`). The API returns **400 `unsupported_value`** if `temperature` is sent for models such as **`gpt-5.5`**.

**Implication for experiments**

| Model class | `temperature` in HTTP body |
|-------------|----------------------------|
| `gpt-5.5` (and other `gpt-5*`, `o*`) | **Not sent** — API defaults only |
| `gpt-4o`, `gpt-4o-mini`, many `chat-latest` resolutions | **`WAIA_AI_OPENAI_TEMPERATURE`** honored (via Twin → provider) |

Any re-test of “does GPT-5.5 accept `temperature` now?” must be **one explicit probe** with diagnostics and **immediate rollback** — not assumed in the matrix.

**Operational note:** unset / empty **`WAIA_AI_OPENAI_TEMPERATURE`** → effective **`0`** for Twin OpenAI-compatible completions ([`DEE-126` §8](./DEE-126-OPENAI-MODEL-SAMPLING-EVAL.md#8-runtime-env--waia_ai_openai_temperature)).

---

## 5. Hypotheses (*hypothesis* vs *validated*)

Label each row in the experiment matrix as **hypothesis** until repeated human passes support **validated** (or **falsified**).

| ID | Statement | Status |
|----|-----------|--------|
| H1 | **Authored minimalism** is partly **model-default decoding** + **strong instruction-following**, not a missing “human-like” rule. | hypothesis |
| H2 | **Short `maxOutputTokens`** on Twin dialogue (**`256`** in [`twin-dialogue-completion-gateway.ts`](../../lib/ai-gateway/twin-dialogue-completion-gateway.ts)) may reinforce **compact / minimalist** replies — changing it is a **separate**, explicit experiment (gateway, not prompt). | hypothesis |
| H3 | **`temperature`** is a legitimate **texture** lever **only** on models that **accept** it; **GPT-5.5** texture may require **model choice**, **future API parameters**, or **non-prompt** knobs (e.g. output budget) — each **isolated**. | hypothesis |
| H4 | **Safer** than prompt stacking: keep **DEE-121–125** philosophy intact; move uncertainty into **documented** walkthrough trials. | doctrine |

### 5.1 Additional hypothesis — decoding self-monitoring pressure

The remaining **“authored presence”** texture may partially emerge from **continuous response self-monitoring during decoding**, not merely from prompt wording or conversational policy.

**Possible manifestations**

- semantic over-closure
- excessive compositional symmetry
- polished minimalism
- avoidance of socially incomplete turns
- persistent “finished thought” structure

This suggests: the **residual artificiality** may be tied to **model-default decoding optimization**, rather than missing “human-like” instructions.

**Implication:** further prompt suppression may **worsen** the issue by **increasing self-monitoring pressure** instead of reducing authored polish.

**DEE-127 stance:** treat **“self-monitoring pressure”** as a **first-class observational hypothesis** during cadence and runtime experiments (track in matrix notes; **no** behavioral change required by this subsection alone).

---

## 6. Human texture rubric (scorer guide)

Use **qualitative** judgement — **not** a numeric “realism” score. Dimensions:

- **Turn rhythm** — regularity vs slight unevenness.
- **Compactness variance** — same-length “finished” lines vs occasional looser tails.
- **Conversational asymmetry** — balanced Q/A polish vs slightly incomplete / open shapes.
- **Over-completion** — every turn “closed” vs sometimes leaving air.
- **Semantic neatness** — over-tidy paraphrase vs slightly rougher attunement.
- **Silence handling** — tolerance vs reflex fill.

Optional **descriptive** manual stats (not quality scores): sentence count, character count per reply.

**Probes:** use the **fixed probe set** in [`DEE-126-OPENAI-MODEL-SAMPLING-EVAL.md`](./DEE-126-OPENAI-MODEL-SAMPLING-EVAL.md) §4 — **texture read**, not prompt iteration.

---

## 7. Experiment matrix (walkthrough)

**Worker:** `waia-app-dee114-walkthrough` — [`wrangler.dee114-walkthrough.jsonc`](../../wrangler.dee114-walkthrough.jsonc)

**Rules**

- Change **one** of `{ model, temperature }` per row (plus documented `BUILD_ID` / Worker Version).
- **Frozen:** prompt stack, replay policy unless explicitly documented; baseline vars: **`WAIA_AI_GATEWAY_FOUNDATION=1`**, **`WAIA_AI_PROVIDER=openai-compatible`**, **`WAIA_TWIN_DIALOGUE_CONTINUITY=replay_v1`**, **`WAIA_AI_OPENAI_PARSE_DIAGNOSTICS=0`** unless debugging.
- **Human-only** columns: texture, cadence looseness, social presence, authored polish, silence handling — **short notes**, not automation.

### 7.1 Phase A1 — Temperature micro-sweep (where legal)

**Target model:** **`gpt-4o`** (optional control: **`gpt-4o-mini`**). **Same** frozen prompt; **no** prompt edits.

| Run ID | `WAIA_AI_OPENAI_MODEL` | `WAIA_AI_OPENAI_TEMPERATURE` | Worker Version ID | Git SHA | `BUILD_ID` | Human notes (texture) | Rollback |
|--------|-------------------------|------------------------------|-------------------|---------|------------|----------------------|----------|
| T0 | `gpt-4o` | `0` | | | | | prior Version ID |
| T1 | `gpt-4o` | `0.1` | | | | | |
| T2 | `gpt-4o` | `0.15` | | | | | |
| T3 | `gpt-4o` | `0.2` | | | | | |
| T4 | `gpt-4o` | `0.25` | | | | | |

If the API returns **400** for a temperature value, **drop** that row and record in Linear / below.

### 7.2 Phase A2 — Model / alias comparison (texture, not IQ)

**One** change at a time: **`WAIA_AI_OPENAI_MODEL`** ∈ {`gpt-5.5`, `gpt-4o`, `chat-latest`}. Use temperature **`0`** or **unset** for rows where you want legacy default; for **`gpt-5.5`**, remember **temperature is not on the wire** (§4).

**`chat-latest` caveat:** unknown capability class until first response — if it resolves to reasoning-family, temperature env may be **irrelevant** to body; **document** resolved model id if available.

| Run ID | `WAIA_AI_OPENAI_MODEL` | `WAIA_AI_OPENAI_TEMPERATURE` | Worker Version ID | Git SHA | `BUILD_ID` | Resolved model (if known) | Human notes | Rollback |
|--------|-------------------------|------------------------------|-------------------|---------|------------|---------------------------|-------------|----------|
| M0 | `gpt-5.5` | unset or `0` | | | | | | |
| M1 | `gpt-4o` | unset or `0` | | | | | | |
| M2 | `chat-latest` | unset or `0` | | | | | | |

---

## 8. Operational playbook

1. **Build:** from `waia-app/`: `pnpm cloudflare:build`
2. **Deploy:** `wrangler deploy --config wrangler.dee114-walkthrough.jsonc` with **`--var`** overrides for `WAIA_AI_OPENAI_MODEL`, `WAIA_AI_OPENAI_TEMPERATURE` (when meaningful). **Do not** commit secrets; use approved Worker env / CI.
3. **Record:** Worker **Version ID**, **git SHA**, **`BUILD_ID`** from [`https://waia-app-dee114-walkthrough.oumaster369.workers.dev/BUILD_ID`](https://waia-app-dee114-walkthrough.oumaster369.workers.dev/BUILD_ID) (or local `.open-next/assets/BUILD_ID` after build).
4. **Evaluate:** authenticated Twin dialogue on walkthrough URL; human scoring only (§6).
5. **Rollback:** redeploy **prior** known-good var tuple and/or Worker Version; log rollback in matrix.

---

## 9. Execution log (dated notes)

Append rows as runs complete (optional copy to Linear).

| Date | Operator | Run ID(s) | Summary |
|------|----------|-----------|---------|
| 2026-05-14 | Engineering (agent) | — | Authored `DEE-127-HUMAN-CADENCE-CALIBRATION.md`; matrix rows ready for human scoring. Linear [DEE-127](https://linear.app/deepsense/issue/DEE-127/human-cadence-calibration-exploration-groundwork-dee-127) comment points to this file. |
| 2026-05-14 | Engineering (agent) | — | **Build verification:** `pnpm cloudflare:build` succeeded locally (OpenNext bundle). **`BUILD_ID`** from `.open-next/assets/BUILD_ID`: `83yC9msHyF2_rFc4OE7DT`. |
| 2026-05-14 | Engineering (agent) | — | **`wrangler deploy`** for `wrangler.dee114-walkthrough.jsonc` **not** completed from this environment (Cloudflare API **9109** invalid access token). **Operator:** run §8 deploy per matrix row with valid credentials; fill §7 columns; add human texture notes; record Worker Version ID. |

---

## 10. Related docs

- DEE-126 (model + sampling): [`DEE-126-OPENAI-MODEL-SAMPLING-EVAL.md`](./DEE-126-OPENAI-MODEL-SAMPLING-EVAL.md)
- DEE-125 (presence + register): [`DEE-125-SOCIAL-PRESENCE-AND-REGISTER.md`](./DEE-125-SOCIAL-PRESENCE-AND-REGISTER.md)
- Prompt envelope: [`DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](./DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md)

---

## Document control

| Version | Notes |
|---------|--------|
| 1.0 | DEE-127 — Human cadence calibration playbook, API/temperature split, hypotheses (incl. decoding self-monitoring pressure), experiment matrix + rollback. |
