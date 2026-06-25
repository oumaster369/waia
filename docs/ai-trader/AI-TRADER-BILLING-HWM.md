# AI-TRADER Billing & High-Water Mark

Status: Baseline v1.2 (single source of truth for billing)
Date: 2026-06-11

This document is the only authoritative definition of how AI-TRADER charges clients. It supersedes the simplified fee example in `AI_TRADER Business Operating Model` and consolidates the billing rules from the master specification.

The payer identity and crypto payment ledger are **WAIA Core shared infrastructure**; trader-specific reporting periods and invoices are **module-owned** (see [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md)).

---

## 1. Fee model

- AI-TRADER charges a **performance fee of 30% of net new Realized Strategy Profit above the per-account High-Water Mark**, assessed monthly. The fee base is defined by the [Closed Trade Reality Doctrine (LD-10)](AI-TRADER-CLOSED-TRADE-REALITY-DOCTRINE.md) — **realized, closed-trade profit only**; unrealized mark-to-market is never fee-bearing.
- There is no subscription fee. Clients pay only from **realized** growth above their prior peak.
- Fees are denominated in USD and invoiced in **USDT TRC-20** (MVP).
- **Fairness disclosure (LD-10 RC4):** Realized profit may coexist with unrealized drawdown — a client may owe a fee on closed-trade gains while open positions are underwater. Such invoices show both quantities side by side and remain dispute-eligible (Section 11.3).

---

## 2. High-Water Mark (HWM)

- The HWM is tracked **per exchange account** (MVP operational scope; doctrine semantics are strategy-scoped — see [LD-10 §5](AI-TRADER-CLOSED-TRADE-REALITY-DOCTRINE.md)).
- The HWM is **cumulative net realized strategy profit** — the running total of Realized Strategy Profit ratcheted upward only (LD-10 RC5). Unrealized marks do not move the HWM.
- A performance fee accrues only when **cumulative Realized Strategy Profit** exceeds the previous HWM. Under [LD-10 RC3](AI-TRADER-CLOSED-TRADE-REALITY-DOCTRINE.md), `deposit_adjustment = 0` — deposits and withdrawals do not enter the fee base (stored for audit and manual gate only).
- The HWM is updated only on period close, **after** invoice rules are satisfied — never intra-period and never before issuance rules are met.
- The HWM never decreases due to losses; clients must recover prior realized drawdowns before new fees apply.

---

## 3. Deposits and withdrawals

Deposits and withdrawals must be neutralized so the client is never charged for capital they added, and the platform is never deprived of fees due to capital the client removed.

- **Net deposits** increase ending equity without representing profit → subtracted from the profit base.
- **Net withdrawals** decrease ending equity without representing loss → added back to the profit base.
- Attribution of deposits/withdrawals to an account is derived from exchange transfer history.

**Reliability requirement:** if deposit/withdrawal attribution cannot be guaranteed for a period, that period's fee **must not** be auto-issued; it is routed to manual reconciliation (Section 7).

---

## 4. Canonical profit and fee formula

> **Superseded by [LD-10 Closed Trade Reality Doctrine](AI-TRADER-CLOSED-TRADE-REALITY-DOCTRINE.md) (RC1).** The canonical fee base is **Realized Strategy Profit** measured against **cumulative net realized strategy profit HWM** — not period-close equity. The equity-based formula below is retained as historical reference only.

```text
realized_strategy_profit     = sum of closed-trade realized PnL net of trading costs (LD-10 RC3)
new_profit_above_hwm         = max(cumulative_realized_profit - previous_hwm, 0)   # deposit_adjustment = 0 under LD-10 RC3
performance_fee              = new_profit_above_hwm * 0.30
```

**Deprecated (equity-based — superseded):**

```text
adjusted_profit        = ending_equity - starting_equity - net_deposits + net_withdrawals
new_profit_above_hwm   = max(ending_equity - previous_high_water_mark - net_deposits + net_withdrawals, 0)
performance_fee        = new_profit_above_hwm * 0.30
```

---

## 5. Reporting period lifecycle

At **period start**, lock the baseline:
- starting balance snapshot, open positions, starting equity, starting HWM.

At **period end**:
- ending balance snapshot, **realized PnL** (fee-bearing input), **unrealized PnL** (audit/transparency only — not fee-bearing per LD-10);
- net deposits and net withdrawals for the period;
- compute Realized Strategy Profit and `new_profit_above_hwm` per [LD-10](AI-TRADER-CLOSED-TRADE-REALITY-DOCTRINE.md);
- compute the fee on positive new realized profit above HWM only;
- generate a **draft** invoice if the fee exceeds the minimum threshold;
- update the HWM only after period close and issuance rules are satisfied.

Every period stores the exact inputs and the balance snapshots it derived from, so any invoice can be reconstructed later.

---

## 6. Invoice lifecycle

```text
DRAFT → ISSUED → PAYMENT_PENDING → PARTIALLY_PAID → PAID
                                  ↘ OVERDUE
        WAIVED / CANCELLED (admin, Single Operator Governance, audited)
```

- Invoices and their line items are **append-only** financial records.
- An invoice line-item set shows: starting equity, ending equity, net deposits, net withdrawals, profit, previous HWM, fee rate, and computed fee.
- Waiver/cancellation runs under the **Single Operator Governance Model** (immutable audit, cooling-off, explicit confirmation, audit reason) — see [ADR-0011](../adr/0011-single-operator-governance-model.md). A draft invoice is reversible (cancel) before issuance; an issued invoice is corrected via the overcharge-remediation and refund/credit policies (Section 11), never by a destructive edit.

---

