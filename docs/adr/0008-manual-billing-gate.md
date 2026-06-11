# ADR-0008 — Manual billing gate for performance fees

Status: Accepted
Date: 2026-06-11

## Context

The performance fee (30% of net new profit above the high-water mark) depends on correctly attributing client deposits and withdrawals so clients are not charged on added capital. The master spec itself admits deposit/withdrawal detection may be "unreliable." Charging real clients off an HWM whose inputs are not provably reliable produces disputable — potentially fraudulent-looking — invoices.

## Decision

Until deposit/withdrawal attribution is **provably reliable**, live fee issuance is **gated by mandatory manual reconciliation**:

1. The billing engine computes a complete **draft** invoice with full line-item math (starting/ending equity, net deposits, net withdrawals, profit, previous HWM, fee rate, fee).
2. A human reviewer **must verify all of the following before approving issuance**:
   - **deposits** for the period are correctly identified and attributed;
   - **withdrawals** for the period are correctly identified and attributed;
   - **balance snapshots** (period start and period end) are present and correct;
   - **reconciliation status** is clean (orders/fills/positions reconciled, no unresolved mismatches);
   - **exchange synchronization integrity** — the account's exchange data is fully synced for the period with no gaps.
3. Only after the reviewer confirms every item above does the invoice transition `DRAFT → ISSUED` and the HWM update. The sign-off (reviewer identity, timestamp, and verified items) is recorded in the audit stream.

This is a hard control, not optional. If **any** verification item fails, issuance is withheld and the period is escalated. Automation may replace the gate only after attribution reliability is demonstrated and signed off.

The manual gate is one part of the broader **billing governance** defined in the Billing & HWM document (valuation-source, unrealized-PnL, dispute-handling, overcharge-remediation, and refund/credit policies). Sensitive billing actions — invoice issuance, waiver, and cancellation — are authorized under the **Single Operator Governance Model** ([ADR-0011](0011-single-operator-governance-model.md)): immutable audit, cooling-off, explicit confirmation, with corrections made by append-only entries rather than destructive edits.

## Consequences

+ No client is billed on unverified numbers; disputes are prevented at the source.
+ Every issuance has a recorded human sign-off in the audit stream.
− Billing is not fully automated in MVP; throughput is bounded by reviewer capacity (acceptable at MVP scale).
Neutral: the fee formula and invoice lifecycle are unchanged; only the issuance trigger is gated.

## Links

- [AI-TRADER Billing & HWM](../ai-trader/AI-TRADER-BILLING-HWM.md)
- [AI-TRADER Master Spec v2](../ai-trader/AI-TRADER-MASTER-SPEC-v2.md)
- [ADR-0011 Single Operator Governance Model](0011-single-operator-governance-model.md)
