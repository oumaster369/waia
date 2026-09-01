# AI-TWIN Presence and Liveness Threat Model

**Status:** Proposed security contract; no implementation or production activation
**Owner:** DEE-873
**Applies to:** AI-TWIN v1 Avatar eligibility, future liveness ceremony and account-presence composition
**Human gate:** [`../product-specs/ai-twin-presence-human-decision.md`](../product-specs/ai-twin-presence-human-decision.md)

## 1. Security objective

WAIA may collect narrowly scoped evidence that a live Human is responding to a fresh challenge while an authenticated account session is present. It must not transform that evidence into a broader identity claim.

The ceremony protects the Human and the WAIA network from replay, injection and account misuse while preserving free choice, accessibility and privacy. Passing it grants only the capability explicitly named by policy. It never grants authority to act, publish, disclose, socialize or bind the Human.

## 2. Claims are separate

| Question | v1 mechanism | Admissible v1 result | Explicit non-claim |
|---|---|---|---|
| Is a live Human responding now? | Fresh randomized active challenge plus passive PAD and integrity signals | `presence.liveness = PASS/FAIL/INCONCLUSIVE` for one ceremony | Not who the Human is |
| Does the session control an enrolled account credential? | WebAuthn/passkey ceremony, verified independently | Authenticated account/device session | Not liveness, uniqueness or legal identity |
| Is this the only WAIA account for this Human? | None in v1 | `uniqueness = NOT_ASSESSED` | No cross-account face search or deduplication |
| Does the Human match a civil/legal identity? | None in v1 | `legal_identity = NOT_ASSESSED` | No KYC, document or government-identity assertion |
| Did the Human approve this representation? | Separate Avatar consent and review | Versioned representation approval | Not proof that generated media is authentic in another context |

No UI, API, receipt or analytics event may collapse these results into `verified human`, `real person`, `unique`, `identity verified` or an equivalent badge.

## 3. Protected assets

- the Human's freedom to participate, stop, refuse and recover;
- passkey credentials and authenticated sessions;
- challenge freshness, unpredictability and one-time use;
- raw camera/audio frames and temporary capture buffers;
- biometric samples, templates, PAD features and vendor outputs;
- Avatar source media, generated representation and approval history;
- consent, policy, deletion/export and recovery records;
- ceremony receipts and security telemetry;
- tenant and subject isolation;
- the truthfulness and limited scope of every user-facing claim.

Raw capture and derived biometric material are high-impact data even when the implementation or jurisdiction does not ultimately classify every processing step identically.

## 4. Trust boundaries

```text
Human
  -> WAIA first-party UI
  -> browser / operating system / camera / microphone
  -> capture-integrity boundary
  -> WAIA ceremony API and nonce store
  -> vendor-neutral PAD adapter [DARK]
  -> policy/verdict engine
  -> minimal receipt store

Separate path after separate consent:
Human -> Avatar source store -> Avatar provider [DARK] -> Human review -> approved representation

Independent path:
Human -> authenticator -> WebAuthn relying party -> authenticated account session
```

The browser, device, camera feed, third-party SDK, provider response, generated media and model explanation are untrusted inputs. The client cannot authoritatively declare a pass. A provider score is evidence, not policy or fact.

## 5. Adversaries and misuse conditions

- an unauthenticated attacker creating synthetic accounts;
- an account thief with a stolen session, password, device or recovery channel;
- a presentation attacker using print, screen, mask, puppet or prerecorded media;
- an injection attacker replacing camera frames or using a virtual camera/emulator;
- a deepfake operator generating or relaying responses in real time;
- a relay attacker directing a remote Human to complete a challenge for another session;
- malware or a compromised browser/device/SDK;
- an abusive partner, employer or other coercive actor controlling the Human;
- a malicious or compromised vendor, insider or support operator;
- a curious internal service attempting secondary use or cross-account matching;
- an automated client probing thresholds, challenge distribution or fallback routes;
- accidental harm caused by disability, device quality, skin tone, lighting, language, speech or motor variation;
- WAIA itself overclaiming what a probabilistic result establishes.

## 6. Ceremony security contract

### 6.1 Preconditions

