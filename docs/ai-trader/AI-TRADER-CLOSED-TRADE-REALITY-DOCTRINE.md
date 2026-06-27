# AI-TRADER — LD-10 Closed Trade Reality Doctrine (Realized Fee Base)

> **Status: Ratified doctrine v1.0 (LD-10 Closed Trade Reality). Accepted upon merge.**
> **Ratification:** LD-10 Closed Trade Reality Doctrine v1.0 · **Parent:** DEE-278 · **Slice:** DEE-308.
> **Subordinate to the [AI-TRADER Market Intelligence Architecture](AI-TRADER-MARKET-INTELLIGENCE-ARCHITECTURE.md), the [Knowledge-to-Action Doctrine](AI-TRADER-KNOWLEDGE-TO-ACTION-DOCTRINE.md), the [LD-9 Reality Doctrine](AI-TRADER-REALITY-DOCTRINE.md), the [LD-8 Risk Doctrine](AI-TRADER-RISK-DOCTRINE.md), [Billing & HWM](AI-TRADER-BILLING-HWM.md), and the [Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md); bounded by [ADR-0008](../adr/0008-manual-billing-gate.md) / [ADR-0009](../adr/0009-regulatory-posture.md) / [ADR-0010](../adr/0010-strategy-validation-gate.md) / [ADR-0011](../adr/0011-single-operator-governance-model.md). Where this document and any of those conflict, they win.**
> **Additive only — it overrides nothing and weakens no governance gate.**
> **No engines.** LD-10 delivers the canonical realized-fee-base definition and billing-truth doctrine only. It adds no automation, no fee engine, no schema, and no autonomous money path.

Date: 2026-06-24
Scope: How AI-TRADER defines the **billable** performance-fee base — fixing fees to **realized, closed-trade profit** and the high-water mark to **cumulative net realized strategy profit** — the billing-truth layer that consumes [LD-9 Reality](AI-TRADER-REALITY-DOCTRINE.md)'s realized cashflow facts and hands a chargeable quantity to [Billing & HWM](AI-TRADER-BILLING-HWM.md).
Authority: Subordinate to the [Market Intelligence Architecture](AI-TRADER-MARKET-INTELLIGENCE-ARCHITECTURE.md), the [Knowledge-to-Action Doctrine](AI-TRADER-KNOWLEDGE-TO-ACTION-DOCTRINE.md), the [Reality Doctrine](AI-TRADER-REALITY-DOCTRINE.md), the [Risk Doctrine](AI-TRADER-RISK-DOCTRINE.md), [Billing & HWM](AI-TRADER-BILLING-HWM.md), the [Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md), and ADR-0008/0009/0010/0011. **Where this document and any of those conflict, they win.**
Lineage: Canonical output of the full LD-10 architecture cycle — Architecture Review → Hostile Review → Billing Model Review → Ratification Review → Build Readiness Review (RATIFY WITH REQUIRED CHANGES; RC1–RC5 integrated). It records final decisions; it does not re-litigate them.

> **Reading note.** LD-10 is the billing-truth hinge between Reality and Billing. Reality (LD-9) owns **what actually moved** — realized cashflow as fact. LD-10 owns **what is billable** — the realized closed-trade profit that may be charged. Billing & HWM owns **how much to charge** — the 30% fee, invoice lifecycle, and payment. LD-10 answers exactly one question — **"What realized profit is fee-bearing?"** — and never authors truth, never enforces, never executes, and never moves money autonomously.

---

## Section 1 — Purpose

LD-10 is the layer where AI-TRADER stops assessing performance fees on **period-close equity** (which includes unrealized mark-to-market) and starts assessing them on **realized, closed-trade profit only**. A client must never be charged on open-position marks that can reverse; a client must never be deprived of fees on profit that has actually crystallized in closed trades. LD-10 defines the canonical fee-bearing quantity — **Realized Strategy Profit** — and the canonical high-water mark — **cumulative net realized strategy profit** — that [Billing & HWM](AI-TRADER-BILLING-HWM.md) consumes.

