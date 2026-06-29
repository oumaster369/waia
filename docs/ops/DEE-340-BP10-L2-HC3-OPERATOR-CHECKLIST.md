# DEE-340 / BP-10 — L2 HC-3 Operator Checklist

**Linear:** [DEE-340](https://linear.app/deepsense/issue/DEE-340) · **Checkpoint:** HC-3 · **Status:** **COMPLETE** (2026-06-29)  
**Authority:** [ADR-0008](../adr/0008-manual-billing-gate.md) · [Billing & HWM §7](../ai-trader/AI-TRADER-BILLING-HWM.md)  
**Runbook:** [DEE-340-BP10-LAUNCH-RUNBOOK.md](DEE-340-BP10-LAUNCH-RUNBOOK.md) · **Evidence ledger:** [DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md](DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md) §3

> **Operator-only.** Ceremony **COMPLETE** 2026-06-29. Evidence recorded in closure report §3. **Next:** HC-4 readiness review — **do not proceed to L3 live-enable** until readiness review complete.  
> **UX backlog (post-MVP):** [DEE-340-OPERATOR-CONSOLE-UX-BACKLOG.md](DEE-340-OPERATOR-CONSOLE-UX-BACKLOG.md)

---

## Purpose

Exercise the ADR-0008 manual billing / HWM gate on Org-0 so criterion **10** can move from **OPERATOR REQUIRED** to **PASS** before any live-enable (L3) or live order (L4).

---

## Preconditions (verify before starting)

| # | Check | Expected |
|---|-------|----------|
| P-0 | Production deployment verified | Closure report §3 deployment verification **PASS**; admin commands route live on `trader.waia.life` (not **404**) |
| P-1 | BP-10 L1 complete | Closure report §2 **COMPLETE** |
| P-2 | Criterion 10 is the sole pre-live operator gate | Closure report §1 — only row **10** is **OPERATOR REQUIRED** |
| P-3 | No live-enable armed | Admin `/admin/live-enable` — Org-0 state **DISABLED** (or equivalent not-enabled) |
| P-4 | No live order placed | Closure report §5 **not started** |
| P-5 | Platform admin session | Signed-in operator with platform **`admin`** role on production trader host |
| P-6 | Org-0 selected | Organization matches operator vault Org-0 UUID (org prefix **`3c50b4e9…`** per BP-9A Step 4) |
| P-7 | Billable DRAFT exists | A **`DRAFT`** invoice row for Org-0 exchange account **`htx-spot-1`** (see Step 1) |

If **P-7** fails: stop. A closed billable reporting period and draft invoice must exist per [Billing & HWM §5–6](../ai-trader/AI-TRADER-BILLING-HWM.md) before the gate can be exercised. Do not proceed to L3.

If **P-7** fails because no DRAFT exists yet (post-recovery deploy): use governed admin **`POST /api/trader/admin/reporting-periods/commands`** with **`close-and-materialize`** and operator-attested period inputs for **`htx-spot-1`** (realized PnL must yield billable fee ≥ minimum threshold). Confirm **`billable": true`** and audit actions include **`trader.invoice.draft_generated`**, then restart from Step 1.

---

## Step 0 — Materialize drill period (only if P-7 fails with empty invoices)

**Surface:** Authenticated admin API **`POST /api/trader/admin/reporting-periods/commands`**

**Body (non-secret shapes only):**

- `command`: `"close-and-materialize"`
- `organization_id`: Org-0 UUID
- `exchange_account_id`: `"htx-spot-1"`
- Operator-attested period fields: `period_start`, `period_end`, `starting_equity`, `ending_equity`, `starting_snapshot_at`, `ending_snapshot_at`, `open_positions_snapshot_ref`, `valuation_source`, `realized_pnl`, `unrealized_pnl`

**Confirm response includes:** `reportingPeriodIdPrefix`, `invoiceIdPrefix` (when billable), `invoiceStatus: "DRAFT"`, `billable: true`, audit action names including **`trader.reporting_period.closed`** and **`trader.invoice.draft_generated`**.

Then proceed to Step 1.

---

## Step 1 — Locate the Org-0 draft invoice

1. Open production admin console: **`/admin/billing`** on the trader host.
2. Select **Org-0** organization.
3. Enter exchange account id: **`htx-spot-1`**.
4. Click **Load billing**.
5. Confirm invoice list JSON includes at least one invoice with **`status": "DRAFT"`** and **`billable": true`**.
6. Record the invoice **`id`** prefix (first 8 characters only) for the evidence package.

**Read-only review (before approval):**

- Invoice detail JSON shows line-item math: starting/ending equity, net deposits, net withdrawals, profit, previous HWM, fee rate, performance fee.
- Reporting period id prefix is present.
- No open billing dispute blocks issuance (review panel shows none, or dispute resolved).

---

## Step 2 — Manual reconciliation review (ADR-0008 + LD-10)

Review each item below against production data sources (admin billing detail, reconciliation posture, exchange sync state, closed-trade records). **Do not approve** unless every item is verified.

| # | Attestation key | Operator verifies |
|---|-----------------|-------------------|
| A-1 | `depositsVerified` | Deposits for the period are correctly identified and attributed |
| A-2 | `withdrawalsVerified` | Withdrawals for the period are correctly identified and attributed |
| A-3 | `balanceSnapshotsVerified` | Period start and end balance snapshots are present and correct |
| A-4 | `reconciliationVerified` | Reconciliation status is clean — no unresolved order/fill/position mismatches |
| A-5 | `exchangeSyncVerified` | Exchange account data is fully synced for the period with no gaps |
| A-6 | `realizedFillFinalityVerified` | Closed trades underlying Realized Strategy Profit are final, not provisional (LD-10) |

**Hard rule:** If **any** item fails, **withhold issuance**, document the failure, and escalate. Do not issue.

---

## Step 3 — Approve issuance (pending + cooling-off)

**Surface:** Admin **`/admin/billing`** → **Approve issuance** (or equivalent authenticated admin command).

**System behavior:**

- Invoice remains **`DRAFT`**; approval records `issuanceApprovedAt`, `issuanceApprovedBy`, and `coolingOffUntil`.
- Audit action emitted: **`trader.invoice.issuance_approved`**
- Default cooling-off: **15 minutes** (`TRADER_INVOICE_ISSUANCE_COOLING_OFF_MS` override if set in production)

**Operator confirms:**

- UI/command returns success.
- Invoice detail shows approval metadata and future `coolingOffUntil` timestamp.
- All **6** attestation keys were affirmed (gate attestation count = **6**).

Record **`issuanceApprovedAt`** as ISO-8601 (manual sign-off timestamp for evidence).

---

## Step 4 — Wait for cooling-off

1. Note `coolingOffUntil` from invoice detail.
2. Wait until current time is **after** `coolingOffUntil`.
3. Do not attempt **Issue** before cooling-off elapses (`ISSUANCE_COOLING_OFF_NOT_ELAPSED` fail-closed).

---

## Step 5 — Issue invoice (DRAFT → ISSUED + HWM update)

**Surface:** Admin **`/admin/billing`** → **Issue**.

**System behavior:**

- Invoice transitions **`DRAFT` → `ISSUED`**.
- HWM ledger updates per fee computation artifact binding.
- Audit action emitted: **`trader.invoice.issued`**

**Operator confirms:**

- UI/command returns success.
- Invoice detail shows **`status": "ISSUED"`** and `issuedAt` timestamp.
- Issued invoice digest fields unchanged from approved draft (no tamper).

---

## Step 6 — Operator attestation (handoff to Composer)

Complete the evidence package in [closure report §3](DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md) and confirm:

| Field | Operator supplies |
|-------|-------------------|
| Invoice id prefix | First 8 chars of issued invoice id |
| Gate attestation count | **6** (if all ADR-0008 items verified) |
| Manual sign-off timestamp | `issuanceApprovedAt` ISO-8601 |
| Issued-at timestamp | `issuedAt` ISO-8601 |
| Reporting period id prefix | First 8 chars |
| Audit actions observed | `trader.invoice.issuance_approved`, `trader.invoice.issued` |
| Operator attestation | Name/role + date |
| Criterion 10 | Operator confirms gate exercised — Composer records **PASS** in §1 |

**STOP after Step 6.** HC-3 **COMPLETE** (2026-06-29). Do not proceed to L3 (live-enable) until **HC-4 readiness review** complete and Architect/Operator agree to continue.

---

## Completion record (2026-06-29)

| Step | Status | Evidence |
|------|--------|----------|
| 0 — Materialize drill period | **COMPLETE** | Period prefix `d926e5ff`; audit chain through `draft_generated` |
| 1 — Locate draft invoice | **COMPLETE** | Invoice prefix `2cedeaa5`; `DRAFT`, `billable: true` |
| 2 — Manual reconciliation review | **COMPLETE** | 6 attestations affirmed (audit metadata) |
| 3 — Approve issuance | **COMPLETE** | `issuanceApprovedAt` `2026-06-29T17:35:34.798Z` |
| 4 — Cooling-off elapsed | **COMPLETE** | `coolingOffUntil` `2026-06-29T17:50:34.798Z`; Issue after |
| 5 — Issue invoice | **COMPLETE** | `ISSUED`; `issuedAt` `2026-06-29T17:57:37.216Z`; HWM ratchet prefix `6a182789` |
| 6 — Evidence handoff | **COMPLETE** | Closure report §3 updated; criterion **10** **PASS** |

---

## Abort / rollback

| Situation | Action |
|-----------|--------|
| Wrong invoice selected | **Cancel pending** with reason (audit: `trader.invoice.issuance_cancelled`); restart from Step 1 |
| Reconciliation fails mid-review | Do not approve; escalate period |
| Issue attempted before cooling-off | Wait; do not bypass |
| Issuance succeeds but data wrong | Do **not** edit invoice destructively; follow Billing & HWM dispute/remediation policies |

---

## References

- [ADR-0008 — Manual billing gate](../adr/0008-manual-billing-gate.md)
- [ADR-0011 — Single Operator Governance Model](../adr/0011-single-operator-governance-model.md)
- [AI-TRADER Billing & HWM §7](../ai-trader/AI-TRADER-BILLING-HWM.md)
- Admin surface: `app/(trader)/admin/billing/page.tsx` · API: `POST /api/trader/admin/invoices/{invoiceId}/commands`
- Post-MVP UX backlog: [DEE-340-OPERATOR-CONSOLE-UX-BACKLOG.md](DEE-340-OPERATOR-CONSOLE-UX-BACKLOG.md)
