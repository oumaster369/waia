# DEE-337 — P5 Two-Strategy 48h Paper Soak Closure Report

**Linear:** [DEE-337](https://linear.app/deepsense/issue/DEE-337/p5-new-10-48h-paper-soak-2-strategies-closure-report) · **Pipeline:** P5 · **Milestone:** M7 — Paper Trading  
**Audit type:** Operational closure assessment (Post-P5 multi-strategy)  
**Run ID:** DEE-337-p5-two-strategy  
**Host:** _TBD (operator VPS)_  
**Git SHA:** _TBD — must be ≥ `a8509e0` (PR #296)_  
**Assessment date:** 2026-06-27 (evidence path prepared; soak not yet executed)  
**Verdict:** **PENDING — blocked on ≥48h wall-clock soak**

---

## Executive summary

The **evidence path** for NEW-10 is prepared on `dev` (runbook, log analyzer, acceptance gates). The **48-hour two-strategy soak has not been executed** at audit time. DEE-337 **cannot** move to Done until an operator completes the soak per [DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-RUNBOOK.md](./DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-RUNBOOK.md), log analysis passes, and closed-trade proof exists for **both** strategies (or the report documents an honest FAIL with root cause).

Pipeline **P5 remains In Progress**. NEW-11 / DEE-338 (RC promotion) is **out of scope** until this report reaches **Verdict: PASS**.

---

## Evidence inventory (prepared)

| Artifact | Location | Status |
|---|---|---|
| Operator runbook | `docs/ops/DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-RUNBOOK.md` | **Ready** |
| Log analyzer | `lib/trader/paper/analyze-paper-soak-log.ts` | **Ready** |
| CLI | `pnpm trader:paper:soak:analyze` | **Ready** |
| Main soak log | `/root/soak-runs/DEE-337-p5-two-strategy/paper-loop-soak-48h.log` | **Not started** |
| Preflight smoke | `.../smoke.log` | **Not started** |
| Soak DB | `.../.data/paper-soak.db` | **Not started** |

**Expected strategy IDs:** `liquidity_sweep_reversal_v0`, `mean_reversion_v0`

---

## 1. Success criteria — current assessment

| Criterion | Verdict | Evidence |
|---|---|---|
| **48h soak completion** | **PENDING** | No T0/T1 recorded; requires ≥2,880 `cycle_complete` lines at 60s cadence |
| **Both strategies participate** | **PENDING** | Requires `strategy_ids` telemetry union across soak log |
| **critical = 0** | **PENDING** | Requires post-soak `pnpm trader:paper:soak:analyze` PASS |
| **≥1 closed trade per strategy** | **PENDING** | Requires Postgres/SQLite book query over soak window — not inferable from logs alone |
| **Closure report merged** | **PENDING** | This document; update to PASS after soak |

---

## 2. Why the soak cannot be honestly closed yet

1. **Wall-clock constraint:** NEW-10 requires ≥48h unattended runtime. No substitute (CI, fixture replay, or shortened `--min-hours`) satisfies acceptance for production closure.
2. **Closed-trade proof:** Multi-strategy dispatch is validated in CI (`trader-paper-p5-multi-strategy.test.ts`), but live soak must demonstrate round-trip fills under HTX bar polling cadence for **each** strategy.
3. **Operator execution:** Soak runs on a long-lived VPS with systemd — outside agent/CI scope.

---

## 3. Preflight validation (repo / CI)

| Check | Result |
|---|---|
| PR #296 merged to `dev` | **PASS** @ `a8509e0` |
| Multi-strategy integration test | **PASS** (fixture round-trips both strategies) |
| Log analyzer unit tests | **PASS** (`trader-paper-soak-log-analyzer.test.ts`) |
| DEE-334/335/336 Linear Done | **PASS** (PR #296 attached) |

---

## 4. Post-soak update checklist (operator)

When soak completes, replace §1 verdicts and set **Verdict: PASS** only if all hold:

- [ ] `pnpm trader:paper:soak:analyze -- --log=... --min-hours=48` exits 0
- [ ] `grep critical` count = 0 on full log
- [ ] Closed trade count ≥ 1 per strategy in soak window (export or SQL)
- [ ] Fill Host, Git SHA, T0/T1, cycle count in this document
- [ ] Merge updated report on `dee-337-*` PR → `dev`
- [ ] Move **DEE-337 → Done** with PR link

---

## 5. Linear-ready status comment (current)

```markdown
## DEE-337 — P5 Two-Strategy Soak — PENDING

**Status:** Evidence path prepared; **48h soak not yet executed**.

**Prepared on dev:**
- Runbook: docs/ops/DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-RUNBOOK.md
- Analyzer: pnpm trader:paper:soak:analyze
- Closure template: docs/ops/DEE-337-P5-TWO-STRATEGY-PAPER-SOAK-CLOSURE-REPORT.md

**Blocker:** Operator must run ≥48h VPS soak (both strategies, critical=0, closed trades).

**Next:** Execute runbook Phase 0–3 → update closure report to PASS → merge PR.
```

---

## 6. Recommended action

**Do not** close DEE-337 or Pipeline P5 until §4 checklist is complete.

After PASS: proceed to **NEW-11 / DEE-338** (RC `dev→main`) only — not before.

---

*Prepared 2026-06-27. Soak execution pending operator wall-clock run.*
