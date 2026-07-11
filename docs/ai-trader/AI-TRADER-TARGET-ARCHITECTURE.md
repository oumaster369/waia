# AI-TRADER — Target Runtime Architecture (Completed System)

> **Status:** Target architecture — **READY_FOR_HUMAN_REVIEW** (not yet ratified canon).
> **Class:** Runtime architecture + end-to-end algorithm for the *completed / mature* AI-TRADER.
> **Scope:** How the finished AI-TRADER must run end-to-end — topology, the full algorithm from first market contact to closed, reconciled trades, and the invariants that keep the capital path deterministic and safe. It is **not** a roadmap, an implementation plan, an MVP scope, or a governance override.

---

## 1. Title

**AI-TRADER Target Runtime Architecture** — the canonical description of how the completed AI-TRADER perceives markets, forms and proves beliefs, authorizes and executes trades, supervises positions, reconciles reality, and learns — without ever letting AI, strategies, or blockchain signals touch capital outside the deterministic, human-governed path.

---

## 2. Status / Scope / Authority

**Status:** Target architecture, proposed for canonicalization. Additive and descriptive; it introduces no new live-trading path and weakens no existing gate.

**Scope:** The *completed* runtime architecture and end-to-end algorithm. It describes the destination, not the sequence to reach it.

**Authority (precedence):** This document is **subordinate** to, in order:

```
WAIA Core Architecture
  > AI-TRADER Product Constitution
    > AI-TRADER Master Spec v2
      > subject-owner docs (Security, Billing & HWM)
        > ratified doctrines (Market Intelligence Architecture, LD-5a … LD-10)
          > ADRs (0005 … 0023)
            > this document (target runtime architecture)
              > implementation (code, comments — may lag)
```

- It is **additive** to the ratified doctrines and ADRs and **overrides nothing**.
- Where it conflicts with WAIA Core Architecture, the Product Constitution, the Master Spec v2, subject-owner docs, ratified doctrines, or any ADR, **those higher-authority sources win** and this document must be corrected.
- It describes the **completed target runtime architecture and end-to-end algorithm** — **not** implementation sequencing, **not** the MVP scope, **not** a roadmap, and **not** a governance override.

---

## 3. Purpose

AI-TRADER is not a trading bot, not a set of indicators, and not a signal generator. It is a **market intelligence system embedded inside WAIA** whose primary output is validated knowledge; trading is the most demanding way that knowledge is tested against reality and, occasionally, harvested.

This document exists so that a completion effort has a single, precise picture of what the finished runtime must be: how the algorithm flows from first market contact to closed trades, how timeframes are used, how the system perceives the market as a living structure, how it manages multiple positions, where AI is allowed to operate, how the control plane and execution plane are separated, and which architectural mistakes are unacceptable.

The core principle it preserves:

```text
AI-TRADER does not guess the market.
AI-TRADER builds a living picture of the market and acts only when the advantage is proven.
```

---

## 4. Relationship to Product Constitution, Master Spec, doctrines, ADRs

- **Product Constitution** owns *what the product is* (identity, principles, maturity model, acceptance). This document defers to it and does not restate it.
- **Master Spec v2** owns *contracts* (schemas, interfaces, lifecycle). This document references contracts; it does not redefine them.
- **Market Intelligence Architecture (knowledge-first doctrine)** owns *how the system forms and trusts knowledge*. This document is a peer runtime view that consumes those objects (Source → PIT Observation → Measurement → Pattern → Regime Knowledge → Hypothesis → Evidence Ledger → Worldview → Strategy → Forecast → Decision → Calibration).
- **LD-5a … LD-10 doctrines** own Hypothesis/Evidence, Knowledge-to-Action, Forecast, Decision, Risk, Reality, and Closed-Trade Reality. This document uses their layering verbatim and must not blur it.
- **ADRs consumed here:** [ADR-0009](../adr/0009-regulatory-posture.md) (regulatory posture), [ADR-0010](../adr/0010-strategy-validation-gate.md) (Strategy Validation Gate), [ADR-0011](../adr/0011-single-operator-governance-model.md) (single operator), [ADR-0014](../adr/0014-payment-watcher-execution-model-read-only-observer.md) (payment watcher read-only), [ADR-0018](../adr/0018-research-intelligence-market-knowledge-base.md) (RI + MKB), [ADR-0019](../adr/0019-ai-operator-intelligence-authority.md) (AI operator authority), [ADR-0021](../adr/0021-deterministic-research-replay-clock-and-state-isolation.md) (deterministic replay), [ADR-0023](../adr/0023-execution-server-ai-trader-only-execution-plane.md) (execution plane).

### 4.1 Maturity / era scope note (mandatory reading)

