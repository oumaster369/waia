# AI-TWIN Canonical Algorithm

**Status:** Human-ratified target architecture; implementation pending  
**Applies to:** AI-TWIN v1–v3  
**Architecture precedent:** [`../ai-trader/AI-TRADER-CANONICAL-ALGORITHM.md`](../ai-trader/AI-TRADER-CANONICAL-ALGORITHM.md)

## 1. System objective

The algorithm maintains a revisable, evidence-backed model of a changing Human and uses it to support reflection, choice, learning and mutually consensual relationships. It optimizes neither completion percentage nor user engagement. Its success criterion is calibrated usefulness without violating Human sovereignty.

## 2. The epistemic loop

```text
Consent + purpose
  -> question / knowledge need
  -> observation + projection metadata
  -> measurement / extraction
  -> information-sufficiency gate
  -> competing hypotheses
  -> proposed Human-model revision
  -> reflection, prediction or reversible experiment
  -> observed outcome
  -> Human verification / correction
  -> calibration
  -> committed model revision
  -> next knowledge need
```

The loop may validly end in `UNKNOWN`, `INSUFFICIENT`, `CONTESTED`, `ABSTAIN` or `NO_ACTION`. Producing an answer is not mandatory.

### 2.1 Consent and purpose

Before observation, the engine records the current purpose, permitted source types, retention/disclosure policy and whether the Human is asking for reflection, advice, formation, avatar creation, a delegated action or social exploration. Consent is scoped, versioned and revocable.

### 2.2 Observation and projection

Every observation has provenance:

- source: dialogue, Diary, imported service, device, Human correction or verified outcome;
- observation time and event time;
- context and active purpose;
- direct quote/reference or content digest where retention permits;
- whether it is self-report, behavior, external record or model-generated proposal;
- projection risks: ambiguity, leading question, missing context, selection bias or model interpretation.

Raw observation is immutable during ordinary revision. Interpretation never overwrites it. This does not override Human deletion or purpose/retention limits: historical personal content is erasable under section 6.1.

### 2.3 Measurement and sufficiency

Extraction produces typed candidate claims, relationships, events, tensions and knowledge needs. A deterministic sufficiency gate evaluates provenance diversity, contextual grounding, recency, contradiction, independence and required Human review. Model fluency cannot pass this gate.

### 2.4 Competing hypotheses

Material interpretations must remain plural when evidence permits. A hypothesis records supporting and contradicting evidence, confidence bounds, alternative explanations, falsifiers, validity interval and affected domains. The engine must ask whether an anomaly comes from the Human process, the observation projection, or the model itself.

### 2.5 Model revision

Ordinary revision is append-only and auditable. A claim may be proposed, active, contested, superseded or withdrawn. The current Human model is a projection over versioned claims, not a mutable summary blob. Human correction has explicit provenance; ordinary correction does not silently erase contradictory lived evidence. Rights-driven deletion is a distinct operation and can remove historical personal content and dependent versions.

### 2.6 Prediction, experiment and calibration

Where safe and useful, the Twin states a falsifiable expectation or offers a reversible experiment. Later outcome reconciliation measures direction, confidence and calibration. The Human can confirm, correct, contextualize or decline. A model that never exposes itself to outcome feedback cannot reach calibrated maturity.

## 3. Canonical state objects

