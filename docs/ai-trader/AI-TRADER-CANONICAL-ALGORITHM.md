# AI-TRADER Canonical Algorithm — Autonomous Trader-Researcher V2

**Status:** HUMAN-RATIFIED CANON  
**Ratified:** 2026-08-19  
**Linear authority:** DEE-627 (final Human ratification), DEE-601 (master Code↔Canon repair program), DEE-628 (publication gate)  
**Implementation state:** TARGET + REPAIR CONTRACT; not a claim that current `main` already implements this system  
**Audited legacy baseline:** `main@001683f583d8985fb241ae4022848b0ebf9f5768`

---

## 1. Purpose and authority

This document is the canonical implementation orientation for AI-TRADER V2 after the Human Step 0–22 walkthrough, Audit A–E, and the 2026-08-19 Code↔Canon re-audit.

It defines the single intended executable algorithm, the ownership boundary of each authority layer, the recurring runtime loops, the autonomous research loop, the Human sovereignty boundary, the first-live qualification chain, and the dependency-ordered repair program.

It does **not** assert that the current published code already behaves this way. Where current executable behavior conflicts with this document, the conflict is a repair obligation owned by the corresponding Linear issue; legacy executability is not authority.

### Authority order

This document is additive to the WAIA Core and AI-TRADER governing corpus. It is the final Human-ratified end-to-end Trader algorithm/repair contract. It must not silently override WAIA Core identity/tenancy/security ownership, subject-owner doctrines, or ratified ADRs. A true conflict requires explicit Human governance, not agent interpretation.

### Core law

> **There is one AI-TRADER algorithm, not a collection of cooperating shortcuts.**

> **No valid canonical authority proof → no external capital effect.**

> **Unknown or mixed authority chain → no external capital effect.**

> **Qualification is not promotion. Promotion is not activation. Activation is not an order.**

> **Autonomous cognition and research do not imply autonomous sovereignty over new capital authority.**

---

## 2. Canonical objective

AI-TRADER is an autonomous Trader-Researcher designed to continuously:

`observe → establish point-in-time truth → measure → determine what is missing → understand → maintain competing knowledge/hypotheses → predict probabilistically → decide executable economics → obtain capital permission → execute exactly one authorized external effect → reconstruct Reality → reassess open positions → settle closed outcomes → calibrate/learn → generate/test new research candidates → propose qualified improvements to Human → repeat`.

The objective is **not mandatory trading in every market state**. The system seeks reproducible positive executable edge while preserving capital when edge is not proven.

The following are first-class valid outcomes, not failures of autonomy:

- `NO_TRADE`
- `INSUFFICIENT`
- `UNAVAILABLE`
- `UNKNOWN`
- `NO_NEW_RISK`
- `CLOSE_ONLY`
- `REDUCE`
- `CLOSE`
- `HALT`

The canon does not promise profit in every market state. It requires the Trader to distinguish a real executable edge from an illusion of certainty.

---

## 3. The canonical authority graph

### 3.1 Fresh / new-exposure path

`AuthoritativeRuntimeContextV2`

→ `Source`

→ `PIT Observation`

→ `Measurement`

→ `Information Sufficiency`

→ `Understanding / Evidence`

→ `Pattern / Knowledge / Hypothesis`

→ `Predictive Admission`

→ `Forecast V2`

→ `Decision V2`

→ `RiskVerdictV2 / RiskAllowanceV2`

→ `ExecutionPlanV2 / ExecutionAttemptV2`

→ `Venue`

→ `Reality V2`.

`AuthoritativeRuntimeContextV2` is an enveloping upper permission bound. It is not another Decision engine.

### 3.2 Ordinary open-position recurrence

`Reality + fresh qualified evidence`

→ `GuardianAssessmentV2`

→ `Decision V2`

→ `Risk V2`

→ `Execution V2`

→ `Reality`.

### 3.3 Sole narrow Decision-less protective pattern

`Decision-sealed ProtectiveActionMandateV2 + exact deterministic Guardian trigger proof`

→ `Risk V2`

→ `Execution V2`

→ `Reality V2`.

This is not a second discretionary Decision path. The economic conditional was sealed by Decision earlier. The mandate is narrow, reducing/protective, and cannot create new or reversed exposure.

### 3.4 Closed-trade / Billing branch

`Reality`

→ `ClosedTradeSettlementV2`

→ `RealizedStrategyProfitReceiptV2`

→ `BillingAssessmentV2`

→ `BillingHwmEventV2 / InvoiceBasisReceiptV2`

→ Human manual invoice gate.

Billing is downstream-only and cannot issue or modify trading actions.

