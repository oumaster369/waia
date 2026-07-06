# Gate A — PR2 Lifecycle Readiness Input

> **Status:** PR2 implementation complete on branch `dee-389-spot-lifecycle-hardening` (DEE-389).  
> **Gate A does not close at PR2 merge.** Gate A closes only after **PR2.5 (Market Intelligence Integration)** and a successful **Repeat M9 v0.1.7** under the complete production MI stack.

---

## PR1 + PR2 checklist

| Item | PR | Module / test | Status |
|------|-----|---------------|--------|
| Canonical symbol inventory walk | PR1 | `lib/trader/paper/derive-canonical-inventory.ts` | ✅ merged (#375) |
| Guardian batch cap to inventory | PR1 | `evaluate-position-guardian.ts` | ✅ merged |
| Risk sell reject on oversell | PR1 | `capital-limits-evaluator.ts` | ✅ merged |
| Unified pairing scope (FIFO + accountKey) | PR2 | `lib/trader/lifecycle/pairing-scope.ts` | ✅ PR2 |
| `EXIT_PARTIAL` / `REDUCE_LONG` + inventory-capped partial | PR2 | `compute-exit-quantity.ts`, guardian types | ✅ PR2 |
| M5 reason qty fields on guardian records | PR2 | `guardian-reason-record.types.ts` | ✅ PR2 |
| Dust remainder synthetic close | PR2 | `dust-lot-closure.ts` | ✅ PR2 |
| Forced-flat per `strategySignalId` scope | PR2 | `research-backtest-runner.ts` | ✅ PR2 |
| Open-qty parity assertion wired | PR2 | `lifecycle-fill-walk-parity.ts`, backtest + paper cycle | ✅ PR2 |
| Unified campaign failure sealing (all paths) | PR2 | `finalize-research-campaign-outcome.ts` | ✅ PR2 |
| Operator diagnostics on success/reject/crash | PR2 | `m9-v2-research-campaign.ts` | ✅ PR2 |

---

## Regression coverage (PR2)

| Test | Purpose |
|------|---------|
| `tests/unit/trader-lifecycle-open-qty-parity.test.ts` | Parity pass/fail + inventory-capped partial qty |
| `tests/unit/trader-m9-oversell-regression.test.ts` | `EXIT_PARTIAL` + `GUARDIAN_INVENTORY_CAPPED_PARTIAL` |
| `tests/unit/trader-campaign-outcome-failure-sealing.test.ts` | Unified sealer — success + governed reject |
| `tests/unit/trader-campaign-crash-failure-sealing.test.ts` | Crash path diagnostics (PR1 baseline extended) |
| `tests/fixtures/trader/m9-v0.1.6-partial-inventory-mismatch.json` | M9-class mismatch golden |
| `tests/fixtures/trader/multi-lot-partial-exit-fifo.json` | Multi-lot FIFO partial reference |

---

## Remaining Gate A prerequisites

1. **Merge PR2** to `dev` (DEE-389).
2. **PR2.5 — Market Intelligence Integration** (foundational MI layer — not merely API wiring).
3. **Repeat M9 v0.1.7** with fresh operator authorization, guardian exits ON, under complete production MI stack.
4. **Gate A verification** after successful Repeat M9.

**Blocked until Gate A:** PR3 (Market Context + MSV Depth), PR4 (Market Memory + Knowledge Loop), M10 paper soak, first HTX live account.

---

## Repeat M9 v0.1.7 preflight notes

- Bump strategy version (e.g. `0.1.7`) — fresh candidate slot.
- Regenerate operator campaign + blind authorization digests on Execution Server host.
- Enable guardian exits (`--enable-guardian-exits=1`).
- Require PR2.5 production MI stack before campaign run.
- Vault must contain **either** success manifest **or** sealed failure bundle **plus** `m9-campaign-operator-diagnostics.json` on every exit.

---

## Engineering resume point after PR2

After PR2 merge, resume at **PR2.5 — Market Intelligence Integration**, not Repeat M9.

See `replay-runs/RI-P7/AI-TRADER-ENGINEERING-STATUS.md` for canonical sequence.
