# AI-TRADER — Grandmaster Strategy Framework (Capital Allocation Doctrine)

> **Status: Proposed doctrine v0.1**
> **Not ratified canon.**
> **Subordinate to the AI-TRADER Master Spec and ADR-0009 / ADR-0010 / ADR-0011.**
> **No quantitative thresholds are added to the MVP.** The MVP Strategy Validation Gate remains governance-only and operator-judged per ADR-0010.

Date: 2026-06-21
Scope: Strategy validation, rating, promotion, retirement, classification, and evolution
Authority: **Subordinate** to [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md), the [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md), [ADR-0009](../adr/0009-regulatory-posture.md), [ADR-0010](../adr/0010-strategy-validation-gate.md), and [ADR-0011](../adr/0011-single-operator-governance-model.md). Where this document and any of those conflict, **they win**. This is a forward-looking design doctrine; the MVP gate remains governance-only and operator-judged per ADR-0010.

> **Reading note.** This is not a trading strategy. It is the **framework that decides which strategies deserve capital**. It defines what "good enough to risk money" means, how that judgment is scored and re-scored over time, how strategies climb toward capital and fall away from it, and how the system scales from one strategy to a disciplined research organization — without ever sacrificing survivability.

---

## 0. Executive summary

M7 is closed: DEE-170 proved the **plumbing** (≈48.5h soak, ~2,908 cycles, `critical=0`, reconciliation PASS, execution PASS). That answered *"can the bot trade?"*. It did **not** answer *"which strategies deserve capital?"* — which is the M7.5 question ([ADR-0010](../adr/0010-strategy-validation-gate.md)).

This doctrine answers it with five linked instruments:

1. **The Grandmaster Definition (Part 1)** — an operational, falsifiable bar. A strategy is Grandmaster-grade only if it demonstrates *persistent, regime-aware, cost-survived, capacity-bounded, risk-characterized, reproducible* edge.
2. **The Validation Stack (Part 2)** — 10 sequential evidence layers, each with a veto. Absence of evidence is failure, never neutral (ADR-0010).
3. **The WAIA Strategy Rating, "WSR" (Part 3)** — a Glicko-style, confidence-aware, regime-conditional, age- and drawdown-sensitive rating. Not Elo (Elo lacks a confidence dimension); a strategy's rating is meaningless without its **uncertainty**.
4. **The Promotion Ladder (Part 4)** — Research → Simulation → Paper → Shadow → Canary (Live Small) → Live Scaled, each rung a one-way valve guarded by the [Single Operator Governance Model](../adr/0011-single-operator-governance-model.md).
5. **Retirement Logic (Part 5), the Genome (Part 6), and the Evolution Path (Part 7)** — how strategies die safely, how thousands are classified and diversified, and how WAIA grows into an autonomous-but-safe research organization.

Part 8 maps all of this onto the **current** codebase (the DEE-272 promotion service, `PaperEvaluationExport`, the Risk Engine, MSV/Chief Decision Engine) and classifies every gap into **M7.5 / M9 / M10 / Post-MVP**.

**The optimization target is not return. It is survival of capital across regimes and decades.** Every mechanism below is biased toward *not* allocating when evidence is thin.

---

## Part 1 — What is a Grandmaster Strategy?

### 1.1 The wrong definitions (rejected)

A Grandmaster Strategy is **not**: the highest backtest return; the highest Sharpe; the strategy that won last month; the most sophisticated model; the one with the best story. Each of these is a known path to ruin (overfitting, regime luck, survivorship, complexity-as-fragility).

### 1.2 The operational definition

> **A Grandmaster Strategy is a versioned, reproducible decision process that has demonstrated — across more than one market regime, net of a conservative cost model, within an explicitly bounded capacity, and under live-tracking-paper conditions — a positive risk-adjusted expectancy whose *failure modes are known and bounded by the Risk Engine*, and whose edge has not decayed below its retirement floor.**

It is a *grade*, not a label you assign once. Grandmaster status is **continuously earned and continuously revocable**, exactly like a chess rating or an institutional mandate.

### 1.3 The seven operational criteria (all required, none sufficient alone)

A strategy is Grandmaster-grade **iff** all seven hold simultaneously. Each maps to evidence the system already can (or will) produce.

