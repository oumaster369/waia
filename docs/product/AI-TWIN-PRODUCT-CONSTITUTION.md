# AI-TWIN Product Constitution

**Status:** Human-ratified target canon; implementation is not implied  
**Ratified:** 2026-09-01 (DEE-130 / PR #541); economic/access extension Human-merged 2026-09-02 (DEE-922 / PR #550)
**Evidence review:** 2026-09-06 — [source register and implementation map](../ai-twin/AI-TWIN-EVIDENCE-BASELINE-2026-09-06.md)
**Canonical root:** [DEE-130](https://linear.app/deepsense/issue/DEE-130)  
**Decision record:** [ADR-0032](../adr/0032-ai-twin-epistemic-formation-and-authority-separation.md)

## 1. Purpose

AI-TWIN is a private, longitudinal co-researcher of one Human life. It helps the Human understand their changing patterns, make deliberate choices, learn from consequences, and form mutually compatible relationships without taking ownership of identity, truth, choice, or action.

The Twin is neither a personality label nor a synthetic replacement for the Human. It is a revisable model of observations made through limited projections. Its highest product obligation is therefore not confidence or resemblance, but calibrated usefulness under Human sovereignty.

## 2. Constitutional claims

1. **A Human is a changing process.** The model must represent trajectory, context and transformation, not freeze a person into a profile.
2. **The Human is not the model.** Reality, observation and model are distinct: `R != O != M(O)`.
3. **Relationship structure matters.** Connections between traits, motives, contexts and consequences can be more informative than isolated attributes.
4. **Contradiction is information.** Tensions and context-dependent opposites are first-class evidence, not defects to be averaged away.
5. **Uncertainty is visible.** Unknown, stale, disputed and projection-sensitive claims must stay distinguishable from corroborated knowledge.
6. **The Human retains free will.** WAIA may clarify, forecast, warn, propose and abstain. The Human chooses.
7. **Formation grants no authority.** Knowing more about a Human does not authorize impersonation, disclosure, purchase, communication or any other external action.
8. **Private by default.** Dialogue, Diary, inferred models and relationship hypotheses remain private unless the Human makes a specific, revocable disclosure.
9. **Compatibility is contextual.** It is a purpose-bound hypothesis between people, never a universal score of human worth.
10. **WAIA develops by evidence and ratification.** It may generate and test proposals in bounded environments; it cannot self-grant authority, resources or constitutional power.

## 3. The Human model

The canonical model is temporal and relational:

`H_t = <D_t, Sigma_t, Delta_t, A_t, R_t, T_t, Pi_t, U_t>`

Where:

- `D` — six observable life domains;
- `Sigma` — cross-domain relationships;
- `Delta` — responses and transformations under events;
- `A` — attractors: recurring needs, motives and desired states;
- `R` — tensions, simultaneous opposites and unresolved contradictions;
- `T` — temporal trajectory and phase changes;
- `Pi` — observation/projection metadata: source, context, purpose and possible distortion;
- `U` — explicit unknowns and knowledge needs.

This is a model of claims and evidence, not a diagnosis, essence or claim of consciousness.

### 3.1 Six visible domains

The product retains six visible indicators, but changes their meaning:

1. **Meaning, Values & Boundaries** — what matters, what must not be traded away, and where consent ends.
2. **Needs, Motives & Attractors** — what draws or repels the Human, including interests and recurring needs.
3. **Perception, Thinking & Decision** — how the Human notices, interprets, reasons, chooses and revises.
4. **Emotion & Self-Regulation** — emotional patterns, bodily/subjective signals and regulation strategies, without clinical inference.
5. **Action & Adaptation** — actual behavior, habits, coping, experimentation and change under pressure.
6. **Relationships & Reciprocity** — attachment, trust, roles, conflict, care, exchange and boundaries with others.

Goals are not a seventh trait or a replacement domain. A goal is a temporal trajectory through one or more domains: desired change, constraints, milestones and observed consequences.

### 3.2 Per-domain formation maturity

Each domain advances through evidence-backed maturity states:

| State                     | Meaning                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| 0 — Unobserved            | WAIA has no adequate evidence and must not guess.                                               |
| 1 — Self-described        | The Human has declared a view, preference or story.                                             |
| 2 — Contextually grounded | Episodic or situational evidence connects the declaration to lived context.                     |
| 3 — Dynamically modelled  | Triggers, responses, consequences, cross-domain relationships and tensions are represented.     |
| 4 — Calibrated            | A reflection, prediction or reversible experiment has an observed outcome and Human correction. |

The maturity state is evidence-derived. Fluency, message count, elapsed time and model confidence cannot substitute for evidence.

### 3.3 Source admission, use and disclosure

No source may enter productive Human-model use unless its current purpose,
admitted source class, permitted use, retention policy and disclosure boundary
are deterministically resolvable. Admission is fail-closed: missing, expired,
revoked, purpose-mismatched or non-provable authority means no productive use.
Storage, Formation progress, possession of data or consent for another
source/purpose grants nothing by implication.

AI-TWIN remains private by default. A new sensitive or not-yet-authorized
source class requires Human-visible disclosure before its first productive use
and explicit Human authorization. Ordinary voluntarily supplied dialogue may
continue under an already-current dialogue grant without per-message
re-consent. A statement voluntarily supplied after withdrawal is a new source
event with its own creation time and current authorization; it cannot revive
the withdrawn source, old consent or dependent claims.

Disclosure permission is separate from modelling/use permission. It is
specific, purpose-bound, versioned and revocable. A private modelling grant
does not authorize disclosure, and a disclosure grant does not silently
authorize storage, modelling, Formation credit or another purpose.

V1 productive raw-observation ingress is limited to currently authorized
dialogue and Diary. Imported service/device context remains future-capable but
unadmitted until later Connected Context / v2 consent, connector and ingestion
decisions. Human corrections and outcome receipts are separate typed records,
not generic external-source ingress.

DEE-871 defines the durable provenance contract—exact identity/version,
tenant/subject, purpose/policy, chronology, current authority/availability
references and append-only lineage. WP-1 does not claim that production
persistence/runtime delivery exists. DEE-871 does not score independence, sufficiency,
corroboration, inference recency, hypothesis confidence, Formation or Model
Health; those are downstream DEE-874/875/876 responsibilities.

Legacy material is never inferred or backfilled as consented. It remains
quarantined and non-productive without current provable authority. Later
explicit Human authorization for specified material creates a new current,
purpose-bound grant for future use and does not rewrite prior collection/use
history. Unresolvable identity, scope, provenance or rights keeps the material
quarantined, subject only to independent Human export/delete rights.

ConsentGrant issuance requires an authenticated Human action with
`actorUserId == subjectUserId` and an exact current organization. Purpose,
admitted dialogue/Diary sources, productive uses, private disclosure boundary,
retention/use policy and temporal mode are explicit; trusted server time is the
issue time. Possession, account/membership, prior consent, Formation,
subscription/payment, continued use and silence imply no consent.

Temporal mode is exactly `UNTIL_REVOKED` or `EXPIRES_AT`, never missing or
defaulted. `EXPIRES_AT` requires a valid future trusted timestamp at issuance.
`UNTIL_REVOKED` is an explicit Human choice and remains usable only while
unrevoked, purpose/source/policy remain current and no higher-priority rights
operation blocks use. Expiry or revocation blocks new productive use but does
not erase data. Later authorization is a new append-only grant/version and
cannot rewrite history, revive deleted/erased sources or widen purpose,
sources, use or disclosure without explicit Human authorization.

### 3.4 Personal-model access

Supabase Auth and WAIA Core are the sole credential, identity, organization,
membership, role and permission authorities. AI-TWIN duplicates none of that
state. Matching caller-supplied identifiers prove nothing.

Ordinary v1 access to a private personal model requires a trusted Core
resolution proving an authenticated Human, current exact organization,
current actor membership, current subject-to-organization binding and
`actorUserId == subjectUserId`. Membership in an organization never grants
access to another Human's Twin. Admin, owner, member, agent or service status
creates no bypass; future operator/support access requires a separate audited
capability contract.

Payment, subscription, Formation or future module-routing entitlement is not a
prerequisite for the Human's own private Formation/model data. The DEE-871
guard is a pure fail-closed evaluation of already trusted Core facts. It does
not authenticate, parse credentials, query model persistence or grant consent,
disclosure, Society, action or billing authority, and its result is not an
authorization token for caller-controlled use.

Every protected repository operation must resolve current Core
identity/membership/subject authority at operation time and, where technically
possible, within the same authoritative transaction/consistent database
boundary as the protected read or mutation. A prior guard decision is not
durable authority, is never reused across transactions and has no invented TTL,
grace or cache interval. If that atomic authority cannot be provided, the
repository fails closed rather than substituting matching IDs or a fixture Core
model.

## 4. Formation Contract and progress

Formation progress answers one narrow question: **how much of the initial evidence contract has been completed?** It does not answer whether the account is genuine, whether the model is currently healthy, whether the Human is ready to socialize, or whether WAIA may act.

The v1 engine must use deterministic evidence coverage with these provisional caps, shadow-validated before production activation:

- maximum `19%` while any domain is fully unobserved;
- maximum `49%` while the model is predominantly self-description without contextual grounding;
- maximum `74%` until dynamics, relationships and material contradictions are represented;
- maximum `99%` until at least one prediction/experiment feedback cycle and explicit Human review;
- `100%` only when the Human ratifies the initial model as sufficiently accurate, including its known limits and unknowns.

`100%` means **initial Formation Contract complete**. It never means that a Human is fully known.

The Diary is available after privacy consent, from the start. It is an observation and reflection channel, not a reward unlocked by progress.

## 5. After formation: Model Health and Adviser

At `100%`, the formation surface becomes the **Personal Adviser / Co-Researcher**. Formation history remains inspectable, while the primary status becomes Model Health:

- freshness and temporal coverage;
- provenance and corroboration;
- predictive calibration;
- unresolved contradictions;
- untested or changing domains;
- Human corrections and contested claims.

Contradiction or staleness can reduce Model Health and create knowledge needs. It does not falsify the historical fact that the initial Formation Contract was completed.

Every substantive advice object must separate:

1. Human intent or question;
2. what WAIA currently knows and from which evidence;
3. assumptions, projection risks and uncertainty;
4. viable options, including doing nothing;
5. likely first- and second-order consequences;
6. important unknowns;
7. a reversible experiment or next observation when appropriate;
8. the Human decision.

WAIA may explicitly abstain when evidence or authority is insufficient.

### 5.1 Learning to use WAIA — Human requirement added 2026-09-12

AI-TWIN also teaches the Human how to use WAIA: explain functions, prerequisites and limitations, offer short contextual steps, and help recover from errors. Guidance is optional, interruptible and non-punitive, available without completing Formation. It must preserve the current task and distinguish implemented, unavailable and planned functionality. Guidance about a feature neither grants its authority nor performs its action. Learning activity is not personality evidence or Formation credit by default.

The target is progressive coverage of all Human-facing WAIA functions as their owners publish verified help and capability contracts. No private/admin/scientific control is disclosed or enabled by a generic tutorial. Current account access comes from authoritative checks, never an inferred percentage or generated promise. DEE-994 owns the first curated in-workspace guide; context-aware conversational teaching extends DEE-878/881 and is not implied by that first interface. Preserve separate confirmation for any later navigation with unsaved changes or real action.

### 5.2 Long-lived model knowledge

Long-lived model knowledge SHALL receive a **Human-approved
storage-necessity review** at least annually. WAIA prepares the review surface;
the Human confirms whether the exact selected knowledge remains necessary.
First endorsement of a model establishes its initial review anchor but is not
itself a necessity-review confirmation.

Once the annual interval is overdue, and until the review is current, affected
knowledge MUST NOT be used for new inference or advice. This pause is neither an
automatic deletion rule nor permission for indefinite pending storage: the
review presents retain, correct, archive or delete/erase actions, while Human
access, correction and deletion remain independently available. Confirmation
does not renew consent, restore withdrawn evidence, establish truth, promote an
archive, refresh evidence or widen purpose. Current purpose and source
authorization remain mandatory after review. No unapproved grace period,
automatic deletion deadline or retained receipt exception follows from this
rule.

### 5.3 Rights operations

Rights requests are durable evidence-bearing operations, not mutable flags.
Their canonical lifecycle is:

`REQUESTED -> ACCEPTED -> USE_BLOCKED -> LIVE_REMOVAL_IN_PROGRESS -> LIVE_REMOVED -> RESIDUAL_COPIES_PENDING -> CLOSED`

`REFUSED`, `FAILED` and `CANCELLED` are explicit terminal/error states;
cancellation exists only while it remains valid. Authenticated acceptance binds
the exact organization, Human/subject, operation type, target scope, original
request time, policy version and actor.

Withdrawal or deletion blocks new productive use independently of later
physical cleanup. `LIVE_REMOVED` requires evidence that affected live stores,
indexes and dependent live projections no longer serve the source. Residual
backup/processor cleanup remains a distinct obligation, and `CLOSED` requires
verified completion evidence. A request, tombstone, hash, attempted job or
process exit is never completion by itself.

Failure/retry history is append-only and cannot manufacture success or reset
the original request clock. Minimal receipts must not preserve the personal
content whose removal they prove. Rights operations do not renew consent, widen
purpose, establish truth, grant archive authority or alter Formation/Model
Health. At minimum, type-specific operations include `WITHDRAW_USE`, `DELETE` /
`ERASE`, `EXPORT`, `CORRECT`, `RETAIN` and `ARCHIVE`; sharing one
auditable lifecycle does not make their effects interchangeable.

`WITHDRAW_USE`, `DELETE` and `ERASE` may be cancelled only while `REQUESTED`.
After authenticated `ACCEPTED`, productive-use blocking cannot be cancelled to
revive previous authority. `EXPORT`, `CORRECT`, `RETAIN` and `ARCHIVE` may be
cancelled until their type-specific artifact, revision, decision or archive
effect is committed. A later change requires a new operation; history is never
rewritten.

`FAILED` terminates one execution attempt, not necessarily the Human operation.
Retry creates a new append-only attempt under the same immutable operation,
original request time, scope and policy. Prior failure evidence remains, and
withdrawal/deletion/erasure use blocking survives every failure and retry.

Type-specific effects remain:

- `WITHDRAW_USE` blocks future productive use without claiming deletion;
- `DELETE` removes selected records/sources and unsupported dependent
  projections;
- `ERASE` applies to the declared subject/source/purpose scope and dependency
  closure without claiming statutory compliance;
- `EXPORT` creates only a currently authorized point-in-time export under the
  existing 24-hour generated-export rule and grants no wider disclosure;
- `CORRECT` appends a Human correction/revision without erasing prior evidence;
- `RETAIN` records continued storage of an exact currently eligible record
  under existing purpose authority, without renewing consent or freshness;
- `ARCHIVE` records independently authorized private preservation, grants no
  inheritance/disclosure and cannot rescue a previously withdrawn/deleted
  source.

Removal-only states apply only to operations requiring removal. Other
operations close from verified type-specific effect evidence and never
fabricate `LIVE_REMOVED`.

While unresolved, retain only the minimum operation/attempt state needed to
complete and prove the operation. After `CLOSED`, `REFUSED` or `CANCELLED`,
retain the minimized content-free receipt for twelve months from that terminal
timestamp. This does not extend automatically beyond verified subject/account
deletion: after live and backup/processor cleanup, remove subject-linkable
receipts unless a separately Human-approved legal/security basis applies.
Receipts contain only operation identity/type, organization/subject reference
while necessary, scope kind/digest, relevant timestamps, policy version,
authenticated actor class/reference, attempt/outcome information and
completion-evidence digests—never removed content, dialogue/Diary or claim text,
embeddings or copied payloads.

## 6. Embodiment and account trust

At `20%` Formation, the Human becomes eligible to open Avatar Studio. This threshold means only that enough interaction exists for a meaningful representation workflow. It is not proof of identity or uniqueness.

The system must keep four questions separate:

- **liveness** — is a live person responding now;
- **account authentication** — is the authorized account holder present;
- **uniqueness** — is this one account per person, if the product ever requires that policy;
- **legal identity** — does the person correspond to a verified real-world identity.

The v1 target uses passkeys/WebAuthn for account and device authentication plus a separate active liveness ceremony: a short-lived server challenge with nonce and expiry, randomized actions, passive presentation-attack checks, injection/virtual-camera signals, rate limits and a recovery path. “Say cheese” can be one prompt, never the sole control. Raw liveness evidence and avatar training material have separate consent, retention, deletion and export policies. WAIA must not infer personality or emotion from biometric media.

The Human's 2026-09-01 DEE-873 decision authorizes provider-neutral **DARK evaluation only**, ephemeral raw liveness processing with no reusable central face template, the narrow presence claim and accessible fallback. EU/EEA is the design baseline, not evidence of legal compliance. No vendor, final retention durations or production activation were approved. The [decision record](../product-specs/ai-twin-presence-human-decision.md) preserves the exact scope.

## 7. Authority and real-world action

Action is a separate, later capability. The invariant is:

`request != plan != permission != execution attempt != factual real-world result`

Every delegated action requires a purpose-bound capability grant, explicit risk classification, least privilege, expiry/revocation, preview or confirmation where required, an execution receipt and reconciliation against Reality. Connected gadgets and services never silently expand the Twin's authority.

Reserved matters remain Human-only, including identity/legal commitments, intimate consent, irreversible publication or disclosure, high-impact financial/medical/legal decisions, changes to constitutional safety rules, and granting further authority.

## 8. Society and Alignment Contracts

WAIA Society is a network of living Humans represented by private Twins. It is not an engagement market. The product forbids likes, follower counts, popularity statistics, public compatibility scores and ranking optimized for attention.

The unit of connection is a **mutual Alignment Contract**:

- purpose and relationship type: friendship, collaboration, love, care, learning or another explicit purpose;
- each person's intentions, boundaries and non-negotiables;
- approved disclosures and their provenance/expiry;
- compatible areas, tensions and unresolved unknowns;
- expectations of reciprocity and communication;
- version, consent by both Humans, revocation and review conditions.

Compatibility is returned as an evidence-backed, purpose-specific hypothesis with uncertainty and potential tensions. Twins may privately explore whether an introduction is worth proposing, but neither Twin may consent, disclose private source material, negotiate a binding commitment or initiate a relationship on behalf of a Human.

## 9. Economics, subscription and universal access

Formation and training are currently free. Reaching a Formation threshold, including Human-ratified `100%`, does not create a bill, payment permission, Society connection or subscription entitlement.

The billable lifecycle is deliberately separate:

```text
FORMING -> READY -> NETWORK_CONNECTED -> SUBSCRIPTION_ACTIVE
```

Each transition requires its own server-owned evidence. A monthly subscription may begin only after all of the following are true:

1. the initial Formation Contract is Human-ratified and the Twin is `READY`;
2. the Human chooses to connect the Twin to the future Society network;
3. WAIA shows the current Human-approved price and its effective terms;
4. the Human gives explicit confirmation for the billable subscription;
5. the payment and entitlement policy independently accepts the resulting evidence.

The governed pricing policy is a versioned monthly price derived from verified monthly cost per active Twin multiplied by `5`. Cost includes direct and allocated infrastructure required to operate a Twin, such as model inference, memory/storage, moderation/security and Society traffic. The calculation produces a proposal, not authority: a Human must approve a price-book version before it may be disclosed or used for billing. Formation being free is an access rule, not a claim that Formation has no underlying cost.

The canonical pre-billing disclosure below the Twin dialogue is:

> Creating and training your AI Twin is currently free. A monthly subscription will begin only after your Twin is fully formed and you choose to connect it to the future social network of AI Twins. We will show you the current price and ask for your explicit confirmation before billing begins.

Inability to pay should not permanently remove a Human perspective from WAIA. Subject to a separately implemented and sustainably funded mechanism, an eligible Human may request community support for one billable subscription period and another authenticated Human may choose to fund it. Sponsorship grants no access to, control over or influence on the supported Human or their Twin; creates no ownership or governance weight; and does not expose financial hardship, email, wallet or payment details. Public identity is limited to separately consented display information.

The canonical public explanation for that future support surface is:

> The more people can actively participate in WAIA, the more honest and accurate WAIA becomes—especially its collective layer. If someone cannot cover their subscription, another member of the community can help keep their voice present.

A sponsored subscription is a subscription payment classification, not an ordinary donation or Patron-share contribution unless a later Human-ratified policy explicitly says otherwise. The complete universal-access boundary remains governed by [`waia-user-stewardship-doctrine.md`](waia-user-stewardship-doctrine.md).

## 10. Version boundary

| Version                                    | Product outcome                                                                                           | Explicit boundary                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| v1 — Formation, Embodiment & Adviser       | Evidence-backed Human model, Diary, Formation/Model Health, Avatar Studio trust gates, calibrated Adviser | No general connector execution or Society launch                |
| v2 — Connected Context & Delegated Actions | Consented read context and bounded real-world actions with receipts                                       | No silent authority expansion; no broad autonomous agent        |
| v3 — Society & Alignment Contracts         | Mutual introductions, compatibility hypotheses and revocable contracts                                    | No popularity mechanics or machine consent                      |
| Future — Living WAIA network               | Bounded collective learning and self-improvement proposals                                                | No consciousness claim, survival imperative or self-sovereignty |

Economic work crosses version boundaries without changing them: v1 may explain the future billing contract and measure cost; no billable activation is permitted before the v3 Society connection gate and explicit Human confirmation.

## 11. Non-negotiable separations

- Formation Progress != Model Health.
- Formation Progress != liveness/account/identity trust.
- Formation Progress != Social Readiness.
- Formation Progress != action authority.
- Observation != interpretation != hypothesis != ratified Human model.
- Twin-to-Twin exploration != Human disclosure != Human consent.
- Advice != decision != permission != execution != verified outcome.
- Formation/READY != Society connection != subscription consent != verified payment != entitlement.
- Cost estimate != approved price != invoice != payment != subscription access.
- Sponsorship != access to the supported Human/Twin != governance or Patron weight.

Any implementation that collapses one of these separations is constitutionally incorrect even if its UI appears complete.

## 12. Baseline and change history

This is the current agreed baseline, not a claim of complete knowledge or a prohibition on future Human-approved revision. The source register distinguishes user decisions, ratified canon, proposals, code inspection and verification results. Legacy runtime remains legacy until its own migration/qualification gates pass.

| Date       | Decision / evidence                            | Effect                                                                                                      |
| ---------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 2026-09-01 | DEE-130, PR #541, ADR-0032                     | Initial epistemic Formation/Adviser and v1–v3 canon                                                         |
| 2026-09-01 | DEE-873, PR #542 and subsequent D1–D5 decision | Narrow DARK-only presence evaluation; no production authority                                               |
| 2026-09-02 | DEE-922, Human-merged PR #550                  | Free Formation, governed cost ×5 pricing, separate subscription and sponsored-access consent                |
| 2026-09-06 | Explicit Human resume; DEE-943                 | Evidence/status reconciliation; isolated implementation permitted while Trader stays outside mutation scope |
| 2026-09-12 | Explicit Human retention decision; DEE-871     | Human-controlled annual storage-necessity review; overdue knowledge paused from new inference/advice         |
| 2026-09-12 | Explicit Human product-learning and UX requirement; DEE-994 | AI-TWIN teaches WAIA use through optional, truthful, capability-aware guidance; no authority/progress from learning |
| 2026-09-14 | Explicit Human source-admission and RightsOperation decision; DEE-871 | Fail-closed private source use, separate disclosure authority and evidence-bearing rights lifecycle |
| 2026-09-14 | Explicit Human RightsOperation completion decision; DEE-871 | Type-specific cancellation/effects, append-only retry, verified closure and minimized twelve-month terminal receipts |
| 2026-09-14 | Explicit Human DEE-871 WP-1 closure decision | Dialogue/Diary-only v1 ingress, provenance-only persistence ownership and non-inferred historical consent |
| 2026-09-14 | Explicit Human DEE-871 WP-2 Core-access decision | Personal-model access requires exact trusted Core actor/subject/organization equality; no role or entitlement bypass |
| 2026-09-14 | Explicit Human DEE-871 authenticated-repository decision | Transaction-current Core authority plus explicit append-only `UNTIL_REVOKED` / `EXPIRES_AT` consent; no stale guard reuse |

Unresolved rubric weights, retention schedules, provider choice, release thresholds and Society pilot policy remain subject to their downstream decisions. They are not filled in by the phrase “final vision.”