### 3.5 Autonomous research / Strategy Evolution branch

`Reality / Closed Trade / objective Outcome / Forecast calibration + causal context`

→ immutable `Research Memory`

→ `Research Question`

→ falsifiable `Hypothesis`

→ candidate generation / mutation / combination

→ `DEVELOPMENT`

→ locked walk-forward / OOS

→ candidate evidence package

→ Human proposal

→ Human admission / assignment

→ exact admitted strategy/package identity in RuntimeContext.

No stage before explicit Human admission creates capital authority for a new strategy/package.

---

# 4. Canonical Step 0–22 map

The numbered Steps are architectural responsibilities. Cross-step mechanisms may serve more than one Step and do **not** create extra authority layers.

## Step 0 — Human Canon / Authority Constitution

**Owns:** the one canonical algorithm, authority ownership, MAY/MUST-NOT boundaries, and Human sovereignty over new strategy/package/account/live-capital authority.

**Must not:** be silently changed by runtime code, a coding agent, a profitable result, a deployment, or a lower-level implementation convenience.

**Primary governance:** DEE-627 → DEE-628; master program DEE-601.

**Implementation meaning:** agents may implement inside the canon; any material authority-model change requires a new explicit Human decision.

---

## Step 1 — Source

**Owns:** canonical source/provider identity, provenance/trust metadata, and the origin of an external observation.

**Must not:** interpret the market, create a Forecast, decide economics, size, or issue an order.

**Primary repair:** DEE-620.

**Key rule:** connected source ≠ qualified evidence ≠ useful evidence ≠ required evidence.

---

## Step 2 — PIT Observation

**Owns:** exactly what could have been known at the relevant anchor, including event time, availability/knowledge time, ingest time, revisions, and immutable content identity.

**Must not:** use future revisions or current-state hindsight to repair the past.

**Primary repair:** DEE-620.

**Key rule:** if the system could not know it then, it cannot be part of that historical/live-equivalent causal input.

---

## Step 3 — Measurement

**Owns:** deterministic, versioned, mathematically valid transforms and units from admitted observations.

**Must not:** mix measurement with interpretation, trading permission, or silent fallback values.

**Primary repairs:** DEE-624 plus the canonical measurement lineage in DEE-620.

**Known legacy repair class:** residual `realizedVol20` consumers must not use standard deviation of price levels when the canonical measure is volatility of returns.

---

## Step 4 — Information Sufficiency

**Owns:** purpose-specific `RequiredInformationProfileV2` and deterministic `InformationSufficiencyReceiptV2` with `SUFFICIENT | INSUFFICIENT | UNAVAILABLE` semantics.

**Must not:** turn missing/stale/untrusted required evidence into zero, synthetic evidence, or a compensating aggregate score.

**Primary repair:** DEE-621.

**Required cross-step mechanism:** DEE-645 Dynamic Information Need Planner may request qualified optional evidence above the hard profile floor but may never weaken hard minima.

**Key rule:** new-opportunity sufficiency and open-position reassessment sufficiency are distinct purposes.

---

## Step 5 — Market Understanding / Evidence

**Owns:** exact question-level attribution of causal, corroborating, contradicting, ignored, irrelevant, and missing evidence.

**Must not:** become BUY/SELL, probability, EV, sizing, or capital authority.

**Primary repairs:** DEE-645 + DEE-622.

**Key rule:** `UNKNOWN` is a valid conclusion when evidence does not justify a stronger claim.

---

## Step 6 — Exact Causal Reconstruction

**Owns:** content-addressing the exact causal intelligence input bundle and the evidence → Hypothesis → Forecast lineage so the system can deterministically reconstruct why a downstream conclusion existed.

**Must not:** hash only a convenient structural subset while other unpinned evidence can affect the result.

**Primary repairs:** DEE-626 + DEE-623.

---

## Step 7 — Mathematical / Evidence Correctness

**Owns:** enforcement of correct measurement, baseline, statistical and scientific semantics before evidence can gain predictive authority.

**Must not:** allow profitable PnL to excuse invalid mathematics, leakage, or failed scientific conditions.

**Primary repairs / proof mechanisms:** DEE-624, DEE-630, DEE-631.

**Note:** Scientific Admission is a proof mechanism feeding Predictive Admission; it is not an independent trading authority.

---

## Step 8 — Pattern Discovery

**Owns:** detection and representation of recurring structures, transitions and regime phenomena as evidence-bearing patterns.

**Must not:** equate recurrence with profitability or create executable BUY/SELL authority.

**Primary runtime convergence:** DEE-629; research foundations remain evidence-only until qualified.

---