| # | Criterion | Operational test | Evidence source |
|---|-----------|------------------|-----------------|
| **G1 — Reproducibility** | Same code + same inputs ⇒ same decisions. No hidden state, no look-ahead. | Deterministic replay; backtest/live feature parity through the Feature Engine; `gitCommitSha` + `strategyVersion` pinned in the promotion record. | Master Spec §8.2, §9; `StrategyPromotionRecordPayload` |
| **G2 — Edge net of cost** | Expectancy > 0 **after** conservative fees + slippage + fee-drag, not just gross. | `PaperEvaluationExport` expectancy/profitFactor net of `periodTotalFees`; `costModel` (feesBps, slippageBps) attested in the promotion record. | `paper-strategy-eval.types.ts`; `PromotionCostModel` |
| **G3 — Regime awareness** | Strategy declares its `intendedRegime` and behaves as declared; edge is conditional on regime, not assumed universal. | Per-regime evaluation; behaves correctly under MSV `STOP_TRADING` / `PAPER_ONLY`; does not trade outside its allowed regime set. | MSV regimes; Chief Decision Engine allowed-strategy-set |
| **G4 — Bounded, known failure modes** | The ways it loses are enumerated *in advance* and each is caught by a Risk Engine control or kill switch. | `failureModes[]` in promotion record map 1:1 to Risk Engine limits / kill switches; drill-tested. | Master Spec §13; `failureModes` field |
| **G5 — Robustness** | Edge survives parameter perturbation, data perturbation, and out-of-sample windows — it is not a knife-edge fit. | Walk-forward, parameter neighborhood stability, deflated metrics (see Part 2 L4). | Post-MVP Research Engine |
| **G6 — Capacity & efficiency** | There is a stated capital band within which the edge holds; beyond it, market impact eats the edge. | Capacity model (notional band) recorded; capital efficiency (return per unit risk per unit capital) measured. | Part 2 L8/L9 (future) |
| **G7 — Live-tracks-paper** | Observed live behavior stays within tolerance of paper/shadow expectation; no silent divergence. | `live-vs-paper divergence` critical alert; Shadow-stage tracking error within band. | Master Spec §20; Observability |

**Disqualifiers (any one ⇒ not Grandmaster, regardless of the seven):**

- Requires withdraw/transfer permission, or any control the Risk Engine cannot bound (violates Master Spec §21).
- Edge depends on a single regime that is not currently classifiable, or on data below the `data_quality_score` gate.
- Cannot be reproduced from stored context (fails the auditability product requirement, Vision §2.3).
- Promotion would bypass the gate or the Single Operator Governance Model (ADR-0010/0011).

### 1.4 The chess-grandmaster mapping (why the metaphor is load-bearing)

| Chess world | WAIA Strategy world |
|-------------|---------------------|
| A title earned by sustained results, not one good game | Grandmaster grade earned across regimes/time, not one good month |
| Elo/Glicko rating with a confidence interval | **WSR** with rating deviation (Part 3) |
| Rating decays with inactivity / can be lost | Strategy rating decays with edge decay / inactivity (Part 5) |
| Opening preparation = known lines | `intendedRegime` + `failureModes` = the strategy's "prepared lines" |
| Blunder = catastrophic, avoidable loss | Unbounded loss outside enumerated failure modes |
| Tournament conditions, neutral arbiter | Paper/Shadow under neutral measurement; operator as arbiter under ADR-0011 |

The point of the metaphor: **a grandmaster is defined by the absence of blunders under pressure across many games**, not by brilliancies. WAIA optimizes for the same — bounded downside, consistency across regimes, no blow-ups.

---

## Part 2 — The Validation Stack (multi-layer evidence system)

Validation is a **pipeline of vetoes**, ordered cheapest-to-most-expensive and least-to-most-real. A strategy must clear every layer in order; any layer can reject. This mirrors institutional discipline (data → research → risk → capital) and scientific peer review (each layer is a referee).

```text
L0  Data Quality            ── is the input trustworthy?
L1  Specification & Reproducibility ── is the strategy well-formed and replayable?
L2  Simulation / Backtest Quality   ── does edge exist in history, honestly measured?
L3  Cost & Execution Realism        ── does edge survive fees, slippage, latency?
L4  Robustness                      ── does edge survive perturbation & OOS?
L5  Regime Adaptability             ── across which regimes does edge hold / vanish?
L6  Risk Characterization           ── are losses bounded, enumerated, Risk-Engine-caught?
L7  Paper Trading                   ── does the full loop reproduce edge with no funds?
L8  Shadow / Capacity               ── does it track live conditions; how much capital fits?
L9  Capital Efficiency & Portfolio Fit ── does it earn its allocation vs alternatives?
                    │
              Promotion Gate (ADR-0010) → Live (ADR-0011)
```

Each layer below states: **purpose · the veto · the metric(s) · MVP posture**.

### L0 — Data Quality (the foundation; garbage in ⇒ everything downstream is theater)

- **Veto:** any window where `data_quality_score` falls below threshold is **excluded** from validation evidence (not silently included). Low data quality forces `PAPER_ONLY` upstream and invalidates evidence here.
- **Metrics:** gap count, staleness, source disagreement, reconciliation cleanliness over the window, valuation-gap count.
- **MVP posture:** **Built.** `PaperEvaluationDataQuality` already records `reconciliationStatus`, `valuationGapCount`, `valuationGaps`, `unrealizedAvailable`, `strategiesWithNoFills`. The promotion record only accepts a clean export.

### L1 — Specification & Reproducibility

- **Veto:** no pinned `strategyVersion` + `gitCommitSha`, no documented `hypothesis` + `intendedRegime` ⇒ reject.
- **Metrics:** deterministic replay match; feature parity (backtest vs live computed through the same Feature Engine).
- **MVP posture:** **Built (assembly).** `assembleStrategyPromotionRecord` pins version, commit, hypothesis, regime, and a content digest. Deterministic replay harness is **Post-MVP**.

### L2 — Simulation / Backtest Quality