1. Avatar Studio eligibility at Formation `>=20%` is evaluated independently and conveys no trust.
2. The Human sees the purpose, data path, retention posture, optionality and fallback before capture.
3. A fresh WebAuthn/passkey result binds the ceremony to the authenticated WAIA session. Passkey user verification does not substitute for WAIA liveness.
4. Production biometric and Avatar providers remain `DARK` until the Human gate is recorded.

### 6.2 Challenge

The server creates a cryptographically unpredictable, single-use ceremony with:

- opaque ceremony ID and nonce;
- authenticated subject/account and tenant binding;
- purpose and policy-version binding;
- allowed origin, relying-party/session and capture-mode binding;
- issued-at, strict expiry and maximum attempt count;
- multiple actions selected and ordered from an approved, accessibility-aware catalog;
- server-held expected sequence and timing envelope;
- explicit cancellation and replay state.

“Say cheese” may be one localized prompt. A fixed phrase, a single action or an exact three-second response window cannot independently pass the ceremony. Time pressure must not become an accessibility filter; the server can preserve freshness while selecting an approved alternative action or duration.

### 6.3 Capture and transport

- Capture begins only after an explicit Human gesture and active camera/microphone indicators.
- The client returns frames/signals bound to the ceremony; client timestamps and integrity claims remain untrusted.
- Transport uses an authenticated protected channel; payload size, type, duration and frame cadence are bounded.
- Raw evidence is not logged, placed in analytics, embedded in traces or reused for model training.
- The capture pipeline collects only modalities required by the selected challenge. Voice recognition is outside scope.
- Device/SDK integrity and virtual-camera signals can increase suspicion but cannot prove Human identity.

### 6.4 Evaluation and verdict

The policy engine evaluates independent evidence:

- fresh challenge completion and sequence consistency;
- passive presentation-attack detection;
- injection/virtual-camera/client-integrity signals;
- passkey/session binding;
- replay, nonce, rate-limit and risk signals;
- vendor health and evidence completeness.

Only these terminal outcomes are allowed:

| Outcome | Meaning | Capability effect |
|---|---|---|
| `PASS` | Evidence meets the approved liveness policy for this ceremony | May satisfy only the named liveness gate |
| `FAIL` | Evidence contradicts or falls below the approved policy | No capability; retry/recovery policy applies |
| `INCONCLUSIVE` | Evidence is insufficient or conflicting | No capability; accessible retry or review |
| `TECHNICAL_ERROR` | Capture/provider/system could not evaluate | No capability; never convert to fail or pass |
| `EXPIRED` | Freshness or one-time-use constraint failed | No capability; start a new ceremony |
| `CANCELED` | Human withdrew or stopped | No capability; no progress penalty |

Provider confidence is never returned directly as truth. Threshold, provider/model version, policy version and reason-code mapping are versioned and testable.

### 6.5 Minimal receipt

The long-lived receipt must exclude raw media and reusable biometric templates. It may contain only:

- subject/tenant-scoped receipt ID;
- purpose, policy version and challenge family;
- server issue/completion time and nonce digest;
- passkey-session-binding reference, not credential secrets;
- PAD/integrity provider and model version identifiers;
- categorical verdict and bounded reason codes;
- review/revocation/expiry state;
- deletion lineage for temporary evidence.

Receipt retention is a Human decision, not selected by this document.

## 7. Threat and control matrix