- This document describes the **completed / mature** AI-TRADER target architecture.
- It **does not authorize MVP-era engine construction.** The ratified Market Intelligence Architecture holds that the MVP delivers records, registers, and read-only views — **no engines**.
- It **creates no new live-trading path** and **weakens no gate.** It does not weaken **ADR-0009, ADR-0010, ADR-0011, ADR-0018, ADR-0019, or ADR-0023**.
- **MVP scope remains governed by** MVP Scope v2 / Master Spec v2 / the Research Intelligence Program.
- Terms such as **Market Canvas, Hypothesis Engine, Strategy Synthesis Engine, Blockchain Event Engine, and Portfolio Intelligence are target capabilities** unless §23 marks them already implemented.

---

## 5. What completed AI-TRADER is

A completed AI-TRADER is a system that:

- operates quickly and **does not recompute the market from scratch on every candle**;
- does not trade without an active, sustained hypothesis and a proven edge net of costs;
- does not let strategies think instead of Market Intelligence;
- does not let AI place orders, size positions, change permission, or promote strategies;
- does not lose evidence during failures;
- manages multiple positions safely through portfolio-level risk, lots, exposure, and reconciliation;
- can create new strategy *candidates* from accumulated knowledge, which become live only after the Strategy Validation Gate and human promotion;
- explains every action and every abstention with a terminal reason code;
- preserves reproducibility of every decision.

It is a **knowledge-first market intelligence system** whose defining capability is **restraint**: a period of zero trades that strengthens or refutes knowledge is a productive period; a run of profitable trades that leaves the knowledge base no more trustworthy is luck, not product.

---

## 6. Runtime topology: Cloudflare control plane → AI-TRADER Execution Server execution plane

AI-TRADER is part of the WAIA platform, but its heavy trading runtime must not run inside a Cloudflare Worker. Plane separation is governed by [ADR-0023](../adr/0023-execution-server-ai-trader-only-execution-plane.md).

```text
WAIA Platform
│
├── Cloudflare Worker (CONTROL PLANE)
│   ├── Web app, AI-Twin, Social, Trader dashboard/admin
│   ├── Auth-facing surfaces, read APIs, command submission
│   ├── Entitlement checks, billing/reporting views
│   ├── Risk / kill-switch control surface (submit + view)
│   └── Audited command dispatch (short-lived only)
│
└── AI-TRADER Execution Server (EXECUTION PLANE, off-Cloudflare)
    ├── Long-running research / M9 campaigns, replay jobs
    ├── Backtest / walk-forward / blind holdout runtime
    ├── Market data streaming / polling loops
    ├── Stateful Market Canvas (target)
    ├── Strategy evaluation runtime
    ├── Risk Engine fast path + Execution Engine
    ├── Persistent exchange sessions, retries
    ├── Reconciliation + Position Guardian workers
    ├── Kill-switch enforcement
    └── Artifact streaming / checkpointing / campaign finalization
```

### 6.1 Cloudflare responsibilities (control plane)

Cloudflare owns short-lived platform surfaces: web app, AI-Twin, Social, Trader dashboard, admin console, auth-facing logic, read APIs, command submission, entitlement checks, billing/reporting views, and visible audit/control surfaces. Cloudflare may **receive a command, verify rights, and write an audited command record** — but it must not become the long-running trading engine.

### 6.2 Execution Server responsibilities (execution plane)

The Execution Server owns everything heavy, stateful, and long-running: campaigns, replay, market-data loops, the stateful Market Canvas, strategy evaluation, the Risk Engine fast path, order submission, exchange sessions, retries, reconciliation, guardian exits, kill-switch enforcement, and artifact sealing.

### 6.3 Supabase/Postgres role

Supabase/Postgres is the **system of record** (configuration, state, audit, memory, billing, orders, fills, positions, strategy metadata, research-artifact references). It **must not be a low-latency execution bus**, and the trading fast path must not depend on the UI request lifecycle.

### 6.4 Command flow

```text
User/Admin action in Cloudflare UI
→ entitlement / permission check
→ audited command record in Supabase
→ Execution Server receives/polls command
→ validates against runtime state
→ applies governance / risk / kill-switch checks
→ executes or rejects
→ persists outcome and evidence
→ Cloudflare UI displays status
```

### 6.5 Hard rules

1. Cloudflare does not hold live exchange sessions.
2. Cloudflare does not run multi-hour research campaigns.
3. Cloudflare does not contain the live execution fast path.
4. The Execution Server does not bypass WAIA Core identity, tenancy, entitlement, or audit; modules never read or write each other's tables.
5. Every Cloudflare → Execution Server command must be auditable.
6. The Execution Server must be recoverable from Supabase + exchange state (see §7.3).
7. Loss of control-plane connectivity forces fail-closed behavior (see §11 / §7.4).
8. Trade credentials and execution secrets use a dedicated managed secret/KMS path — not Cloudflare runtime variables (see §7).

---

## 7. Non-custodial and security invariants

These are permanent identity constraints inherited from the Product Constitution and [AI-TRADER Security](AI-TRADER-SECURITY.md). They are not softenable by this document.

### 7.1 Non-custodial

- AI-TRADER is **non-custodial**. Client funds remain on the client's own exchange account at all times.
- AI-TRADER may hold **READ + TRADE permissions only**.
- **WITHDRAW and TRANSFER permissions are structurally forbidden** — not merely disabled by configuration.