LD-10 records **doctrine** (definitions, supersession, fairness disclosure, HWM semantics); it **never** constructs truth (that is LD-9), **never** computes the charge (that is Billing & HWM), and **never** issues an invoice. It is the billing-truth contract that downstream fee computation must honor.

---

## Section 2 — Closed Trade Reality Definition

**Core statement (canonical):**

> **Closed Trade Reality is the billing-truth doctrine that fixes the performance-fee base to realized, closed-trade profit net of trading costs, defines the high-water mark as cumulative net realized strategy profit, and excludes mark-to-market of open positions from fee assessment — consuming LD-9's realized cashflow facts and handing a billable quantity to Billing & HWM, never authoring truth, never enforcing, and never moving money autonomously.**

**LD-10 IS:**
- **the realized-fee-base owner** — it defines what profit is fee-bearing;
- **closed-trade grounded** — only realized PnL from completed round-trips (closed positions) counts toward the fee base;
- **HWM-defining** — the high-water mark ratchets on cumulative net realized strategy profit, never on equity or unrealized marks;
- **fairness-explicit** — it declares that realized profit may coexist with unrealized drawdown and that such fees are disclosed, audited, and dispute-eligible;
- **subordinate to Reality** — it reads LD-9's realized cashflow; it never authors or rewrites truth records.

**LD-10 IS NOT:**
- **Reality (LD-9)** — it does not construct, record, or project post-execution truth;
- **Billing & HWM** — it does not compute the 30% fee, generate invoices, or track payments;
- **Risk (LD-8)** — it grants, clamps, vetoes, or halts nothing;
- **an accounting engine** — lot matching, cost-basis method, and full P&L accounting remain reserved (LD-9 §16; partially instantiated here for the fee base only).

**Position in the chain:** `… → Reality (LD-9) →` **Closed Trade Reality (LD-10)** `→ Billing & HWM`. LD-10 consumes Reality's realized cashflow facts and publishes the fee-bearing definition Billing reads.

---

## Section 3 — RC1: Supersession Statement

LD-10 **supersedes** the following sections of [Billing & HWM](AI-TRADER-BILLING-HWM.md) as they stood before ratification:

| Section | Prior canon (superseded text) | LD-10 disposition |
|---|---|---|
| **§11.2 Unrealized PnL policy** | "The fee is assessed on **period-close equity** including open positions marked at the declared valuation source. Unrealized PnL is therefore *in scope* for the HWM and the fee at the snapshot moment." | **FULLY SUPERSEDED.** Unrealized PnL is **out of fee scope**. The fee base is Realized Strategy Profit only. Unrealized PnL is captured for audit/transparency but never billed. |
| **§4 Canonical profit and fee formula** | `adjusted_profit = ending_equity − starting_equity − net_deposits + net_withdrawals`; `new_profit_above_hwm = max(ending_equity − previous_HWM − …, 0)`. | **SUPERSEDED (formula).** The canonical base is Realized Strategy Profit measured against cumulative net realized strategy profit HWM. The equity-based formula and worked example are retained in Billing & HWM as historical reference only, marked superseded. |
| **§2 High-Water Mark (partial)** | "A performance fee accrues only when the period's **ending equity** exceeds the previous HWM after adjusting for client deposits and withdrawals." | **PARTIALLY SUPERSEDED.** HWM semantics shift to cumulative net realized strategy profit (RC5). Per-account operational scoping is retained for MVP (Org-0). |
| **§5 Reporting period lifecycle (partial)** | Period-end captures realized PnL and unrealized PnL "policy" with both feeding fee computation. | **REINTERPRETED.** Realized PnL is the fee-bearing input; unrealized PnL is audit/transparency only. |

**Nothing in LD-8, LD-9, ADR-0010, or ADR-0011 is superseded.** LD-10 is additive to them and overrides no governance gate.

---

## Section 4 — RC3: Realized Strategy Profit (Definition)

**Realized Strategy Profit** is the canonical fee-bearing quantity for a reporting period.

**Definition (canonical):**

