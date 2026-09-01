# WAIA v1 — MVP product & engineering hub

**Audience:** Humans + autonomous agents onboarding to WAIA in ≤15 minutes. **This file indexes; it does not replace deeper specs.**

| Quick links | |
|-------------|--|
| **Semantics & autonomy** | [`../waia-governance/GLOSSARY.md`](../waia-governance/GLOSSARY.md), [`SYSTEM-MAP.md`](../waia-governance/SYSTEM-MAP.md), [`NON-GOALS.md`](../waia-governance/NON-GOALS.md) |
| **Execution** | Repo [`AGENTS.md`](../../AGENTS.md), [`../waia-governance/EXECUTION-CONTRACT.md`](../waia-governance/EXECUTION-CONTRACT.md), [`AUTONOMOUS-EXECUTION-LOOP.md`](../waia-governance/AUTONOMOUS-EXECUTION-LOOP.md) |
| **Completion specs** | [`../product-specs/`](../product-specs/) — module *done* layer ([`PRODUCT-COMPLETION-SPEC-STANDARD`](../waia-governance/PRODUCT-COMPLETION-SPEC-STANDARD.md)) |
| **Gaps & roadmaps** | [`../gaps/`](../gaps/), [`../roadmaps/`](../roadmaps/) — intake → batch sequencing |
| **Architectural WHY** | [`../adr/`](../adr/README.md) |
| **AI-TWIN target canon** | [`AI-TWIN-PRODUCT-CONSTITUTION.md`](AI-TWIN-PRODUCT-CONSTITUTION.md), [`../ai-twin/README.md`](../ai-twin/README.md), [`../product-specs/ai-twin-v1-completion.md`](../product-specs/ai-twin-v1-completion.md) |

---

## Human-centered scope (v1)

WAIA is a **human-centered AI ecosystem**: the person, their stated intent, free will and ongoing alignment are primary. The shipped MVP concentrates on dialogue, reflection, Diary and legacy readiness progression. The Human-ratified target is **AI-TWIN v1 — Formation, Embodiment & Adviser**: a private, temporal and evidence-backed co-researcher with Diary available from consent, explicit initial-model ratification and a separate post-formation Model Health/Adviser state. Runtime stabilization remains enabling infrastructure.

> **Current/target boundary:** the legacy journey and `{0,33,67,100}` thresholds below remain current-runtime evidence until DEE-884 cutover. They must not be extended as target semantics. New work follows [`AI-TWIN-PRODUCT-CONSTITUTION.md`](AI-TWIN-PRODUCT-CONSTITUTION.md).

## North Star

**Increase alignment over time** between a person’s stated values, observed behavior, growing self-awareness, and long-term life trajectory—as modeled and refined through Twin dialogue, Diary, and governed product surfaces.

---

## Vision (now)

**Primary outcome:** Deliver canonical **AI-TWIN v1** (Formation, Embodiment & Adviser) through DEE-868/DEE-871..DEE-885. Connected context/actions are v2; Society/Alignment Contracts are v3. **Engineering in parallel:** stabilize shared runtime and complete AI-TRADER without coupling domain state or authority.

---

## AI-Twin v1 is NOT

WAIA’s direction includes purposeful AI-TWIN assistance, but knowledge never grants authority. Society exploration, disclosure, consent and real-world action are separate capability systems. The invariant is `request != plan != permission != execution attempt != factual real-world result`.

- The **human user** remains the **primary authority.**
- **Diary** and dialogue act as continuing **alignment and preference surfaces**, not ornament.
- The system may **ask clarifying questions** about autonomy, boundaries, permissions, social behavior, and interaction strategy.
- The user may **refine, restrict, expand, or redirect** AI-Twin behavior through dialogue and Diary.

**AI-Twin v1 is not:**

- A runaway or unconstrained autonomous entity.
- An unconstrained **replacement identity** for the user.
- A hidden behavioral manipulation / profiling subsystem **as product intent**.
- A production **psychological diagnosis** or clinical assessment engine.

**MVP emphasis** (until Society is unlocked and beyond): **self-reflection**, **behavioral-consistency modeling**, **user-guided evolution**, **readiness progression**, and **interaction that stays within explicit alignment pathways**—not maximum autonomous operation on day one.

---

## Canonical product surfaces

