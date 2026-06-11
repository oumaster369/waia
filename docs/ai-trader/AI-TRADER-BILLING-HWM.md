# AI-TRADER Billing & High-Water Mark

Status: Baseline v1.2 (single source of truth for billing)
Date: 2026-06-11

This document is the only authoritative definition of how AI-TRADER charges clients. It supersedes the simplified fee example in `AI_TRADER Business Operating Model` and consolidates the billing rules from the master specification.

The payer identity and crypto payment ledger are **WAIA Core shared infrastructure**; trader-specific reporting periods and invoices are **module-owned** (see [WAIA Core Architecture](../waia-core/WAIA-CORE-ARCHITECTURE.md)).

---

## 1. Fee model

- AI-TRADER charges a **performance fee of 30% of net new profit above the per-account High-Water Mark**, assessed monthly.
- There is no subscription fee. Clients pay only from realized growth above their prior peak.
- Fees are denominated in USD and invoiced in **USDT TRC-20** (MVP).

---

## 2. High-Water Mark (HWM)

- The HWM is tracked **per exchange account**.
- A performance fee accrues only when the period's ending equity exceeds the previous HWM **after** adjusting for client deposits and withdrawals.
- The HWM is updated only on period close, **after** invoice rules are satisfied — never intra-period and never before issuance rules are met.
- The HWM never decreases due to losses; clients must recover prior drawdowns before new fees apply.

---

## 3. Deposits and withdrawals

Deposits and withdrawals must be neutralized so the client is never charged for capital they added, and the platform is never deprived of fees due to capital the client removed.

- **Net deposits** increase ending equity without representing profit → subtracted from the profit base.
- **Net withdrawals** decrease ending equity without representing loss → added back to the profit base.
- Attribution of deposits/withdrawals to an account is derived from exchange transfer history.

**Reliability requirement:** if deposit/withdrawal attribution cannot be guaranteed for a period, that period's fee **must not** be auto-issued; it is routed to manual reconciliation (Section 7).

---

## 4. Canonical profit and fee formula

This formula is canonical. The simplified `ending − starting` example in the old business document is **deprecated**.

```text
adjusted_profit        = ending_equity - starting_equity - net_deposits + net_withdrawals
new_profit_above_hwm   = max(ending_equity - previous_high_water_mark - net_deposits + net_withdrawals, 0)
performance_fee        = new_profit_above_hwm * 0.30
```

Worked example (HWM-aware):

```text
previous_high_water_mark = 10,000
starting_equity          = 10,000
ending_equity            = 12,000
net_deposits             = 0
net_withdrawals          = 0

new_profit_above_hwm = max(12,000 - 10,000 - 0 + 0, 0) = 2,000
performance_fee      = 2,000 * 0.30 = 600
new_high_water_mark  = 12,000   (set on period close, post-issuance rules)
```

---

## 5. Reporting period lifecycle

At **period start**, lock the baseline:
- starting balance snapshot, open positions, starting equity, starting HWM.

At **period end**:
- ending balance snapshot, realized PnL, unrealized PnL policy;
- net deposits and net withdrawals for the period;
- compute `adjusted_profit` and `new_profit_above_hwm`;
- compute the fee on positive new profit above HWM only;
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

- The fee is assessed on **period-close equity** including open positions marked at the declared valuation source. Unrealized PnL is therefore *in scope* for the HWM and the fee at the snapshot moment.
- Because unrealized gains can reverse, the **HWM ratchet protects the client**: a later period that gives back unrealized gains cannot be charged again until equity exceeds the prior HWM. The valuation moment, marks, and open positions used are stored so any period is reconstructable.

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

- [AI-TRADER Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md)
- [AI-TRADER Security](AI-TRADER-SECURITY.md)
- [ADR-0008 Manual Billing Gate](../adr/0008-manual-billing-gate.md)
- [ADR-0011 Single Operator Governance Model](../adr/0011-single-operator-governance-model.md)