## 7. Manual billing gate (MVP requirement)

Until deposit/withdrawal attribution is provably reliable, **live fee issuance is gated by mandatory manual reconciliation**:

- The billing engine computes and presents a complete draft invoice with full math.
- A human reviewer **must verify all of the following before approving issuance**:
  - **deposits** correctly identified and attributed for the period;
  - **withdrawals** correctly identified and attributed for the period;
  - **balance snapshots** (period start and end) present and correct;
  - **realized-fill finality** — closed trades underlying Realized Strategy Profit are final, not provisional (LD-10 RC2 / ADR-0008 reinterpretation);
  - **reconciliation status** clean (no unresolved order/fill/position mismatches);
  - **exchange synchronization integrity** (account data fully synced for the period, no gaps).
- Only after every item is confirmed does the invoice move `DRAFT → ISSUED` and the HWM update. The sign-off (reviewer, timestamp, verified items) is recorded in the audit stream.
- If any item fails, issuance is withheld and the period is escalated.

This is a hard control, not optional. See [ADR-0008](../adr/0008-manual-billing-gate.md).

---

## 8. Payment tracking & attribution

- **Unique deposit address per account** is the production model for automated reconciliation.
- The Payment Watcher must: verify token + network (USDT TRC-20), verify amount, wait required confirmations, match payment to invoice, store the transaction hash, update invoice status, and reactivate a suspended account on confirmed settlement.
- **Shared-address-plus-exact-amount matching is banned in production** — it is spoofable and unsafe for attribution.

---

## 9. Account status & suspension

```text
ACTIVE → PAYMENT_DUE → GRACE_PERIOD → OVERDUE → SUSPENDED / CLOSE_ONLY → TERMINATED
```

If an invoice remains unpaid after the grace period:
- disable new trades;
- optionally allow close-only orders;
- notify user and admin;
- keep account data visible.

Reactivation occurs only on confirmed on-chain settlement.

---

## 10. Dispute prevention

- Append-only invoices and payments; no destructive edits.
- Each fee calculation stores all inputs and references the balance snapshots used.
- The monthly report shows the formula and the HWM trajectory.
- Manual reconciliation sign-off is recorded in the audit stream.
- Admin overrides run under the Single Operator Governance Model (immutable audit, cooling-off, explicit confirmation, audit reason) — see [ADR-0011](../adr/0011-single-operator-governance-model.md).

---

## 11. Billing governance policies (architecture-level)

A 30% performance fee is not a complete revenue model on its own. The following policies bound how that fee is computed, contested, and corrected. They are stated at the architecture level — no accounting formulas, no quantitative thresholds — and each is enforced through the append-only ledger and the Single Operator Governance Model.

### 11.1 Valuation source policy

- Every period's equity, balances, and positions are valued from a **single declared source**: the exchange account's own reported balances and the exchange's marks at the snapshot moment. The valuation source and snapshot timestamps are stored with the period.
- No off-exchange or alternative price source is substituted silently. If the declared source is unavailable or degraded for a period, the period is routed to manual reconciliation (Section 7) rather than valued from a fallback.

### 11.2 Unrealized PnL policy

> **Superseded by [LD-10 Closed Trade Reality Doctrine](AI-TRADER-CLOSED-TRADE-REALITY-DOCTRINE.md) (RC1).** Unrealized PnL is **out of fee scope**.

- The fee is assessed on **Realized Strategy Profit** (closed-trade realized PnL net of trading costs) only — never on mark-to-market of open positions. Unrealized PnL is **not in scope** for the HWM or the fee.
- Unrealized PnL is still **captured and stored** with each reporting period for audit, transparency, and the fairness disclosure (LD-10 RC4): when realized profit and unrealized drawdown coexist, both are shown side by side on the draft invoice and monthly report.
- The **HWM ratchet on cumulative realized profit** protects the client: a later period that gives back unrealized gains cannot trigger a fee; only new realized profit above the prior HWM is charged.

### 11.3 Dispute handling policy

- A client may dispute any issued invoice. A dispute **freezes enforcement** for that invoice (no suspension escalation while open) and is recorded in the audit stream.
- Resolution is evidence-based: the stored period inputs, balance snapshots, valuation source, and deposit/withdrawal attribution are re-presented. The outcome (upheld / corrected) is logged. Disputes are resolved under the Single Operator Governance Model.

### 11.4 Overcharge remediation policy

- If review or a dispute shows a client was overcharged, the error is corrected by an **append-only correcting entry** (credit or refund per Section 11.5) — never by editing or deleting the original invoice.
- A corrected overcharge also **rolls back any HWM movement** that the erroneous period caused, so future fees are computed from the correct high-water mark.

### 11.5 Refund / credit policy

- Corrections are issued as either a **credit** against future fees or a **refund** of settled funds; which one is a recorded decision under the Single Operator Governance Model.
- Refunds/credits are append-only ledger entries linked to the original invoice and the reason. Settled on-chain refunds are treated as irreversible effects and therefore guarded by the cooling-off + explicit-confirmation workflow before execution.

---

## Related documents

- [AI-TRADER Closed Trade Reality Doctrine (LD-10)](AI-TRADER-CLOSED-TRADE-REALITY-DOCTRINE.md)
- [AI-TRADER Reality Doctrine (LD-9)](AI-TRADER-REALITY-DOCTRINE.md)
- [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md)
- [AI-TRADER Security](AI-TRADER-SECURITY.md)
- [ADR-0008 Manual Billing Gate](../adr/0008-manual-billing-gate.md)
- [ADR-0011 Single Operator Governance Model](../adr/0011-single-operator-governance-model.md)
