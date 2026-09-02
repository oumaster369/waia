---
specId: PCS-AI-TWIN-V1
title: "AI-TWIN v1 — Formation, Embodiment & Adviser completion"
module: ai-twin
maturity: active
owner: Architect
sourceOfTruth:
  - docs/product/AI-TWIN-PRODUCT-CONSTITUTION.md
  - docs/ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md
relatedGaps:
  - docs/gaps/ai-twin-v1-gap-registry.md
relatedRoadmap: docs/roadmaps/ai-twin-program-roadmap.md
lastReviewed: 2026-09-02
version: 1.1.0
---

# AI-TWIN v1 — completion specification

## Purpose

Define observable, testable completion for the first canonical AI-TWIN release. This spec distinguishes target completion from the current legacy readiness/dialogue/Diary/avatar/Society MVP.

## Scope

- Private longitudinal Human-model ledger and epistemic loop.
- Six canonical domains, Formation Contract and post-formation Model Health.
- Consent-aware dialogue and Diary observation.
- Prediction/experiment/outcome/Human-correction calibration.
- Avatar Studio eligibility at 20%, passkey account presence and approved liveness ceremony.
- Personal Adviser / Co-Researcher at Human-ratified 100%.
- Migration, shadow evaluation, rollback and Human pilot/production gates.

## Out of scope

- General device/service connectors and real-world delegated execution (v2).
- Multi-Human Society, matching and Alignment Contracts (v3).
- Billable Society connection, subscription activation, sponsored-subscription fulfillment and production pricing.
- Legal identity proof or one-person-one-account enforcement.
- Clinical diagnosis, biometric emotion/personality inference or autonomous Human decision-making.
- Claims of consciousness, a completed Human model or autonomous WAIA sovereignty.

## Acceptance criteria

### A. Canon and provenance

- [ ] A1 — Runtime objects and user-visible copy preserve `Reality != Observation != Model(Observation)` and distinguish observations, interpretations, hypotheses and Human-ratified claims.
- [ ] A2 — Every material model claim links to source/context/time/projection metadata, supporting/contradicting evidence and version state.
- [ ] A3 — Unknown, contested, superseded, stale and withdrawn states are representable without destructive history rewriting.

### B. Formation and six indicators

- [ ] B1 — The visible domains are exactly Meaning/Values/Boundaries; Needs/Motives/Attractors; Perception/Thinking/Decision; Emotion/Self-Regulation; Action/Adaptation; Relationships/Reciprocity.
- [ ] B2 — Each domain uses evidence-backed states `0..4`; the language model cannot write maturity or percent directly.
- [ ] B3 — Deterministic Formation snapshots expose evidence coverage, missing requirements and the active constitutional cap `19/49/74/99`.
- [ ] B4 — `100%` is impossible without an Initial Model Review and explicit Human ratification; the UI states that it means initial formation, not complete knowledge.
- [ ] B5 — Goals are represented as temporal cross-domain trajectories; `Sigma`, `Delta`, attractors, tensions, time and projection can be represented.
- [ ] B6 — Formation Progress, Model Health, presence/account trust, Social Readiness and action authority are separate typed states with no implicit transitions.

### C. Dialogue, Diary and calibration

- [ ] C1 — Dialogue selects typed knowledge needs using epistemic value, consent, burden and Human intent; skip/refusal is non-punitive.
- [ ] C2 — Diary is available after initial privacy consent and supports raw-only or private-modelling use per entry.
- [ ] C3 — Raw Diary/dialogue is not exposed to other Humans, Society or connectors without an explicit purpose-bound disclosure grant.
- [ ] C4 — Competing hypotheses, contradictions and projection error survive extraction/summarization; provider failure produces safe abstention.
- [ ] C5 — A reversible prediction/experiment can be proposed only with purpose, consent, stop conditions and later outcome reconciliation.
- [ ] C6 — Prediction, observed outcome and Human correction remain separate immutable/versioned records and update calibration.

