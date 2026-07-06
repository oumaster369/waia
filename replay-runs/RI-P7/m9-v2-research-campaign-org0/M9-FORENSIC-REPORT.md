# M9 Forensic Report — Canonical SPOT Inventory / Position Accounting Defect

**Status:** CLOSED (root cause identified; fix deferred to PR1 + PR2)  
**Blocker code:** `M9_BLOCKED_BY_ACCOUNTING_DEFECT`  
**Date:** 2026-07-06  
**Build:** DEE-384 / PR #371 @ `87e5fb8`  
**Operator campaign:** DEE-385 / PR #372 @ `a9c416a`

---

## Executive summary

The M9 operator campaign executed the full RI orchestrator path (dataset seal → validation → walk-forward → blind holdout) with v2 metrics, guardian exits, and lifecycle recording enabled. The campaign **did not complete** because `derivePaperPnL` raised `PaperPnLReconciliationError` when a SELL fill quantity exceeded the PnL ledger's tracked open quantity.

This is **not** a strategy, Research Pipeline, Feature Engine, Chief Decision Engine, or Pattern Discovery failure. It is isolated to **canonical SPOT inventory / position accounting** — the gap between execution fills, lifecycle lots, and the avg-cost PnL ledger.

---

## Canonical failure signature

```
PaperPnLReconciliationError: sell quantity <fillQty> exceeds open quantity <openQty>
```

Emitted from `lib/trader/paper/derive-paper-pnl.ts` → `applySellFill()` when `compareDecimal(fillQty, ledger.openQty) > 0`.

| Attempt | Strategy version | Dataset | Error |
|---------|------------------|---------|-------|
| 1 (after schema fix) | `0.1.1` | default | `sell quantity 0.01 exceeds open quantity 0` |
| 0.1.2 | `0.1.2` | suffix | lifecycle: `no open lot for sell fill` (earlier segment) |
| 0.1.3 | `0.1.3` | suffix | Postgres `CONNECTION_CLOSED` (infra; not accounting) |
| 0.1.4 | `0.1.4` | suffix | `sell quantity 0.00856178 exceeds open quantity 0` |
| 0.1.5 | `0.1.5` | suffix | `sell quantity 0.0085634 exceeds open quantity 0` |
| **Final (0.1.6)** | **`0.1.6`** | **`m9-v2-research-campaign-org0-0.1.6`** | **`sell quantity 0.00866055 exceeds open quantity 0.00731991`** |

Full tee log (local, gitignored): `m9-campaign-run.log`.

---

## Root cause (precise)

### Symptom

The PnL derivation ledger (`walkFillsForPnL` / `SymbolLedger.openQty`) does not maintain a **single canonical open quantity** consistent with:

1. All prior BUY fills that should increase inventory, and  
2. All prior SELL fills (including partial closes, guardian exits, and strategy sells) that should decrease inventory, and  
3. The lifecycle recorder's lot model (`lifecycle-recorder.ts`).

When a SELL fill arrives, `applySellFill` correctly **rejects** sells that exceed `ledger.openQty`. During M9, sells were emitted and filled by the mock execution path while the ledger reported **zero or insufficient** open quantity — meaning inventory was **lost, never credited, or double-decremented** upstream of PnL derivation.

### Observed failure modes in campaign log

| Class | Message | Interpretation |
|-------|---------|----------------|
| **Orphan sell** | `sell quantity X exceeds open quantity 0` | SELL fill processed with no credited BUY inventory in PnL ledger |
| **Partial mismatch** | `sell quantity 0.00866055 exceeds open quantity 0.00731991` | Ledger under-counts open qty vs fill qty (partial close / rounding / desync) |
| **Lifecycle desync** | `[trader/lifecycle/recorder] no open lot for sell fill <uuid>` | Lifecycle lots and fill stream disagree (same accounting layer) |

### What this is NOT

- **Not** CDE blocking strategy (CDE emitted `CDE_QUALITY_ALLOW_TRADING`; MR signals fired).
- **Not** regime gate failure (campaign progressed past early gates into bar replay).
- **Not** guardian logic failure (guardian exits participated; failure is at PnL reconciliation).
- **Not** RI orchestrator wiring (orchestrator invoked backtest runner; failure is in paper PnL layer).
- **Not** promotion FSM (promotion was never attempted; `promotionAttempted: false` by design).

### Architectural conclusion

SPOT position state is **derived ad hoc** in multiple places (PnL avg-cost ledger, lifecycle lots, strategy eval, backtest isolation mock ledger) without a **single canonical position ledger** as source of truth. Under multi-fill, partial-close, and guardian-exit paths, these views diverge. M9 exposed the divergence at scale on Org-0 historical replay.

---

## Evidence preserved

| Artifact | Location | Notes |
|----------|----------|-------|
| Operator authorization | `operator-authorization-record.json` | Final attempt: `0.1.6` |
| Campaign tee log | `m9-campaign-run.log` | Gitignored (`*.log`); preserved on Execution Server |
| Execution record | `M9-CAMPAIGN-EXECUTION-RECORD.md` | Human-readable retry chronology |
| Validation | `VALIDATION.md` | Final proven / not-proven matrix |
| Closure | `M9-ENGINEERING-CLOSURE.md` | Engineering closure verdict |

No sealed success-bundle JSON was produced (`m9-campaign-manifest.json`, PKA, metrics export absent — campaign never completed).

---

## Approved remediation (do not modify)

Per approved evolution roadmap (not started in this closure):

1. **PR1 — Canonical Position Ledger** — single source of truth for SPOT open quantity / cost basis consumed by PnL, lifecycle, and research backtest paths.  
2. **PR2 — Spot Lifecycle Hardening** — align fill → lot → close semantics; eliminate orphan sells and partial desync.  
3. **Repeat M9** — operator-authorized campaign after PR1 + PR2 merge.

---

## Cross-links

- M0 forensics (prior closed-trade semantics): `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/FINDINGS.md`
- PnL error type: `lib/trader/paper/paper-pnl.errors.ts`
- PnL derivation: `lib/trader/paper/derive-paper-pnl.ts`
- Lifecycle recorder: `lib/trader/lifecycle/lifecycle-recorder.ts`
