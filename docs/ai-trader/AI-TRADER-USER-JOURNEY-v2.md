# AI-TRADER User Journey v2

Status: Baseline v1.2
Date: 2026-06-11

This journey replaces `AI_TRADER User Journey` entirely. It is consistent with the reconciled MVP: **HTX only, spot only, paper-first, admin-gated live trading**. All futures, scalping, swing, and leverage references are removed.

---

## Step 1 — Registration

The user registers through `waia.life` or `trader.waia.life`. The account is created in the shared WAIA identity system (Supabase Auth), and a personal organization is auto-provisioned by WAIA Core. The same credentials work on both domains.

## Step 2 — Trader access

With the `trader` entitlement, the user enters the AI-TRADER dashboard (sidebar in WAIA, or directly on `trader.waia.life`). Initially no exchange account is connected.

## Step 3 — Exchange connection (HTX, spot)

The user selects **HTX** and provides:
- API Key
- Secret
- Passphrase (if required)

Required permissions: **READ**, **TRADE**.
Forbidden permissions: **WITHDRAW**, **TRANSFER**.

The UI explains the required permissions and warns that withdraw/transfer must be disabled. The system validates credentials server-side, shows detected permissions where HTX exposes them, and rejects forbidden permissions where detectable. Credentials are encrypted at rest and never returned to the browser.

## Step 4 — Initial synchronization

The system imports balances, spot positions, recent trade history, and account metadata, then stores a balance snapshot. The user sees account status.

## Step 5 — Strategy selection (spot only)

The user enables one or both of the two available spot strategies:
- **Liquidity Sweep Reversal**
- **Mean Reversion**

Each strategy is subject to platform risk limits and to the Chief Decision Engine's regime-based permission. There are no futures, scalping, swing, or leverage options.

## Step 6 — Paper trading (default)

Paper trading is the default mode. The system runs the full loop — market state, decision, signal, risk approval, simulated execution, reconciliation, and paper reporting — without touching client funds. The user observes how strategies behave.

## Step 7 — Live trading activation (admin-gated, Org 0 only in MVP)

Live spot trading is **off by default**.

**In MVP, live trading is permitted only for Org 0 (in-house capital).** External client live trading is **prohibited by policy** until ADR-0009 transitions to `Accepted (Cleared)`; until then, the journey for external users ends at paper trading and monitoring, regardless of any flag or entitlement.

For the permitted (Org 0) case, activation requires:
- an explicit live-trading request with accepted risk disclosure and performance-fee terms;
- each strategy intended to go live has **passed the Strategy Validation Gate** (signed promotion record proving edge, not just paper-loop stability — [ADR-0010](../adr/0010-strategy-validation-gate.md));
- an **admin approval / enablement flag** with strict notional caps, authorized under the **Single Operator Governance Model** — immutable audit, cooling-off period, explicit confirmation, reversible where possible ([ADR-0011](../adr/0011-single-operator-governance-model.md));
- a valid exchange connection and strategy assignment.

The system confirms all of the above before any live order can be placed. Live trading begins under supervision with conservative limits.

## Step 8 — Monitoring

The user can view: balances, spot positions, open orders, closed trades, PnL, current strategy health summary, current risk status, the current reporting period PnL, the High-Water Mark, and trade reason codes.

## Step 9 — Monthly reporting

On the first day of each month the system generates a performance report with profit calculation and fee calculation, using the High-Water Mark and deposit/withdrawal adjustment.

## Step 10 — Invoice

The performance fee is 30% of net new profit above the High-Water Mark. The billing engine produces a **draft** invoice; issuance occurs only after manual reconciliation sign-off (MVP control). See [Billing & HWM](AI-TRADER-BILLING-HWM.md).

## Step 11 — Payment

The user pays the invoice in **USDT TRC-20** to a unique deposit address. The Payment Watcher verifies token, network, amount, and confirmations, then attributes the payment to the invoice.

## Step 12 — Account status

- Paid invoice → **ACTIVE**.
- Unpaid after grace period → **CLOSE_ONLY** or **SUSPENDED** per platform policy.
- Reactivation occurs only on confirmed on-chain settlement.

---

## Journey invariants

1. HTX only; spot only.
2. Paper trading is the default; live trading is opt-in and admin-gated, and in MVP is restricted to Org 0. External live trading is prohibited by policy until ADR-0009 is `Accepted (Cleared)`.
3. Withdraw/transfer permissions are never requested.
4. The user can revoke API access, disable trading, or disconnect at any time.
5. Every state change is auditable.

---

## Related documents

- [AI-TRADER MVP Scope v2](AI-TRADER-MVP-SCOPE-v2.md)
- [AI-TRADER Billing & HWM](AI-TRADER-BILLING-HWM.md)
- [AI-TRADER Security](AI-TRADER-SECURITY.md)