| Slice | Canonical doc |
|-------|----------------|
| Target product meaning and Human sovereignty | [`AI-TWIN-PRODUCT-CONSTITUTION.md`](AI-TWIN-PRODUCT-CONSTITUTION.md) |
| Epistemic/formation/advice/action/Society algorithm | [`../ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md`](../ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md) |
| v1 completion, gaps and batches | [`../product-specs/ai-twin-v1-completion.md`](../product-specs/ai-twin-v1-completion.md), [`../gaps/ai-twin-v1-gap-registry.md`](../gaps/ai-twin-v1-gap-registry.md), [`../roadmaps/ai-twin-program-roadmap.md`](../roadmaps/ai-twin-program-roadmap.md) |
| Legacy current-runtime flow/readiness/dashboard | [`ai-twin-user-flow.md`](ai-twin-user-flow.md), [`ai-twin-readiness-model.md`](ai-twin-readiness-model.md), [`ai-twin-dashboard-shell.md`](ai-twin-dashboard-shell.md) |
| Twin dialogue *training modes* | [`../DIALOGUE_MODES_V1.md`](../DIALOGUE_MODES_V1.md) |
| Landing (if differentiated) | [`waia-landing.md`](waia-landing.md) |
| User stewardship, universal access & mutual support | [`waia-user-stewardship-doctrine.md`](waia-user-stewardship-doctrine.md) |
| Conscious contribution & Development Fund | [`waia-conscious-contribution-development-fund-doctrine.md`](waia-conscious-contribution-development-fund-doctrine.md) |

**Privacy invariant (Diary literal text never leaks to Society feeds)** — documented in [`ai-twin-user-flow.md`](ai-twin-user-flow.md) §8.

---

## Legacy current-runtime journey snapshot (migration evidence)

| Phase | Highlights |
|-------|-------------|
| Entry | Landing → Auth → Dashboard (Twin active; Diary/Society locked) |
| Progress | Twin dialogue optionally + Diary ≥60%; readiness never exceeds 100% |
| Diary unlock | Total Readiness ≥ **60%** |
| Completion prep | Total Readiness = **100%** exposes **Socialization** action (**Society stays locked**) |
| Post Socialization | Society usable + single final acknowledgment message semantics |

Detailed triggers / edge handling: **same table expanded** upstream—do not reinterpret here.

---

## Unlock logic (observe only)

Source of legacy thresholds: **`ai-twin-user-flow.md` §5–6**. Target Formation caps, Diary-from-consent, Avatar `20%` eligibility and Human-ratified `100%` are owned by the AI-TWIN canon. Never mix the two models in one computation.

---

## MVP definition of done (engineering + product checklist)

_Product (high level)_  
- Implemented surfaces match authoritative flow + shell docs for MVP states. **No contradiction** unlock ordering.

_Engineering_  
- Tests & CI patterns per [`AGENTS.md`](../../AGENTS.md): `pnpm lint`, `pnpm typecheck`, `pnpm test --run`, `pnpm build` (+ e2e if UI-critical).  
- Runtime/migration alterations carry tracker memory lines when applicable ([`DOCUMENTATION-STANDARDS`](../waia-governance/DOCUMENTATION-STANDARDS.md)).

_Governance readiness_  
- Risk tier labelled on infra PRs ([`RISK-TIERS`](../waia-governance/RISK-TIERS.md)).  
- Architectural policy shifts prefer ADRs ([`ADR-POLICY`](../waia-governance/ADR-POLICY.md)).

---

## Relationship to migrations & stabilization

Operational sequencing + forbidden shortcuts tracked in:

- [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md)  
- Strategy / telemetry: **`DEE-95*`** markdown cluster

Readable bridge: [`MIGRATION-GOVERNANCE`](../waia-governance/MIGRATION-GOVERNANCE.md)

---

## Linear spine (starting points—not exhaustive authoritative board state)

Refer to live Linear for status. **Common structural parents** referenced in specs:

| Theme | Typical anchor issues |
|-------|-----------------------|
| User flow authoring | [`DEE-7`](https://linear.app/deepsense/issue/DEE-7) lineage |
| Landing / Dashboard shell | [`DEE-8`](https://linear.app/deepsense/issue/DEE-8), [`DEE-13`](https://linear.app/deepsense/issue/DEE-13) |
| Dialogue modes | [`DEE-20`](https://linear.app/deepsense/issue/DEE-20) |
| Readiness model | [`DEE-22`](https://linear.app/deepsense/issue/DEE-22) |
| Society / Socialization | [`DEE-53`](https://linear.app/deepsense/issue/DEE-53)+ |
| Canonical AI-TWIN program | [`DEE-130`](https://linear.app/deepsense/issue/DEE-130), DEE-868 / DEE-870 / DEE-869 |
| Persistence / Postgres slices | **`DEE-72`** family |
| Runtime routing / telemetry backbone | **`DEE-92`**, **`DEE-95*`** lineage |

Stale status hygiene guidance: [`ARCHITECT NEXT STEPS → Linear checklist`](../waia-governance/LINEAR-ARCHITECT-NEXT-STEPS.md).

---

## When unsure

STOP + escalate via [`EXECUTION-CONTRACT`](../waia-governance/EXECUTION-CONTRACT.md) **ambiguity ladder** rather than patching this summary with new semantics.

**Last anchored:** onboarding hub introduction (2026-05-07). Update only with Architect/product-approved deltas.
