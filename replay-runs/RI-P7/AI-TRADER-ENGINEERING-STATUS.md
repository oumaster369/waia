# AI-TRADER — Canonical Engineering Recovery Entry Point

> **Document role:** The **single** canonical entry point for engineering recovery after M9 closure.  
> Do not create parallel status, checkpoint, or recovery documents — update **this file** only.

**Last synchronized:** 2026-07-07 (post Data Provider Readiness / DEE-392 merge #379)  
**Integration branch:** `dev` @ `9c1df25`  
**Approved active roadmap:** `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` (Cursor plan — local; not committed per `.gitignore`)

---

## Current engineering phase

**Phase I — Post-M9 Recovery (Full Market Data Source Integration — next)**

PR1 through **Data Provider Readiness** are merged. **Full Market Data Source Integration** is the active engineering phase. Gate A remains **open** until that phase and Repeat M9 v0.1.7 complete.

---

## Where engineering resumes

| Field | Value |
|-------|--------|
| **Resume at** | **Full Market Data Source Integration** (groom fresh `DEE-<NEW_ID>`) |
| **Linear** | DEE-392 **Done** → next provider integration issue |
| **Branch** | New `dee-<NN>-*` from `dev` @ `9c1df25` |
| **Do not start** | Repeat M9, PR3, PR4, M10, or live trading until Gate A passes |

**Immediate next action for implementers:** Groom Full Market Data Source Integration → end-to-end provider validation → then Repeat M9 v0.1.7.

**Operator provisioning (canonical):** [`docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`](../../docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md)

---

## Current state (summary)

| Item | Value |
|------|--------|
| Milestone closed | M9 v2 research campaign |
| Official result | **`M9_BLOCKED_BY_ACCOUNTING_DEFECT`** |
| Root cause | SPOT inventory / position accounting (`PaperPnLReconciliationError`) |
| PR1 | Merged — canonical inventory + guardian caps (#375) |
| PR2 | Merged — lifecycle hardening + failure sealing (DEE-389) |
| PR2.5 | Merged — Market Intelligence Integration (#377) |
| PR2.6 | Merged — Pre-M9 Market Understanding Bridge (#378 / DEE-391) |
| Data Provider Readiness | Merged — operator/env gate (#379 / DEE-392) |
| Gate A | **Open** — closes after Full Market Data Source Integration + Repeat M9 v0.1.7 |

M9 milestone evidence: `m9-v2-research-campaign-org0/` — **not** the recovery entry point.  
Gate A input: `m9-v2-research-campaign-org0/GATE-A-VALIDATION.md`.

---

## Canonical next engineering sequence

Implementation proceeds **only** through the approved Intelligence Evolution roadmap.  
**PR3 and PR4 do not start until Gate A passes.**

```text
PR2.6 (merged)
  ↓
Data Provider Readiness (merged #379)
  ↓
Full Market Data Source Integration  ← CURRENT
  ↓
Repeat M9 v0.1.7  (BLOCKED until integration phase passes)
  ↓
Gate A
  ↓
PR3 → PR4 → M10
```

| Step | Task | Status |
|------|------|--------|
| **1** | **PR1 — Canonical Position Ledger** | ✅ Merged (#375) |
| **2** | **PR2 — Spot Lifecycle Hardening + Failure Sealing** | ✅ Merged (DEE-389) |
| **3** | **PR2.5 — Market Intelligence Integration** | ✅ Merged (#377) |
| **4** | **PR2.6 — Pre-M9 Market Understanding Bridge** | ✅ Merged (#378 / DEE-391) |
| **5** | **Data Provider Readiness** | ✅ Merged (#379 / DEE-392) |
| **6** | **Full Market Data Source Integration** | **NEXT** |
| **7** | **Repeat M9 v0.1.7** | **BLOCKED** until step 6 passes |
| **8** | **Gate A** verification | After Repeat M9 success |
| **9** | **PR3 — Market Context + MSV Depth** | **BLOCKED** until Gate A |
| **10** | **PR4 — Market Memory + Knowledge Loop** | **BLOCKED** until Gate A |
| **11** | **M10 Paper Soak** | **BLOCKED** until PR1–PR4 + Gate A + Gate B |
| **12** | **First HTX Live Account** | After all human governance gates |

---

## M9 merge lineage (`dev`)

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

---

## Document architecture (avoid duplicates)

| Document | Role | Recovery entry? |
|----------|------|-----------------|
| **This file** | Canonical recovery + current phase + resume point | **Yes — only this** |
| `GATE-A-VALIDATION.md` | Gate A checklist | No |
| `AI-TRADER-DATA-PROVIDERS.md` | Binding provider spec | No |
| `AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md` | **Canonical operator provisioning** | No |
| `DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md` | DEE-392 phase gate record | No |
| `M9-ENGINEERING-CLOSURE.md` | M9 milestone closure evidence | No — points here |
| `M9-OPERATOR-RUNBOOK.md` | Operator execution procedures | No |
