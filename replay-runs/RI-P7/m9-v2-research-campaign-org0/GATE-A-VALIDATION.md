# Gate A — PR2 Lifecycle Readiness Input

> **Status:** PR1–PR2.6 + Data Provider Readiness + Full Market Data Source Integration + Pre-M9 Provider Fusion Remediation merged on `dev`. Gate A does **not** close at doc sync.  
> **Gate A closes only after:** Architect re-audit PASS → operator validation → successful **Repeat M9 v0.1.7** under the complete 20/20 production MI stack with truthful replay fusion.

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

**Repeat M9 v0.1.7 is BLOCKED** until Architect re-audit PASS and fresh operator authorization:

1. ✅ **Data Provider Readiness** (DEE-392 / #379) — operator/env, secrets conventions, gateway config, validation script, runbook, canonical provisioning guide
2. ✅ **Full Market Data Source Integration** (DEE-393 / #381) — 20/20 providers, fused context v2, `order_book_snapshot`, integration validation script — **Merged**
3. ✅ **Pre-M9 Provider Fusion Remediation** (DEE-394 / #382) — Sidecar v2, truthful replay fusion, fusion/decision-trace artifacts — **Merged**
4. **Architect re-audit** — pending
5. **Operator end-to-end validation** — `pnpm validate:market-data-integration` + sidecar capture after re-audit PASS

| Phase | Repeat M9 blocked? |
|-------|-------------------|
| Data Provider Readiness incomplete | **BLOCKED** |
| Full Market Data Source Integration incomplete | **BLOCKED** |
| Pre-M9 Provider Fusion Remediation incomplete | **BLOCKED** |
| DEE-393 + DEE-394 merged + Architect re-audit PASS | Repeat M9 may be operator-authorized |

**Operator provisioning (canonical):** [`docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`](../../../docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md)  
**Phase records:** [`docs/ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md`](../../../docs/ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md) · [`docs/ops/DEE-393-FULL-MARKET-DATA-INTEGRATION-RUNBOOK.md`](../../../docs/ops/DEE-393-FULL-MARKET-DATA-INTEGRATION-RUNBOOK.md) · [`docs/ai-trader/M9-PROVIDER-FUSION-REMEDIATION-GATE.md`](../../../docs/ai-trader/M9-PROVIDER-FUSION-REMEDIATION-GATE.md)

---

## Remaining Gate A prerequisites

1. ✅ **PR1–PR2.6** merged to `dev`.
2. ✅ **Data Provider Readiness** — complete (DEE-392 / #379 @ `9c1df25`).
3. ✅ **Full Market Data Source Integration** — complete (DEE-393 / #381 @ `fe503b8`).
4. ✅ **Pre-M9 Provider Fusion Remediation** — complete (DEE-394 / #382 @ `7d1401d`).
5. **Architect re-audit** — pending.
6. **Repeat M9 v0.1.7** with fresh operator authorization, guardian exits ON, under validated 20/20 provider stack — **NOT STARTED**.
7. **Gate A verification** after successful Repeat M9.

**Blocked until Gate A:** PR3 (Market Context + MSV Depth), PR4 (Market Memory + Knowledge Loop), M10 paper soak, first HTX live account.

---

## Repeat M9 v0.1.7 preflight notes

- Bump strategy version (e.g. `0.1.7`) — fresh candidate slot.
- Regenerate operator campaign + blind authorization digests on Execution Server host.
- Enable guardian exits (`--enable-guardian-exits=1`).
- Require validated provider stack (post provider phases + DEE-394 remediation).
- Capture sidecar v2 (`pnpm trader:m9:capture-sidecar`) and pin digest in blind authorization scope.
- Vault must contain **either** success manifest **or** sealed failure bundle **plus** `m9-campaign-operator-diagnostics.json` on every exit.

---

## Engineering resume point

**Current:** Architect re-audit pending (DEE-393 + DEE-394 merged)  
**Completed:** Data Provider Readiness (DEE-392) · Full Market Data Source Integration (DEE-393) · Pre-M9 Provider Fusion Remediation (DEE-394)  
**Not yet:** Repeat M9 (**NOT STARTED** — BLOCKED until Architect re-audit PASS + operator authorization)

See `replay-runs/RI-P7/AI-TRADER-ENGINEERING-STATUS.md` for canonical sequence.