### 7.2 Secrets

- Trade-only keys are still dangerous and must be treated as **high-value secrets**.
- Live execution secrets **must not live in Cloudflare runtime variables**; they follow the dedicated **execution-host secret/KMS path** ([ADR-0023](../adr/0023-execution-server-ai-trader-only-execution-plane.md) AD-5).
- Credential-at-rest encryption uses the managed master-key path; production readiness is fail-closed.

### 7.3 Startup / recovery (live path)

- Before live execution resumes after any startup or restart, AI-TRADER **must rebuild and reconcile reality** from exchange state + Supabase state (open orders, fills, balances, position lots, lifecycle records).
- **Unknown positions, reconciliation mismatch, or stale runtime state must fail closed** (no new orders; close-only or stop-account per policy) until reality is reconstructed clean.

### 7.4 Control-plane loss

- Loss of control-plane connectivity must force **fail-closed / close-only / no-new-orders** behavior per the applicable risk policy.
- The Cloudflare control plane and the Execution Server execution plane remain separated per [ADR-0023](../adr/0023-execution-server-ai-trader-only-execution-plane.md); sync, deploy, and live operations on the host are human-only.

---

## 8. Full end-to-end algorithm

The completed cycle, using the doctrinal layering consistently (CDE = regime/permission gate; Decision/LD-7 = actionability; Risk = downward-only enforcement; Execution = placement within allowance; Reality = post-trade truth):

```text
0.  Runtime preflight    → org/account/entitlement/strategy/risk/exchange status; fail-closed on failure
1.  Market contact       → HTX + cross-venue confirmation + context/blockchain lanes, via the Gateway
2.  Data truth gate      → freshness, gaps, stale quote, spread, cross-venue agreement, no-lookahead
3.  Market Canvas update → incremental 1m/15m/1h/4h/1d state (no full recompute)
4.  1D analysis          → daily permission / capital preservation
5.  4H analysis          → dominant scenario / control side
6.  1H analysis          → operational hypothesis / expected path
7.  15m analysis         → setup validation / opportunity formation
8.  1m analysis          → execution safety only
9.  Feature Engine       → features + dataQualityScore
10. Reconstruction       → structure, levels, liquidity, invalidation (incremental)
11. Market Understanding → what/why/who/where/how strong/how uncertain
12. Hypothesis Engine    → ranked hypotheses + sustained conviction
13. Market Knowledge     → have we seen this? what happened? edge net of cost?
14. CDE / MSV            → regime admissibility + trading permission + reason codes  (PERMISSION GATE)
15. Forecast             → pre-registered, scored prediction (accuracy)
16. Decision / LD-7      → actionability + whyNotCash + economics + opportunity cost + "do nothing" (INTENT)
17. Portfolio Intelligence → exposure, correlation, capital slots, opportunity cost
18. Allocation / sizing  → stop-based, risk-adjusted
19. Risk Engine          → approve / resize-down / reject / close-only / stop  (DOWNWARD-ONLY)
20. Execution Engine     → order state machine, within allowance only
21. Reality reconciliation → fills / positions / balances / lots parity (post-trade truth)
22. Position Guardian    → supervise open positions every cycle
23. Exit                 → target / trail / invalidation / risk / time / close-only
24. Closed-trade record  → PnL, fees, slippage, reason, hypothesis outcome
25. Learning / AI assist → reason clusters, new hypotheses, knowledge candidates (offline)
26. Governance           → Strategy Validation Gate before any live promotion
```

Every cycle terminates with a **terminal reason code**, including every no-trade cycle.

---

## 9. Market Canvas and incremental replay

**Market Canvas is a target capability, not the current default runtime.** Today the research/replay path uses an expanding-window model; the completed system must replace that with a stateful, incrementally updated canvas.

### 9.1 Purpose

Market Canvas is the central **living picture of the market**. It holds rolling bars (1m/15m/1h/4h/1d), structure (swings, BOS/CHoCH, trend legs, ranges, compression/expansion, prior levels), liquidity (equal highs/lows, swept/unswept pools, trapped participants, order-book imbalance, spread/slippage state), context (Fear & Greed, macro/event risk, blockchain events, cross-venue confirmation, provider degradation), hypotheses (ranked, active, confidence, sustained cycles, expected path, invalidation), and portfolio state (open lots, per-position thesis, exposure, capital usage, opportunity cost).

### 9.2 The unacceptable error (runtime failure mode)

AI-TRADER must **not** do this on every candle:

```text
bars[0..N] → resample all timeframes → rebuild all reconstruction
           → rebuild all understanding → rebuild all hypotheses
           → run the full MI stack from scratch
```

This expanding-window / full-recomputation pattern is **`O(N²)`** and makes long research/M9 replay practically unusable. It is a **real runtime architecture failure mode** that the Market Canvas must prevent. (Note: it is not asserted to be the sole historical M9 blocker; it is a distinct architectural problem to be fixed on its own merits.)

