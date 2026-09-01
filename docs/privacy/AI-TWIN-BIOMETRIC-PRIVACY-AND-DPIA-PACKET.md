# AI-TWIN Biometric Privacy and DPIA Packet

**Status:** Pre-DPIA design record; requires counsel/DPO and Human approval
**Owner:** DEE-873
**Related:** [`../security/AI-TWIN-PRESENCE-AND-LIVENESS-THREAT-MODEL.md`](../security/AI-TWIN-PRESENCE-AND-LIVENESS-THREAT-MODEL.md)

## 1. Decision posture

DEE-873 does not declare WAIA legally compliant and does not select a processor. It defines the minimum evidence that legal/privacy review and the Human need before any biometric processing can leave `DARK` state.

Because face/video processing can be high-impact, probabilistic and difficult to remediate after disclosure, WAIA applies the stricter design posture before determining jurisdiction-specific classification:

- purpose limitation and data minimization;
- no compelled capture for core account access;
- explicit, granular and revocable choice;
- separation of authentication, liveness, Avatar representation, uniqueness and legal identity;
- no cross-account biometric search;
- no emotion, personality or sensitive-trait inference;
- shortest feasible raw-evidence lifetime;
- independently testable deletion, export, access and processor controls;
- no production activation without a completed DPIA/legal review where applicable.

Consent is a product safety boundary, not a substitute for determining the correct legal basis.

## 2. Purposes and prohibited purpose expansion

| Processing purpose | v1 status | Permitted output | Prohibited expansion |
|---|---|---|---|
| Passkey account authentication | Planned separately in DEE-880 | Cryptographic account/session result | Sending platform biometric data to WAIA |
| Fresh Human liveness for Avatar gate | Candidate, `DARK` | One ceremony verdict and minimal receipt | Identity, age, uniqueness, trustworthiness or fraud propensity |
| Avatar source capture/generation | Candidate, separate consent | Human-reviewed representation asset | Reusing source media as PAD training or cross-account matching |
| Security abuse telemetry | Candidate, minimized | Bounded reason/risk events | Raw face/audio, general behavior profiling or advertising |
| Legal/civil identity proofing | Not in v1 | `NOT_ASSESSED` | Document/KYC or government-identity inference |
| One-person-one-account deduplication | Not in v1 | `NOT_ASSESSED` | Face gallery, similarity index or silent duplicate search |
| Emotion/personality/sensitive traits | Forbidden | None | Any direct or proxy inference from biometric media |

Any new purpose requires a new data-flow inventory, necessity/proportionality analysis, legal basis, threat model, completion-spec change and explicit Human decision.

## 3. Data-flow inventory

| Data class | Source | Processing need | Default destination | Default lifetime posture | Forbidden destinations |
|---|---|---|---|---|---|
| Passkey assertion | Authenticator/browser | Bind account session | WAIA auth verifier | Auth lifecycle policy | PAD/Avatar training |
| Challenge/nonce | WAIA server | Freshness and replay prevention | Ephemeral ceremony store | Through terminal state plus short replay window | Analytics/profile model |
| Raw liveness frames/audio | Human device | PAD/challenge evaluation only | Volatile/isolated processing path | Immediate deletion after decision is the target; exact bound is gated | Logs, analytics, Diary, Human model, Avatar training |
| PAD features/template | Capture/PAD processor | Evaluation only if technically necessary | Processor/isolated evaluation | No reusable central template by default; exception needs approval | Cross-account gallery/search |
| Integrity/device signals | Client/platform | Detect injection/virtual camera | Risk evaluation | Minimized, coarse and time-bound | General device fingerprinting/advertising |
| Provider raw response | PAD provider | Evidence mapping/debugging | Restricted adapter boundary | Only fields required for receipt/dispute; exact bound gated | User-facing truth claim |
| Liveness receipt | WAIA policy engine | Capability audit, abuse/revocation | Subject-scoped receipt store | Human decision required | Public profile/Society ranking |
| Avatar source media | Human | Create chosen representation | Separate Avatar source store | User-controlled retention option required | Liveness/PAD evaluation or unrelated training |
| Generated Avatar | Provider/WAIA | Human-approved representation | Separate Avatar asset store | Until withdrawal/deletion under chosen policy | Unapproved publication or impersonation |
| Consent/policy record | Human/WAIA | Prove scope and withdrawal | Consent ledger | Policy/legal retention decision | Engagement targeting |
| Deletion/export receipt | WAIA/processors | Reconcile rights request | Privacy audit store | Legal/audit decision | Product profiling |

