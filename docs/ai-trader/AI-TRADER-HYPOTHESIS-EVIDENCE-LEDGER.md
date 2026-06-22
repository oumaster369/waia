# AI-TRADER — LD-5a Hypothesis + Evidence Ledger Doctrine (Knowledge-First)

> **Status: Ratified doctrine v1.1 (LD-5a).**
> **v1.1 (DEE-290 / LD-5a.2c.0):** reconciliation update — §5.2 ratifies R1 (pin-only) and R2 (derived integrity) as shipped in DEE-289; new §5.2.1 ratifies the closed Trial Integrity reason taxonomy, fold rule, and digest contract; Open Question #6 closed. Additive; no record type added, no governance gate weakened.
> **Subordinate to the [AI-TRADER Market Intelligence Architecture](AI-TRADER-MARKET-INTELLIGENCE-ARCHITECTURE.md) and the [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md); bounded by [ADR-0009](../adr/0009-regulatory-posture.md) / [ADR-0010](../adr/0010-strategy-validation-gate.md) / [ADR-0011](../adr/0011-single-operator-governance-model.md).**
> **Additive only — it overrides nothing and weakens no governance gate.**
> **No engines.** LD-5a delivers persisted records, registers, and derived read-models only. It adds no automation, no statistical model, no autonomous generation, and no live-trading path.

Date: 2026-06-22
Scope: How AI-TRADER forms falsifiable market claims (Hypotheses) and accumulates immutable, provenance-pinned evidence for and against them (the Evidence Ledger) — the first layer at which the system holds a belief that can be wrong.
Authority: Subordinate to the [Market Intelligence Architecture](AI-TRADER-MARKET-INTELLIGENCE-ARCHITECTURE.md) (Knowledge Objects 5 and 6), the [Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md), and [ADR-0009](../adr/0009-regulatory-posture.md) / [ADR-0010](../adr/0010-strategy-validation-gate.md) / [ADR-0011](../adr/0011-single-operator-governance-model.md). **Where this document and any of those conflict, they win.**
Lineage: Canonical output of three review cycles (Initial Design → Hostile Review → Ratification Review). It records final decisions; it does not re-litigate them.

> **Reading note.** LD-5a is not a strategy, not a forecast, and not a decision. It is the layer where a recurring *structure* (LD-4 Pattern) becomes a *claim* (Hypothesis) and where the system records — append-only and forever — every fact that bears on that claim. The optimization target is **evidence quality, reproducibility, and honesty — never trading profitability.**

---

## Section 1 — Executive Summary

LD-5a is the layer where AI-TRADER stops cataloguing structure and starts holding belief.

**Why LD-5a exists.** The Market Intelligence doctrine's central thesis is that "strategy is a derived, disposable artifact compiled from validated market knowledge" (MI Architecture §1). The unit of validated knowledge is the **Hypothesis**, and the substrate that validates or refutes it is the **Evidence Ledger**. Everything downstream — Worldview, Strategy, Forecast, Decision, and the DEE-178 gate — depends on a claim having an auditable, immutable evidence trail. LD-5a is the layer that produces one.

**Why the Pattern Registry (LD-4) was insufficient.** LD-4 is, by deliberate construction, an inert structural registry behind a firewall that forbids any claim of profitability, edge, direction, prior, relationship-type, or falsification. A Pattern records only that "this structure recurs (no tradeability claim)" (MI Architecture §7, object 3). It therefore cannot hold a belief, cannot accumulate evidence, and cannot be wrong. LD-4 also deliberately deferred trial accounting: its `trial_budget_max` is advisory metadata with no consumption, explicitly leaving "actual trial accounting" to "a future Hypothesis/Evidence layer." LD-5a is that layer.

**Why Hypothesis and Evidence are introduced together.** A Hypothesis is the cognitive atom (MI Architecture §7.1): a falsifiable, regime-scoped, relationship-typed claim with an explicit prior and a mandatory null set. It is meaningless without a substrate that records what argued for and against it. The Evidence Ledger is that "append-only, immutable spine" (§8). The two are distinct entities but one layer: the claim and the immutable record of its testing.

LD-5a records **facts**; it never computes **interpretations**. Confidence is recorded human judgment, not a model. Trials are registered, never scored or enforced. False-discovery awareness is a count, never a rate. Every statistical model — decay curves, FDR rates, calibration scoring, eligibility verdicts — is deferred to the layer whose outcomes give it meaning.