## Step 9 — Knowledge Lifecycle

**Owns:** versioned PIT-causal knowledge, support, contradiction, invalidation, supersession, failure boundaries, and future-cycle learning.

**Must not:** delete negative evidence or use same-cycle outcomes to retroactively justify the Forecast/Decision that produced them.

**Primary repair:** DEE-629.

**Feedback edge:** DEE-633 closes Forecast outcome/calibration into **future** Knowledge.

---

## Step 10 — Competing Hypotheses

**Owns:** ranked falsifiable market explanations with exact supporting and contradicting evidence.

**Must not:** collapse causal uncertainty into one confidence scalar that directly creates capital authority.

**Primary repairs:** DEE-629 + DEE-626.

---

## Step 11 — Predictive Admission

**Owns:** deterministic proof that one exact PIT epistemic state is admissible to one exact scientifically admitted Forecast package and analysis purpose.

**Canonical output:** `MarketStateSnapshotV2` + `PredictiveAdmissionReceiptV1` (or exact semantic equivalents).

**Must not own:** BUY/SELL, `spotPosture`, `riskMultiplier`, strategy execution allowlists, confidence-based permission escalation, EV, sizing, Risk, or Runtime mode.

**Primary repair:** DEE-647 consuming DEE-631 scientific-admission evidence.

**Key rule:** CDE/MSV becomes a fail-closed Predictive Admission boundary, not a second Decision/Risk engine.

---

## Step 12 — Forecast V2 / Mathematical Challenger Arena

**Owns:** the probability/distribution-of-future authority.

Forecast states what is likely to happen and how uncertain that prediction is. Models compete on common PIT-valid targets and proper scores. Complexity creates no privilege and no model self-promotes.

**Must not:** decide whether trading is economically worthwhile, size capital, or create Risk permission.

**Primary implementation:** DEE-648 + DEE-632.

**Feedback edge:** DEE-633 returns realized forecast outcomes/calibration to future Knowledge; it is not an extra numbered Step.

---

## Step 13 — Decision V2 / Economic Actionability

**Owns:** the sole executable economic-actionability decision.

Canonical transformation:

`ForecastDistribution → ExecutionPayoffFunctionalV2 → EconomicDistribution → DecisionV2`.

For a flat first-release long-only spot account, the core choice is `ENTER_LONG | CASH/NO_TRADE`. Open-position economic alternatives may include `HOLD | REDUCE | CLOSE` with the appropriate baseline.

Decision must model the exact qualified execution economics: fees, spread, impact, capacity, rounding, partial-fill policy, timing/slices and other causally required execution-policy components. It produces economically qualified size(s) / `EconomicAdmissibleSizeSet`.

**Must not:** use Risk permission as an input to economic merit; let StrategySignal confidence/expectedEdge/maxRisk create independent economics; clip negative conservative outcomes into zero.

**Primary repair:** DEE-649 → DEE-634.

**Position-opening meaning:** the **intent/economic decision** to open a new long position is created here, but no order exists yet.

---

## Step 14 — Risk V2 / Capital Permission

**Owns:** the sole capital-permission authority after Decision.

Canonical verdict vocabulary:

`APPROVE | APPROVE_CLAMPED | VETO | CLOSE_ONLY | HALT`.

A permitted verdict creates a separate single-use, expiring, revocable, reservation-backed `RiskAllowanceV2` bound to exact org/account/instrument/Decision/action/economic size/policy state.

Risk may only preserve/restrict/reduce/veto Decision-qualified action. A clamp may select only a size already economically qualified by Decision, or require re-evaluation/fail closed.

**Must not:** recompute Forecast, EV, why-not-cash, economic merit, or invent a new size.

**Primary repair:** DEE-650.

**Position-opening meaning:** Risk grants the **capital permission** to attempt the already-economically-qualified entry. Still no venue order exists.

---

## Step 15 — Execution V2 / Mechanical External Effect

**Owns:** the sole mechanical realization authority and the only production write-enabled venue ingress.

Canonical sequence:

`RiskAllowanceV2 → ExecutionPlanV2 → ExecutionAttemptV2 → exact external-effect identity → venue`.

Execution owns venue/order type/timing/TIF/routing/slicing/retry/cancel mechanics inside the qualified execution-policy envelope. It atomically claims the allowance and durably binds the exact attempt before the first irreversible network effect.

**Must not:** alter the economic thesis, increase exposure, chase beyond qualified price/economic bounds, blindly resend an unknown outcome, create a second residual order after partial fill, or fabricate fills/trades.

**Primary repair:** DEE-651; full ingress monopoly enforced by DEE-639.

