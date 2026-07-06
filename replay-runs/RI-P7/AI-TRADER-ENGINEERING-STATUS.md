# AI-TRADER — Canonical Engineering Recovery Entry Point

> **Document role:** The **single** canonical entry point for engineering recovery after M9 closure.  
> Do not create parallel status, checkpoint, or recovery documents — update **this file** only.

**Last synchronized:** 2026-07-06 (post PR2 / DEE-389 implementation)  
**Integration branch:** `dev` (PR1 merged @ #375; PR2 pending merge)  
**Approved active roadmap:** `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` (Cursor plan — local; not committed per `.gitignore`)

---

## Current engineering phase

**Phase I — Post-M9 Recovery (PR2 complete → PR2.5 next)**

PR1 (Canonical Position Ledger) is merged. PR2 (Spot Lifecycle Hardening + Failure Sealing) is implemented on `dee-389-spot-lifecycle-hardening`. Gate A remains **open** until PR2.5 + Repeat M9 v0.1.7.

---

## Where engineering resumes

| Field | Value |
|-------|--------|
| **Resume at** | **PR2.5 — Market Intelligence Integration** (after PR2 merge) |
| **Linear** | DEE-389 (PR2) → next PR2.5 issue from roadmap |
| **Branch** | New `dee-<NN>-*` from current `dev` after PR2 merge |
| **Do not start** | PR3, PR4, M10, or live trading until Gate A passes |

**Immediate next action for implementers:** Merge PR2 → groom PR2.5 → implement Market Intelligence Integration only.

---

## Current state (summary)

| Item | Value |
|------|--------|
| Milestone closed | M9 v2 research campaign |
| Official result | **`M9_BLOCKED_BY_ACCOUNTING_DEFECT`** |
| Root cause | SPOT inventory / position accounting (`PaperPnLReconciliationError`) |
| PR1 | Merged — canonical inventory + guardian caps (#375) |
| PR2 | Implemented — lifecycle hardening + unified failure sealing (DEE-389) |
| Gate A | **Open** — closes after PR2.5 + Repeat M9 v0.1.7 |

M9 milestone evidence: `m9-v2-research-campaign-org0/` — **not** the recovery entry point.  
PR2 readiness input: `m9-v2-research-campaign-org0/GATE-A-VALIDATION.md`.

---

## Canonical next engineering sequence

Implementation proceeds **only** through the approved Intelligence Evolution roadmap.  
**PR3 and PR4 do not start until Gate A passes.**

| Step | Task | Status |
|------|------|--------|
| **1** | **PR1 — Canonical Position Ledger** | ✅ Merged (#375) |
| **2** | **PR2 — Spot Lifecycle Hardening + Failure Sealing** | ✅ Implemented (DEE-389) — merge pending |
| **3** | **PR2.5 — Market Intelligence Integration** | **NEXT — resume here after PR2 merge** |
| **4** | **Repeat M9 v0.1.7** (fresh operator authorization) | After PR2.5 — mandatory before Gate A |
| **5** | **Gate A** verification | After Repeat M9 success |
| **6** | **PR3 — Market Context + MSV Depth** | **BLOCKED** until Gate A |
| **7** | **PR4 — Market Memory + Knowledge Loop** | **BLOCKED** until Gate A |
| **8** | **M10 Paper Soak** | **BLOCKED** until PR1–PR4 + Gate A + Gate B |
| **9** | **First HTX Live Account** | After all human governance gates |

---

## M9 merge lineage (`dev`)

| Phase | Linear | PR | Notes |
|-------|--------|-----|-------|
| Build | DEE-384 | #371 | M9 v2 campaign CLI |
| Operator package | DEE-385 | #372 | Runbook + authorization |
| Engineering closure | DEE-386 | #373 | M9 blocked verdict |
| PR1 ledger | DEE-388 | #375 | Canonical inventory |
| PR2 lifecycle | DEE-389 | pending | Spot hardening + sealing |

---

## Document architecture (avoid duplicates)

| Document | Role | Recovery entry? |
|----------|------|-----------------|
| **This file** | Canonical recovery + current phase + resume point | **Yes — only this** |
| `GATE-A-VALIDATION.md` | PR2 readiness input toward Gate A | No — checklist only |
| `M9-ENGINEERING-CLOSURE.md` | M9 milestone closure evidence | No — points here |
| `M9-OPERATOR-RUNBOOK.md` | Operator execution procedures | No |
