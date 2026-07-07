# Gate A — PR2 Lifecycle Readiness Input

> **Status:** PR1–PR2.6 + Data Provider Readiness merged on `dev`. Full Market Data Source Integration (DEE-393) **complete pending merge**. Gate A does **not** close at integration PR open.  
> **Gate A closes only after:** DEE-393 merge → operator validation → successful **Repeat M9 v0.1.7** under the complete 20/20 production MI stack.

---

## PR1 + PR2 checklist

| Item | PR | Module / test | Status |
|------|-----|---------------|--------|
| Canonical symbol inventory walk | PR1 | `lib/trader/paper/derive-canonical-inventory.ts` | ✅ merged (#375) |
| Guardian batch cap to inventory | PR1 | `evaluate-position-guardian.ts` | ✅ merged |
| Risk sell reject on oversell | PR1 | `capital-limits-evaluator.ts` | ✅ merged |
| Unified pairing scope (FIFO + accountKey) | PR2 | `lib/trader/lifecycle/pairing-scope.ts` | ✅ merged |
| `EXIT_PARTIAL` / `REDUCE_LONG` + inventory-capped partial | PR2 | `compute-exit-quantity.ts`, guardian types | ✅ merged |
| M5 reason qty fields on guardian records | PR2 | `guardian-reason-record.types.ts` | ✅ merged |
| Dust remainder synthetic close | PR2 | `dust-lot-closure.ts` | ✅ merged |
| Forced-flat per `strategySignalId` scope | PR2 | `research-backtest-runner.ts` | ✅ merged |
| Open-qty parity assertion wired | PR2 | `lifecycle-fill-walk-parity.ts`, backtest + paper cycle | ✅ merged |
| Unified campaign failure sealing (all paths) | PR2 | `finalize-research-campaign-outcome.ts` | ✅ merged |
| Operator diagnostics on success/reject/crash | PR2 | `m9-v2-research-campaign.ts` | ✅ merged |

---

## PR2.5 + PR2.6 checklist (MI stack)

| Item | PR | Status |
|------|-----|--------|
| Provider Registry + Gateway + fusion | PR2.5 | ✅ merged (#377) |
| Market Understanding Bridge + M9 export | PR2.6 | ✅ merged (#378) |
| `AI-TRADER-DATA-PROVIDERS.md` binding spec | PR2.5/2.6 | ✅ extended by DEE-392 |
| Canonical provisioning guide | DEE-392 | ✅ [`AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`](../../../docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md) |

---

## Provider-readiness prerequisites (before Repeat M9)

**Repeat M9 v0.1.7 is BLOCKED** until **Full Market Data Source Integration (DEE-393)** merges and passes operator validation:

1. ✅ **Data Provider Readiness** (DEE-392 / #379) — operator/env, secrets conventions, gateway config, validation script, runbook, canonical provisioning guide
2. ⏳ **Full Market Data Source Integration** (DEE-393) — 20/20 providers, fused context v2, `order_book_snapshot`, integration validation script — **complete pending merge**
3. **Operator end-to-end validation** — `pnpm validate:market-data-integration` + gateway tests after merge

| Phase | Repeat M9 blocked? |
|-------|-------------------|
| Data Provider Readiness incomplete | **BLOCKED** |
| Full Market Data Source Integration incomplete / unmerged | **BLOCKED** |
| DEE-393 merged + operator validation pass | Repeat M9 may be operator-authorized |

**Operator provisioning (canonical):** [`docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`](../../../docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md)  
**Phase record:** [`docs/ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md`](../../../docs/ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md) · [`docs/ops/DEE-393-FULL-MARKET-DATA-INTEGRATION-RUNBOOK.md`](../../../docs/ops/DEE-393-FULL-MARKET-DATA-INTEGRATION-RUNBOOK.md)

---

## Remaining Gate A prerequisites

1. ✅ **PR1–PR2.6** merged to `dev`.
2. ✅ **Data Provider Readiness** — complete (DEE-392 / #379 @ `9c1df25`).
3. ⏳ **Full Market Data Source Integration** — DEE-393 **complete pending merge**; operator validation after merge.
4. **Repeat M9 v0.1.7** with fresh operator authorization, guardian exits ON, under validated 20/20 provider stack.
5. **Gate A verification** after successful Repeat M9.

**Blocked until Gate A:** PR3 (Market Context + MSV Depth), PR4 (Market Memory + Knowledge Loop), M10 paper soak, first HTX live account.

---

## Repeat M9 v0.1.7 preflight notes

- Bump strategy version (e.g. `0.1.7`) — fresh candidate slot.
- Regenerate operator campaign + blind authorization digests on Execution Server host.
- Enable guardian exits (`--enable-guardian-exits=1`).
- Require validated provider stack (post both provider phases).
- Vault must contain **either** success manifest **or** sealed failure bundle **plus** `m9-campaign-operator-diagnostics.json` on every exit.

---

## Engineering resume point

**Current:** Full Market Data Source Integration (DEE-393 — complete pending merge)  
**Completed:** Data Provider Readiness (DEE-392 / #379)  
**Not yet:** Repeat M9 (BLOCKED until DEE-393 merge + operator validation)

See `replay-runs/RI-P7/AI-TRADER-ENGINEERING-STATUS.md` for canonical sequence.