**Position-opening meaning:** the **actual order is sent to the market at Step 15** after valid Decision + RiskAllowance + ExecutionPlan/Attempt + Runtime admission proof.

---

## Step 16 — Reality V2 / Canonical Actual Truth

**Owns:** the sole bitemporal canonical post-execution actual-state authority.

Canonical chain:

`raw Execution/Venue reports → RealitySourceReportV2 → TruthRecordV2 + RealityEventV2 → RealityProjectionV2`.

Reality records what is actually known to be true using source-native identity, provenance, valid time, knowledge time, append-only corrections/supersession and explicit uncertainty.

**Must not:** treat connector/order status as fill truth; infer positions from expectations; fabricate fee/price/trade identity; compute Risk/Billing policy.

**Primary repair:** DEE-652.

**Position-opening meaning:** a position becomes **canonically open only when Reality contains provenance-grounded fill/inventory evidence**. `ORDER_ACCEPTED` is not a position. Status-only `FILLED` without exact fill evidence is not canonical fill truth.

---

## Step 17 — Guardian V2 / Open-Position Thesis Reassessment

**Owns:** continuous reassessment of every open position against fresh Reality and qualified evidence.

Ordinary change path:

`Reality + fresh evidence → GuardianAssessmentV2 → Decision → Risk → Execution → Reality`.

Sole narrow exception:

`Decision-sealed ProtectiveActionMandateV2 + exact deterministic trigger → Risk → Execution → Reality`.

**Must not:** become a second discretionary Trader, increase exposure, reverse, average down, or bypass Risk/Execution.

**Primary lineage/implementation:** DEE-635 → DEE-636.

**Key rule:** loss of NEW_OPPORTUNITY information sufficiency must not automatically blind Guardian if the OPEN_POSITION_REASSESSMENT profile remains sufficient.

---

## Step 18 — Runtime Authority V2 / Startup, Recovery, Posture

**Owns:** whether a concrete runtime instance may participate in the live-capital path now.

Canonical postures:

`FULL_ANALYSIS_AND_NEW_RISK | NO_NEW_RISK | CLOSE_ONLY | HALT`.

Runtime startup/recovery must rebuild canonical Reality, resolve execution uncertainty, restore Guardian coverage, expire/revalidate allowances, validate release/credentials/governance/persistence/control lease, and enforce current promotion/enable identity before new-risk capability.

**Must not:** invent a trading action or treat heartbeat/deployment success as capital authority.

**Primary repair:** DEE-637.

---

## Step 19 — Closed Trade / Billing V2

**Owns:** deterministic closed-trade settlement and commercial billing authority downstream of Reality.

Canonical fee basis:

`BillableProfit = max(0, CumulativeRealizedStrategyProfit - PreviousBillingHWM)`

`PerformanceFee = BillableProfit × 0.30`

The fee applies only to new **net realized strategy profit** above the Billing HWM, after canonical closed-trade accounting. Unrealized PnL is not fee-bearing. Deposits/withdrawals are not strategy profit. Billing HWM and Risk/equity HWM remain separate.

**Must not:** accept caller-authored commercial authority, use unrealized equity as fee basis, or influence trading decisions.

**Primary repair:** DEE-638.

---

## Step 20 — Canonical Runtime V2 / Recurring Orchestrator and Bypass Elimination

**Owns:** integration of the repaired authorities into one durable recurring autonomous runtime and one capital-effect spine.

The production orchestrator is **not** `while(true) trade()` and is not one `runLiveCycleOnce` call. It is an authority/frontier state machine that repeatedly performs, conceptually:

1. rebuild/verify Reality;
2. resolve unknown prior execution effects;
3. establish RuntimeContext/posture;
4. acquire the next PIT frontier;
5. prioritize required Guardian reassessment for open positions;
6. perform bounded/fair new-opportunity inquiry;
7. evaluate information sufficiency;
8. update Understanding/Knowledge/Hypotheses;
9. perform Predictive Admission and Forecast;
10. perform Decision;
11. obtain RiskAllowance if allowed;
12. bind `ExecutionAdmissionProofV2`, plan and exact attempt;
13. execute if authorized;
14. ingest raw venue reports into Reality;
15. reconcile/resolve closed-trade outcomes;
16. calibrate future Knowledge and enqueue research evidence;
17. advance the frontier and repeat.

### Mandatory runtime invariants