---

## Section 2 — Role in the Market Intelligence Chain

The canonical knowledge chain (MI Architecture §5), with LD-5a's position bounded:

```mermaid
flowchart LR
  Obs["Observation (LD-2b)"] --> Meas["Measurement (LD-3)"]
  Meas --> Pat["Pattern (LD-4)"]
  Pat -->|"pinned by digest"| Hyp["Hypothesis (LD-5a)"]
  Hyp --> Ev["Evidence Ledger (LD-5a)"]
  Ev --> Fcst["Forecast (LD-6a)"]
  Fcst --> Dec["Decision (LD-7)"]
  subgraph ld5a [LD-5a boundary]
    Hyp
    Ev
  end
```

- **Upstream boundary (Pattern → Hypothesis).** A Hypothesis *references* one or more Patterns and Measurements by pinned version digest. It never restates or recomputes structure. Promotion from Pattern to Hypothesis is the act of attaching a claim, a prior, a falsification condition, and a required-null declaration to a recurring structure.
- **Downstream boundary (Evidence → Forecast).** LD-5a stops at the immutable record of evidence and recorded judgment. It produces no dated, scored prediction — that is a Forecast (LD-6a). The Evidence Ledger may be *read by* the Forecast layer; it contains no forecast.
- **Lateral boundaries.** Regime Knowledge (LD-5c) and Null Comparators (LD-5b) are neighbors, not contents: LD-5a declares the *required* null set and a free-text regime scope, but computes neither. See Sections 9 and 10.

**Ordering note.** The epistemic chain lists Regime Knowledge before Hypothesis; the implementation sequence places LD-5a before LD-5c. This is intentional: regime-transition *recording* can follow the hypothesis/evidence spine without blocking it, and LD-5a reserves a regime seam (Section 10) so no rework is required.

---

## Section 3 — Hypothesis

**Purpose.** A Hypothesis is the cognitive atom of the system: a falsifiable, regime-scoped, relationship-typed market claim that can accumulate evidence and be proven wrong.

**Responsibilities.**

- Carry an explicit `relationshipType`: `correlational | predictive | causal-conjecture` (causal claims are flagged speculative and demand far more evidence).
- Carry an explicit **prior** (recorded ordinal judgment plus an uncertainty band) — the belief held *before* evidence.
- Carry **mandatory falsification conditions** — the pre-registered statement of what would prove the claim false.
- Carry a **mandatory required-null declaration** — the set of null comparators the claim must eventually beat, fixed by hypothesis type (declaration only; computation is LD-5b).
- Reference upstream Patterns/Measurements by pinned version digest.
- Carry an optional `supersedes` lineage reference to a prior hypothesis it replaces (a recorded fact; no displacement enforcement).
- Be **pre-registered**: each version is sealed before its evaluation window; any change to parameters or falsification conditions is a new version and a new window.

**Lifecycle.** `PROPOSED → VALIDATING → VALIDATED → DECAYING → RETIRED | QUARANTINED` (defined in Section 7). Lifecycle state is *derived* from an append-only lifecycle record, never stored as a mutable flag.

**Invariants.**

- A Hypothesis is **immutable per version**; revisions are new versions.
- A Hypothesis **without falsification conditions is invalid** and cannot be recorded.
- A Hypothesis without a required-null declaration is invalid.
- A Hypothesis without an explicit prior is invalid.
- The prior is an attribute of the (immutable) Hypothesis. Evolving belief is **not** stored here — it lives in the Evidence Ledger as Confidence Judgments.

**A Hypothesis is NOT:**

- a **Pattern** — it adds a claim to a structure; it does not record structure;
- a **Measurement or Observation** — it is a claim, not a definition or a value;
- a **Forecast** — it carries no `expectedMove`, holding period, or resolution; encoding any of these is a forbidden forecast leak;
- a **Decision or Strategy** — it is neither an action nor a compiled artifact;
- a **probability** — its prior and confidence are recorded judgments with bands, never computed probabilities.

---

## Section 4 — Evidence Ledger

**Purpose.** The Evidence Ledger is the append-only, immutable spine of the system: the permanent record of every fact bearing on every hypothesis, for and against, neutral included.

