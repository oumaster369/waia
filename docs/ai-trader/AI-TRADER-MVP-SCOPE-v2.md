# AI-TRADER MVP Scope v2

Status: Baseline v1.2 (governing scope)
Date: 2026-06-11

This document is the single, internally consistent definition of the AI-TRADER MVP. It supersedes `AI_TRADER MVP SCOPE v1.0` and the strategy choices implied by the original `AI_TRADER User Journey`.

**Rule:** if a feature is not explicitly listed as IN, it is OUT. When an implementation choice is unclear, choose the simplest, safest, most auditable option, and prefer paper trading over live trading.

---

## MVP Goal

Validate the complete AI-TRADER operating loop:

`User → Exchange Connection → Paper Trading → Risk Controls → Admin-gated Live Spot → Reporting → Billing`

using the smallest safe architecture, on top of WAIA Core identity and tenancy.

---

## IN

### Identity & tenancy (via WAIA Core)
- Shared WAIA authentication (Supabase Auth) across `waia.life` and `trader.waia.life`.
- WAIA Core `profiles`, `organizations`, `organization_members`, roles, entitlements (built as the Phase 1 prerequisite).
- Auto-provisioned personal organization per user; `organization_id` on every trader row.
- `trader` entitlement gates access to the trader module.

### Exchange
- **HTX only.**
- **Spot only** (BTCUSDT, ETHUSDT).
- Read + Trade API credentials; encrypted at rest; service-role access only.
- Permission warnings; reject withdraw/transfer permissions where HTX metadata makes them detectable; behave safely when not detectable.
- Balance / position / trade-history sync and snapshots.

### Intelligence
- Market data ingestion for BTC/ETH spot, plus Fear & Greed Index and news sentiment.
- **Minimal Market State Vector:** Market Physics + Liquidity + partial Crowd Psychology; regime, trading permission, and `data_quality_score`.
- **Chief Decision Engine** as a regime/permission gate that can decline to trade.
- Future Context Layer: **stubbed** (`event_risk_score` null/zero).

### Strategies
- **Exactly two**, whitelisted and deterministic:
  - Liquidity Sweep Reversal
  - Mean Reversion
- Strategies emit structured signals only; they never place orders.

### Risk & execution
- Risk Engine with hard limits and security controls (symbol allowlist, max notional, max order rate, price collars).
- Kill switches at all levels: global, user, account, strategy, instrument — fail-closed.
- Order state machine, idempotency keys, reconciliation.
- Mock execution + **paper trading end-to-end** (default mode).
- **Limited live HTX spot for Org 0 (in-house capital) only**, behind an admin flag, with strict notional caps and a single supervised account.

### Billing
- Monthly reporting periods; per-account High-Water Mark.
- 30% performance fee on net new profit above HWM, with mandatory deposit/withdrawal adjustment.
- Invoice lifecycle; USDT TRC-20 payments with unique deposit address per account; payment tracking; suspension lifecycle.
- **Manual reconciliation gate**: the billing engine computes draft invoices; a human approves issuance (see [Billing & HWM](AI-TRADER-BILLING-HWM.md)).

### Administration & platform
- Cross-module admin console; full append-only audit; observability and alerting for critical events.

---

## OUT (Phase 2 unless stated)

- **External client live trading** — prohibited by policy until ADR-0009 transitions to `Accepted (Cleared)`. No entitlement, workflow, onboarding flow, or deployment may enable it in MVP. (MVP live trading is Org 0 only.)
- **Futures, margin, options, high-frequency execution** — live trading of any of these. (Removed from the user journey entirely.)
- Funding-rate / open-interest / long-short ratio as **execution inputs** (may be read for regime context only).
- Future Context Layer beyond a stub.
- Portfolio Allocation beyond a trivial constant allocator (data model only in MVP).
- Research Engine backtesting / walk-forward **automation** (schema + minimal manual lifecycle only in MVP).
- Strategy Health **automation** (manual review in MVP; schema present).
- Additional symbols beyond BTC/ETH, added later by configuration.

---

## FUTURE

- Additional exchanges: Binance, OKX, Bybit, Coinbase, Deribit; DEX venues.
- Portfolio / fund / prop-firm structures, investor allocation, institutional reporting.
- AI-generated / reinforcement-learning / self-modifying strategies.
- Cross-exchange arbitrage and market making.
- Integration with AI-TWIN social network, 3P, and AI-Marketplace.

---

## Contradiction reconciliations (for the record)

- **Spot vs futures:** spot only; futures are interface stubs, disabled.
- **Strategy scope:** exactly two whitelisted strategies; no scalping/swing groups from the old journey.
- **Intelligence scope:** Physics + Liquidity + partial Crowd + MSV + Chief Decision; Future Context stubbed.
- **Research scope:** schema + manual lifecycle; no automated backtest infrastructure in MVP.
- **Execution scope:** mock + paper first; live spot only behind an admin flag with caps.

---

## MVP success criteria

1. A user registers through WAIA and lands in the trader module via entitlement.
2. A user connects HTX (spot) with encrypted Read+Trade credentials.
3. Balances and positions synchronize correctly.
4. The Market State Vector is produced and stored with a data-quality score.
5. The Risk Engine blocks any signal that violates limits; kill switches work and fail closed.
6. Paper trading runs end-to-end for ≥48 hours with clean reconciliation, with the minimum observability baseline live so the run is measurable.
7. No strategy is promoted to live without passing the Strategy Validation Gate (signed promotion record proving edge, not just plumbing — ADR-0010). Live spot trades (Org 0 only) execute only when admin-enabled under the Single Operator Governance Model (immutable audit, cooling-off, explicit confirmation — ADR-0011), within caps, under supervision.
8. Monthly reporting + HWM + 30% fee compute correctly; invoices issue only after manual reconciliation sign-off.
9. USDT TRC-20 payments are detected and attributed; overdue accounts suspend.
10. Every critical action is auditable.

---

## Related documents

- [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md)
- [AI-TRADER Roadmap v2](AI-TRADER-ROADMAP-v2.md)
- [AI-TRADER Billing & HWM](AI-TRADER-BILLING-HWM.md)