- **Purpose:** establish that an edge plausibly exists in history, measured *honestly* (the hardest part — most "edges" are overfit).
- **Veto:** evidence of look-ahead, survivorship, or multiple-testing inflation ⇒ reject.
- **Metrics:** in-sample vs out-of-sample expectancy; **Deflated Sharpe Ratio** / number-of-trials adjustment; minimum-sample sufficiency (enough independent trades for the horizon).
- **MVP posture:** **Out of MVP** (Research backtesting automation is Post-MVP; Master Spec §10). MVP relies on paper (L7) as the empirical bar and operator judgment.

### L3 — Cost & Execution Realism

- **Purpose:** kill strategies whose edge is an artifact of zero-cost assumptions.
- **Veto:** expectancy turns ≤ 0 under the **conservative** cost model ⇒ reject.
- **Metrics:** modeled fees + slippage (bps) vs realized; fee drag as % of gross; profit factor net of fees.
- **MVP posture:** **Partially built.** `PromotionCostModel` is attested and fees are already netted in the paper evaluation. Slippage modeling against mock is crude; realistic slippage is M9/Post-MVP.

### L4 — Robustness

- **Purpose:** distinguish a *structural* edge from a *fragile fit*.
- **Veto:** edge collapses under small parameter perturbation, data jitter, or OOS windows ⇒ reject (knife-edge fits are demoted to Research).
- **Metrics:** parameter-neighborhood stability (does a grid around the chosen params stay positive?); walk-forward efficiency; bootstrap/Monte-Carlo confidence on expectancy; Probability of Backtest Overfitting (PBO).
- **MVP posture:** **Post-MVP** (needs the Research Engine). For MVP, robustness is argued qualitatively by the operator and recorded; the framework reserves the fields.

### L5 — Regime Adaptability

- **Purpose:** know *where* the edge lives. A Grandmaster strategy is honest about the regimes in which it is mediocre or negative.
- **Veto:** strategy claims universal edge but evidence is single-regime ⇒ downgrade claim, not reject (record it as a regime specialist).
- **Metrics:** per-regime expectancy/drawdown (TREND_BULL/BEAR, RANGE, CHOP, STRESS, …); behavior under `ONLY_CLOSE_POSITIONS` / `STOP_TRADING`; correlation of returns to regime transitions.
- **MVP posture:** **Partial.** ADR-0010 already requires "more than one regime where observable." Per-regime evaluation slicing is a near-term enhancement (M7.5+).

### L6 — Risk Characterization

- **Purpose:** make every loss path *expected and bounded*. This is the safety heart of the framework.
- **Veto:** any plausible loss path not mapped to a Risk Engine control or kill switch ⇒ reject.
- **Metrics:** max drawdown (realized + theoretical), tail loss (CVaR), max consecutive losses, time-to-recovery, worst-case single-order exposure vs notional caps.
- **MVP posture:** **Strong.** Risk Engine enforces position/loss/drawdown/exposure caps + kill switches, fail-closed (Master Spec §13). `failureModes[]` recorded in promotion. `maxRealizedDrawdown` / `recoveryFactor` computed in paper evaluation.

### L7 — Paper Trading (the MVP empirical bar)

- **Purpose:** prove the *full loop* reproduces the edge with no client funds.
- **Veto:** reconciliation not clean throughout, or window not meaningful for the horizon, or edge absent net of cost ⇒ reject (ADR-0010).
- **Metrics:** the full `PaperStrategyEvaluation` set — expectancy, profitFactor, winRate, averageWin/Loss, grossProfit/Loss, maxRealizedDrawdown, recoveryFactor — over a horizon-appropriate window across >1 regime.
- **MVP posture:** **Built and proven** (DEE-170 soak; `PaperEvaluationExport`). This is the **load-bearing** MVP layer.

### L8 — Shadow / Capacity

- **Purpose:** run the strategy against **live** market data and **live** decisioning but with **no order submission** (or micro-orders), measuring divergence and impact.
- **Veto:** live decisions diverge from paper beyond tolerance (`live-vs-paper divergence` alert) ⇒ block promotion.
- **Metrics:** decision tracking error (live vs paper), realized vs modeled slippage at increasing notional, capacity band (notional at which marginal edge → 0).
- **MVP posture:** **New layer, M9.** Shadow mode is the missing rung between paper and live (see Part 4 and Part 8).

### L9 — Capital Efficiency & Portfolio Fit

- **Purpose:** even a good strategy may not deserve *this* capital *now* if a better-diversifying one exists.
- **Veto:** marginal contribution to portfolio risk-adjusted return ≤ 0 (it only adds correlated risk) ⇒ do not allocate (hold in bench).
- **Metrics:** marginal Sharpe contribution, correlation to the live book, capital-at-risk efficiency, drawdown-correlation in stress.
- **MVP posture:** **Post-MVP** (allocation is trivial/constant in MVP, Master Spec §12). Single-strategy Org 0 makes this moot until a portfolio exists.

### 2.1 Layer-to-stage binding

| Layers required | Minimum stage they unlock |
|-----------------|---------------------------|
| L0–L1 | Simulation |
| L0–L4 | Paper |
| L0–L7 | Shadow |
| L0–L8 | Live Small (Canary) |
| L0–L9 | Live Scaled |

This binding makes the promotion ladder (Part 4) *evidence-driven*: you cannot stand on a rung whose layers you have not cleared.