**Append-only nature.** Nothing in the Ledger is ever edited or deleted. Corrections, revisions, and re-examinations are **appends**. Retired and refuted hypotheses and all their evidence are retained forever — there is no deletion and no archival that removes a fact from the record. This is the architectural guarantee against survivorship flattery.

**Reproducibility guarantees.** Because every entry is immutable and version-pinned (Section 8), the complete belief state of any hypothesis is reconstructable as of any past instant. A future operator can determine exactly what evidence existed, which upstream versions it depended on, and why the recorded judgment was what it was, at any point in time.

**Provenance requirements.** Provenance is a precondition for evidence (MI Architecture principle #8). No evidence entry may exist without a pinned upstream source/observation (LD-2a/2b), a pinned measurement version (LD-3), and point-in-time stamps (`event_time` knowable, `ingest_time` recorded, `ingest_time >= event_time`). A datum without verifiable provenance cannot become evidence.

**Firewall.** The Research Journal (notes, rejected ideas, narrative) may *reference* the Ledger but can **never be evidence**. The gate ignores the journal entirely (MI Architecture §8). Narrative content is firewalled out of all Ledger record types.

---

## Section 5 — Evidence Ledger Record Types

The Evidence Ledger is a single append-only spine containing exactly four ratified record types. There are no separate ledgers.

**1. Evidence.** A provenance-stamped, version-pinned fact bearing on a specific hypothesis version.

- `direction`: `FOR | AGAINST | NEUTRAL`. Neutrality is explicit and recorded; absence of evidence is never silently treated as neutral.
- Pins the hypothesis version and the measurement version(s) it rests on; carries source/observation provenance and PIT stamps.
- A falsification-triggering observation is recorded as an `AGAINST` entry and may drive retirement.

**2. Trial Registration.** An immutable record that an evaluation attempt was pre-registered against a hypothesis version.

- **Hypothesis pin (R1).** Pins the hypothesis version **only** (`hypothesis_id` + `hypothesis_definition_digest`). The declared nulls and the falsification conditions are **not snapshotted on the trial row**; they are sealed transitively inside `hypothesis_definition_digest` and **resolved at read time** from the pinned, immutable hypothesis version.
- **Integrity (R2).** Integrity is a **derived read-model**, not a stored column. The default derived value is `valid`; a trial becomes `invalidated` **only** through appended Trial Integrity events (see §5.2.1). There is **no mutable `integrity_status` column** (consistent with §6). The record also carries an optional free-text `research_program` label.
- Records **only that an attempt occurred**. It does **not** classify success or failure, does not adjudicate outcome, and does not enforce any budget.

> **Ratification note (DEE-290 / LD-5a.2c.0).** The two bullets above ratify the corrections made when Trial Registration shipped (DEE-289 / LD-5a.2b): **R1** (pin-only; nulls/falsification resolved at read time, never snapshotted) and **R2** (integrity derived; no stored column). They supersede the original v1.0 wording, which described an `integrity_status` attribute and a declared-nulls/falsification snapshot carried on the trial.

**3. Confidence Judgment.** A recorded human judgment of belief in a hypothesis given its evidence.

- Expressed as an ordinal level plus an uncertainty band; cites the Evidence entries that justify it; carries an `as_of` time and a declared review horizon.
- Is **recorded judgment, not a model** — never a computed probability, never a fitted curve.
- Evolving belief lives here (append-only), not on the immutable Hypothesis.

**4. Invalidation Flag.** An appended marker that an upstream source or measurement has been revised, flagging dependent evidence for human re-examination.

- Never edits or removes the affected evidence; it appends a re-examination signal. It does not itself change any recorded judgment.

### 5.2.1 Trial Integrity (derived; LD-5a.2c)

Trial integrity is the **derived `integrity_status` attribute of a Trial Registration** (record type 2). It is **not** a fifth Evidence Ledger record type and **not** a separate ledger — the Evidence Ledger remains exactly the four record types above. Integrity is derived from an **append-only Trial Integrity event substrate** that belongs to the same category as the hypothesis/pattern lifecycle records of §7: *derivation substrate*, not Ledger record types.

**Closed reason taxonomy (Open Question #6 — ratified).** A trial may be integrity-invalidated only for one of these attempt-local reasons:

- `look_ahead_contamination` — future/leaked data discovered in the evaluation (a point-in-time violation found after the fact).
- `pre_registration_breach` — the evaluation deviated from the sealed pre-registration protocol.
- `computation_defect` — a defect in the evaluation harness invalidated the attempt.
- `provenance_gap` — required provenance was found missing or unverifiable (the §4 precondition failed).

The list is **closed**; growth requires a new ratified version of this document plus an additive migration. Upstream source/measurement **revision** is deliberately **not** a trial-integrity reason — it is the domain of the **Invalidation Flag** (record type 4, implemented in LD-5a.3b), which flags dependent *evidence* for re-examination. There is **no `operator_error` catch-all** (an unverifiable, unremovable survivorship surface).

**Derived-state fold rule (ratified).** Current integrity is the resulting status of the **most recent** integrity transition for the trial, ordered by `seq`; `since` is the timestamp of the most recent transition **into** the current status. A trial with **no** integrity events derives `valid`. This latest-transition rule is forward-compatible with a future `reinstated` event type (deferred from MVP).

**Content-digest contract (ratified).** Each Trial Integrity event's `content_digest` binds exactly: `schemaVersion`, `organizationId`, `trialId`, `eventType`, `reasonCode`, `rationale`, `causeRef` (null until LD-5a.3b), `eventTime`, `ingestTime`, `recordedBy`. It **excludes** `seq`, derived state, and any denormalized `trialHypothesisKey`.

**Anti-survivorship guarantees.** Integrity invalidation **never** refunds or removes a trial from trial counts, **never** edits or deletes Evidence, and **never** transitions hypothesis lifecycle. It records an audited re-examination/trust fact — never a back door (§11).

**Boundary — two distinct "integrity" concepts.** *Trial integrity invalidation* is **per-attempt** (this substrate). The §7 *hypothesis integrity break* → `QUARANTINED` is a **per-claim**, human-recorded lifecycle transition. **Neither auto-triggers the other.**

---

## Section 6 — Core Invariants

- **Append-only.** Every record type is immutable. Current state is always derived from the append-only log; there are no mutable state columns.
- **Provenance.** No evidence without pinned upstream source/observation, pinned measurement version, and valid PIT stamps (`ingest_time >= event_time`).
- **Reproducibility.** Every entry is version-pinned by digest; historical belief state is reconstructable as of any instant (Section 8).
- **Pre-registration.** A hypothesis version is sealed before its evaluation window. Any change to parameters or falsification conditions creates a new version and a new window, logged.
- **Falsification.** Falsification conditions are mandatory; a hypothesis without them is invalid.
- **Required-null declaration.** The required null set (by hypothesis type) is mandatory at authoring; computation is deferred to LD-5b.
- **Human promotion.** The machine records facts; only the human promotes. LD-5a produces facts and derived read-models, never eligibility verdicts or signals.
- **Facts, not interpretations.** No success/failure classification, no budget enforcement, no FDR rate, no decay curve, no eligibility aggregation, no engines.
- **Default state.** The canonical default belief state of any hypothesis is `INSUFFICIENT_EVIDENCE`.
- **Tenant isolation.** All records are organization-scoped, with the isolation guarantees established by LD-2a through LD-4.

---

## Section 7 — Lifecycle Model

Hypothesis lifecycle state is derived from an append-only lifecycle record (current state = latest entry). Transitions are human-recorded; none are automatic.

```mermaid
stateDiagram-v2
  [*] --> PROPOSED
  PROPOSED --> VALIDATING: pre-registration sealed
  VALIDATING --> VALIDATED: human promotes
  VALIDATING --> QUARANTINED: integrity break
  VALIDATED --> DECAYING: staleness / review horizon passed
  DECAYING --> VALIDATED: fresh evidence + renewed judgment
  DECAYING --> RETIRED: human retires
  VALIDATED --> QUARANTINED: structural break
  RETIRED --> [*]
  QUARANTINED --> [*]
```

- **PROPOSED** — the hypothesis exists with prior, falsification conditions, and required-null declaration, but no sealed evaluation window yet.
- **VALIDATING** — pre-registration is sealed; evidence and trials accumulate against this version.
- **VALIDATED** — a human has promoted the hypothesis on the recorded evidence. Promotion is never machine-automated.
- **DECAYING** — the latest confidence judgment has passed its review horizon; under the revert-to-prior doctrine the effective belief reverts toward the recorded prior and is surfaced as stale until a human renews judgment on fresh evidence.
- **RETIRED** — the hypothesis is no longer held. Its records are retained forever (no survivorship flattery).
- **QUARANTINED** — an integrity or structural break has occurred; the hypothesis is isolated pending human disposition. Structural-break handling routes to the kill-switch posture defined upstream; LD-5a records the state transition, not the remediation.

---

## Section 8 — Reproducibility Model

LD-5a guarantees that the belief state of any hypothesis is exactly reconstructable as of any past instant.

- **Evidence pinning (the LD-5 Evidence pin).** Every Evidence entry pins the exact hypothesis version (by definition digest) and the exact measurement version(s) it rests on (by key + digest), plus source/observation provenance and PIT stamps. This is distinct from the LD-4 reproducibility pin (which pins measurements *inside a pattern definition*); the LD-5 Evidence pin records *what evidence was based on at the moment it was recorded*.
- **Version pinning.** All upstream layers (LD-2a..LD-4) are append-only and version-pinned by digest, so a pinned reference resolves deterministically and immutably forever.
- **Reconstruction of historical state.** Because every record carries an immutable sequence and timestamp, filtering the append-only logs to a chosen instant and applying the revert-to-prior staleness rule reproduces the exact confidence, evidence set, and lifecycle state as they stood then. No model version, clock, or external input is required to replay history.

---

## Section 9 — Explicit Exclusions

The following are intentionally **not** part of LD-5a:

- **Forecast (LD-6a).** No dated, scored predictions; no `expectedMove`, holding period, or resolution may appear in a hypothesis or evidence entry.
- **Calibration (LD-6b).** No proper scoring, no survivorship-aware scorecard, no empirical decay model.
- **FDR models / calculations / engines.** LD-5a holds trial **counts** and recorded forking-path **awareness** only. Any false-discovery **rate** belongs to Calibration; an FDR **engine** is Post-MVP.
- **Discovery Family semantics.** Removed as a concept. Permitted only as optional free-text trial metadata, with no semantics and no enforcement.
- **Confidence decay curves / models.** Only staleness, review horizons, and the revert-to-prior doctrine. Empirical decay belongs to Calibration.
- **Budget enforcement and trial outcome classification.** Trials are immutable registrations; LD-5a does not enforce budgets, classify success or failure, or adjudicate outcomes.
- **Promotion eligibility verdicts/signals.** LD-5a produces facts; aggregation into a verdict belongs to Worldview/Decision and the human-governed gate.
- **Regime logic (LD-5c).** Only a free-text regime scope and a reserved seam; no regime model, classification, or runtime label.
- **Decision logic (LD-7), Challenger logic (LD-8), Worldview aggregation, contradiction/conflict resolution, displacement enforcement.**
- **Strategy, Risk, and Execution logic; trading permissions; DEE-178 gate changes.** Gate linkage is a separate later slice (LD-9).

**Terminology bridge.** What MI Architecture §16 calls the "FDR register" is, in LD-5a, the trial-count + forking-path-awareness facet; the false-discovery rate itself is deferred to Calibration (LD-6b).

---

## Section 10 — Future Layer Interfaces (reserved seams)

LD-5a is designed so the following layers can be added later without rewriting its structure. Each seam is *reserved*, not *implemented*.

- **LD-5b Null Comparator.** The hypothesis carries the *declared* required-null set; the Evidence record type reserves a null-comparator evidence kind and reference so computed null results can later be appended as evidence (typically `AGAINST`) pinned to the same hypothesis version. LD-5a computes no nulls and imports no price/feature data.
- **LD-5c Regime Knowledge.** The hypothesis carries a free-text `regimeScope` descriptor; evidence records reserve a nullable regime-context reference so evidence can later become regime-dependent and confidence regime-sliced. LD-5a performs no regime classification and consumes no runtime regime label.
- **LD-6 Forecast.** The Forecast layer reads hypotheses and evidence to author pre-registered predictions; LD-5a stores no forecast and reserves no forecast fields inside hypothesis/evidence (the firewall is the seam).
- **LD-6 Calibration.** Calibration will consume resolved forecasts to produce scoring, empirical decay, and a true false-discovery rate. LD-5a's recorded confidence judgments, review horizons, and trial counts are the inputs it will later score; LD-5a computes none of them.
- **LD-7 Decision Record.** Decisions will bind hypotheses, evidence-for/against, and a governing forecast; LD-5a exposes the facts a decision cites and produces no decision.
- **LD-8 Challenger.** The Challenger will cite specific Evidence entries against a claim; LD-5a's `AGAINST` evidence and immutable record are the substrate it will reference. LD-5a contains no challenger logic and no dissent adjudication.

---

## Section 11 — Architectural Principles

LD-5a is governed by one discipline: **record facts; do not interpret them.**

- **Recording facts, not interpreting facts.** Every entity and record type stores something that *happened* — a claim was authored, evidence was observed, a human judged, an upstream version changed. No record stores a computed interpretation. This is the load-bearing principle from which the others follow.
- **Preserving evidence.** Append-only and immutable forever. Nothing is deleted; corrections are appends. The record of what the system once believed, and why, is permanent.
- **Preventing survivorship bias.** Failed, refuted, and retired hypotheses and all their evidence are retained forever and remain visible. Trials are registered as attempts and never refunded by reclassification; the integrity-invalidation path is audited, not a back door.
- **Preventing hindsight bias.** Pre-registration seals each hypothesis version — prior, parameters, falsification conditions, and required nulls — *before* its evaluation window. Any change is a new version and a new window. The past cannot be rewritten to fit what happened.
- **Preventing confirmation bias.** Evidence `direction` is first-class; `AGAINST` and `NEUTRAL` are recorded with equal standing to `FOR`; the mandatory required-null declaration forces a disconfirming baseline; the canonical default state is `INSUFFICIENT_EVIDENCE`, so silence reads as doubt, never as support.
- **Honest confidence.** Confidence is recorded human judgment with an explicit uncertainty band — never a probability, never a fitted curve. Staleness reverts belief toward the prior rather than asserting unjustified precision.
- **The machine researches; the human promotes.** LD-5a surfaces facts and derived read-models. Promotion and every act of capital remain human-governed and pass, unchanged, through the DEE-178 gate downstream.

---

## Open Questions (deferred implementation contracts)

These do not block the doctrine. Each is a field/contract decision owned by its implementation slice, not an architectural contradiction:

1. **Confidence ordinal scale and band representation** — locked before the Confidence Judgment record (LD-5a.3).
2. **Review-horizon and revert-to-prior trigger semantics** — locked before LD-5a.3.
3. **Required-null declaration vocabulary** — aligned to MI Architecture §7.3; locked at the Hypothesis slice (LD-5a.1).
4. **Trial-to-evidence cardinality** — confirmed before LD-5a.3.
5. **`supersedes` lineage in MVP** — recorded as a bare fact (no displacement policy) or deferred; confirmed at LD-5a.1.
6. **Integrity-invalidation reason taxonomy** — **CLOSED (DEE-290 / LD-5a.2c.0).** Ratified as the closed four-reason taxonomy in §5.2.1 (`look_ahead_contamination`, `pre_registration_breach`, `computation_defect`, `provenance_gap`); upstream-revision deferred to the Invalidation Flag (LD-5a.3b); no `operator_error`. The derived-state fold rule and content-digest contract are ratified in the same subsection.

---

## Ratification Statement

This document is the **ratified canonical doctrine for LD-5a — Hypothesis + Evidence Ledger**. It reflects the finalized decisions of the three-cycle architecture process (Initial Design → Hostile Review → Ratification Review) and is authoritative for all future LD-5a implementation planning, issue decomposition, architecture reference, audit, and architect onboarding.

It is subordinate to the [AI-TRADER Market Intelligence Architecture](AI-TRADER-MARKET-INTELLIGENCE-ARCHITECTURE.md), the [Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md), and ADR-0009/0010/0011; it is additive and weakens no governance gate. LD-5a contains exactly two top-level entities — the **Hypothesis Registry** and the **Evidence Ledger** (with four record types: Evidence, Trial Registration, Confidence Judgment, Invalidation Flag). It records facts and never computes interpretations; confidence is recorded judgment, trials are immutable registrations, false-discovery handling is a count only, and every statistical model is deferred to Calibration and later layers. The canonical default state is `INSUFFICIENT_EVIDENCE`.

Decisions herein are final unless a future contradiction with superior canon is discovered, in which case the conflict resolves upward to the Market Intelligence Architecture and the ADRs, and any change lands as a new ratified version of this document.

---

*End of doctrine. This document is subordinate to the Market Intelligence Architecture and the Master Spec, additive to the system, and introduces no new governance.*
