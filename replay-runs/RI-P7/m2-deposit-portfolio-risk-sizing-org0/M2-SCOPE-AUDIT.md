# M2 Deposit / Portfolio / Risk Sizing — Scope & Implementation Audit

**Auditor:** Independent remediation pass (Composer 2.5)  
**Date:** 2026-07-04  
**Branch:** `dee-377-m2-portfolio-risk-sizing`  
**Plan:** `replay-runs/RI-P7/m2-deposit-portfolio-risk-sizing-org0/M2-PLAN.md`  
**Base:** `dev` @ `f3498e6` (M1 merged #363)

---

## Verdict

| Item | Result |
|------|--------|
| **Overall** | **PASS** |
| **MERGE-PATH** | **READY_FOR_PR** (after manifest commit + governance preflight) |

---

## Phase compliance

### Phase 1 — Pure portfolio model

| Deliverable | Status |
|-------------|--------|
| `lib/trader/portfolio/*` | ✅ |
| StopDistanceProvider + DefaultStopDistanceProvider | ✅ |
| Unit tests (provider, sizing, ledger, adapter) | ✅ — expanded post-audit |

### Phase 2 — Schema + capital enforcement

| Deliverable | Status |
|-------------|--------|
| SQLite `0039` + Postgres `0069` migrations | ✅ |
| No new RLS migration | ✅ |
| Capital evaluator checks + reason codes | ✅ |
| Limits service / repo column mapping | ✅ |
| Tenant isolation for M2 columns | ✅ — added post-audit |

### Phase 3 — Runner integration

| Deliverable | Status |
|-------------|--------|
| Backtest portfolio refresh | ✅ |
| Research v2 seeded portfolio | ✅ |
| Paper cycle sizing + portfolio account sync before submit | ✅ — fixed post-audit |
| Paper loop env config | ✅ |
| Paper cycle integration tests | ✅ — added post-audit |
| M0/M1 regression green | ✅ |

### Phase 4 — Artifacts

| Deliverable | Status |
|-------------|--------|
| `DESIGN.md` | ✅ — legacy path documented |
| `VALIDATION.md` | ✅ — honest coverage matrix |
| `M2-SCOPE-AUDIT.md` | ✅ (this file) |
| `M2-PR-READINESS.md` | ✅ |

---

## Scope boundaries respected

| Boundary | Status |
|----------|--------|
| No strategy file edits | ✅ |
| No Guardian / exits modules | ✅ |
| No sealed M0/M1 artifact mutation | ✅ |
| Stop distance via provider only | ✅ |
| `reservedMarginUsdt === "0"` | ✅ |

---

## Known deferrals (documented, non-blocking)

| Item | Notes |
|------|-------|
| Legacy account-state helper | Buy-only exposure retained for v1/fixture callers |
| Paper loop limits source | Static defaults; org service overrides at runtime |
| M4 final stop providers | `RUN_DEFAULT_PCT` provisional |
| `withProjectedOrderRisk` helper | Exported; capital evaluator computes inline from `stopDistanceUsdt` |

---

## Governance

| Check | Result |
|-------|--------|
| Linear DEE-377 | ✅ In Progress |
| Branch naming | ✅ `dee-377-m2-portfolio-risk-sizing` |
| Risk tier | T2 (migrations + runtime) |
| Uncommitted work | ⚠️ Must commit manifest before PR |