> **Realized Strategy Profit** is the net realized profit from **closed trades** within the reporting period — the sum of realized PnL from completed round-trips (positions opened and fully closed), net of trading fees, funding, and other trading costs as asserted by the venue and recorded by LD-9 Reality as realized cashflow facts.

**In scope:**
- Realized PnL from closed positions (round-trips fully settled within or spanning the period, attributed by closed-trade finality).
- Trading fees and funding costs netted against realized gains (as Reality records them).

**Out of scope (never fee-bearing):**
- Mark-to-market of **open positions** at period close (unrealized PnL).
- Deposits and withdrawals (neutralized separately per Billing & HWM §3).
- Equity deltas that reflect unrealized marks rather than closed-trade crystallization.

**Source:** Realized Strategy Profit is **derived from** LD-9 Reality's realized cashflow and settled-fill records; LD-10 defines the aggregation rule, Reality owns the underlying facts. Billing & HWM computes the 30% fee on positive Realized Strategy Profit above the HWM.

---

## Section 5 — RC5: Strategy HWM Semantics

**Strategy High-Water Mark (HWM)** is the canonical ratchet against which new Realized Strategy Profit is measured.

**Definition (canonical):**

> **Strategy HWM** is the **cumulative net realized strategy profit** — the running total of Realized Strategy Profit across all prior closed reporting periods for the strategy (or account, in MVP), ratcheted upward only when a period's Realized Strategy Profit exceeds the prior cumulative peak. The HWM **never decreases** due to losses or unrealized drawdown; new fees apply only when cumulative realized profit exceeds the prior HWM.

**Ratchet rules:**
- HWM updates only after period close and invoice issuance rules are satisfied (Billing & HWM §2, ADR-0008).
- A period with negative Realized Strategy Profit does not lower the HWM; the client must recover the drawdown in future realized profit before new fees apply.
- Unrealized gains or losses on open positions do not move the HWM.

**MVP account-scoped reconciliation note:** In Org-0 MVP (single supervised exchange account, spot-only), **account ≈ strategy** — the per-account HWM ledger (`trader_hwm_ledger`, DEE-307) stores the HWM as an opaque cumulative realized-profit value per `exchange_account_id`. Multi-strategy-per-account HWM decomposition is deferred to the fee-computation implementation slice (AT-E11 S4); the doctrine semantics are strategy-scoped, the MVP operational scope is account-scoped.

---

## Section 6 — RC4: Fairness Disclosure

**Fairness invariant:** Realized profit may **coexist with unrealized drawdown**.

A client may owe a performance fee on Realized Strategy Profit from closed winning trades in a period while simultaneously holding open positions that are underwater (negative unrealized PnL). This is **by design**, not an error:

- The fee reflects profit that **actually crystallized** in closed trades — money the client could withdraw.
- Open-position marks can reverse; billing on unrealized marks would charge on gains that may never materialize.
- The HWM ratchet on cumulative **realized** profit protects the client from being charged twice on the same realized peak.

**Disclosure requirements:**
- Every draft invoice and monthly report must show **both** Realized Strategy Profit (fee base) **and** unrealized PnL (audit/transparency) side by side.
- The fairness coexistence case must be explicitly surfaced when it occurs — never hidden.
- Such invoices remain fully dispute-eligible under Billing & HWM §11.3 and ADR-0011.

---

## Section 7 — RC2: ADR-0008 Reinterpretation (Manual Billing Gate)

The [manual billing gate (ADR-0008)](../adr/0008-manual-billing-gate.md) survives for **two independent grounds**, not one:

1. **Deposit/withdrawal attribution unreliability** (original ADR-0008 context) — clients must not be charged on capital they added; the platform must not be deprived of fees on capital they removed.
2. **Realized-fill finality** (LD-10 ground) — provisional fills can reverse, re-org, or be corrected by the venue after initial reporting. Until a Finality / Settlement doctrine ratifies automatic promotion of provisional → final, **no realized cashflow reaches an issued invoice without human verification** that the closed trades underlying Realized Strategy Profit are final (not provisional).

