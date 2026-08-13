# DEE-518 — LD-8 Risk Doctrine Amendment (Kill Fold)

> **Status:** Ratified amendment (Gate-D + DEE-518 WP-CANON)  
> **Parent:** [AI-TRADER Risk Doctrine (LD-8)](../AI-TRADER-RISK-DOCTRINE.md)  
> **Authority:** DEE-516 Human ratification; DEE-518 Human plan approval (2026-08-10)  
> **Implementation plan:** [`docs/plans/dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md`](../../plans/dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md) §1.22

## Kill fold state machine (frozen)

On kill-switch **TRIPPED**, the system MUST execute this fold in order:

1. **Revoke exposure increase** — no new risk-increasing allowances.
2. **Cancel pending entries** — all open entry orders cancelled.
3. **CLOSE_ONLY** — posture restricts to reducing exposure only.
4. **FLATTEN** — continue until flat.
5. **RECONCILE** — reconcile expected vs actual state.
6. **HALT** — terminal fail-closed posture; no emergency trading bypass.

## Invariants

- Kill fold is **immediate** on trip; flatten continues until flat.
- Recovery is **human-gated only** (ADR-0011); no autonomous re-enable.
- Risk remains **economics-blind** and **downward-only** throughout.
- Post-HALT emergency trading is forbidden.

## Exit priority (inside FHV executable policy)

1. Safety/kill exits (this fold)
2. Guardian exits (max-hold, permission, strategy-disallowed, ATR SL/TP/trailing when enabled)
3. Mandatory post-horizon liquidation

## WP-AUTHORITY scope note

DEE-518 enforces this fold and documents FHV-v1 narrow Guardian policy. **Mature Position Reassessment is NOT implemented in DEE-518** — see plan §1.22 `BLOCKING_PRE_HOLDOUT_POSITION_REASSESSMENT_INTEGRATION`.