---

## Part 3 — The WAIA Strategy Rating (WSR): an Elo for strategies

### 3.1 Why not Elo

Elo answers "who beats whom" with a single number. Strategies are not playing each other; they play **the market**, and the market's difficulty changes (regimes). Worse, a single number hides the thing that matters most for capital safety: **how confident are we in this number?** A strategy with a great score on 30 trades is not the same as one with the same score on 3,000 trades across three regimes.

WAIA therefore adopts a **Glicko-2-style** model (rating + **rating deviation (RD)** + **volatility**), generalized to be **regime-conditional** and **risk-penalized**. This gives capital allocation three numbers instead of one:

- **WSR (rating):** point estimate of edge quality.
- **RD (deviation):** uncertainty — *the confidence interval*. High RD ⇒ small or no capital, regardless of WSR.
- **σ (volatility):** how erratic the strategy's results have been — high σ widens RD faster.

> **Capital is allocated against the lower confidence bound, `WSR − k·RD`, never against WSR alone.** This single rule encodes institutional humility: we size to what we *know*, not to what we *hope*.

### 3.2 What gets scored (the "outcome" per period)

Each evaluation period (e.g., per reporting period or per N closed trades), the strategy produces an **outcome score** in [0,1], derived from realized, cost-net, risk-adjusted performance versus its *own declared expectation* (not versus other strategies):

```text
period_outcome = f(
    realized_expectancy_net_of_cost,
    realized_drawdown vs expected_drawdown,
    live_vs_paper_tracking_error,
    regime_match (did it trade only where allowed?),
    data_quality of the window
)
```

- Beating its declared expectation in-regime, with bounded drawdown and clean tracking ⇒ outcome near 1 (rating up, RD shrinks).
- Underperforming, or drawing down beyond expectation, or diverging from paper ⇒ outcome near 0 (rating down, RD and σ grow).
- **No trading when correctly declining (MSV said STOP)** is scored *neutral-positive* — restraint is rewarded, not punished (Vision: "the system knows when not to trade").

### 3.3 Rating update (Glicko-2 adaptation)

Per period, update `(WSR, RD, σ)` Glicko-2-style with three WAIA-specific modifications:

1. **Regime-conditional sub-ratings.** Maintain a WSR per regime *and* a blended rating. A strategy can be Grandmaster in RANGE and unrated in STRESS. Allocation in a given regime uses that regime's `WSR − k·RD`.
2. **Asymmetric drawdown penalty.** Drawdowns move the rating down **faster** than equivalent gains move it up (loss aversion is correct for capital preservation). A breach of *expected* max drawdown applies a step penalty and inflates σ.
3. **Confidence floor for capital.** No live capital while `RD > RD_max_for_live` (too uncertain) — this is the quantitative form of ADR-0010's "absence of evidence = failure."

### 3.4 How rankings evolve, age, and decay