### 9.3 Correct incremental mode

```text
onNewClosed1mBar:
  append 1m bar; update 1m execution state
  if 15m closes: update 15m setup structure
  if 1h  closes: update 1h operational scenario
  if 4h  closes: update 4h dominant scenario
  if 1d  closes: update daily context
  update affected levels only
  update affected hypotheses only
  update conviction
  emit decision state + terminal reason code
```

### 9.4 Replay/live parity and determinism

Research replay must imitate live runtime: a bar stream where the cursor advances one bar, the canvas updates incrementally, **no lookahead**, and a deterministic decision trace. Incremental replay must satisfy the [ADR-0021](../adr/0021-deterministic-research-replay-clock-and-state-isolation.md) invariant (byte-identical metrics/digests over identical inputs). The legacy expanding-window path may be **retained only as a diagnostic parity oracle** to validate the incremental canvas — never as the default production runtime.

---

## 10. Multi-timeframe cognitive sequence

Each timeframe answers one question. Higher timeframes grant permission and scenario; lower timeframes refine and execute. **1m never builds structural understanding.**

| TF | Question | Output |
|----|----------|--------|
| **1D** | Is it acceptable to search for trades today? | `dailyPermission`: `TRADE_ALLOWED` / `REDUCE_RISK` / `WAIT` / `PRESERVE_CAPITAL` / `ONLY_CLOSE` |
| **4H** | Who controls the market? | `dominantScenario`: continuation / reversal / distribution / accumulation / breakout / false_breakout / liquidity_sweep / no_clear_scenario |
| **1H** | What working scenario is developing now? | `operationalHypothesis`: type, confidence, expectedPath, targetZone, setupZone, invalidation |
| **15m** | Has a real opportunity appeared? | `setupValidation`: `SETUP_CONFIRMED` / `SETUP_FORMING` / `SETUP_INVALIDATED` / `NO_SETUP` |
| **1m** | Can execution be done safely now? | `executionReadiness`: `EXECUTE_NOW` / `WAIT_FOR_CLOSE` / `SPREAD_TOO_WIDE` / `SLIPPAGE_TOO_HIGH` / `ENTRY_INVALIDATED` / `MICROSTRUCTURE_UNSAFE` |

---

## 11. Data truth / provider fusion / gateway invariants

### 11.1 Single ingress

All external market data flows through one path — **no bypass**:

```text
Provider Registry → Market Data Gateway → Normalization → Validation
  → Freshness / Reliability → Context Fusion → Market Understanding / CDE
```

Strategies are **never** allowed to import providers directly. Any non-poll ingress (fixtures, backfill, pre-built live snapshots) must be an explicitly sanctioned, audited exception, not an accidental side path.

### 11.2 Data truth gate

Before understanding the market, the system answers **"can the data be trusted?"** by checking freshness, bar gaps, stale quotes, spread, slippage conditions, provider availability, cross-venue disagreement, no-lookahead (in replay), completeness, and exchange status. On poor data: new entries blocked, existing positions managed by the Guardian, risk reduced, reason code persisted.

### 11.3 `dataTruthStatus` (target abstraction)

If the completed system exposes a `dataTruthStatus` enum (`VALID / DEGRADED / STALE / INCOMPLETE / CONFLICTING / INVALID`), it is a **target abstraction** that maps onto existing constructs — **it is not asserted to already exist as an enum**. It aggregates: `dataQualityScore` (feature engine), provider health (`HEALTHY / DEGRADED / STALE / UNAVAILABLE`), freshness policy, cross-venue triangulation (`AGREE / PARTIAL / DISAGREE`), and degradation reason codes. Implementation may realize it as a derived view rather than a new stored enum.

---

## 12. Reconstruction / Understanding / Hypothesis / Knowledge

### 12.1 Market Reconstruction

Builds structure from the canvas: trend legs, swing highs/lows, BOS/CHoCH, liquidity pools, equal highs/lows, swept/unswept levels, prior day/session levels, range boundaries, compression/expansion, trapped-participant zones, structural invalidation. **Reconstruction must be incremental** — never sort the full history, resample all timeframes, or recreate all levels every cycle. Structure is derived from HTF bars; **1m is execution only**.

### 12.2 Market Understanding

Responsible for understanding, not signals. It answers: what/why is happening, who controls, where liquidity is, where participants are trapped, the probable path, what confirms and contradicts the scenario, where invalidation is, and **why risk is better than cash right now**. `whyNotCash` is a mandatory element of the actionability chain (owned by Decision/LD-7, §13); a trade is allowed only if the system can explain why risk beats capital preservation.

### 12.3 Hypothesis Engine

Forms ranked, competing hypotheses (trend_continuation, reversal, accumulation, distribution, breakout, false_breakout, liquidity_sweep, mean_reversion, event_risk, low_edge). Each carries type, confidence, supporting/contradicting evidence, expected path, target zones, invalidation conditions, eligible strategy families, sustained cycles, knowledge references, and health.

