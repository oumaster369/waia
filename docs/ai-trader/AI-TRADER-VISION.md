# AI-TRADER Vision

Status: Baseline v1.2
Date: 2026-06-11

This document defines the purpose, philosophy, and long-term direction of AI-TRADER. It deliberately contains **no timelines and no budget estimates** — those belong to the roadmap and to operational planning, and earlier speculative figures (e.g. "~2 months", "$200–300/month") are explicitly retired.

---

## 1. What AI-TRADER is

AI-TRADER is a **market intelligence system**, not a trading bot, a signal service, or a black-box strategy.

It is a module of the WAIA ecosystem with a dedicated entry point (`trader.waia.life`). It detects recurring market states, measures their statistical strength, classifies the current regime, and trades only the strategies that are permitted in that regime under strict risk control — on client-owned exchange accounts, using trade-only API access.

The system must always be able to choose **not to trade**.

---

## 2. Philosophy

### 2.1 The market is repeating human behavior

Markets are not random; they are recurring human reactions under uncertainty. People systematically err under fear and greed. AI-TRADER does not participate in those emotions — it measures and exploits the behavioral structure around them.

### 2.2 Mathematics over narrative

AI-TRADER is assigned strict tasks: identify recurring states, measure expectancy and stability, rank patterns, synthesize strategies, and discard anything that does not survive reality. It proves rather than predicts.

### 2.3 An engineering system, not a black box

Every decision is reproducible from stored context: market state, regime, approved strategy, risk decision, and execution outcome. Reproducibility and auditability are first-class product features, not afterthoughts.

### 2.4 Adapt parameters, not core logic

The system accumulates its own decision history, measures edge and risk, and adapts parameters within validated bounds. It becomes more precise over time, not more complex or more opaque.

---

## 3. Layered intelligence (conceptual)

AI-TRADER is an orchestra of specialized layers, each with a narrow responsibility:

1. **Market Physics** — price, volume, volatility, momentum, movement asymmetry, continuation/retracement statistics.
2. **Liquidity & Microstructure** — spread, depth, imbalance, absorption, slippage, execution quality.
3. **Crowd Psychology** — fear/greed, news sentiment, social noise, positioning imbalances.
4. **Future Context** — anticipation regimes, asymmetric volatility, scheduled events.

These feed a central **Chief Decision Engine** that aggregates everything into a **Market State Vector**, determines the regime, decides whether trading is permitted, and selects which strategies are allowed. The Chief Decision Engine does not place orders.

The defining capability is restraint: **the system knows when not to trade.**

---

## 4. Trust and the human role

- Clients keep custody of their funds. AI-TRADER receives **read + trade** access only; **withdraw and transfer are forbidden**.
- Clients may revoke API access, disable trading, or disconnect at any time.
- The human formulates hypotheses, sets strategic boundaries, and supervises. AI-TRADER amplifies human judgment; it does not replace human authority. A human is always above the system.

---

## 5. Long-term direction

AI-TRADER is designed to evolve, without rewrites, into institutional-grade market intelligence infrastructure that:

- researches markets and validates strategies systematically,
- executes with controlled, risk-bounded automation,
- produces transparent, auditable performance reporting,
- supports multiple exchanges, portfolios, and fund/partner structures,
- and keeps custody with the client throughout.

The near-term product is a safe, narrow MVP (HTX, spot-only, two validated strategies, paper-first). The architecture is built today as the seed of future institutional infrastructure. Scope discipline is defined in [AI-TRADER MVP Scope v2](AI-TRADER-MVP-SCOPE-v2.md); sequencing in [AI-TRADER Roadmap v2](AI-TRADER-ROADMAP-v2.md).

---

## 6. Social mission

AI-TRADER is not about greed. Its long-term purpose within DeepSense/WAIA is the redistribution of value in a world where automation displaces traditional employment — turning market intelligence into a foundation that finances and supports people through that transition.

---

## 7. Related documents

- [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md)
- [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md)
