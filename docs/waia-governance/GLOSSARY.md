# Glossary — WAIA DEV OS (AI-Twin v1 context)

Anchors cite canonical docs. **Do not redefine** upstream product wording—link instead.

## Core product constructs

| Term | Meaning | Canon |
|------|---------|-------|
| **WAIA** | Modular AI-driven ecosystem roadmap; MVP slice = AI-Twin v1 plus stabilization. | [`AGENTS.md`](../../AGENTS.md) preamble |
| **AI-Twin** | Structured personality model built via dialogue (+ optional diary); six readiness axes. | [`../product/ai-twin-user-flow.md`](../product/ai-twin-user-flow.md) §4 |
| **Readiness indicator** | One of Values, Behavior, Thinking, Emotions, Interests, Goals (0–100 observable). | user flow §4 / readiness model |
| **Total Readiness** | Aggregated [0–100] capped; gates Diary / Socialization thresholds. | user flow §5 + [`../product/ai-twin-readiness-model.md`](../product/ai-twin-readiness-model.md) |
| **Twin mode** (dashboard) | Workspace hosting AI-Twin creation dialogue (`Twin` tab). | user flow glossary |
| **Diary mode** | Behavioral memory journaling; unlocked ≥60% readiness. | user flow |
| **Society mode** | Social network workspace; unlocked only **after Socialization succeeds**. | user flow §5.4 |
| **Socialization** | Product **transition event / gate** (not “a button” alone): **after 100% readiness**, required **before Society unlock**; begins the Twin’s interaction with the broader AI-Twin network under flow rules. | [§ Socialization](#socialization) · user flow / dashboard specs |
| **Aligned autonomy** | Twin agency within user-shaped bounds; evolves through dialogue, Diary, and governance. | [§ Aligned autonomy](#aligned-autonomy) · [`WAIA-V1-MVP-SPEC`](../product/WAIA-V1-MVP-SPEC.md#ai-twin-v1-is-not) |

## Dialogue vocabulary

| Term | Meaning | Canon |
|------|---------|-------|
| **Twin dialogue training mode** | Cognitive routing label inside Twin chat (`reflection`, `clarification`, …) — distinct from dashboard Modes. | [`../DIALOGUE_MODES_V1.md`](../DIALOGUE_MODES_V1.md) §1 |
| **`trainingMode` id** | String enum influencing future extraction routing—not a readiness percentage. | DIALOGUE_MODES_V1 |

## Operational / governance

| Term | Meaning |
|------|---------|
| **Migration wave** | Sequenced batch (e.g. DEE-64 slice, DEE-95 phase) with explicit tracker bullets. |
| **Runtime route** | HTTP/App Router endpoint behavior—especially under `GET/POST api/**`. |
| **Telemetry** | Emitted operational signals (`waia_runtime_route`, etc.—see migrations strategy docs). |
| **Governance** | Executable conventions in `docs/waia-governance/**` + repo `AGENTS.md`. |
| **Autonomy** | Agent automation boundary per [`RISK-TIERS.md`](RISK-TIERS.md). |
| **Human approval gate** | Architect/human-required decision checkpoints ([`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md)). |
| **WAIA Architect** | Human **final authority** for architecture, semantics, and governance merges; escalation destination. See [§ WAIA Architect](#waia-architect), [`AGENT-ROLES.md`](AGENT-ROLES.md). |
| **ADR** | Lightweight Architecture Decision Record (see [`ADR-POLICY.md`](ADR-POLICY.md)). |

## Canonical definitions

### Socialization

- **Gate / transition event** in the MVP journey—not reducible to a single UI control label.
- **Timing:** proceeds in product flow once **full readiness** (100%) context is satisfied; **Society remains locked** until Socialization succeeds.
- **Meaning:** the **start** of disciplined AI-Twin exposure to the **broader WAIA Society layer** (networked interaction semantics), consistent with canonical user-flow and dashboard docs.

### WAIA Architect

- **Human** role: **final** architectural and semantic approval, production and governance decisions where the [`EXECUTION-CONTRACT`](EXECUTION-CONTRACT.md) reserves humans.
- **Escalation destination** when agents hit STOP/ambiguity on product-vs-implementation contradiction.
- **Preserves coherence** among product narrative, WAIA DEV OS conventions, and durable technical posture (often via PR/ADR ritual). **Executing agents** surface work; the **Orchestrator** shorthand is continuity **labeling only** ([`AGENT-ROLES.md`](AGENT-ROLES.md))—not a substitute for Architect authority.

### Aligned autonomy

**Bounded AI-Twin agency**: the Twin may initiate or carry actions **within** user guidance, **Diary-assisted** alignment, platform and governance constraints, behavioral memory, and **interaction preferences that can change over time**. Depth may increase through dialogue, Diary use, explicit correction, observed patterns, and readiness progression—it is **never** unconditional or user-disconnected.

## Related

[`SYSTEM-MAP.md`](SYSTEM-MAP.md) · [`NON-GOALS.md`](NON-GOALS.md)