**Conviction accumulates over time** (illustrative):

```text
cycle 1: 0.42 → cycle 3: reclaim confirmed 0.63 → cycle 5: volume confirms 0.81
→ sustained threshold met → opportunityAuthorized
```

Trading is forbidden without **sustained** conviction. Every hypothesis carries death conditions (close back below swept level, HTF break, liquidity consumed, spread regime change, expected path fails for K bars, RR collapse, data-quality degrade).

### 12.4 Market Knowledge Base (MKB) and Market Memory

The MKB is the four-layer knowledge store (Facts, Events, Hypotheses/edges, Verified-knowledge read-model) per [ADR-0018](../adr/0018-research-intelligence-market-knowledge-base.md). It cross-checks recurring states, pattern outcomes, regime-specific expectancy, successful/failed setups, no-trade clusters, reason-code distributions, cost reality, strategy performance by hypothesis, and stale/obsolete knowledge. **The MKB does not place orders**; it provides evidence to the Hypothesis Engine, Forecast, and Decision. Market Memory resolves predictions against outcomes and adjusts edge confidence deterministically.

---

## 13. Forecast → Decision → Risk → Execution → Reality chain

The capital path uses the LD-6 … LD-10 layering, each with a single responsibility. **Confidence and permission never grow as they flow downstream** (non-amplifying invariant); risk may only clamp down.

- **Forecast (LD-6)** — a pre-registered, immutable, scored prediction with a distribution/band, invalidation conditions, and horizon. Owns *accuracy*. It is not a decision or an order.
- **Decision (LD-7)** — converts an eligible Forecast / Hypothesis / Understanding state into **auditable intent**, including the explicit choice to **do nothing**. Owns *actionability and economics*: `whyNotCash`, expected edge net of cost, opportunity cost, and challenger dissent. It records why, why now, why this size, why this asset.
- **Risk (LD-8)** — deterministic, fail-closed enforcement that may **clamp, veto, restrict to close-only, or halt**, and **never raises** size, conviction, or permission.
- **Execution (LD-9 seam)** — places orders **only within the Risk-granted allowance**, off the platform's edge runtime.
- **Reality (LD-9)** — bitemporal, append-only post-execution truth (positions, balances, realized cashflows, settled fills).

### 13.1 Two reconciliation meanings (must not be merged)

- **Reality reconciliation** — constructing post-trade truth from exchange order status, fills, balances, open lots, internal positions, lifecycle records, and canonical inventory. It answers *what actually happened*.
- **Risk-level enforcement reconciliation** — enforcing limits against that truth (blocking, close-only, kill-switch). It answers *what we must now allow*.

They are related but **distinct concerns** and must never collapse into one vague "reconciliation." On a Reality mismatch: `RECONCILIATION_REQUIRED` → fail-closed → no new trades → possible kill switch → operator alert. A trade is not complete until reality reconciliation is clean.

---

## 14. CDE / MSV as regime-permission gate

> **Permanent disambiguation.** The **CDE (Chief Decision Engine)** is the **regime admissibility and trading-permission gate**. It is **not** the Decision (LD-7) actionability layer. These must never be conflated in product or code (Product Constitution §4.3).

The CDE builds the **Market State Vector (MSV)** — physics, liquidity, crowd, futureContext, understanding, hypotheses, active hypothesis, conviction, strategy eligibility — and derives: regime, **tradingPermission**, allowed strategy families, risk multiplier, reason codes, and dataQualityScore.

CDE emits one **permission** posture:

```text
ALLOW_TRADING | ALLOW_REDUCED_RISK | ONLY_CLOSE_POSITIONS | PAPER_ONLY | STOP_TRADING
```

CDE may signal that the environment is **admissible** for trading only when: data quality acceptable, provider health acceptable, HTF/LTF not conflicting, an active sustained hypothesis exists, conviction above the operator-configured threshold, and no hard veto applies. **CDE decides whether the environment is tradeable at all — it does not decide the specific action, does not own `whyNotCash` economics, and does not place orders.** Those belong to Decision (§13), Risk, and Execution respectively.

---

## 15. Strategy consumers

Strategies are **tactical consumers, not the brain**. They receive `MarketStateSnapshot`, active hypothesis, CDE permission, reconstruction levels, setup validation, portfolio state, and execution constraints; they return a `StrategySignal` or `NoSignal` with a reason code.

A strategy must **not** build its own market reality, call providers directly, bypass CDE, bypass the Risk Engine, or place an order.

- **LSR (Liquidity Sweep Reversal)** operates only when the active hypothesis is liquidity_sweep / reversal / false_breakout, with HTF not opposed, 15m setup confirmed, 1m execution safe, RR above threshold, spread acceptable, reclaim confirmed, structural stop available, and clear invalidation.
- **Mean Reversion** operates only in a controlled range/chop regime with an active mean_reversion hypothesis and unstressed volatility; it must not trade panic, stress, strong trend, or event-risk regimes.

---

## 16. Portfolio Intelligence and multi-position management

