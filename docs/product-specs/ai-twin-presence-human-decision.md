---
specId: PCS-AI-TWIN-PRESENCE-DECISION
title: "AI-TWIN Presence, Biometric Privacy and Avatar — Human decision"
module: ai-twin
maturity: proposed
owner: Architect
sourceOfTruth:
  - docs/product/AI-TWIN-PRODUCT-CONSTITUTION.md
  - docs/ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md
relatedGaps:
  - docs/gaps/ai-twin-v1-gap-registry.md
relatedRoadmap: docs/roadmaps/ai-twin-program-roadmap.md
lastReviewed: 2026-09-01
version: 0.1.0
---

# AI-TWIN Presence, Biometric Privacy and Avatar — Human Decision

**Status:** Decision requested; no biometric implementation authorized
**Issue:** DEE-873
**Blocks:** DEE-880 final trust composition, DEE-882 liveness implementation and DEE-883 Avatar provider integration

## Purpose

Present the smallest explicit Human decisions required to preserve free will, biometric privacy and truthful trust claims before any downstream AI-TWIN liveness or Avatar implementation begins.

## Scope

- v1 liveness strategy and the exact claim it may produce;
- raw-evidence and reusable-template posture;
- fallback and accessibility contract;
- downstream DARK-only implementation authority;
- vendor evidence and later production activation boundary.

## Out of scope

- selecting or contracting a production vendor;
- setting final retention periods without processor and jurisdiction evidence;
- implementing passkeys, liveness, Avatar generation or runtime changes;
- authorizing production biometric processing;
- uniqueness, legal identity, face deduplication or biometric emotion/personality inference.

## Acceptance criteria

- [ ] The Human records D1–D5 using the decision template or an equivalently explicit statement.
- [ ] Any revision preserves the canonical separation of Formation, authentication, liveness, uniqueness, legal identity, representation approval and action authority.
- [ ] Downstream plans retain DARK-by-default activation and their independent Human merge/production gates.
- [ ] Unresolved vendor, jurisdiction, retention or performance questions remain visibly open rather than inferred as approved.

## 1. What is already canonical

The following is not reopened by this decision:

- Avatar Studio becomes eligible at Formation `>=20%`, but this is only product eligibility.
- Formation, liveness, account authentication, uniqueness, legal identity, representation approval and action authority are different states.
- Passkeys/WebAuthn protect account and device access independently of WAIA liveness.
- “Say cheese” can be one randomized action, never the only proof.
- v1 does not perform face deduplication, uniqueness checking, civil/legal identity proofing or biometric emotion/personality inference.
- liveness material and Avatar source/training material have separate consent, storage, retention, deletion and export.
- refusal, cancellation or failure does not reduce Formation and cannot remove core account access.
- production biometric processing remains `DARK` until a later activation decision with measured evidence.

## 2. Decision now required

DEE-873 can establish the architecture boundary, but a Human must choose the risk posture before downstream implementation begins.

### D1 — v1 liveness strategy

| Option | Meaning | Benefit | Cost/risk |
|---|---|---|---|
| **A — Non-biometric v1** | Launch Avatar workflow with passkey, rate limits, disclosure/provenance and optional Human review; no camera PAD gate | Lowest biometric/privacy risk; fastest honest launch | Does not produce a liveness result; synthetic/replayed source risk handled by other controls |
| **B — Privacy-minimized PAD adapter (recommended for evaluation)** | Build a vendor-neutral, `DARK` liveness path; select a provider only after DPIA, contract and independent benchmark | Can reduce replay/presentation abuse while preserving exit/fallback | Processor, transfer, bias, false-reject, breach and vendor-change risk; requires real evaluation |
| **C — First-party/self-hosted PAD** | WAIA operates capture and PAD models itself | Greater infrastructure/data-path control | Highest v1 engineering, security, dataset, bias and ongoing adversarial-research burden; not recommended for v1 |

Recommendation: authorize **B for DARK evaluation only**, not production. Preserve **A** as the launch/fallback posture if vendor evidence, DPIA or accessibility thresholds do not pass. Do not choose C for v1 without a separate resourced program.

### D2 — admitted claim

Recommended exact claim:

> For one short-lived ceremony, WAIA received evidence meeting the approved policy that a live Human responded while an authenticated account session was present.

Approve or revise this wording. Any wording implying unique, real-world or legal identity stays prohibited.

### D3 — raw-evidence posture

Recommended default:

- process raw liveness media ephemerally and erase it immediately after the terminal decision;
- retain no reusable central face template;
- store only a minimal subject-scoped categorical receipt;
- permit a short raw dispute/debug window only as a separately justified, explicitly chosen exception after counsel/DPO review.

Exact receipt, telemetry, backup and Avatar-source durations remain to be selected after vendor and jurisdiction evidence exists.

### D4 — fallback and accessibility

Recommended posture:

- liveness is never required for core WAIA account access or Formation;
- an accessible alternative action catalog and adjustable timing are mandatory;
- `INCONCLUSIVE` and `TECHNICAL_ERROR` are not failures;
- a Human-review/non-biometric route may grant only the specifically reviewed Avatar capability and never fabricate `liveness = PASS`;
- no public or social badge exposes the result.

