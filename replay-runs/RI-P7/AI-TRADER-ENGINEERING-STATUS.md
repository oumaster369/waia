# AI-TRADER — Canonical Engineering Recovery Entry Point

> **Document role:** The **single** canonical entry point for engineering recovery after M9 closure.  
> Do not create parallel status, checkpoint, or recovery documents — update **this file** only.

**Last synchronized:** 2026-07-12 (HTR-WP02 post-M9 forensic + status truth-up — DEE-415)  
**HTR integration branch:** `dee-415-ai-trader-historical-test-readiness` @ `60310d5` (WP01 CLOSEOUT; activation baseline `dev` @ `f23c51e` / PR #400)  
**Approved active program authority:** [`docs/plans/dee-415-ai-trader-historical-test-readiness.md`](../../docs/plans/dee-415-ai-trader-historical-test-readiness.md) (DEE-415 Historical-Test Readiness — 23 work packages)  
**Forensic truth-up canon:** [`docs/ai-trader/AI-TRADER-POST-M9-FORENSIC-AND-STATUS-TRUTH-UP.md`](../../docs/ai-trader/AI-TRADER-POST-M9-FORENSIC-AND-STATUS-TRUTH-UP.md)

> **Supersession (2026-07-12):** The intelligence_evolution Cursor plan (`.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md`) is **superseded as program authority** by D-13 / HTR DEE-415. It is retained as historical/evidence source only. Forward engineering resume is through HTR work packages — not by treating the old PR2→Repeat M9 sequence as the active program gate.

---

## Current engineering phase

**Phase II — Historical-Test Readiness (HTR DEE-415)**

M9 v2 closed with official result **`M9_BLOCKED_BY_ACCOUNTING_DEFECT`** (SPOT inventory / position accounting). Repeat M9 v0.1.7 additionally recorded **`CAMPAIGN_INFRA_DISCONNECT`** (Postgres pooler disconnect — infrastructure, not accounting). The **M9 Accounting Gate** (formerly "Gate A" in AI-TRADER prose) remains **open** until HTR work packages deliver accounting parity, resilience, and the full historical-test readiness gate groups (CG-A..CG-H).

**Active work package:** HTR-WP02 complete (forensic + truth-up); forward runtime remediation is owned by later HTR work packages (see forensic canon).

---

## Where engineering resumes

| Field | Value |
|-------|--------|
| **Resume at** | **HTR program** — canonical integration plan `docs/plans/dee-415-ai-trader-historical-test-readiness.md`; next unblocked work package after WP02 Opus closeout |
| **Linear** | **DEE-415** In Progress (whole program) |
| **Branch** | `dee-415-ai-trader-historical-test-readiness` (one integration boundary; one final PR after HTR-WP23) |
| **Do not start** | Repeat M9 rerun, walk-forward, holdout, paper/live, or Execution Server mutation outside approved HTR work packages |

**Immediate next action for implementers:** Follow the approved HTR child plan for the active work package. M9/Repeat M9 **must not be rerun** as part of status reconciliation — evidence-only forensic (HTR-WP02).

**Operator provisioning (canonical):** [`docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`](../../docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md)

---

## Current state (summary)

| Item | Value |
|------|--------|
| Milestone closed | M9 v2 research campaign |
| Official result | **`M9_BLOCKED_BY_ACCOUNTING_DEFECT`** |
| Repeat M9 v0.1.7 | **`CAMPAIGN_INFRA_DISCONNECT`** (infra — not accounting) |
| Root cause (M9) | SPOT inventory / position accounting (`PaperPnLReconciliationError`) |
| Program authority | HTR DEE-415 (supersedes intelligence_evolution plan) |
| M9 Accounting Gate (formerly "Gate A") | **Open** — closes via HTR readiness program, not a standalone Repeat M9 under old roadmap |

M9 milestone evidence: `m9-v2-research-campaign-org0/` — **not** the recovery entry point.  
M9 Accounting Gate input artifact (filename unchanged): `m9-v2-research-campaign-org0/GATE-A-VALIDATION.md`.

---

## Historical — Phase I Post-M9 Recovery (pre-HTR; preserved facts)

*The following records the intelligence_evolution sequence as it stood before HTR supersession (2026-07-08 sync). It is **historical** — not the active resume authority.*

**Phase I label:** Canonical Pre-Repeat-M9 Remediation Strategy — PR1 merged; PR2 (DEE-398 Task B + C) was in progress at last pre-HTR sync.

| Item | Historical value (2026-07-08) |
|------|-------------------------------|
| Integration branch cited | `dev` @ `108a632` |
| Remediation PR2 | DEE-398 In Review (content-bound auth + dataset idempotency) |
| Resume sequence | PR2 merge → re-audit → Repeat M9 v0.1.7 → M9 Accounting Gate (formerly Gate A) → PR3 → PR4 |

### Historical merge lineage (`dev`)

| Phase | Linear | PR | Notes |
|-------|--------|-----|-------|
| Build | DEE-384 | #371 | M9 v2 campaign CLI |
| Operator package | DEE-385 | #372 | Runbook + authorization |
| Engineering closure | DEE-386 | #373 | M9 blocked verdict |
| PR1 ledger | DEE-388 | #375 | Canonical inventory |
| PR2 lifecycle | DEE-389 | #376 | Spot hardening + sealing |
| PR2.5 MI | DEE-390 | #377 | Provider stack + fusion |
| PR2.6 understanding | DEE-391 | #378 | Market understanding bridge |
| Data Provider Readiness | DEE-392 | #379 | Operator/env + validation |
| Full Market Data Source Integration | DEE-393 | #381 | 20/20 providers + fused context v2 |
| Pre-M9 Provider Fusion Remediation | DEE-394 | #382 | Sidecar v2 + truthful replay fusion |
| Remediation PR1 (Task A) | DEE-397 | — | Deterministic research replay (ADR-0021) |
| Remediation PR2 (Task B + C) | DEE-398 | — | Content-bound auth + idempotent dataset (ADR-0022) |

### Historical canonical sequence (pre-HTR)

```text
PR2.6 (merged) → Data Provider Readiness (#379) → Full Market Data Integration (#381)
  → Pre-M9 Provider Fusion (#382) → Remediation PR1 (DEE-397) → Remediation PR2 (DEE-398)
  → re-audit → Repeat M9 v0.1.7 (BLOCKED / infra disconnect recorded)
  → M9 Accounting Gate (formerly Gate A) → PR3 → PR4 → M10
```

| Step | Task | Historical status |
|------|------|-------------------|
| 1–7 | PR1 through Pre-M9 Provider Fusion | ✅ Merged (see table) |
| 8 | Final Pre-M9 Architectural Readiness Audit | ✅ Complete — 3 Critical findings |
| 9 | Remediation PR1 (Task A) | ✅ Merged (DEE-397) |
| 10 | Remediation PR2 (Task B + C) | In progress at 2026-07-08 sync (DEE-398) |
| 11–12 | Re-audit / Repeat M9 v0.1.7 | Repeat M9: **CAMPAIGN_INFRA_DISCONNECT** on 0.1.7 attempt |
| 13 | M9 Accounting Gate verification | **Not reached** under old sequence |
| 14–17 | PR3 / PR4 / M10 / Live | **Blocked** — now mapped to HTR-WP15/WP21 and later gates |

---

## Document architecture (avoid duplicates)

| Document | Role | Recovery entry? |
|----------|------|-----------------|
| **This file** | Canonical recovery + current phase + resume point | **Yes — only this** |
| `AI-TRADER-POST-M9-FORENSIC-AND-STATUS-TRUTH-UP.md` | HTR-WP02 forensic + supersession + gap evidence | No — cites here |
| `GATE-A-VALIDATION.md` | M9 Accounting Gate checklist (filename historical) | No |
| `AI-TRADER-DATA-PROVIDERS.md` | Binding provider spec | No |
| `AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md` | **Canonical operator provisioning** | No |
| `DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md` | DEE-392 phase gate record | No |
| `M9-ENGINEERING-CLOSURE.md` | M9 milestone closure evidence | No — points here |
| `M9-OPERATOR-RUNBOOK.md` | Operator execution procedures | No |