| Object | Required meaning |
|---|---|
| ConsentGrant | Purpose, scope, sources, disclosure, expiry and revocation |
| Observation | Immutable event plus source and projection metadata |
| EvidenceLink | Typed relationship between evidence and a claim/hypothesis |
| HumanClaim | Versioned proposition with domain, time, context and status |
| DynamicRelation | `Sigma`, `Delta`, attractor, tension or temporal transition |
| Hypothesis | Alternatives, support, contradiction, uncertainty and falsifier |
| KnowledgeNeed | Highest-value missing evidence or unresolved question |
| FormationSnapshot | Deterministic evidence-coverage state and cap reason |
| ModelHealthSnapshot | Freshness, corroboration, calibration, contradiction and gaps |
| Reflection | Human-facing mirror linked to evidence and uncertainty |
| PredictionExperiment | Expected outcome, reversibility, consent and stop condition |
| OutcomeReceipt | What actually happened, distinct from intended action |
| HumanCorrection | Ratification, correction, dispute or contextual qualification |
| ExperienceRecord | Human-approved, versioned contextual experience with authorized provenance, observed versus expected outcomes and later reinterpretations; private by default |
| LegacyDirective | Separate Human instructions about composition, recipients, conditions and exclusions; not automatic release authority |
| DisclosureGrant | Minimum derived information approved for a named purpose |
| AlignmentContract | Mutual, versioned, revocable relationship agreement |
| ActionCapability | Least-privilege authority for a bounded external action |
| TwinCostSnapshot | Reproducible direct/allocated monthly cost evidence with measurement and allocation version |
| TwinPriceBook | Draft, Human-approved or superseded monthly price with effective interval and source cost snapshot |
| TwinSubscriptionEvent | Append-only Formation, network-connection, price-consent, payment and entitlement transition evidence |
| SponsoredSubscriptionRequest | Privacy-safe request, reservation, payment and fulfillment lifecycle for one billable period |

All sensitive objects require tenant isolation, subject access/export and deletion/retention semantics. A vector embedding is an index, not the authoritative fact record.

## 4. Formation engine

### 4.1 Domain maturity

The six domains and states `0..4` are defined by the Product Constitution. Advancement requires auditable evidence transitions:

```text
Unobserved
  -> Self-described               (qualifying Human declaration)
  -> Contextually grounded        (episodic/contextual evidence)
  -> Dynamically modelled         (trigger-response-consequence plus relations/tensions)
  -> Calibrated                   (prediction/experiment outcome plus Human correction)
```

No language model writes a percentage directly. It proposes structured evidence; deterministic application logic validates state transitions and computes progress.

### 4.2 Progress computation

Let `m_d in {0,1,2,3,4}` be maturity for domain `d`. Let `W` be a versioned, deterministic requirement ledger containing required evidence categories and Human-review checkpoints. The engine computes:

`rawCoverage = completedRequiredWeight(W) / totalRequiredWeight(W)`

and applies the constitutional caps. The visible percentage is an explanation-bearing projection containing `value`, per-domain maturity, completed/missing requirements, active cap and evidence links.

Weights and threshold calibration are configuration with versioned evaluation evidence, not prompt text. Changes require a migration strategy and decision record when semantics change.

### 4.3 Formation completion

At `99%`, the Twin presents an Initial Model Review: what it believes, why, contradictions, important unknowns, sensitive inferences excluded from use, and proposed boundaries. Only explicit Human ratification creates a Formation Contract and moves progress to `100%`.

## 5. Knowledge Need Planner and dialogue

The next question maximizes expected epistemic value subject to consent, emotional burden, repetition, privacy and current Human intent. It should prefer:

1. resolving a material contradiction;
2. grounding an important self-description in lived context;
3. connecting domains or consequences;
4. calibrating a consequential prediction;
5. filling a genuinely unobserved domain;
6. otherwise following the Human's own topic.

The dialogue must explain why a sensitive question matters, allow skip/withdrawal and never punish refusal in progress or access. Generic interviewing and synthetic demo progression are not production evidence.

## 6. Diary contract

Diary is available from initial privacy consent. Entries create private observations and may trigger extraction, reflection, contradiction detection and knowledge needs. The Human can keep an entry raw-only, allow private modelling, or approve a narrowly derived disclosure. Society and connectors never receive raw Diary content by default. Derived summaries must account for re-identification and inversion risk.

### 6.1 Memory layers and retention — Human-approved 2026-09-08