- no duplicate semantic frontier processing without a new causal/revision identity;
- no reuse of Decision, RiskAllowance, ExecutionAttempt or external-effect identity;
- unresolved prior venue effect blocks conflicting new exposure;
- every open position receives required Guardian reassessment without starvation;
- Guardian priority cannot permanently starve bounded new-opportunity evaluation;
- closed-trade/outcome/calibration delivery is durable and idempotent;
- crash/restart resumes from canonical Reality/Runtime/Execution state;
- concurrent workers cannot create overlapping capital authority;
- background research cannot starve capital-safety workloads;
- `NO_TRADE`, `INSUFFICIENT`, restrictive posture and zero opportunities are normal successful cycles.

### Sole production write ingress

Exactly one component may possess production venue-write capability: canonical Execution V2 / Execution Server boundary.

Forecast, Decision, Risk, Guardian, Billing, Research, UI/control plane, compatibility layers and legacy StrategySignal/ForecastDecision paths do not possess independent venue-write authority.

### Repository-wide bypass dispositions

Every legacy seam must receive exactly one migration disposition:

`CANONICAL | MIGRATE | READ_ONLY | RESEARCH_ONLY | QUARANTINE | DELETE`.

Production cutover is forbidden while any unresolved write-capable `CAPITAL_BYPASS` remains.

**Primary implementation:** DEE-646 supplies the autonomous slow research loop; DEE-639 owns final recurring runtime/cutover integration.

---

## Step 21 — First-Live Information Contract V2

**Owns:** empirical admission and freeze of the information contract used by the first live Trader.

Core doctrine:

> connected source ≠ qualified evidence ≠ useful evidence ≠ required evidence.

> more data is not the objective; sufficient, independent, causal and reproducible information is the objective.

Canonical lifecycle:

1. build generic Source/PIT/Measurement + profile/ISG machinery;
2. provision truthful PIT history for provisionally justified candidate classes;
3. issue `SourceClassQualificationReceiptV2` with `ABLATION_ELIGIBLE | RESEARCH_ONLY | NOT_QUALIFIED`;
4. use DEVELOPMENT for exploratory utility/redundancy/effective-information analysis;
5. preregister exact finite profile candidates, deterministic selection rule, metrics, thresholds and multiplicity in `SourceAblationPlanV2`;
6. execute locked WALK_FORWARD as independent confirmation, not iterative tuning;
7. classify final source/profile requirements;
8. Human freezes immutable/content-addressed `FirstLiveInformationContractV2` + `FirstLiveInformationFreezeReceiptV2` while official blind holdout remains sealed.

Terminal result may legitimately be:

`FIRST_LIVE_INFORMATION_CONTRACT_FROZEN`

or

`NO_FIRST_LIVE_INFORMATION_CONTRACT_QUALIFIES`.

**Primary implementation:** generic machinery DEE-620/621/625; final empirical freeze DEE-642; DEE-594 closure.

---

## Step 22 — Exact Qualification → Human Promotion → Governed Activation

**Owns:** the final evidence/governance boundary from repaired system to bounded Org-0 live-capital eligibility and activation.

### Qualification identity

`QualificationTupleV2` pins the exact system whose evidence is relied upon, including as applicable:

- git/release/build identity;
- Execution Server/runtime identity;
- `FirstLiveInformationContractV2` and RequiredInformationProfile mappings;
- source/Measurement/dataset/corpus identities;
- predictive package/model/targets/scientific configuration;
- Forecast, Decision, Risk, Execution, Guardian, Reality/accounting contract versions;
- cost/slippage/fee model;
- strategy identity;
- venue/instrument/account/org scope;
- security/runtime configuration;
- deterministic tuple digest.

### Evidence bundle

`QualificationEvidenceBundleV2` binds the exact tuple to mandatory immutable evidence without recomputing or rewriting it.

The repaired first-live chain is:

`canonical BUILD complete`

→ Step-21 FirstLiveInformationContract frozen

→ DEE-594 closure

→ DEE-643 final Execution Server qualification

→ DEE-416 final observability acceptance

→ DEE-644 two independent real-data final Control Replays

→ DEE-539 scientific qualification / frozen selected package

→ DEE-540 explicit Human one-shot blind-holdout authorization

→ DEE-541 Full Historical Validation

→ DEE-640 Forward Paper

→ DEE-641 version-specific Human strategy re-attestation

→ DEE-176 final exact-tuple security assurance

→ DEE-340 Human Org-0 live promotion

→ separate ADR-0011 request / cooling-off / explicit Human confirmation

→ `ENABLED`

→ capped supervised Org-0 live.

### Critical separation

- qualification ≠ promotion;
- promotion ≠ activation;
- activation ≠ order;
- security PASS ≠ order;
- profitable PnL ≠ permission;
- deployment success ≠ live authority.

