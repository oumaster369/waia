# ADR-0016 — Settlement Exception Reconciliation

Status: Proposed (pending ratification)
Date: 2026-06-26
Baseline: AT-E12 S3-C (settlement exception reconciliation — human decision layer)

## Context

AT-E12 S3-B ([settlement engine](../../lib/trader/settlement/settlement-service.ts), migration `0052_trader_settlement.sql`) settles CONFIRMED payments deterministically. One `trader_settlements` row is written per payment, enforced unique on `payment_id`. When automatic matching cannot proceed safely — missing attribution, no candidate invoice, multiple candidate invoices, amount mismatch, unsupported asset/network, or an invoice that is not in `ISSUED` state — the engine writes an immutable settlement row with `outcome = EXCEPTION` and performs **no** invoice or account mutation. This is intentional: ambiguity must never corrupt financial state.

The consequence is that an EXCEPTION payment drops out of the settlement backlog and is never retried automatically. Without a human decision layer, exceptions accumulate silently. AT-E12 S3-C introduces **Settlement Exception Reconciliation** — the operator workflow that resolves every settlement that could not be applied automatically. The complete architecture is in `.cursor/plans/s3-c_exception_reconciliation_1291b7dd.plan.md` (concluded APPROVED FOR BUILD, prerequisite: accept this ADR).

This ADR fixes the durable architectural decisions for that layer. It implements nothing: no code, schema, migration, API, or behavior change accompanies it.

## Decision

### 1. EXCEPTION settlement rows are immutable

`trader_settlements.outcome = EXCEPTION` is the permanent, append-only record of the **automatic** settlement attempt. It must never be rewritten to `APPLIED`, `RESOLVED`, or any other value, and its digest-bearing fields must never be edited.

**Why:** The row is auditable evidence that the machine declined a specific payment for a specific reason. Mutating it would destroy that evidence, break the `record_content_digest` chain, and make S3-B settlement non-replayable. Immutability is a financial-correctness invariant, not a convenience.

### 2. Reconciliation is a separate bounded aggregate

Human resolution lives in a new Trader-owned aggregate, distinct from the settlement row:

```
Settlement (EXCEPTION, immutable)
  → Reconciliation Case (projection)
    → Reconciliation Events (append-only, digest-chained)
      → optional Settlement Application(s) (only on manual apply)
```

The case and its event ledger are the source of truth for workflow state; settlement applications remain the only path that produces financial effect (invoice → PAID, account reactivation).

**Why:** Separating the human-decision aggregate from the machine-verdict record keeps each immutable in its own right, isolates the reconciliation lifecycle from settlement semantics, and mirrors the event-sourced, digest-verified pattern already used for settlements and payment events. It also gives a clean seam for future AI/policy assistance to read cases and evidence without touching settlement history.

### 3. Effective outcome is derived, never stored on the settlement

Operational and reporting state is **computed** from the settlement plus its applications plus its reconciliation case/events — for example:

```
effectiveOutcome(settlement) =
  FINANCIALLY_APPLIED        if an application exists for the settlement
  CLOSED_WITHOUT_APPLICATION if the case resolved to a non-applying terminal type
  PENDING_RECONCILIATION     otherwise (EXCEPTION with an open/unresolved case)
```

The original `outcome = EXCEPTION` is never overwritten to express the derived state.

**Why:** Derivation preserves both truths simultaneously: "the machine declined because X" and "a human later applied / waived / closed it." A single mutable status column would collapse those two facts and lose the audit trail.

### 4. ADR-0011 governs every terminal reconciliation action

Manual apply, waive, close (no action / duplicate), external escalation, and the future refund / credit / reversal decisions are sensitive administrative actions governed by the [Single Operator Governance Model (ADR-0011)](0011-single-operator-governance-model.md):

- immutable, append-only audit (who / when / why / before / after / evidence);
- explicit multi-step confirmation (intent → review of computed impact → confirm);
- a cooling-off period during which a proposed resolution is visible and cancellable;
- reversibility / compensation where possible, with irreversible effects (e.g. settled refunds) pushed as late as possible behind cooling-off + confirmation.

**Why:** A manual apply marks an invoice PAID and can reactivate an account; a waiver forgoes revenue; a refund moves funds. These carry the same risk class as invoice issuance/waiver, which ADR-0011 already governs. Applying the same control model keeps governance consistent and dispute-grade.

### 5. MVP action subset is fixed

S3-C MVP **may implement**:

- open a reconciliation case automatically when a settlement EXCEPTION is recorded;
- claim / release a case;
- propose a resolution;
- cancel a proposal during cooling-off;
- execute a resolution after cooling-off;
- manual apply to exactly **one** invoice;
- close with no action;
- close as duplicate;
- waive;
- external escalation as **audit-only** (no external side effect).

S3-C MVP **explicitly defers**:

- partial settlements;
- `PARTIALLY_PAID` invoice status;
- multi-invoice / split allocation;
- credit ledger entries;
- refund execution (depends on S7/S8 custody/disbursement);
- fraud workflow;
- reversal/compensation workflow;
- AI / policy-engine auto-resolution.

**Why:** The MVP subset covers every exception reason producible by S3-B with reversible or no-effect actions, while deferring the items that require new invoice states, outbound custody, or compensation machinery. The deferred set is recorded so later slices extend — not redesign — this aggregate.

### 6. Bounded contexts: reconciliation is Trader-owned; the payment stack stays frozen

WAIA Core payments, the Payment Address Registry, the Payment Watcher, and the S3-B Settlement Engine remain **frozen** by this ADR. Settlement Exception Reconciliation is owned entirely by the AI-TRADER module and consumes the frozen settlement output; it adds no FK from Core into module tables and changes no Core or watcher behavior.

**Why:** The inbound payment rail (ADR-0013/0014/0015) and the deterministic settlement engine are correctness-critical and already ratified. Keeping reconciliation a downstream, module-owned consumer protects those invariants and preserves module isolation (WAIA Core Architecture §3).

### 7. Financial invariants preserved

The reconciliation layer must preserve, without exception:

- **append-only history** — no destructive edits to settlements, applications, invoices, or payments;
- **exactly-once payment settlement** — one settlement per payment; at most one applying resolution per settlement;
- **deterministic replay** — case state folds from its append-only event ledger;
- **auditability** — every decision recorded with full who/when/why/before/after/evidence;
- **tenant isolation** — all reconciliation records carry `organization_id` and are org-scoped (app-layer primary, targeted RLS per ADR-0007);
- **no destructive edits** — corrections are expressed as new compensating records, never as edits or deletes.

**Why:** These are the same invariants that protect the rest of the payment and billing stack. Reconciliation introduces human action into a financial system; the invariants are what keep manual action safe and forever attributable.

## Consequences

+ The durable WHY for S3-C is fixed and reviewable before any code is written; the build slice inherits zero open architectural decisions.
+ Immutable EXCEPTION rows + a separate event-sourced case aggregate keep both the machine verdict and the human verdict auditable and replayable.
+ Derived effective outcome avoids a mutable status column that would collapse audit history.
+ Reusing ADR-0011 keeps governance consistent with invoice issuance/waiver.
+ Freezing the payment/watcher/settlement contexts protects ratified correctness invariants.
− Two representations of state (immutable settlement row + derived effective outcome) require readers to compute effective state rather than read a single column; this is intentional and documented.
− The deferred action set (refund/credit/reversal/partial) means some real-world cases are MVP-closed or escalated rather than fully resolved until later slices.
Neutral: future AI/policy-assisted reconciliation and the deferred actions extend this aggregate without altering settlement history.

## Links

- [.cursor/plans/s3-c_exception_reconciliation_1291b7dd.plan.md](../../.cursor/plans/s3-c_exception_reconciliation_1291b7dd.plan.md) — S3-C architecture plan (APPROVED FOR BUILD)
- [ADR-0011 — Single Operator Governance Model](0011-single-operator-governance-model.md)
- [ADR-0008 — Manual billing gate](0008-manual-billing-gate.md)
- [ADR-0013 — Payment Address Registry](0013-payment-address-registry-wallet-anchored-event-sourced-soft-bound.md)
- [ADR-0014 — Payment Watcher execution model](0014-payment-watcher-execution-model-read-only-observer.md)
- [ADR-0015 — Tron settlement / finality / RPC trust doctrine](0015-tron-settlement-finality-rpc-trust-doctrine.md)
- [ADR-0007 — Targeted RLS strategy](0007-targeted-rls-strategy.md)
- [AI-TRADER Billing & HWM](../ai-trader/AI-TRADER-BILLING-HWM.md) §8–9, §11
- [AI-TRADER Security](../ai-trader/AI-TRADER-SECURITY.md)
- [DEE-216 — AT-E12 parent](https://linear.app/deepsense/issue/DEE-216)
- [DEE-323 — ADR-0016 ratification docs slice](https://linear.app/deepsense/issue/DEE-323)
