# M3 Position Guardian — Scope & Implementation Audit

**Auditor:** Independent implementation audit + pre-PR remediation pass  
**Date:** 2026-07-04  
**Branch:** `dee-378-m3-position-guardian`  
**Plan:** `replay-runs/RI-P7/m3-position-guardian-org0/M3-PLAN.md`  
**Base:** `dev` @ `0b26d13` (M2 merged #364)

---

## Verdict

| Item | Result |
|------|--------|
| **Overall (architecture)** | **PASS** |
| **Pre-PR remediation** | **COMPLETE** |
| **MERGE-PATH** | **READY_FOR_COMMIT** (manifest commit + Linear sync + human PR authorization) |

---

## Independent audit summary

Initial independent audit (2026-07-04) found architecture aligned with plan. Non-blocking gaps:

- Orchestration-path lifecycle proof missing in paper-cycle integration tests
- End-to-end `TRADE_CLOSED` not asserted after guardian sell
- Shared SQLite DB leaked state between M3 integration cases
- No `maxHoldBars` / `STOP_TRADING` orchestration integration case

All four items remediated in `tests/unit/trader-paper-cycle-runner.test.ts` without production code changes.

---

## Phase compliance

### Phase 1 — Pure guardian model

| Deliverable | Status |
|-------------|--------|
| `lib/trader/guardian/*` (8 files + index) | ✅ |
| Pure `decideGuardianAction` + `evaluatePositionGuardian` | ✅ |
| Exit mapper + order keys | ✅ |
| Guardian unit tests | ✅ |

### Phase 2 — Lifecycle recorder

| Deliverable | Status |
|-------------|--------|
| `recordGuardianEvaluated` | ✅ |
| `recordGuardianExitIntent` | ✅ |
| Recorder unit test | ✅ |

### Phase 3 — `runPaperCycleOnce` integration

| Deliverable | Status |
|-------------|--------|
| Guardian phase after evaluation, before strategy loop | ✅ |
| No-signal early return fix when open lots exist | ✅ |
| Opt-in via `input.guardian` | ✅ |
| Paper cycle M3 integration tests | ✅ — 3 cases with lifecycle + isolation |
| M0/M1/M2 regression green | ✅ |

### Phase 4 — Artifacts

| Deliverable | Status |
|-------------|--------|
| `M3-PLAN.md` | ✅ |
| `DESIGN.md` | ✅ |
| `VALIDATION.md` | ✅ |
| `M3-SCOPE-AUDIT.md` | ✅ (this file) |
| `M3-PR-READINESS.md` | ✅ |
| Governance preflight | ✅ (see PR readiness doc) |

---

## Scope boundaries respected

| Boundary | Status | Evidence |
|----------|--------|----------|
| No ATR / SL / TP / trailing | ✅ | Decision model + SCOPE audit |
| No `lib/trader/exits/*` | ✅ | No files touched |
| No `reason-records/*` DB table | ✅ | Payload-only lifecycle events |
| No strategy file edits | ✅ | git diff scope |
| No backtest/research runner wiring | ✅ | Files untouched |
| No `build-worker-deps.ts` changes | ✅ | Forbidden per plan |
| No `paper-loop-worker.ts` changes | ✅ | Forbidden per plan |
| No sealed artifact mutation | ✅ | New RI-P7 dir only |
| No billing/HWM changes | ✅ | Out of diff |
| Mock/paper execution only in tests | ✅ | No live connector paths |

---

## Architectural invariants verified

| Invariant | Status |
|-----------|--------|
| Guardian reads M1 lots as position truth | ✅ |
| Sell uses lot `openingStrategySignalId` for M1 pairing | ✅ |
| Side effects only in `runPaperCycleOnce` orchestration | ✅ |
| Deterministic ExitIntent replay | ✅ |
| M4 composition hook present, unused | ✅ `GuardianRuleProvider` types only |

---

## Known deferrals (documented, non-blocking)

| Item | Notes |
|------|-------|
| Worker / paper-loop wiring | Later milestone after primitive proven |
| Linear DEE-378 groom via MCP | Blocked at groom time; branch naming convention used |
| Portfolio-derived lot inference | Explicitly out of scope — lots only |
| M4 rule providers | Types exported; no providers shipped |

---

## Pre-PR remediation (audit-driven)

| Audit finding | Remediation | Status |
|---------------|-------------|--------|
| Missing GUARDIAN_* lifecycle proof in orchestration path | Assert phases on `POSITION_LOT` in close-only + maxHoldBars tests | ✅ |
| Missing exit-intent-before-submit proof | Spy call-order on `recordGuardianExitIntent` vs `submitOrder` | ✅ |
| Missing TRADE_CLOSED after guardian sell | Assert `TRADE_CLOSED` event, trade `CLOSED`, no open lots | ✅ |
| Shared DB leakage between M3 cases | Fresh SQLite harness per test (`resetWaiaSqliteSingleton`) | ✅ |
| No maxHoldBars orchestration test | Added maxHoldBars integration case | ✅ |

---

## Governance

| Check | Result |
|-------|--------|
| Branch naming | ✅ `dee-378-m3-position-guardian` |
| Risk tier | T2 (execution-path module, no migration) |
| Manifest committed | ⏳ Pending human commit |
| Linear DEE-378 synced | ⏳ Pending human verification |
| PR open | ⏳ Human authorization required |