Even after `ENABLED`, every capital effect still requires the full Step-20 Runtime → Forecast → Decision → Risk → ExecutionAdmissionProof → Execution chain.

### Live envelope

Human promotion binds a versioned `LiveCapitalEnvelopeV2`. Runtime/Risk may only restrict it. No automated profitability trigger may widen it.

### DEE-351 sequencing

DEE-351 completion means **implementation readiness** of the repaired ADR-0011 activation FSM while the org can remain operationally `DISABLED`.

Correct operational order:

`DEE-351 repaired enable implementation/CI ready while DISABLED`

→ `DEE-340 Human promotion`

→ separate post-promotion `REQUESTED`

→ `COOLING_OFF`

→ explicit Human confirmation

→ `ENABLED`.

Neither DEE-351 issue completion nor DEE-340 promotion alone may synthesize `ENABLED` or an order.

---

# 5. Position opening — exact semantics

A new market position crosses four distinct boundaries:

1. **Step 13 — Decision V2:** decides that `ENTER_LONG` is economically preferable to `CASH/NO_TRADE` for exact economically admissible size(s).
2. **Step 14 — Risk V2:** grants current capital permission through an exact `RiskAllowanceV2` for a Decision-qualified size.
3. **Step 15 — Execution V2:** claims the allowance, seals `ExecutionPlanV2` and `ExecutionAttemptV2`, then sends the exact BUY effect to the venue.
4. **Step 16 — Reality V2:** only provenance-grounded fill/inventory evidence makes the position canonically open.

Therefore:

> **intent ≠ permission ≠ execution attempt ≠ factual open position.**

Once Reality proves an open position, Step 17 Guardian recurrence becomes mandatory until the position is canonically flat.

---

# 6. Autonomous learning and research

AI-TRADER may autonomously:

- ingest and retain qualified profitable, losing, flat, inconclusive and invalidated outcomes;
- analyze failure/success patterns in causal context;
- formulate Research Questions;
- formulate falsifiable hypotheses;
- mutate parameters/logic of existing strategies;
- derive new candidate strategies;
- combine parent strategies when explicit lineage and coherent hypothesis exist;
- run multiple bounded research campaigns;
- test candidates automatically through DEVELOPMENT and locked walk-forward/OOS;
- compare candidates with incumbents/baselines;
- record failed candidates and negative evidence;
- propose promotion/demotion/retirement to Human.

It may **not**:

- delete negative evidence because it hurts a hypothesis;
- use naive PnL-sign/reward leakage as discovery fitness;
- use the official one-shot blind holdout as an iterative optimization surface;
- self-promote or self-assign a candidate;
- directly mutate live strategy assignment, Risk policy or production code authority;
- starve Reality/Risk/Execution/Guardian workloads.

### Durable research requirement

The autonomous research plane is event-driven/scheduled, server-owned, durable and resumable. A manual CLI pass may exist for operations/debugging but is not the production autonomous loop.

Canonical chain:

`canonical closed-trade/outcome/calibration event`

→ durable research enqueue

→ Research Memory

→ Question

→ Hypothesis

→ candidate

→ DEVELOPMENT

→ locked walk-forward/OOS

→ evidence package

→ Human proposal.

**Primary implementation:** DEE-646.

---

# 7. Official one-shot blind-holdout firewall

The official DEE-540/DEE-541 blind holdout is a separate authority/security namespace, not merely an unused date range in the normal research catalog.

Before Human one-shot authorization:

- research credentials have no read capability for the protected payload;
- generic research dataset discovery cannot enumerate/reveal the protected target outcomes;
- Research/Strategy Evolution cannot open the payload even if an identifier/path is guessed;
- DEVELOPMENT, WALK_FORWARD and research holdouts use separate evidence namespaces;
- only a valid DEE-540 Human authorization can create the exact one-shot DEE-541 access capability for the exact QualificationTuple.

After first reveal, the evidence is permanently non-blind for future changed candidates. A later replay over the same revealed period may be historical/research evidence but cannot be called another blind validation.

---

# 8. Current `main` vs target canon — mandatory Code↔Canon repair ledger

The audited baseline `main@001683f583d8985fb241ae4022848b0ebf9f5768` is a **legacy/hybrid implementation**. The following classes are known repair obligations, not accepted canon:

## 8.1 Legacy StrategySignal / raw-order capital bypass

Current legacy paths can map StrategySignal-like output toward live order construction. Target canon forbids StrategySignal, confidence, expectedEdge or maxRisk from independent capital authority.

**Owner:** DEE-634 / DEE-639.

## 8.2 CDE/MSV trading/risk authority leakage