The final DPIA must replace every “gated” value with a named controller/processor, region, encryption/key boundary, backup behavior and maximum duration.

## 4. Rights and Human control contract

Before capture, the Human must be able to understand:

- the precise purpose and which question is being answered;
- which modalities and processors are used;
- whether data leaves the device/region and for how long;
- what is stored after the ceremony;
- that refusal or cancellation does not reduce Formation or remove core account access;
- the available non-biometric or Human-review route;
- how to withdraw, delete, export, appeal and report coercion or error;
- that liveness does not establish uniqueness or legal identity;
- whether generated Avatar media may look or sound like the Human and where it can be used.

Required controls:

- explicit start and cancel at any point;
- separate consent for liveness and Avatar material;
- granular withdrawal without deleting the whole WAIA account;
- subject access/export with human-readable provenance and machine-readable receipts;
- deletion cascade to every processor, backup/legal-hold explanation and reconciliation status;
- correction/appeal path for a false or inconclusive result;
- visible active/expired/revoked status;
- no dark patterns, progress penalty or social penalty for refusal.

## 5. Necessity and proportionality questions

The DPIA/legal reviewer must answer with evidence:

1. What concrete abuse is liveness meant to reduce at Avatar eligibility, and what measured incidence supports it?
2. Why are passkeys, rate limits, content provenance, delayed activation or Human review insufficient alone?
3. Is camera processing necessary, or can the v1 capability launch without biometric liveness?
4. Which output is required: presence only, authentication, verification or identification?
5. Can evaluation occur on device or ephemerally without a reusable biometric template?
6. What is the least intrusive challenge catalog that remains effective and accessible?
7. Could an attacker use the collected media or generated Avatar to impersonate the Human elsewhere?
8. Does refusal meaningfully disadvantage the Human, making consent non-freely given?
9. Which regional rules apply to controller, processor, Human and data location?
10. What residual false-accept, false-reject, bias, coercion and breach risks remain, and who accepts them?

If necessity cannot be demonstrated, production biometric capture remains off and the product uses the non-biometric option.

## 6. DPIA risk register

| Risk to the Human | Impact | Required mitigation/evidence | Residual decision owner |
|---|---|---|---|
| Irrevocable biometric disclosure or template theft | Identity fraud, impersonation, inability to rotate trait | Ephemeral processing, no central reusable template, encryption, vendor controls, deletion rehearsal | Human + privacy/security reviewer |
| Function creep into identity/dedup/profiling | Surveillance, exclusion, loss of autonomy | Typed purposes, no cross-account index, schema/API review, constitutional prohibition | Human |
| Invalid or coerced consent | Unlawful/unfair processing, intimate harm | Optional path, granular notice, cancel, no core-feature penalty, coercion review | Counsel/DPO + Human |
| False acceptance | Synthetic/relayed accounts, trust erosion | Representative PAD/injection evaluation, rate limits, limited claim | Security reviewer + Human |
| False rejection or accessibility exclusion | Denied representation, stigma, repeated capture | Alternatives, appeal, adjustable catalog/timing, stratified testing | Accessibility reviewer + Human |
| Differential demographic performance | Discrimination and unequal burden | Fixed policy, representative samples, confidence intervals, differential thresholds/gates | Human after evidence review |
| Vendor secondary use/model training | Loss of control and confidentiality | Contract prohibition, subprocessor list, audit evidence, delete/export SLA | Counsel/DPO + Human |
| Cross-border or opaque processing | Legal/rights uncertainty | Region map, transfer mechanism, subprocessor residency and government-access assessment | Counsel/DPO |
| Generated Avatar misuse | Deception, reputational or relationship harm | Separate approval, watermark/provenance policy, use restrictions, revocation | Human |
| Overclaim in product language | Misplaced trust and harmful decisions | Four-question typed contract, copy/API tests, no badge conflation | Product/security Human review |
| Excessive retention/backup persistence | Expanded breach and secondary-use window | Maximum durations, backup expiry, deletion receipt and periodic reconciliation | Human + counsel/DPO |
| Support/insider access | Intimate data exposure | Least privilege, audited break-glass, no routine raw access | Security/privacy owner |

## 7. Accessibility and non-discrimination

The ceremony must not assume speech, hearing, vision, facial movement, fine motor control, a particular skin tone, a high-end camera, stable broadband, a quiet room or fluent understanding of one language.

Before activation, evidence must cover:

- localized text, audio and visual instructions;
- an approved alternative to each sensory or motor-dependent action;
- timing that preserves freshness without an arbitrary three-second exclusion;
- keyboard and assistive-technology operability for surrounding UI;
- low-light, camera-quality, device/OS/browser and network strata;
- representative demographic and disability cohorts with sample-size disclosure;
- false-accept, false-reject, inconclusive, retry and abandonment distributions;
- a non-punitive Human-review or non-biometric route.

Accessibility fallback is not a weaker silent bypass. It has its own explicit policy and result type.

## 8. Vendor due-diligence evidence

No provider may be selected from marketing claims alone. The evaluation record must include:

### Data governance

- controller/processor roles, legal entity and processing regions;
- subprocessors and transfer mechanisms;
- raw sample, feature/template, result, log, support and backup retention;
- model-training/secondary-use defaults and enforceable opt-out/prohibition;
- deletion/export APIs, SLA and verifiable cascade;
- encryption and customer/key-control model;
- incident notification, audit access and termination export/deletion.

### Security and integrity

- active/passive PAD methods and supported injection/virtual-camera signals;
- independent ISO/IEC 30107-3-aligned testing scope, version and attack species;
- API authentication, replay protection, tenant isolation and SDK supply chain;
- model/version pinning and change notification;
- availability, timeout, regional failover and fail-closed behavior;
- penetration testing, vulnerability handling and incident history evidence.

### Performance and fairness

- attack and bona fide error metrics with sample sizes/confidence intervals;
- demographic, disability, device and environment strata;
- fixed threshold behavior and threshold ownership;
- inconclusive/technical-error handling;
- ability to export raw evaluation results for independent WAIA qualification.

### Product boundary

- no face deduplication or cross-customer search;
- no age, gender, ethnicity, emotion, personality or sensitive-trait output;
- no legal-identity or uniqueness claim;
- no use of WAIA data to improve unrelated models;
- contract permits immediate kill switch and data deletion.

An unavailable or undisclosed item is recorded as risk, not interpreted as assurance.

## 9. Retention alternatives requiring Human decision

The following are architecture options, not approved durations:

| Class | Privacy-minimal recommendation | Alternative needing justification |
|---|---|---|
| Raw liveness frames/audio | Volatile processing; erase immediately after terminal decision | Very short encrypted dispute/debug window with restricted access and explicit opt-in/legal basis |
| PAD features/template | Do not retain a reusable template | Short-lived ceremony-bound features only when provider evidence proves necessity |
| Challenge state | Until terminal state plus bounded anti-replay window | Longer security window only with minimized non-biometric fields |
| Liveness receipt | Minimal categorical receipt for bounded audit/revocation period | Longer retention only for named dispute/security obligation |
| Security telemetry | Coarse, pseudonymous, time-bound | Longer abuse intelligence only after reidentification assessment |
| Avatar source media | Human chooses delete-after-generation or retained-editable source | Provider copy only for bounded processing with deletion proof |
| Generated Avatar | Until Human revokes/deletes under disclosed policy | No indefinite provider retention by default |

The final decision must name maximum durations, backup expiry, deletion trigger, legal hold, controller copy and every processor copy.

## 10. DPIA completion checklist

- [ ] Processing purpose, capability benefit and non-biometric alternative are evidenced.
- [ ] Controller, processors, subprocessors, regions and transfers are mapped.
- [ ] Correct legal bases and special-category posture are determined by qualified counsel/DPO for launch jurisdictions.
- [ ] Necessity and proportionality are documented.
- [ ] Raw/derived data inventory, storage, keys, access, logs and backups are complete.
- [ ] Retention, deletion, export, withdrawal and appeal are testable end to end.
- [ ] Vendor contract and technical evidence pass the due-diligence matrix.
- [ ] Security threat-model release blockers are closed.
- [ ] Accessibility, false-rejection and differential-performance evidence is independently reviewed.
- [ ] User notice and consent UX are reviewed without dark patterns.
- [ ] Residual risks, incident owner and kill switch are accepted by the Human.
- [ ] Production remains `DARK` until the separate activation decision.

## 11. Primary legal and rights references

Retrieved 2026-09-01:

- [Regulation (EU) 2016/679 (GDPR), including Articles 4(14), 9 and 35](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [Regulation (EU) 2024/1689 (AI Act)](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)
- [EDPB Guidelines 3/2019 on processing personal data through video devices](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-32019-processing-personal-data-through-video_en)
- [EDPB Opinion 11/2024 on facial recognition at airports](https://www.edpb.europa.eu/our-work-tools/our-documents/opinion-board-art-64/opinion-112024-use-facial-recognition-streamline_en)
- [W3C Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)

The references inform review questions. Launch counsel must determine applicability, current law, territorial scope and any supervisory consultation requirement.