AI-TRADER manages multiple trades through portfolio discipline, never "many positions for the sake of activity." **Portfolio Intelligence (multi-instrument, correlation/concentration, opportunity cost) is a target capability**; today the code has per-symbol and quote-exposure caps only (§23).

It must support multiple instruments, multiple lots per instrument, multiple active hypotheses, per-position thesis, portfolio-level exposure, correlation/concentration limits, capital-allocation slots, and risk budgets per trade / per hypothesis / per account per day.

- **Position lots.** Each entry creates or updates a lot (instrument, side, quantity, entryPrice, entryTime, strategyId, activeHypothesisId, originalThesis, initialStop, currentStop, target, riskAmount, maxHoldBars, status).
- **Multi-position rules.** Multiple trades only if each has its own thesis, exposure and correlation are bounded, cash reserve is sufficient, per-trade and total risk are bounded, no contradictory hypotheses exist on the same instrument unless explicitly hedged and allowed, and no pyramiding occurs unless strategy and CDE explicitly allow it.
- **Same-instrument lots** pass through the **canonical inventory** so one strategy can never buy while another closes without understanding the combined position.
- **Opportunity cost.** Before a new trade, the system asks whether opening, preserving capital, or managing an existing position is best; a new trade is authorized only if its edge exceeds opportunity cost. Opportunity-cost economics are owned by the Decision layer (§13).

**Sizing is stop-based:** `riskPerTrade = accountEquity × allowedRiskPercent`; `positionSize = riskPerTrade / stopDistance`, adjusted by confidence, regime risk multiplier, strategy health, data quality, exposure, correlation, liquidity/slippage, and daily-loss state. Risk may only reduce or reject the size.

---

## 17. Position Guardian and exits

After entry, the Guardian supervises every cycle against: original vs current hypothesis, PnL, stop distance, target probability, RR decay, time in trade, structure changes, data quality, event risk, exposure, and opportunity cost.

Actions: `HOLD`, `MOVE_TO_BREAKEVEN`, `TRAIL_STOP`, `PARTIAL_EXIT`, `FULL_EXIT`, `EARLY_INVALIDATION_EXIT`, `BLOCK_ADDITIONAL_POSITIONS`. Rules: **stop never widens**; breakeven only after threshold; trail is deterministic; invalidation forces exit; close-only blocks new entries. (Some of these actions are target extensions of the current Guardian vocabulary — §23.)

Exits and their reasons are classified. Profit exits: structural/liquidity/RR target reached, hypothesis fulfilled, trail stop in profit, RR decay after path completion, context change, capital release for a better opportunity. Loss exits: structural invalidation, stop-loss, time exit, hypothesis decay, data-quality failure, risk event, reconciliation issue, kill-switch. Each loss is classified (controlled / model error / data error / execution error / known failure mode / new failure mode). Every closed trade becomes a knowledge object.

---

## 18. Blockchain Event Engine as deferred/later-maturity context intelligence

> **Scope:** The Blockchain Event Engine is **later-maturity / post-MVP / deferred** (Product Constitution §4.15; RI-P8 deferred). It is retained here as a direction, not as immediate MVP scope, and must not be read as authorizing near-term work.

When built, it is a **context and event intelligence** engine, **not a direct buy/sell trigger** and **not a strategy**. Sources include Infura/MetaMask Developer RPC, TronGrid, mempool.space, and future chain adapters. Tracked events include large transfers, exchange in/outflows, stablecoin mint/burn and exchange deposits, unusual wallet clusters, protocol/security events, and mempool congestion / fee spikes.

Path: `Blockchain Event → Normalize → Validate → Classify → Market Impact Score → FutureContext → Market Understanding → Hypothesis Engine → Market Memory / Research Questions`.

**Allowed influence:** raise event risk, reduce permission, strengthen/weaken a hypothesis, explain abnormal price/volume, create a research question, add a memory annotation.

**Forbidden:** placing orders directly, creating a strategy signal directly, bypassing CDE / Decision / Risk / the Strategy Validation Gate, or **mixing Payment Watcher and Market Intelligence keys/code**.

**Separation from Payment Watcher.** The **Payment Watcher** verifies settlement/invoices as a read-only inbound observer ([ADR-0014](../adr/0014-payment-watcher-execution-model-read-only-observer.md)); the **Blockchain Event Engine** supports market intelligence. They are separate systems with separate keys and code paths and must remain so.

---

## 19. AI Research Assist / AI Operator boundary

AI operates **only after the evidence layer or inside the research/offline loop** — never on the order-producing fast path ([ADR-0019](../adr/0019-ai-operator-intelligence-authority.md)).

**AI may:** read decision traces, cluster reason codes, explain no-trade outcomes, detect veto-only traps, analyze closed trades, identify recurring patterns, propose research questions and strategy candidates, assess stale knowledge, and prepare reports for the human architect.

**AI may not:** place orders, change trading permission, select a live strategy, change position size, bypass CDE, bypass Risk, bypass the Strategy Validation Gate, or promote a strategy to live without human approval. On provider failure it **fails closed** — no recommendation.