### D5 — production activation authority

Recommended posture:

1. DEE-873 approves architecture only.
2. DEE-880 may implement passkeys independently.
3. DEE-882 may implement a provider-neutral pipeline behind `DARK` controls only after D1–D4 are approved.
4. A provider cannot be selected until its contract, regions, subprocessors, retention/deletion and evaluation evidence pass the DPIA packet.
5. Production activation requires a new explicit Human decision after representative security, accessibility, false-accept, false-reject and differential-performance evidence.

## 3. Vendor evaluation scorecard

Each candidate is marked `PASS`, `FAIL`, `UNKNOWN` or `NOT_APPLICABLE`; `UNKNOWN` never contributes to approval.

| Gate | Required evidence | Blocking |
|---|---|---|
| Purpose boundary | Liveness-only configuration; no identity/dedup/emotion/sensitive-trait features | Yes |
| Data location | Controller/processor/subprocessor and region map | Yes |
| Secondary use | Enforceable no-training/no-unrelated-use terms | Yes |
| Raw/template retention | Exact default/max durations and deletion proof | Yes |
| Security | Independent PAD scope plus injection/SDK/API controls | Yes |
| Version control | Model/version pinning or advance change notice and requalification | Yes |
| Performance | Attack/bona fide errors with sample sizes and confidence intervals | Yes |
| Fairness/accessibility | Demographic, disability, device/environment evidence and fallback | Yes |
| Rights | Access/export/delete/withdrawal cascade and SLA | Yes |
| Incident/exit | Notification, kill switch, termination export/deletion | Yes |
| Commercial/operational | Cost, latency, availability and support | No; compare after safety gates |

## 4. Evidence required for the later production decision

- completed jurisdiction-specific DPIA/legal review;
- signed processor/subprocessor and data-transfer posture;
- end-to-end data-flow and retention map with named durations;
- attack corpus results for replay, deepfake, relay, virtual-camera and injection families;
- false-accept, false-reject, inconclusive and technical-error distributions;
- confidence intervals and sample sizes for relevant demographic, disability, device and environment strata;
- accessible alternative and Human-review completion evidence;
- deletion/export/withdrawal rehearsal across WAIA and every processor;
- provider-version change and emergency shutdown rehearsal;
- UI/API/copy proof that the four trust questions stay separate;
- explicit residual-risk acceptance and production kill-switch owner.

Numeric thresholds cannot honestly be ratified before the candidate provider, corpus and launch population are known. DEE-882 must therefore make thresholds versioned configuration and remain `DARK`; the later Human activation packet proposes numbers from observed evidence.

## 5. Decision record template

The Human decision should record:

```text
DEE-873 DECISION
D1 liveness strategy: A | B-DARK-EVALUATION | C-SEPARATE-PROGRAM
D2 admitted claim: APPROVE | REVISE: <text>
D3 raw-evidence posture: EPHEMERAL-NO-TEMPLATE | REVISE: <text>
D4 fallback/accessibility posture: APPROVE | REVISE: <text>
D5 downstream authority: APPROVE-DARK-ONLY | HOLD
Jurisdictions for evaluation: <list>
Decision notes: <optional>
```

This decision authorizes only the selected preparatory scope. It does not select a vendor, approve final retention, activate production biometrics or waive a later Human merge/activation gate.

## Dependencies

- Human-ratified AI-TWIN Product Constitution and canonical algorithm.
- DEE-130 merged canon and DEE-873 threat/privacy evidence.
- Qualified counsel/DPO and representative vendor evidence before production activation.
- DEE-880 before liveness is composed with account authentication.
- AI-TRADER remains an independent, higher-priority parallel program and shares no runtime surface with this decision.

## Traceability

- Product boundary: [`../product/AI-TWIN-PRODUCT-CONSTITUTION.md`](../product/AI-TWIN-PRODUCT-CONSTITUTION.md)
- Canonical algorithm: [`../ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md`](../ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md)
- Threat model: [`../security/AI-TWIN-PRESENCE-AND-LIVENESS-THREAT-MODEL.md`](../security/AI-TWIN-PRESENCE-AND-LIVENESS-THREAT-MODEL.md)
- Privacy/DPIA: [`../privacy/AI-TWIN-BIOMETRIC-PRIVACY-AND-DPIA-PACKET.md`](../privacy/AI-TWIN-BIOMETRIC-PRIVACY-AND-DPIA-PACKET.md)
- Completion criteria: [`ai-twin-v1-completion.md`](ai-twin-v1-completion.md) E1–E6 and F4–F6
- Downstream plans: [`../plans/dee-880-ai-twin-passkey-foundation.md`](../plans/dee-880-ai-twin-passkey-foundation.md), [`../plans/dee-882-ai-twin-liveness-pipeline.md`](../plans/dee-882-ai-twin-liveness-pipeline.md), [`../plans/dee-883-ai-twin-avatar-studio.md`](../plans/dee-883-ai-twin-avatar-studio.md)
