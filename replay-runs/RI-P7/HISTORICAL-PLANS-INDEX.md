# Historical Engineering Plans — Annotated Index

**Purpose:** Preserve execution history without rewriting prior plans.  
**Active roadmap (only):** `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md`  
**Canonical recovery entry point:** `AI-TRADER-ENGINEERING-STATUS.md`

> Implementation after M9 closure continues **only** through the approved Intelligence Evolution roadmap.

---

## Completion plan snapshot (pre-M0)

| Plan | Path | Final status | Stopped / outcome | Concluding PR |
|------|------|--------------|-------------------|---------------|
| AI-Trader Completion Plan | `AI-TRADER-COMPLETION-PLAN-SNAPSHOT-BEFORE-M0.md` | **Superseded** | M0–M8 executed via DEE-372–383; M9 blocked by accounting defect; M10+ deferred | M9 closure: **#373** |

**Why stopped:** M9 operator campaign hit `M9_BLOCKED_BY_ACCOUNTING_DEFECT`. Completion-plan todo statuses in the snapshot body are **frozen at copy time** — see footer annotation in that file.

---

## RI-P7 milestone plans (in-repo)

| Milestone | Plan / design | Execution | Outcome | PR / Linear |
|-----------|---------------|-----------|---------|-------------|
| M0 | `closed-trade-attribution-forensics-org0/` | Complete | Closed-trade semantics v2 forensics | DEE-372 |
| M0.5 | `dataset-regime-coverage-audit-org0/` | Complete | Regime audit | — |
| M1 | `trade-lifecycle-model-org0/` | Complete | Lifecycle model | DEE-376 / #365 |
| M2 | `m2-deposit-portfolio-risk-sizing-org0/M2-PLAN.md` | Complete | Portfolio/risk sizing | DEE-377 / #366 |
| M3 | `m3-position-guardian-org0/M3-PLAN.md` | Complete | Position guardian | DEE-378 / #365 |
| M4 | `m4-dynamic-sl-tp-org0/M4-PLAN.md` | Complete | Dynamic SL/TP | DEE-379 / #366 |
| M5 | `m5-exit-intelligence-org0/` | Complete | Exit intelligence | DEE-380 / #367 |
| M6 | `m6-pattern-catalog-org0/` | Complete | Pattern catalog | DEE-381 / #368 |
| M7 | `m7-event-attribution-org0/` | Complete | Event attribution | DEE-382 / #369 |
| M8 | `m8-strategy-discovery-org0/` | Complete | Strategy discovery | DEE-383 / #370 |
| **M9** | `m9-v2-research-campaign-org0/` | **Closed (blocked)** | **`M9_BLOCKED_BY_ACCOUNTING_DEFECT`** | DEE-384–386 / **#371–373** |
| M10 | — | **Not started** | Blocked until PR1–PR4 + Gate A + Gate B | — |
| M11 | — | **Not started** | Blocked | — |

---

## Cursor plans (local; `.cursor/plans/` — gitignored)

| Plan file | Role | Status |
|-----------|------|--------|
| **`ai-trader_intelligence_evolution_48358215.plan.md`** | **ACTIVE canonical roadmap** | Approved — governs PR1+ |
| `m9_v2_research_campaign_bb3822c5.plan.md` | M9 build phase | Historical — merged PR #371 |
| `ri_p7_execution_d2ccef43.plan.md` | RI-P7 tooling | Historical — superseded by completion-plan track |
| `strategy_evolution_loop_48bd31eb.plan.md` | SEE loop canon | Historical reference |
| `strategy_evolution_engine_v1_81d1f7e1.plan.md` | SEE engine phase A | Historical — DEE-371 |
| Other `*.plan.md` | Various WAIA / payment / IMP-U1 | Unrelated to post-M9 AI-TRADER track |

---

## Post-M9 engineering (canonical sequence)

See **`AI-TRADER-ENGINEERING-STATUS.md`**. Critical gate:

**Repeat M9 v0.1.7** is mandatory **immediately after PR2** and **before PR3**. PR3/PR4 remain **BLOCKED until Gate A**.