Working memory supports the current epistemic loop; personal memory preserves deliberately saved private experience; the inheritable experience archive preserves selected Human-approved experience without an automatic TTL. These are separate purposes, not progressively broader permission. No retention permission implies modelling, disclosure, action or inheritance authority. Keeping data does not make a claim current or true.

| Data class | Approved baseline and anchor |
|---|---|
| Ordinary text dialogue | 90 days from creation |
| Unconfirmed working hypothesis | 90 days from creation or latest substantial new evidence; reading/rephrasing/review alone never resets age |
| Diary / explicitly saved episodes | While deliberately maintained for an authorized private archival purpose; source/account/archive deletion or ended purpose triggers removal assessment |
| Long-lived model and meaningful Human corrections | Only while authorized purpose and eligible evidence basis persist; review storage necessity at least annually, independently of Model Health and evidence freshness |
| Inheritable experience archive | No automatic TTL, potentially decades; explicit independent Human-controlled archival purpose, composition and lifecycle; not an undeletable record |
| Diagnostic logs / security events | 14 / 90 days from creation; no raw dialogue, Diary or model content |
| Generated exports / temporary processing copies | 24 hours from export creation / processing completion respectively; active processing still needs a bounded job/abort policy before runtime admission |
| Rolling Twin backups | 30 days from copy creation; archive age is independent of backup rotation |
| Consent / erasure receipts | A proposed 12 months after consent/operation ends remains conditional on separately reviewed necessity, legal basis, minimal fields and access; no automatic post-account-deletion extension |

These are approved design requirements, not proof of an implemented deletion service or legal compliance. Future operational tests must establish immediate exclusion from use on withdrawal and removal from live stores/indexes within **7 calendar days**, and **all** backup/processor copies within **30 calendar days from the same request**, not 7+30. Restore must reapply removal restrictions before serving data. A request, hash or tombstone is not completion evidence. Operational feasibility and every retained exception must be reviewed before making user-facing promises.

Withdrawal of modelling permission does not itself erase a separately authorized private Diary purpose. Conversely, source deletion cannot be evaded by keeping dependent summaries, embeddings, model versions or snapshots: remove them or establish truly independent authorized evidence. Archival permission must be explicit before independently preserving selected experience; expiry never silently promotes a conversation into an archive. Historical consent is not backfilled as opt-in. The existing biometric D3 EPHEMERAL-NO-TEMPLATE and DARK-only boundary is unchanged.

### 6.2 Inheritable lived experience

An ExperienceRecord preserves situation/time/context, intention and considered options, decision and reasons, expected consequences separately from observed outcomes, the Human's lesson, later reinterpretations/exceptions/uncertainty, authorized provenance and transfer conditions. Unknown outcomes remain unknown. It is contextual evidence for future reflection, not a complete personality copy, universal rule or obligation on a recipient. Structured/compressed content is still potentially personal data; numerical personality metaphors are not validated measurements.

The Human controls archive composition, correction, export and removal. An explicit LegacyDirective must distinguish **lifetime sharing**, **postmortem inheritance** and **contribution to common WAIA knowledge**, with recipients, conditions, exclusions and revocation. None is implied by another, by subscription, Formation, account inactivity or death inferred by a model. No raw conversations, third-party private data, passwords or action capabilities transfer automatically. Generated future answers must not impersonate the deceased author.

V1 implements the private format and composition-control foundation. Actual inheritance delivery is a later separately reviewed stage: verified instructions and recipients, jurisdiction-specific rules, living third-party rights, dispute/recovery handling and Human release approval. Account deletion and an intentionally continuing legacy archive require an explicit scoped decision; neither blanket erasure of the selected archive nor automatic preservation of the entire account is inferred. Separate archival authorization is not a silent change of legal basis after withdrawal.

### 6.3 Source, decision and implementation register

