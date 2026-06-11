# ADR-0011 — Single Operator Governance Model (replaces dual-control)

Status: Accepted
Date: 2026-06-11
Baseline: v1.2

## Context

Earlier baseline documents required **dual-control** (two independent human approvers) for sensitive administrative actions: enabling live trading and waiving/cancelling invoices. The Red Team review correctly identified that dual-control is not realistic for a one-founder organization — a control that cannot be staffed is governance theater. It must be replaced with a control model that a single operator can actually satisfy while still protecting against error and providing accountability.

## Decision

Replace dual-control everywhere with a **Single Operator Governance Model** for sensitive administrative actions (live-trading enablement, strategy promotion per ADR-0010, invoice issuance/waiver/cancellation, kill-switch overrides). Its required elements:

1. **Immutable audit trail.** Every sensitive action writes a tamper-evident, append-only audit entry (actor, action, target, organization, reason, before/after where applicable). No update or delete by anyone.
2. **Cooling-off period.** Sensitive actions take effect only after a defined cooling-off delay, during which the action is visible and can be cancelled. The delay exists specifically to catch single-operator error.
3. **Explicit confirmation workflow.** The action requires a deliberate, multi-step confirmation (intent → review of computed impact → typed/explicit confirm), never a single click.
4. **Mandatory logging.** The confirmation, the cooling-off start/end, and the effective moment are all logged to the audit stream.
5. **Reversibility where possible.** Actions are designed to be reversible (e.g., demote strategy to paper, disable live, cancel a draft) before irreversible effects occur. Irreversible effects (e.g., a settled crypto payment) are pushed as late as possible and guarded by the cooling-off + confirmation.

This model assumes a single accountable human. It does **not** require two independent operators. If the organization later adds independent operators, dual-control may be layered on top, but it is never a precondition for MVP.

## Consequences

+ A control the founder can actually perform, replacing an unsatisfiable one.
+ Error protection comes from cooling-off + reversibility + immutability rather than a second human.
+ Tamper-evident audit raises the bar for dispute-grade evidence.
− Single-operator means no independent human check; cooling-off and reversibility are load-bearing and must be implemented faithfully.
Neutral: no product scope change; purely a governance-control substitution.

## Links

- [AI-TRADER Security](../ai-trader/AI-TRADER-SECURITY.md)
- [AI-TRADER Billing & HWM](../ai-trader/AI-TRADER-BILLING-HWM.md)
- [ADR-0010 Strategy Validation Gate](0010-strategy-validation-gate.md)
- [ADR-0008 Manual billing gate](0008-manual-billing-gate.md)