**AI output** is advisory records only (ResearchHypothesis, PatternCandidate, FailureModeAnalysis, ReasonCodeClusterSummary, KnowledgeHealthAssessment, ExperimentProposal, ParameterReview, StrategyImprovementProposal). **AI never returns an executable BUY/SELL command.**

---

## 20. Evidence, observability, decision trace, crash artifacts

Every cycle must have a **terminal reason code**, and every no-trade must be explained (data degraded, HTF conflict, no active hypothesis, conviction below threshold, setup not confirmed, RR too low, strategy not allowed, risk rejected, spread too wide, provider conflict, position already active, capital preservation better).

Research/M9 evidence must be **streaming / checkpoint-based**, so a crash cannot destroy evidence. Mandatory artifacts include: decision trace, partial decision trace on crash, metrics export, provider fusion report, coverage matrix, lifecycle trace, guardian reason sample, operator diagnostics, manifest, and rejection record. All artifacts are content-addressed (digest-sealed) and reproducible from stored context.

---

## 21. Billing / HWM / closed-trade reality linkage

Consistent with the Closed Trade Reality Doctrine (LD-10) and [Billing & HWM](AI-TRADER-BILLING-HWM.md):

- Closed-trade reality feeds **realized strategy profit**.
- Where fees apply, **performance fees are based only on realized closed-trade profit above the high-water mark**.
- **Unrealized marks do not create fees.**
- A **manual reconciliation gate** remains required before any fee issuance.

The closed-trade record (entry thesis/reason, risk amount, initial stop, target, exit reason, gross PnL, fees, slippage, net PnL, hypothesis correctness, lessons learned) is the source of realized-profit truth.

---

## 22. Strategy synthesis and validation gate

A completed AI-TRADER can create **new strategy candidates** from accumulated knowledge, but a candidate never becomes live automatically. **Strategy Synthesis is a target capability** (today: template re-parameterization only — §23).

Canonical path:

```text
Market History → Decision Traces → Closed Trades → No-Trade Clusters
→ Reason-Code Distributions → MKB → Pattern Discovery → Research Hypothesis
→ Strategy Candidate → Backtest → Walk-forward → Blind Holdout → Paper Soak
→ Strategy Validation Gate → Human Promotion → Limited Deployment
```

**AI/synthesis may** find recurring structures, group setups, identify regimes where a pattern works/fails, form research hypotheses, draft candidate specifications, propose parameters and falsification conditions, run permitted research checks, estimate edge net of cost, and propose a candidate to a human.

**AI/synthesis may not** enable a live strategy by itself, bypass the Strategy Validation Gate or Risk Engine, use an LLM-generated rule directly in the fast path, or trade a strategy without a versioned evidence package.

**The Strategy Validation Gate** ([ADR-0010](../adr/0010-strategy-validation-gate.md)) is mandatory before any live promotion — even Org 0. Required evidence: strategy version + git commit, documented hypothesis, intended regime, sealed real backtest, walk-forward, single-shot blind holdout, paper soak, versioned cost model, reason-code distribution, clean reconciliation, known failure modes, operator judgment, and human approval. **48 hours of paper stability proves plumbing, not edge.** Edge is proven only through positive expectancy net of costs, multi-regime evidence, a non-invalidating blind holdout, decision-chain completeness, clean reconciliation, and controlled risk. **Thresholds are operator-set and recorded, not fixed in canon.**

### 22.1 Admission bar and the "very few high-quality trades" principle

The system should prefer **very few high-quality trades over forced activity**. An admission regime may be expressed illustratively as:

```text
tradeAllowed only if:
  model-estimated favorable-outcome probability >= an operator-configured bar (illustratively ~0.90)
  expected value net of costs > 0
  riskReward >= minimum threshold
  data quality acceptable
  active hypothesis sustained
  strategy validated for current regime
  risk engine approves
```

The `~0.90` figure is an **illustrative, operator-configurable admission bar** — **not** a guaranteed win rate, **not** a fixed Strategy Validation Gate threshold, and **not** canonical product law. It is subject to calibration, evidence class, operator configuration, and governance. In the current era, confidence is **judgment + band + decay**, not fake-precision math; **calibrated machine probabilities** are used only when the appropriate doctrine and implementation support them. If a high bar yields few trades, that is acceptable — low activity beats forced trading.

---

## 23. Target-vs-current-code mapping

Status legend: **current** (implemented and default), **partial** (exists but gated/incomplete), **target** (not yet built), **deferred** (post-MVP by governance).