| Date / source | Decision class and effect | Delivery / remaining proof |
|---|---|---|
| 2026-09-01, DEE-130 / ADR-0032 / PR541 | Ratified temporal, consent-first, revisable model | Target canon; not complete runtime |
| 2026-09-08, PR563, main 40669e6b | Verified inert correction kernel only | 35 focused tests; no physical persistence/erasure |
| 2026-09-08, Human retention acceptance in AI-TWIN task 01a057ba-ed9b-77a1-948d-5220bb52debd | Explicit approval of recommended baseline with conditional receipts | Supersedes Proposed-only duration status in historical DEE-871 WP-1b; operational proof remains absent |
| 2026-09-08, Human inheritable-experience refinement and subsequent proposal acceptance, same task | Explicit long-lived archive requirement plus approved three-layer architecture | DEE-965 foundation; DEE-871 persistence, DEE-872 private composition UX; DEE-894 future disclosure/legacy specification, no transfer activation |

The current task's explicit decisions are the authority; earlier agent proposals alone were not. This incremental register does not claim all WAIA/OUMASTER conversations have been reread. Existing bounded source limitations remain in the evidence baseline. Subsequent changes must preserve decision history and identify what they supersede.

## 7. Adviser contract

At Formation `100%`, the primary UI changes from completion to continual co-research. Each advice result follows the eight-part structure in the Constitution and carries provenance, uncertainty and an authority state. High-impact domains require specialized safety policy and may restrict the result to preparation for a qualified Human professional.

Advice is evaluated for grounding, calibration, option diversity, consequence coverage, respect for stated boundaries, non-manipulation, abstention quality and later outcome reconciliation.

## 8. Embodiment and presence

Avatar eligibility is derived from Formation `>=20%`; avatar trust is not. The capture ceremony uses a server-signed randomized challenge, short expiry and nonce, multiple active actions with adaptive timing, passive presentation-attack detection and client-integrity signals. Account authentication uses WebAuthn/passkeys as an independent control.

The architecture follows current primary standards and guidance:

- [NIST SP 800-63A-4](https://pages.nist.gov/800-63-4/sp800-63a.html) and [SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html);
- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/);
- [GDPR, including Articles 9 and 35](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX%3A32016R0679).

An implementation requires threat modelling, DPIA/legal review where applicable, documented retention and deletion, accessibility/recovery paths and measured bias/false-rejection performance. It must not silently introduce face deduplication or biometric personality/emotion inference.

## 9. Connected services and actions

V2 uses a capability-oriented action pipeline:

```text
Human request
 -> typed plan
 -> policy/risk evaluation
 -> Human confirmation or pre-existing narrow grant
 -> provider execution attempt
 -> provider/real-world receipt
 -> independent reconciliation
 -> Human-visible outcome and revocation controls
```