The gate's **Decision is unchanged** — mandatory manual reconciliation before `DRAFT → ISSUED`. LD-10 adds the realized-fill-finality verification item to the reviewer checklist (Billing & HWM §7). Automation may replace the gate only after **both** attribution reliability **and** realized-fill finality semantics are demonstrated and signed off.

See the additive reinterpretation note in [ADR-0008](../adr/0008-manual-billing-gate.md).

---

## Section 8 — Ownership & Boundaries

| Layer | Owns | Consumes | May NEVER do |
|---|---|---|---|
| **Reality (LD-9)** | TRUTH — realized cashflow as fact | Execution acks, venue events | compute a charge; own fee policy |
| **Closed Trade Reality (LD-10)** | BILLING TRUTH — Realized Strategy Profit definition, Strategy HWM semantics, fairness disclosure | Reality's realized cashflow / settled fills | author truth; compute fee; issue invoice |
| **Billing & HWM** | CHARGE — 30% fee, invoice lifecycle, payment | LD-10's fee-bearing definition + Reality facts | author truth; override LD-10 fee base |

**Boundary invariant.** Reality authors facts; LD-10 defines what is billable; Billing computes and charges. No layer skips or collapses into another.

---

## Section 9 — Governance Compatibility

LD-10 is bounded by, and reinforces, existing governance. It instantiates no new gate and weakens none.

- **Additive-only / no engines.** LD-10 adds a doctrine document and canon edits. No fee engine, schema, migration, or autonomous money path.
- **Manual billing gate (ADR-0008).** Reinforced with a second, attribution-independent ground (realized-fill finality). Decision unchanged.
- **Single-operator governance (ADR-0011).** Invoice issuance, waiver, and HWM correction remain logged single-operator actions.
- **Strategy validation gate (ADR-0010).** Untouched — LD-10 governs billing truth, not paper→live promotion.
- **Regulatory posture (ADR-0009).** Conservative; no autonomous capital action or autonomous fee issuance added.
- **LD-9 Reality.** Additive + subordinate. LD-10 consumes Reality's realized cashflow; MC2 boundary preserved.

---

## Section 10 — Reservations

Explicitly **out of scope** for v1.0:

- **Full Accounting / Cost-Basis doctrine** — lot matching, FIFO/LIFO, full P&L method remain reserved (LD-9 §16). LD-10 partially instantiates the realized-fee-base seam only.
- **Finality / Settlement auto-promotion** — automatic provisional→final for fee-bearing closed trades remains reserved; ADR-0008 manual gate is the compensating control.
- **Multi-strategy-per-account HWM decomposition** — deferred to AT-E11 S4 fee-computation slice; MVP operates account≈strategy.

---

## Section 11 — Ratification Statement

**LD-10 Closed Trade Reality Doctrine v1.0 is ratified as Accepted Canon**, subordinate and additive to the Market Intelligence Architecture, the Knowledge-to-Action Doctrine, the LD-9 Reality Doctrine, the LD-8 Risk Doctrine, Billing & HWM, and bounded by ADR-0008 / ADR-0009 / ADR-0010 / ADR-0011.

This ratification affirms:

- **RC1** — explicit supersession of Billing & HWM §11.2, §4, §2 (partial), §5 (partial); unrealized PnL is out of fee scope.
- **RC3** — Realized Strategy Profit defined as closed-trade realized PnL net of trading costs; excludes mark-to-market of open positions.
- **RC5** — Strategy HWM = cumulative net realized strategy profit; ratchet-up only; MVP account-scoped operational note for DEE-307 ledger.
- **RC4** — fairness disclosure: realized profit may coexist with unrealized drawdown; disclosed, audited, dispute-eligible.
- **RC2** — ADR-0008 reinterpreted: manual gate survives on realized-fill finality independent of deposit attribution; Decision unchanged.

**This is a documentation-only doctrine.** It adds no code, schema, migration, runtime, CI, or ADR edit beyond the additive ADR-0008 reinterpretation note; it instantiates no engine and authorizes no autonomous capital or fee path. Relaxation of any bound herein is a human action under ADR-0011. Accepted upon merge.