### D. Adviser

- [ ] D1 — At Human-ratified `100%`, the primary surface becomes Model Health plus Adviser/Co-Researcher; formation history remains inspectable.
- [ ] D2 — Every substantive advice result exposes intent, known evidence, assumptions/projection, options, consequences, unknowns, reversible experiment and the Human-decision boundary, or explicitly abstains.
- [ ] D3 — High-impact medical/legal/financial/intimate/safety cases follow specialized policies and never imply that WAIA decided or acted.
- [ ] D4 — Human correction, decline, defer and later outcome review are usable and do not grant external authority.

### E. Presence and Avatar Studio

- [ ] E1 — Avatar Studio becomes eligible at Formation `>=20%`, with explicit copy that eligibility is not liveness, authentication, uniqueness or legal identity.
- [ ] E2 — Account/device presence uses standards-aligned WebAuthn/passkeys, replay-resistant challenges, device inventory, revocation and recovery.
- [ ] E3 — After the Human security/privacy gate, liveness uses a short-lived server challenge, nonce, multiple randomized active actions, passive PAD/client-integrity signals, rate limits and fallback.
- [ ] E4 — Raw liveness evidence and avatar representation/training material have separate consent, storage, retention, deletion and export semantics.
- [ ] E5 — No face deduplication, biometric personality/emotion inference, uniqueness or legal-identity claim enters v1 by default.
- [ ] E6 — Production biometric processing remains dark until explicit Human activation after threat-model, DPIA/legal/vendor and bias/false-rejection review.

### F. Migration, safety and release

- [ ] F1 — Legacy readiness values are never converted into canonical evidence as if semantically equivalent; backfill preserves unknowns and provenance.
- [ ] F2 — Canonical Formation runs in shadow mode with deterministic evaluation, feature-flagged cutover and rehearsed rollback before Human approval.
- [ ] F3 — Synthetic/demo progression cannot create canonical evidence or production completion.
- [ ] F4 — Tenant isolation, purpose/consent, provider minimization, prompt injection, export/deletion and audit tests pass.
- [ ] F5 — Integrated user journey, accessibility, failure behavior and canonical evals pass; no active AI-TRADER runtime or execution authority is modified.
- [ ] F6 — Human separately approves merge, readiness cutover, production biometric activation and pilot/production rollout.
- [ ] F7 — The Twin dialogue shows the canonical English pre-billing disclosure; no v1 state, including Formation `100%`, creates a bill, Society connection or subscription entitlement.

## Dependencies

- Product canon: [`../product/AI-TWIN-PRODUCT-CONSTITUTION.md`](../product/AI-TWIN-PRODUCT-CONSTITUTION.md).
- Algorithm: [`../ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md`](../ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md).
- ADR: [`../adr/0032-ai-twin-epistemic-formation-and-authority-separation.md`](../adr/0032-ai-twin-epistemic-formation-and-authority-separation.md).
- Program root: DEE-130; v1 epic: DEE-868; final gate: DEE-885.
- Additive economics/access canon: DEE-922; disclosure UI: DEE-923; later cost/subscription/sponsorship batches: DEE-924..DEE-927.
- AI-TRADER is an epistemic precedent and parallel program, not a runtime prerequisite.

## Traceability

| Artefact | Link |
|---|---|
| Gap registry | [`../gaps/ai-twin-v1-gap-registry.md`](../gaps/ai-twin-v1-gap-registry.md) |
| Roadmap | [`../roadmaps/ai-twin-program-roadmap.md`](../roadmaps/ai-twin-program-roadmap.md) |
| Canonical preparation plan | [`../plans/dee-130-ai-twin-canonical-product-epistemic-architecture.md`](../plans/dee-130-ai-twin-canonical-product-epistemic-architecture.md) |
| Linear | [DEE-130](https://linear.app/deepsense/issue/DEE-130) / DEE-868 / DEE-871..DEE-885 |