| ID | Threat / failure | Required prevention and detection | Required evidence before activation | Residual risk / response |
|---|---|---|---|---|
| P-01 | Printed photo or static display | Multiple active actions, passive PAD, motion/depth/texture signals where supported | Corpus tests across devices, lighting and presentation instruments | False accepts remain possible; thresholds and step-up policy are Human-approved |
| P-02 | Prerecorded video/audio replay | Fresh nonce, randomized sequence, adaptive timing, one-time use, replay fingerprints | Same-video and transformed-video replay suite | Advanced replay may evade; no uniqueness/identity claim |
| P-03 | Mask, puppet or physical presentation | PAD evaluated against representative attack instruments | Independent PAD benchmark with documented attack species | Unknown instruments remain; monitor and version policy |
| P-04 | Real-time deepfake/reenactment | Unpredictable multi-action challenge, passive PAD, injection signals and bounded latency | Current deepfake tools and adversarial relay fixtures | No claim of universal deepfake detection |
| P-05 | Virtual camera or frame/API injection | Capture provenance/integrity signals, server-side evidence validation, reject direct verdict submission | Browser/device matrix, virtual-camera and modified-client tests | Compromised devices cannot be made fully trustworthy |
| P-06 | Challenge prediction or precomputation | Large approved catalog, CSPRNG selection, short expiry, versioned entropy tests | Distribution/entropy and prompt-enumeration tests | Catalog leakage reduces entropy; rotate/version prompts |
| P-07 | Nonce replay, duplicate submit or race | Atomic single-use consume, session/subject/purpose binding and idempotent terminal result | Concurrency, stale, duplicate and cross-account tests | Availability pressure; fail closed |
| P-08 | Cross-session or cross-tenant substitution | Tenant/subject/session/origin binding at every boundary | Negative isolation tests and receipt trace | Critical incident if violated; revoke affected receipts |
| P-09 | Remote Human relay | Tight session binding, Human-visible account/purpose, challenge latency/risk signals | Relay rehearsal | Cannot eliminate consensual relay; do not claim uniqueness |
| P-10 | Coercion | Obvious exit, neutral cancellation, no punishment, discreet help/recovery path | Safety and coercion UX review | Software cannot prove voluntary participation |
| A-01 | Stolen session or recovery downgrade | Passkey reauthentication, recovery policy isolated from liveness, recent-auth requirement | Account-takeover and recovery abuse tests | Human support review may remain necessary |
| A-02 | Passkey mistaken for identity | Typed trust states and prohibited claim lint/evals | API/UI semantic tests | Platform authenticator can be shared; account control only |
| A-03 | Liveness mistaken for account authority | Separate passkey and liveness results with explicit composition policy | Missing/failed-factor matrix | Never infer authorization from face/video |
| D-01 | Raw-media leakage through logs/traces | Denylist logging, payload redaction, isolated ephemeral processing, deletion receipts | Observability inspection and canary data test | Vendor/support access remains contractual risk |
| D-02 | Secondary use or training | Purpose-bound processing, contractual prohibition, access controls and audit | DPA/vendor evidence, data-flow verification | Vendor claims require independent verification |
| D-03 | Avatar material reused as liveness evidence | Separate stores, keys, purposes, retention and APIs | Cross-purpose denial tests | Compromise of both paths is higher impact |
| D-04 | Reidentification/template theft | No cross-account gallery; no reusable central face template by default; encryption and minimization | Architecture inspection, export/deletion test | Any unavoidable derived feature needs separate approval |
| V-01 | Provider outage or malformed result | Adapter isolation, timeouts, schema validation, circuit breaker, `TECHNICAL_ERROR` | Chaos/contract tests | Never fail open; accessible retry/fallback |
| V-02 | Provider/model changes silently | Allowlisted versions, signed config, change review and requalification | Version pin/change-detection tests | Emergency withdrawal must revoke future eligibility |
| V-03 | Insider/support misuse | Least privilege, audited break-glass, no raw default access | Access review and audit-log test | Human/legal incident process required |
| F-01 | Unequal false rejection/acceptance | Stratified evaluation, fixed policy threshold, accessible fallback, no punitive retry | Demographic/device/disability evidence with confidence intervals | Residual disparity must be disclosed and Human-approved |
| F-02 | Speech/motor/vision/hearing exclusion | Challenge catalog with non-equivalent modality alternatives and adjustable timing | WCAG/accessibility and Human testing | Some modalities may remain unavailable; no loss of core account use |
| F-03 | Poor device/network conditions | Quality preflight, `INCONCLUSIVE`/`TECHNICAL_ERROR`, resumable retry | Low-end device, bandwidth and lighting matrix | Avatar/liveness cannot gate unrelated essential features |
| O-01 | Emotion/personality/sensitive-trait inference | No such model, fields, prompts or vendor feature; contractual prohibition | Schema/output inspection and vendor configuration review | Treat unexpected vendor output as security event |
| O-02 | Face dedup/uniqueness introduced by convenience | No cross-subject comparison API/index/gallery | Architecture and data-store inspection | Any future uniqueness policy requires a new constitutional/Human decision |
| O-03 | “Verified human/identity” overclaim | Typed claim vocabulary and user-facing copy tests | Product/security review | Misleading copy is a release blocker |
| R-01 | Recovery becomes weakest bypass | Recovery changes account state only; liveness failure cannot be manually converted to pass without explicit reviewed receipt | End-to-end recovery abuse suite | Manual review is susceptible to social engineering |
| R-02 | Rate abuse/denial or probing | Subject/device/network-aware limits, cooldown, privacy-preserving telemetry | Boundary and distributed-abuse tests | Limits must avoid trapping legitimate Humans |
| R-03 | Deletion/export incomplete | Data inventory, provider cascade, tombstone/deletion receipt and reconciliation | End-to-end delete/export rehearsal | Backups/legal holds need explicit disclosure and expiry |