Legacy CDE/MSV includes trading/posture/risk semantics such as strategy permission, risk multiplier or confidence-driven escalation. Target CDE/MSV is Step-11 Predictive Admission only.

**Owner:** DEE-647.

## 8.3 Status-derived synthetic fill/trade certainty

Legacy execution fallback may infer/fabricate trade/fill details from status. Target canon treats unknown venue effect as unknown/reconciliation-required and forbids synthetic live truth.

**Owners:** DEE-651 / DEE-652.

## 8.4 Bounded single-cycle orchestration

A one-cycle helper is not the canonical autonomous runtime. The target requires a durable recurring frontier-driven state machine with crash/restart, idempotency, Guardian priority, outcome/calibration delivery and exact single capital-effect ingress.

**Owner:** DEE-639.

## 8.5 Incomplete canonical Guardian recurrence

Guardian logic existing in isolation does not prove the standard runtime repeatedly executes `Reality → Guardian → Decision → Risk → Execution → Reality` for every open position.

**Owners:** DEE-636 / DEE-637 / DEE-639.

## 8.6 Incomplete autonomous Strategy Evolution loop

Existing research foundations/manual passes do not yet prove durable closed-outcome → research → candidate → qualification → Human-proposal recurrence.

**Owner:** DEE-646.

## 8.7 Causal lineage / digest gaps

A digest that does not pin every causally consumed intelligence input is not complete reconstruction authority.

**Owners:** DEE-623 / DEE-626.

## 8.8 Measurement / baseline defects

Known legacy measurement and EWMA/baseline semantics require repair before scientific authority.

**Owners:** DEE-624 / DEE-630 / DEE-631.

## 8.9 Billing evidence boundary

Billing must consume canonical closed-trade RealizedStrategyProfit and a versioned canonical Billing policy. Free caller-supplied commercial authority is not canonical.

**Owner:** DEE-638.

## 8.10 Blind holdout isolation

Research OOS/holdouts and the official Human-authorized one-shot final blind holdout must be physically and authority-separated.

**Owners:** DEE-540 / DEE-541 / DEE-646 / DEE-642.

## 8.11 Live-enable sequencing

DEE-351 issue completion is repaired activation-FSM implementation readiness. A real `ENABLED` event occurs only after DEE-340 Human promotion and separate ADR-0011 request/cooling-off/confirmation.

**Owners:** DEE-351 / DEE-340.

---

# 9. Dependency-ordered implementation program

The following waves summarize intent. **Linear `blocks/blockedBy` relations are the executable source of dependency truth** when they are more specific than this overview.

## Wave 0 — Canon publication

`DEE-627 DONE → DEE-628 publication to main`.

No runtime repair BUILD begins before the exact ratified canon is published and independently audited/green.

## Wave 1 — Epistemic substrate

Core work includes:

`DEE-620 → DEE-621 → DEE-645 → DEE-622 → DEE-625 → DEE-629 → DEE-626 → DEE-623`

with DEE-624 according to its formal blockers.

Purpose: Source/PIT/Measurement, information sufficiency, dynamic inquiry, evidence attribution, candidate PIT corpus, runtime Knowledge/Hypothesis and exact causal reconstruction.

## Wave 2 — Predictive science

Core work includes:

`DEE-630 → DEE-631`

and, according to formal blockers:

`DEE-648 / DEE-647 → DEE-632 → DEE-633`.

Purpose: correct baselines, scientific admission, challenger arena, Predictive Admission authority repair, sole Forecast authority, and outcome/calibration feedback.

## Wave 3 — Capital body

Core chain:

`DEE-649 → DEE-650 → DEE-651 → DEE-634 / DEE-652 → DEE-635 → DEE-636 → DEE-637 → DEE-638`

subject to exact formal DAG.

Purpose: economic Decision → capital permission → execution effect → canonical Reality → lineage → Guardian → Runtime → closed-trade/Billing.

## Wave 4 — Autonomy and canonical cutover

`DEE-646 → DEE-639`

after all formal blockers.

Purpose: durable autonomous Strategy Evolution research plane plus the one durable recurring production runtime, repository-wide bypass elimination, permanent architecture CI and credential boundary.

## Wave 5 — First-live information freeze

`DEE-642 → DEE-594 closure`

after canonical runtime and source/history prerequisites.

Purpose: empirically determine and freeze the truthful first-live information contract.

## Wave 6 — Exact qualification and Human admission

`DEE-643 → DEE-416 → DEE-644 → DEE-539 → DEE-540 → DEE-541 → DEE-640 → DEE-641 → DEE-176`

plus DEE-351 activation-FSM implementation readiness before final launch ceremony;

then:

`DEE-340 Human Org-0 promotion`

→ separate ADR-0011 activation lifecycle

→ capped supervised Org-0 live.

---

# 10. Agent operating rules and mandatory stop points

Implementation agents may autonomously plan, implement, test, repair, re-run CI and prepare PRs inside one currently unblocked issue/slice when the action is within this canon and WAIA DEV OS governance.

They must stop and return to Human authority at least when:

1. a proposed implementation would materially change Step 0–22 authority semantics;
2. a gate/acceptance criterion would need to be weakened, altered or redefined after seeing validation evidence;
3. the official blind holdout would be accessed or revealed (DEE-540);
4. a strategy/package requires Human re-attestation/promotion (DEE-641 and downstream promotion gates);
5. final Org-0 live promotion is reached (DEE-340);
6. the actual post-promotion ADR-0011 live-enable request/cooling-off/confirmation is reached;
7. any live capital envelope widening is proposed;
8. external-client/regulatory live transition is proposed;
9. repository/WAIA DEV OS declares merge/release/tag/live-host mutation Human-only.

Agents must **not** infer Human authority from:

- CI PASS;
- issue completion;
- deployment success;
- a profitable historical/paper/live sample;
- prior-version approval;
- a stale `ENABLED` projection;
- another agent's assertion.

---

# 11. What “autonomous AI-TRADER” means

The target system is autonomous in:

- observation and PIT state progression;
- deciding what information it needs within the ratified information contract;
- understanding and maintaining competing hypotheses;
- probabilistic forecasting;
- economic Decision inside admitted strategy/package authority;
- Risk-governed execution inside the active capital envelope;
- continuous open-position Guardian reassessment;
- Reality reconstruction and reconciliation;
- closed-trade outcome/calibration feedback;
- generation, mutation, combination and automatic testing of research candidates;
- durable research campaigns and Human proposal generation.

It is **not** autonomous in granting itself:

- a new canonical authority model;
- new strategy/package/account production admission;
- a new or wider live capital envelope;
- official blind-holdout access;
- final Org-0 live promotion;
- actual governed live activation;
- external-client regulatory authority.

This is the intended meaning of:

> **Autonomous cognition + autonomous research + autonomous execution inside granted authority ≠ autonomous sovereignty.**

---

# 12. Completion evidence

The repaired AI-TRADER cannot be considered canonically implemented merely because classes or individual tests exist.

At minimum, completion requires proof of:

- exact PIT/provenance/Measurement lineage;
- purpose-specific information sufficiency and no hidden fallback;
- deterministic Understanding/Knowledge/Hypothesis/Forecast causal reconstruction;
- correct predictive/scientific admission semantics;
- Decision economic payoff correctness and negative-outcome preservation;
- single-use/reservation-aware RiskAllowance lifecycle;
- Execution plan/attempt idempotency and no blind resend;
- no synthetic live truth;
- independent bitemporal Reality reconstruction;
- continuous open-position Guardian recurrence;
- restart/recovery Runtime safety;
- canonical closed-trade/Billing lineage;
- durable Strategy Evolution research recurrence;
- one recurring production runtime and exactly one venue-write ingress;
- zero unresolved write-capable `CAPITAL_BYPASS` findings at cutover;
- permanent CI forbidden-consumer/credential guards;
- empirical Step-21 information-contract freeze or explicit no-contract terminal result;
- final exact-tuple host/replay/scientific/FHV/forward-paper/security evidence;
- explicit Human promotion and separate Human-governed activation before live new risk.

---

# 13. Canonical references

Primary final governance / implementation sources:

- **DEE-601** — Final Canon + Code↔Canon Repair Program — Autonomous Trader-Researcher V2
- **DEE-627** — Final Human Canon Ratification Gate — Autonomous Trader-Researcher V2 — **RATIFIED 2026-08-19**
- **DEE-628** — publication of this exact canonical algorithm

Primary Step repair / integration owners referenced above include:

- DEE-620, 621, 622, 623, 624, 625, 626
- DEE-629, 630, 631, 632, 633
- DEE-645, 646, 647, 648
- DEE-649, 650, 651, 652
- DEE-634, 635, 636, 637, 638, 639
- DEE-642, 594
- DEE-643, 644, 539, 540, 541, 640, 641, 176
- DEE-351, 340

Subject-owner documents and ADRs remain authoritative within their ratified domains; this document defines the end-to-end causal/authority composition and repair contract.

---

## Final seal

**Step 0–22 Autonomous Trader-Researcher V2 is Human-ratified.**

There is no implied Step 23.

Subsequent work is implementation, verification, qualification, Human promotion and operations under this canon.
