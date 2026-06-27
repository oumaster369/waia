# DEE-337 — P5 Two-Strategy Accelerated Historical Replay Validation Closure Report

**Linear:** [DEE-337](https://linear.app/deepsense/issue/DEE-337/p5-new-10-48h-paper-soak-2-strategies-closure-report) · **Pipeline:** P5 · **Milestone:** M7 — Paper Trading  
**Audit type:** Operational closure assessment (Post-P5 multi-strategy)  
**Run ID:** DEE-337-p5-two-strategy  
**Host:** _TBD (validation host)_  
**Git SHA:** _TBD — must be ≥ `a8509e0` (PR #296)_  
**Assessment date:** 2026-06-27 (evidence path prepared; replay validation not yet executed)  
**Verdict:** **PENDING — Accelerated Historical Replay Validation not yet executed**

---

## Executive summary

Accelerated Historical Replay Validation is the canonical engineering validation strategy for AI-TRADER MVP. The **evidence path** for NEW-10 is prepared on `dev` (runbook, log analyzer, closed-trade evidence CLI). The **Accelerated Historical Replay Validation run has not been executed** at audit time. DEE-337 **cannot** move to Done until an operator completes the replay per [DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-RUNBOOK.md](./DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-RUNBOOK.md), log analysis passes, and closed-trade proof exists for **both** strategies (or the report documents an honest FAIL with root cause).

Pipeline **P5 remains In Progress**. NEW-11 / DEE-338 (RC promotion) is **out of scope** until this report reaches **Verdict: PASS**.

---

## Evidence inventory (prepared)

| Artifact | Location | Status |
|---|---|---|
| Operator runbook | `docs/ops/DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-RUNBOOK.md` | **Ready** |
| Log analyzer | `lib/trader/paper/analyze-paper-soak-log.ts` | **Ready** |
| Analyzer CLI | `pnpm trader:paper:soak:analyze` | **Ready** |
| Evidence CLI | `pnpm trader:paper:soak:evidence` (DEE-345 / S0) | **Ready** |
| Main replay log | `/root/replay-runs/DEE-337-p5-two-strategy/paper-loop-replay.log` | **Not started** |
| Preflight smoke | `.../smoke.log` | **Not started** |
| Replay DB | `.../.data/paper-replay.db` | **Not started** |

**Expected strategy IDs:** `liquidity_sweep_reversal_v0`, `mean_reversion_v0`

---

## 1. Success criteria — current assessment

| Criterion | Verdict | Evidence |
|---|---|---|
| **Accelerated Historical Replay Validation completion** | **PENDING** | No replay window recorded; requires meaningful historical span per runbook |
| **Both strategies participate** | **PENDING** | Requires `strategy_ids` telemetry union across replay log |
| **critical = 0** | **PENDING** | Requires post-replay `pnpm trader:paper:soak:analyze` PASS |
| **≥1 closed trade per strategy** | **PENDING** | Requires `pnpm trader:paper:soak:evidence` PASS over replay window |
| **Closure report merged** | **PENDING** | This document; update to PASS after replay validation |

---

## 2. Remaining work before closure

1. **Replay execution:** Run Accelerated Historical Replay Validation over historical market data reproducing realistic conditions for both strategies.
2. **Closed-trade proof:** Multi-strategy dispatch is validated in CI (`trader-paper-p5-multi-strategy.test.ts`); replay validation must demonstrate round-trip fills for **each** strategy.
3. **Evidence artifacts:** Analyzer and evidence CLI outputs must be attached; `--min-hours` is computed over replayed bar timestamps, not wall-clock elapsed time.

---

## 3. Preflight validation (repo / CI)

| Check | Result |
|---|---|
| PR #296 merged to `dev` | **PASS** @ `a8509e0` |
| Multi-strategy integration test | **PASS** (fixture round-trips both strategies) |
| Log analyzer unit tests | **PASS** (`trader-paper-soak-log-analyzer.test.ts`) |
| Closed-trade evidence CLI (DEE-345) | **PASS** (`trader-paper-soak-strategy-evidence.test.ts`) |
| DEE-334/335/336 Linear Done | **PASS** (PR #296 attached) |

---

## 4. Post-replay update checklist (operator)

When replay validation completes, replace §1 verdicts and set **Verdict: PASS** only if all hold:

- [ ] `pnpm trader:paper:soak:analyze -- --log=... --min-hours=48` exits 0
- [ ] `grep critical` count = 0 on full log
- [ ] `pnpm trader:paper:soak:evidence` exits 0 with ≥1 closed trade per strategy
- [ ] Fill Host, Git SHA, replay window (T0/T1), cycle count in this document
- [ ] Merge updated report on `dee-337-*` PR → `dev`
- [ ] Move **DEE-337 → Done** with PR link

---

## 5. Linear-ready status comment (current)

```markdown
## DEE-337 — P5 Two-Strategy Replay Validation — PENDING

**Status:** Evidence path prepared; **Accelerated Historical Replay Validation not yet executed**.

**Prepared on dev:**
- Runbook: docs/ops/DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-RUNBOOK.md
- Analyzer: pnpm trader:paper:soak:analyze
- Evidence CLI: pnpm trader:paper:soak:evidence (DEE-345)
- Closure template: docs/ops/DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-CLOSURE-REPORT.md

**Blocker:** Execute Accelerated Historical Replay Validation (both strategies, critical=0, closed trades).

**Next:** Execute runbook Phase 0–3 → update closure report to PASS → merge PR.
```

---

## 6. Recommended action

**Do not** close DEE-337 or Pipeline P5 until §4 checklist is complete.

After PASS: proceed to **NEW-11 / DEE-338** (RC `dev→main`) only — not before.

---

*Prepared 2026-06-27. Replay validation execution pending.*