## 8. Evaluation contract

### 8.1 Required security suites

- static, screen, transformed replay and physical-presentation corpus;
- prerecorded and real-time generated media;
- virtual-camera, emulator, modified-client and direct-API injection;
- stale, guessed, reused, reordered and cross-boundary challenges;
- session theft, passkey absence, account recovery and relay;
- provider timeout, schema drift, model change and partial response;
- consent withdrawal, mid-capture cancellation and deletion propagation;
- accessible alternatives, low-end devices, poor networks and varied environments;
- stratified false-accept and false-reject evaluation;
- copy/API assertions proving the four trust questions stay distinct.

### 8.2 Metrics

Evaluation reports must name the standard, corpus, attack species, sample size, confidence interval, device/browser/OS strata and provider/model/policy version. At minimum they report:

- attack presentation and bona fide presentation error measures appropriate to ISO/IEC 30107-3;
- false-match/non-match or equivalent decision errors where biometric comparison exists;
- retry, inconclusive and technical-error rates;
- abandonment and accessible-fallback completion;
- differential performance across relevant demographic, disability, device and environment strata;
- replay/injection attack success by attack family;
- deletion/export completeness and elapsed time.

NIST values are a reference baseline, not an automatic WAIA compliance claim. Numeric WAIA release thresholds remain unset until a real provider and representative evaluation corpus exist and the Human approves them.

### 8.3 Release blockers

Production activation is blocked when any of these is true:

- a trust question is implied without an implemented mechanism;
- raw liveness evidence and Avatar material share purpose, store or retention by default;
- the client or provider can unilaterally declare a pass;
- challenge replay, cross-tenant substitution or fail-open behavior is possible;
- raw media appears in logs, analytics or model training;
- deletion/export cannot be reconciled through every processor;
- accessibility relies on a single timed phrase/action with no alternative;
- performance evidence hides sample size, uncertainty or affected populations;
- a provider/version changed without requalification;
- DPIA/legal, vendor, retention or Human activation decisions are absent.

## 9. Recovery and incident behavior

- Liveness failure never locks the Human out of their core WAIA account by itself.
- Repeated attempts trigger cooldown and alternative/review routes, not an infinite biometric loop.
- Recovery cannot manufacture `PASS`; it records a different reviewed outcome and capability policy.
- Compromise triggers future-ceremony shutdown, provider isolation, receipt impact analysis, Human notification where required and a new qualification decision.
- Previously generated Avatars remain independently revocable even if liveness receipts expire or are withdrawn.

## 10. Primary references

Retrieved 2026-09-01:

- [NIST SP 800-63A-4 — Identity Proofing](https://pages.nist.gov/800-63-4/sp800-63a.html)
- [NIST SP 800-63B-4 — Authentication and Authenticator Management](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)
- [ISO/IEC 30107-3:2023 — Biometric presentation attack detection testing and reporting](https://www.iso.org/standard/79520.html)
- [W3C Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)
- [FIDO Alliance Privacy Principles](https://fidoalliance.org/fido-authentication-2/privacy-principles/)

These references guide architecture and evaluation. They do not establish certification, regulatory compliance or legal sufficiency for WAIA.