- **Inactivity decay:** like chess, RD grows over idle time (Glicko's core property). A strategy unrated against recent market conditions becomes *less* certain, not frozen-certain. After enough decay it drops below the live confidence floor and is auto-paused (Part 5).
- **Edge decay:** a *declining* trend in period outcomes (even if still positive) inflates σ and bends WSR down; the **edge-decay slope** is itself a monitored metric (Strategy Health, Master Spec §11).
- **Age as evidence, not virtue:** age *narrows* RD only if it brings *new regime coverage*. Ten years of one regime is still single-regime evidence. Age is rewarded through *breadth of conditions survived*, not calendar time.
- **Drawdown memory:** the *worst* historical drawdown is sticky in the risk characterization; recovery improves the rating but never erases the recorded tail (it informs sizing forever).

### 3.5 The composite "Grandmaster Score" (for ranking, not for sizing)

For dashboards/leaderboards (and future portfolio selection), combine into a single 0–1000 **Grandmaster Score**:

```text
GMScore = 1000 · sigmoid(
      w1 · normalized(WSR_lowerbound)          # edge we can trust
    + w2 · regime_breadth_score                # across how many regimes
    + w3 · robustness_score (L4)               # survives perturbation
    + w4 · capacity_efficiency_score (L8/L9)   # earns its capital
    − w5 · tail_risk_score (CVaR, maxDD)        # penalize fat tails
    − w6 · edge_decay_penalty                  # penalize fading edge
)
```

Weights are operator-set and **recorded** (ADR-0010 forbids fixing thresholds in MVP; this is the post-MVP quantitative layer). **GMScore ranks; `WSR − k·RD` sizes.** Never confuse the leaderboard with the allocator.

---

## Part 4 — The Promotion Ladder

### 4.1 The rungs (one-way valves)

```text
RESEARCH ──► SIMULATION ──► PAPER ──► SHADOW ──► CANARY (Live Small) ──► SCALED (Live Full)
   │            │             │          │              │                       │
   L0–L1        L0–L1     L0–L4(+L7)   L0–L7        L0–L8 + GATE            L0–L9 + GATE
   (idea)     (history)   (full loop)  (live-data,   (real capital,         (capital ramp,
                                       no orders)     micro caps)            risk-budgeted)
```

Each promotion is a **deliberate, logged, reversible administrative action** under the [Single Operator Governance Model](../adr/0011-single-operator-governance-model.md): immutable audit → cooling-off → explicit confirmation → effective. Each demotion is one step (or more) **down** and may happen automatically (Part 5) or by operator action, and is always available.

### 4.2 Rung definitions, entry/exit, and current lifecycle mapping

The Master Spec strategy lifecycle (`DRAFT → RESEARCHING → BACKTESTING → VALIDATED → PAPER_TRADING → LIVE_LIMITED → LIVE_FULL → PAUSED → RETIRED`) maps cleanly onto the ladder; the doctrine adds **SHADOW** as the missing rung between paper and live.

| Rung | Lifecycle state | Entry requires | Exit (promotion) requires | Capital |
|------|-----------------|----------------|---------------------------|---------|
| **Research** | DRAFT / RESEARCHING | hypothesis + intended regime | well-formed spec, L0–L1 | none |
| **Simulation** | BACKTESTING | reproducible spec | L2–L4 cleared (Post-MVP); honest OOS edge | none |
| **Paper** | VALIDATED → PAPER_TRADING | L0–L4 | meaningful-horizon, >1-regime, clean-recon paper edge net of cost (ADR-0010 evidence) | none |
| **Shadow** | (new) PAPER_TRADING+shadow | passing paper | live-tracks-paper within tolerance; capacity band estimated | none / micro |
| **Canary (Live Small)** | LIVE_LIMITED | **Strategy Validation Gate PASSED** | stable at small notional; live ≈ shadow; no critical alerts | tiny, capped (Org 0) |
| **Scaled (Live Full)** | LIVE_FULL | sustained Canary + portfolio fit (L9) | risk-budgeted ramp by `WSR − k·RD` | budgeted (Org 0; external only post ADR-0009 Cleared) |

### 4.3 The Strategy Validation Gate sits between Paper/Shadow and Canary

This is exactly ADR-0010 and the **already-built** DEE-272 service. The promotion record carries: version+commit, hypothesis+intended regime, paper evidence (the `PaperEvaluationExport` evidence slot + content digest), cost model, reason-code distribution, failure modes, and the three-part confidence attestation (`edgeNetOfCosts`, `liveTracksPaper`, `downsideRiskBounded`). The governance state machine (`DRAFT → PENDING_CONFIRM → COOLING_OFF → EFFECTIVE`, with `CANCELLED`/`REVOKED`) enforces cooling-off and reversibility, and `isLiveAuthorized` binds the authorization to a **specific version** — a code change re-opens the gate.

> **Critical alignment with canon:** MVP sets **no fixed numeric thresholds** (ADR-0010). The operator records an explicit written judgment per strategy. The quantitative WSR/RD floors in Part 3 are the **Post-MVP** formalization of that judgment — they make the operator's intuition explicit, recorded, and eventually automatable, *without* changing the governance structure.

### 4.4 Why a ladder (not a switch)

Each rung exposes a strategy to *more reality* and *more capital* only after the prior rung's reality has been survived. The gaps between rungs (cooling-off, explicit confirm) are **intended friction** — the institutional equivalent of a risk committee. The ladder's invariant: **the amount of capital at risk never exceeds the amount of validated confidence**, expressed as `capital ∝ WSR − k·RD`, clamped by Risk Engine caps and Org-0/regulatory limits.

---

## Part 5 — Strategy Retirement Logic (how strategies die safely)

A framework that only promotes is a framework that accumulates risk. **De-escalation must be cheaper, faster, and more automatic than escalation.** Four states, increasingly severe:

| State | Trigger (any) | Effect | Reversible? | Authority |
|-------|---------------|--------|-------------|-----------|
| **PAUSE** | edge-decay slope crosses warn; RD grows past live floor; data quality degraded; mild live-vs-paper drift; consecutive-loss warn | stop *new* entries, manage/close existing; capital → 0 new | Yes — resume after review | **Automatic** (Strategy Health) + operator |
| **DEMOTE** | sustained underperformance vs expectation; capacity/slippage worse than modeled; one rung of evidence invalidated | move **one rung down** the ladder (e.g., Live → Shadow/Paper); promotion record `REVOKED` (already supported) | Yes — re-promote via gate | Operator (ADR-0011) or auto on hard triggers |
| **QUARANTINE** | reconciliation mismatch tied to the strategy; unexplained live-vs-paper divergence; suspected look-ahead/bug; anomaly | **fail-closed**: kill-switch the strategy, freeze its capital, preserve all state for forensics; no resume until root-caused | Only after investigation + fresh gate | **Automatic kill switch** + operator sign-off |
| **RETIRE** | structural edge gone (decayed below floor across regimes); superseded by a better version; failure mode realized that cannot be bounded | permanent stop; archived with full history; rating frozen as historical; cannot trade without a *new* version + full re-validation | No (terminal for that version) | Operator (ADR-0011), logged |

### 5.1 Principles

- **Demotion is the default response to doubt.** When uncertain, step down a rung; do not deliberate while capital bleeds. This is the inverse of the careful promotion process — *cheap to retreat, expensive to advance.*
- **Quarantine is fail-closed and automatic.** Anything that looks like a *correctness* failure (recon mismatch, unknown position, divergence) trips the kill switch immediately (Master Spec §21 rule 10). Capital safety beats availability, always.
- **Retirement is honest archival, not deletion.** The Genome (Part 6) and audit keep every retired strategy's full record. We learn from deaths; we never erase them. Survivorship bias is itself a tracked risk.
- **Edge decay is monitored continuously, not at gate time.** A strategy that passed the gate can — and eventually will — fade. The rating's σ/RD growth (Part 3) is the early-warning system; PAUSE fires before capital is materially harmed.

### 5.2 The retirement-rating coupling

Retirement is not a separate subsystem — it is the **downward dynamics of the WSR**. As RD grows (inactivity/uncertainty) or WSR bends down (edge decay) or σ spikes (erratic results), the strategy crosses the live confidence floor and is auto-PAUSED; continued deterioration walks it down the ladder. Retirement logic and rating logic are the same logic read in two directions.

---

## Part 6 — The WAIA Strategy Genome (classifying thousands of strategies)

When WAIA manages hundreds or thousands of strategies, ad-hoc lists collapse. The **Strategy Genome** is a structured, machine-readable classification that makes strategies *comparable, clusterable, and diversifiable*.

### 6.1 Genome dimensions (the "DNA" of a strategy)

| Gene | Values (examples) | Used for |
|------|-------------------|----------|
| **Edge source** | mean-reversion, momentum/trend, liquidity-sweep/microstructure, carry, sentiment, arbitrage, event | diversification by *why* it makes money |
| **Regime affinity** | per-MSV-regime WSR vector | knowing *where* it lives (Part 3.3) |
| **Horizon** | intraday, swing, position | netting/capacity planning |
| **Directionality** | long-only (spot MVP), long/short, neutral | exposure budgeting |
| **Instrument/venue** | HTX-spot-BTC/ETH (MVP) … multi-exchange (future) | venue & asset diversification |
| **Capacity band** | notional range where edge holds | sizing & crowding limits |
| **Factor exposures** | beta to BTC, vol, liquidity, sentiment | risk decomposition |
| **Failure-mode set** | enumerated bounded failures (G4) | correlated-failure analysis |
| **Lineage** | parent strategy/version, mutation history | evolution tracking, anti-overfit audit |

### 6.2 Clustering & comparison

- **Correlation clustering:** cluster strategies by return correlation *and by failure-mode correlation*. Two strategies that lose in the *same* regime for the *same* reason are one bet, not two — even if their code differs.
- **Genome distance:** define a distance metric over genes; the allocator prefers strategies that are *far apart* in genome space (true diversification) over near-duplicates with marginally higher scores.
- **Family caps:** cap aggregate capital per edge-source family and per failure-mode cluster, so no single market truth can sink the whole book (the Risk Engine's exposure caps generalized to the genome).

### 6.3 Diversification doctrine

> **Diversification is across *failure modes*, not across *names*.** The Genome makes this operational: the portfolio is healthy when its capital is spread across uncorrelated edge sources whose worst-case losses occur in *different* regimes for *different* reasons. The Genome is the data structure that lets the allocator reason about that.

In MVP (two strategies, Org 0, trivial allocation) the Genome is **schema-light**: record the genes on each strategy/version for future use; do not build the clustering engine yet. This preserves the path without overbuilding (Master Spec §12; MVP discipline).

---

## Part 7 — Evolution Path (single strategy → autonomous research org, safely)

Four epochs. Each epoch *adds* capability while *preserving* every safety invariant from the prior epoch. The invariants never relax: non-custodial, no withdraw/transfer, no order without Risk Engine approval, every action audited/reproducible, fail-closed, human above the system, gate-before-live, Org-0-then-cleared-external.

### Epoch 1 — Single validated strategy (now: M7 → M10)

- One/two strategies, paper-proven, gate-promoted, Org-0 live. Trivial allocation. Manual Strategy Health. **This is the MVP and it is correct to stay here until it is boring.**

### Epoch 2 — Portfolio of strategies (Post-MVP)

- Multiple strategies live; **WSR/RD rating live**; Genome populated; allocation moves from trivial to **risk-budgeted by `WSR − k·RD`** with family caps. Strategy Health automation drives auto-PAUSE/DEMOTE. Capacity (L8) and portfolio fit (L9) become real layers. Shadow rung operational.
- *Safety addition:* portfolio-level kill switch and correlated-drawdown circuit breaker on top of per-strategy ones.

### Epoch 3 — Adaptive ecosystem (Post-MVP, gated)

- Strategies adapt **parameters within validated bounds** (Vision §2.4 — "adapt parameters, not core logic"). The Research Engine automates backtest/walk-forward; new *versions* are generated and must re-enter the ladder at Simulation. Regime detection drives dynamic allocation across the Genome.
- *Safety addition:* any parameter change outside validated bounds is treated as a **new version** ⇒ re-validation from the appropriate rung; no in-place mutation of live capital risk.

### Epoch 4 — Autonomous strategy research organization (Future, hard-gated)

- AI proposes hypotheses, generates candidate strategies, runs them through the *entire* validation stack autonomously — **but promotion to live capital remains a governed, human-confirmed, cooling-off-protected action** (ADR-0011), and external capital remains gated by ADR-0009. The machine may research, simulate, paper, shadow, and *recommend*; **the machine never self-promotes to real capital.**
- *Safety addition:* the autonomous researcher is itself a tenant under the same Risk Engine, audit, and kill-switch regime; its proposals are rate-limited, sandboxed, and capacity-bounded. The "human above the system" invariant (Vision §4) is the permanent ceiling on autonomy.

### 7.1 The non-negotiable evolution rule

> Every epoch can add *intelligence* and *automation*. **No epoch may remove a safety control or shorten the promotion ladder.** Capability scales up; safety only scales up with it. The day automation pressures us to skip a rung is the day we have mispriced survival.

---

## Part 8 — Gap Analysis: current architecture vs ideal framework

### 8.1 What exists today (strengths)

| Capability | Status | Evidence |
|------------|--------|----------|
| Plumbing proven end-to-end | **Done** | DEE-170 48.5h soak, ~2,908 cycles, critical=0, recon+exec PASS |
| Strategy Validation **Gate** (governance) | **Built** | ADR-0010 + DEE-272 service: assemble → request → confirm → cooling-off → effective; reversible REVOKE/demote |
| Promotion **record** (evidence container) | **Built** | `StrategyPromotionRecordPayload`: version, commit, hypothesis, regime, cost model, reason-code distribution, failure modes, confidence attestation, content digest |
| Paper evidence artifact | **Built** | `PaperEvaluationExport`: expectancy, profitFactor, winRate, drawdown, recoveryFactor, data-quality block, provenance, digest |
| Single Operator Governance | **Built** | ADR-0011: immutable audit, cooling-off, explicit confirm, reversibility; enforced in promotion service |
| Risk characterization spine | **Strong** | Risk Engine limits + kill switches, fail-closed (Master Spec §13/§21) |
| Regime awareness substrate | **Built** | MSV regimes + Chief Decision Engine allowed-strategy-set + `data_quality_score` gate |
| Reproducibility substrate | **Built** | Feature Engine parity contract; version/commit pinning; deterministic-by-design decisions |
| Org-0 + regulatory containment | **Built** | ADR-0009 posture; live restricted to Org 0; external prohibited until Cleared |

### 8.2 What is missing vs the ideal (weaknesses / gaps)

| Gap | Ideal layer/part | Severity | Notes |
|-----|------------------|----------|-------|
| **No quantitative rating (WSR/RD/σ)** | Part 3 | High (Post-MVP) | Today it's pure operator judgment (correct for MVP); no confidence-aware score, no auto-sizing |
| **No Shadow rung** | Part 4 / L8 | High | Largest *structural* gap between paper and live; live-vs-paper divergence alert exists but no shadow stage to exercise it pre-capital |
| **No robustness/OOS automation (L2/L4)** | Part 2 | Med | Research Engine is schema + manual only; overfitting risk leans entirely on paper + judgment |
| **No per-regime evaluation slicing** | L5 / Part 3.3 | Med | ADR-0010 asks for ">1 regime" but eval read models are not yet regime-sliced |
| **No capacity / slippage realism model** | L8/L9 | Med | Mock slippage is crude; capacity band unmodeled (fine while single-strategy Org-0) |
| **No Strategy Health automation** | Part 5 | Med | Auto-PAUSE/DEMOTE on edge decay is manual today (Master Spec §11) |
| **No portfolio allocation / Genome engine** | Part 6 / L9 | Low (now) | Trivial allocator by design; Genome unneeded at 2 strategies — but record genes now |
| **`targetDeploymentState` only `LIVE_LIMITED`** | Part 4 | Low | Ladder's Canary→Scaled (`LIVE_FULL`) not yet representable in the promotion type |
| **No deterministic replay harness** | L1 / G1 | ~~Med~~ **Addressed (DEE-337 / PR #304)** | Reproducibility is designed-in; pinned scenario-sequence replay is canonical for MVP plumbing validation |

### 8.3 Classification into milestones

#### M7.5 — Strategy Validation Gate Passed (now; minimal, judgment-based — *do not over-build*)

- Use the **existing** DEE-272 service + `PaperEvaluationExport` to assemble and operator-sign promotion records for the two MVP strategies, using **DEE-337 Accelerated Historical Replay Validation** evidence as the empirical base. *(This is exactly the DEE-178 next action.)*
- **Add (light):** per-regime annotation on the paper evidence (which regimes the window actually covered) so the ">1 regime" criterion is auditable, not asserted.
- **Add (light):** record the Genome genes (edge source, horizon, directionality, intended regime, capacity guess, failure-mode set) on each strategy version — *fields only, no engine.*
- **Hold the line:** **no numeric thresholds**, no auto-promotion (ADR-0010). Operator judgment, recorded.

#### M9 — Org-0 Live Readiness (the Shadow rung + live hardening)

- **Build the SHADOW rung** (L8): live market data + live decisioning, no/micro order submission, with the `live-vs-paper divergence` alert as the active veto. This is the single most valuable safety addition before real capital.
- Harden live reconciliation, startup state rebuild, isolated execution host, managed key (already on M9 scope).
- Extend `targetDeploymentState` to support `LIVE_FULL` and a capital-ramp parameter so the Canary→Scaled step is representable and audited.
- First realistic slippage/capacity estimate at micro-notional (seed for L8/L9).

#### M10 — MVP Launch (Org-0)

- Full loop validated on in-house capital under controls; Canary live for the gated strategies; demotion/quarantine drills executed at least once (prove de-escalation works *before* it's needed in anger).
- Operator runbook: how to PAUSE/DEMOTE/QUARANTINE/RETIRE, with the audit trail.

#### Post-MVP — The Grandmaster machine

- **WSR/RD/σ rating engine** (Part 3) + Glicko-2 update + regime-conditional sub-ratings + `WSR − k·RD` sizing.
- **Research Engine automation** (L2/L4): backtesting, walk-forward, PBO/Deflated-Sharpe, parameter-neighborhood robustness; new versions re-enter at Simulation.
- **Strategy Health automation** (Part 5): auto-PAUSE/DEMOTE on edge-decay slope and RD growth; quarantine on correctness anomalies.
- **Portfolio allocation + Genome engine** (Part 6 / L9): correlation/failure-mode clustering, family caps, marginal-Sharpe allocation, portfolio-level circuit breakers.
- **Deterministic replay harness** (G1/L1): prove reproducibility on demand.
- **Adaptive parameters within bounds** (Epoch 3) and, far later and hard-gated, the **autonomous researcher** (Epoch 4) — research/recommend only; never self-promote to capital.
- **External clients** strictly behind ADR-0009 `Accepted (Cleared)`.

### 8.4 The one-paragraph verdict

WAIA has built the **right spine in the right order**: plumbing first (M7), governance gate and evidence container next (M7.5, already coded), safety controls throughout. The framework is *not* missing its foundations — it is missing its **measurement and automation layers** (rating, shadow, robustness, health automation, genome/allocation), all correctly deferred. The single highest-value near-term addition is the **Shadow rung** (M9); the single highest-value long-term build is the **WSR rating engine** that turns operator judgment into a recorded, confidence-aware, auto-sizing discipline. Nothing in the current architecture blocks any of this — the lifecycle states, promotion record, MSV, and Genome fields are the seeds already in the ground.

---

## Appendix A — Invariants this framework must never violate

1. Non-custodial; **never** request withdraw/transfer (Master Spec §3/§21).
2. **No order without Risk Engine approval** and an idempotency key.
3. **No live capital without a passed Strategy Validation Gate** (ADR-0010), even for Org 0.
4. Every promotion/demotion/retirement is **logged, cooling-off-protected, reversible-where-possible** (ADR-0011).
5. **Absence of evidence is failure, not neutral.**
6. Capital sized to confidence (`WSR − k·RD`), clamped by Risk Engine caps; never to hope.
7. **De-escalation is cheaper and faster than escalation;** fail-closed on any correctness doubt.
8. Diversify across **failure modes**, not names.
9. **The machine may research; the human promotes to capital.** Always.
10. External clients only after ADR-0009 `Accepted (Cleared)`. No flag, entitlement, or workflow bypasses this.

## Appendix B — Glossary

- **WSR** — WAIA Strategy Rating (point estimate of edge quality).
- **RD** — Rating Deviation (uncertainty / confidence interval around WSR).
- **σ** — Rating volatility (erraticness of results; widens RD).
- **GMScore** — composite 0–1000 leaderboard score (ranks; does not size).
- **Shadow** — live data + live decisions, no/micro orders; measures live-vs-paper tracking and capacity.
- **Canary** — first real capital at tiny, capped notional (Org 0).
- **Genome** — structured classification of a strategy's edge source, regime affinity, horizon, factors, failure modes, lineage.
- **Quarantine** — fail-closed isolation of a strategy on a suspected correctness failure, pending forensics.

## Appendix C — Source documents

- [AI-TRADER Vision](AI-TRADER-VISION.md) · [Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md) · [MVP Scope v2](AI-TRADER-MVP-SCOPE-v2.md) · [Roadmap v2](AI-TRADER-ROADMAP-v2.md) · [Implementation Program v1.2](AI-TRADER-IMPLEMENTATION-PROGRAM.md)
- [ADR-0009 Regulatory posture](../adr/0009-regulatory-posture.md) · [ADR-0010 Strategy Validation Gate](../adr/0010-strategy-validation-gate.md) · [ADR-0011 Single Operator Governance Model](../adr/0011-single-operator-governance-model.md)
- [DEE-170 48h Paper Soak Closure (historical)](../ops/DEE-170-48H-PAPER-SOAK-CLOSURE-REPORT.md) · [DEE-337 AHR Closure](../ops/DEE-337-P5-TWO-STRATEGY-AHR-CLOSURE-REPORT.md) · [DEE-170 M7 Milestone Hygiene & Governance Review](../ops/DEE-170-M7-MILESTONE-HYGIENE-GOVERNANCE-REVIEW.md)
- Code: `lib/trader/validation-gate/*` (promotion service, record types), `lib/trader/paper/*` (paper evaluation export), Risk Engine + MSV per Master Spec §8/§13.

---

*This is proposed doctrine (v0.1), not ratified canon. It is subordinate to the Master Spec and ADRs above and introduces no quantitative thresholds into MVP. Promote it to ratified status only via the normal governance path, and only after operator review.*