| Concept | Status | Notes |
|---------|--------|-------|
| Market Canvas (stateful incremental model) | **target** | No `MarketCanvas` today; closest is a per-cycle frozen `MarketStateSnapshot`. Replaces expanding-window replay. |
| Market Data Gateway / Provider Fusion | **partial** | Canonical gateway + fusion exist; live/fixture/backfill paths can bypass it — must become audited exceptions. |
| Feature Engine (+ dataQualityScore) | **current** | `feature-engine-v0`; produces `dataQualityScore`. |
| Reconstruction (swings/BOS/CHoCH/liquidity) | **partial** | Logic exists but is recomputed per cycle; target is incremental. |
| Market Understanding Bridge | **current** | `market-understanding-bridge-v0`. |
| Hypothesis Engine (+ sustained conviction) | **partial** | `hypothesis/build-hypothesis-set`; conviction session state exists but is gated behind an MI-core flag (default off in research). |
| CDE / MSV (regime-permission gate) | **partial** | `cde-v0` / `MsvEnvelope`; positive `ALLOW_TRADING` path exists; must stay distinct from Decision/LD-7. |
| `whyNotCash` | **target** | Documented in doctrine; not yet in runtime code. |
| Forecast / Decision / Risk / Execution / Reality | **partial** | Risk, Execution state machine, order/venue reconciliation are **current**; Forecast/Decision (LD-6/LD-7) records are **target/partial**. |
| Strategy Consumers (LSR, Mean Reversion, Trend Momentum) | **current** | Registered evaluators with guardrails; LSR + MR in PAPER, Trend Momentum in RESEARCHING. |
| Position Guardian | **partial** | HOLD / EXIT_FULL + trailing exist; MOVE_TO_BREAKEVEN / PARTIAL_EXIT / invalidation-exit are **target**. |
| Portfolio Intelligence (correlation/concentration/opportunity cost) | **target** | Per-symbol and quote-exposure caps exist; correlation, concentration, and opportunity-cost arbitration are not yet built. |
| MKB / Market Memory | **partial** | Tables + write path exist (ADR-0018); some read-models thin. |
| AI Research Assist / AI Operator | **current** | Recommend-only, forbidden-action guards (ADR-0019); no LLM on the order path. |
| Strategy Synthesis Engine | **partial** | Template re-parameterization only; no novel-logic generation; discovery pass not persisted. |
| Blockchain Event Engine | **deferred** | Only lightweight network/mempool stat adapters exist; full event intelligence is RI-P8-deferred. |
| Payment Watcher | **current** | Separate module, separate keys/code (ADR-0014); shares only a public RPC endpoint with MI. |
| Live startup reconciliation | **partial** | Startup reconciliation exists on the paper loop; the live path requirement (§7.3) must be made explicit. |
| `CONTROL_PLANE_LOSS` fail-closed | **partial** | Switch type defined; automatic runtime wiring is a target (§7.4). |
| Deterministic replay (ADR-0021) | **current** | Deterministic clock + per-window isolation + content-digest separation. |

---

## 24. Completion acceptance signs

AI-TRADER is complete (against Product Constitution §11) when:

**Market Intelligence** — Market Canvas is stateful; MTF updates incrementally; the Hypothesis Engine is active with accumulating conviction; the MKB is used; no-trade is always explained; CDE has a positive permission path distinct from Decision.

**Runtime** — research replay is no longer `O(N²)` by default; M9/research emits streaming evidence; crashes preserve partial traces; long campaigns survive DB disconnects; live/paper/research parity holds; the live path rebuilds reality on startup and fails closed on mismatch or control-plane loss.

**Trading** — strategies are consumers; Risk checks every order and only clamps down; execution is idempotent; the Guardian supervises positions; multiple positions are managed through portfolio discipline; reality reconciliation is clean before completion.

**Evidence** — backtest, walk-forward, and single-shot blind holdout pass; positive expectancy net of costs; multi-regime coverage; decision-chain completeness; healthy reason-code distribution.

**Governance** — live only after the Strategy Validation Gate; Org-0-only live before regulatory clearance ([ADR-0009](../adr/0009-regulatory-posture.md)); external live prohibited until cleared; human promotion required; full audit trail; non-custodial invariant intact.

---

## 25. Final formula

```text
AI-TRADER sees the market as a living structure.
It does not re-analyze every candle from scratch — it updates the Market Canvas.
It does not trade for activity — it waits for proven, sustained advantage.
It does not let a strategy think instead of the system — the CDE admits, Decision acts, Risk clamps, Execution places.
It can manage multiple trades — only through portfolio-level risk, lots, exposure, and reality reconciliation.
It can create new strategies — only as research candidates through evidence and the Validation Gate.
It uses blockchains as later-maturity context and event intelligence — never as a direct buy/sell trigger.
It uses AI for research, explanation, and knowledge — never for direct live execution.
It is non-custodial — READ + TRADE only; WITHDRAW and TRANSFER are forbidden.
It does not hide errors — it explains every entry, every exit, and every abstention.
It does not seek frequency — it seeks calibrated advantage, positive expectancy, and capital preservation.
It is not a black box — it is a reproducible market intelligence system, sovereign to the human.
```

---

*End of target architecture. This document is subordinate to WAIA Core, the Product Constitution, and the Master Spec v2; additive to the ratified doctrines and ADRs; and describes the completed runtime architecture only. It authorizes no work, creates no live path, and weakens no gate.*