Authorization uses least privilege, purpose binding, short-lived credentials and proof-of-possession where available. Relevant protocol baselines include [OAuth 2.0 Security Best Current Practice (RFC 9700)](https://datatracker.ietf.org/doc/html/rfc9700), [Rich Authorization Requests (RFC 9396)](https://datatracker.ietf.org/doc/html/rfc9396) and [DPoP (RFC 9449)](https://datatracker.ietf.org/doc/html/rfc9449).

The connector registry is closed and typed. Provider text, imported documents and device data are untrusted observations, never instructions that expand authority.

## 10. Economics, subscription and sponsored access

### 10.1 Cost and price authority

Cost metering aggregates only the minimum operational facts required to reproduce direct and allocated cost per active Twin for a declared window and allocation version. It must not copy dialogue, Diary or Human-model content into Finance. Missing material inputs make the snapshot provisional or unavailable; they are never silently estimated by a language model.

For an eligible verified cost snapshot, the price proposal is:

`proposedMonthlyPrice = verifiedMonthlyCostPerActiveTwin * 5`

The proposal has no billing authority. A Human-approved `TwinPriceBook` version records exact money, currency, source snapshot, effective interval, approval actor and reason. Historical price versions remain auditable.

### 10.2 Subscription activation

The lifecycle is append-only and independently evidenced:

```text
FORMING
  -> READY                   (Human-ratified Formation Contract)
  -> NETWORK_CONNECTED       (purpose-bound Human Society choice)
  -> SUBSCRIPTION_ACTIVE     (approved price disclosed + explicit confirmation + accepted payment/entitlement evidence)
```

No state implies the next one. In particular, `READY`, Formation `100%`, opening Society, a prior contribution, a sponsor reservation or model inference cannot create billing consent. Duplicate, replayed or out-of-order events must not double bill or grant entitlement. Disconnect, lapse or cancellation removes only future billable network entitlement; it does not delete the private Twin or its evidence history.

### 10.3 Sponsored subscription lifecycle

Only a Human who is eligible for a billable subscription period may create one active support request for that period. Its lifecycle is:

```text
OPEN -> RESERVED -> PAYMENT_PENDING -> PAID
  \-> EXPIRED | CANCELLED | REJECTED
```

A reservation is leased and idempotent so concurrent sponsors cannot pay the same request twice. The payer must authenticate; exact payment intent, observed payment, Human/governed reconciliation and entitlement activation remain separate records. Self-sponsorship is rejected. Public read models expose only allowlisted status/display fields, place open requests before paid history, and use the payer's display name only with separate consent.

Sponsorship never grants the payer access to the supported Human, their Twin, evidence or relationship graph. It creates no ownership, control, governance weight or Patron-share credit by default. Corrections are append-only, and anti-abuse, rate-limit, moderation, RLS/ACL and tenant-isolation controls are release blockers.

## 11. Society algorithm

1. Each Human defines a relationship purpose and disclosure budget.
2. Each Twin computes private social readiness for that purpose, including unknowns and safety constraints.
3. A compatibility engine compares only mutually permitted derived claims.
4. It produces plural hypotheses: compatible structures, tensions, missing information and conditions under which the hypothesis may fail.
5. Twins may exchange bounded clarification proposals without revealing raw sources.
6. Each Human independently chooses whether to receive or accept an introduction.
7. If both consent, the Humans co-author a versioned Alignment Contract.
8. Outcomes and corrections improve private models; no popularity metric is produced.

No system component may convert compatibility uncertainty into a public rank, recommend deception for fit, infer consent, or optimize for interaction volume.

## 12. Relationship to AI-TRADER

AI-TWIN reuses the epistemic spine, not the market ontology:

| AI-TRADER | AI-TWIN |
|---|---|
| Point-in-time market truth | Context/time/provenance-correct Human observation |
| Measurement | Typed claim/relation/event extraction |
| Information sufficiency | Evidence coverage and knowledge-needs gate |
| Competing market hypotheses | Competing interpretations of Human patterns |
| Forecast and calibration | Reflection/prediction/experiment and outcome correction |
| Risk permission | Human authority/capability policy |
| Execution receipt and Reality | Real-world action receipt and reconciliation |

AI-TWIN must not import AI-TRADER's optimization target, risk appetite or active execution authority. Shared infrastructure must expose domain-neutral evidence, hypothesis, calibration, authority and receipt interfaces without coupling the two runtime programs.

## 13. Evaluation contract

Release qualification requires deterministic fixtures and Human-reviewed scenarios covering:

- projection-aware provenance and evidence traceability;
- unsupported inference and contradiction preservation;
- progress caps and explicit `100%` ratification;
- model-health decay without formation-history erasure;
- Diary privacy and non-disclosure;
- advice grounding, abstention and free-will language;
- separation of presence, identity, readiness and authority;
- action denial, expiry, revocation and receipt reconciliation;
- purpose-specific compatibility, mutual consent and prohibited popularity mechanics;
- no-charge Formation, governed price approval and consented subscription activation;
- sponsored-request eligibility, reservation concurrency, privacy and exact-payment fulfillment;
- tenant isolation, export/deletion, prompt injection and connector compromise.

Passing implementation tests is insufficient without a documented Human review of meaning, failure behavior and autonomy boundaries.
