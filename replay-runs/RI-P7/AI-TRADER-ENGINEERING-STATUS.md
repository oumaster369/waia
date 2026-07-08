# AI-TRADER — Canonical Engineering Recovery Entry Point

> **Document role:** The **single** canonical entry point for engineering recovery after M9 closure.  
> Do not create parallel status, checkpoint, or recovery documents — update **this file** only.

**Last synchronized:** 2026-07-08 (DEE-398 Canonical Pre-Repeat-M9 Remediation PR2 — Task B + Task C, content-bound authorization + dataset idempotency; in progress)  
**Integration branch:** `dev` @ `108a632`  
**Approved active roadmap:** `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` (Cursor plan — local; not committed per `.gitignore`)

---

## Current engineering phase

**Phase I — Post-M9 Recovery (Canonical Pre-Repeat-M9 Remediation Strategy — PR2 in progress)**

The Final Pre-M9 Architectural Readiness Audit (run after Pre-M9 Provider Fusion Remediation
merged) found three Critical findings gating Repeat M9 v0.1.7: Task A (deterministic replay
substrate), Task B (operator blind authorization was label-bound, not content-bound), Task C
(dataset creation was an unconditional insert with no idempotency/preflight). **PR1 (DEE-397,
Task A, ADR-0021) is merged.** **PR2 (DEE-398, Task B + Task C, ADR-0022) is in progress** —
this is the final remediation PR before the final architectural re-audit. Gate A remains
**open** until Architect re-audit PASS and Repeat M9 v0.1.7 completes under the validated
20/20 provider stack with truthful replay fusion.

---

## Where engineering resumes

| Field | Value |
|-------|--------|
| **Resume at** | **PR2 (DEE-398) review/merge** → **final Architect re-audit** → then **Repeat M9 v0.1.7** (operator authorization) |
| **Linear** | DEE-392 **Done** · DEE-393 **Done** · DEE-394 **Done** · DEE-397 **Done** · DEE-398 **In Review** |
| **Branch** | `dev` @ `108a632`; PR2 on `dee-398-m9-authorization-dataset-idempotency` |
| **Do not start** | Repeat M9 (until re-audit PASS), PR3, PR4, M10, or live trading until Gate A passes |

**Immediate next action for implementers:** None — await Architect re-audit. Operators may run sidecar capture and validation per runbook when authorized.

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
| Full Market Data Source Integration | Merged (#381 / DEE-393) |
| Pre-M9 Provider Fusion Remediation | Merged (#382 / DEE-394) |
| Final Pre-M9 Architectural Readiness Audit | 3 Critical findings (Task A/B/C) — remediation PR1 + PR2 |
| Remediation PR1 (Task A — deterministic replay) | Merged (DEE-397, ADR-0021) |
| Remediation PR2 (Task B + C — content-bound auth + dataset idempotency) | In progress (DEE-398, ADR-0022) |
| Gate A | **Open** — closes after final re-audit PASS + Repeat M9 v0.1.7 success |

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
Full Market Data Source Integration (merged #381)
  ↓
Pre-M9 Provider Fusion Remediation (merged #382)
  ↓
Final Pre-M9 Architectural Readiness Audit (3 Critical findings: Task A/B/C)
  ↓
Remediation PR1 — Task A: deterministic replay (merged, DEE-397, ADR-0021)
  ↓
Remediation PR2 — Task B + C: content-bound auth + dataset idempotency (DEE-398, ADR-0022)  ← CURRENT
  ↓
Final architectural re-audit
  ↓
Repeat M9 v0.1.7  (NOT STARTED — BLOCKED)
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
| **6** | **Full Market Data Source Integration** | ✅ Merged (#381 / DEE-393) |
| **7** | **Pre-M9 Provider Fusion Remediation** | ✅ Merged (#382 / DEE-394) |
| **8** | **Final Pre-M9 Architectural Readiness Audit** | ✅ Complete — 3 Critical findings (Task A/B/C) |
| **9** | **Remediation PR1 — Task A (deterministic replay)** | ✅ Merged (DEE-397, ADR-0021) |
| **10** | **Remediation PR2 — Task B + C (content-bound auth + dataset idempotency)** | **In progress** (DEE-398, ADR-0022) |
| **11** | **Final architectural re-audit** | **PENDING** — after PR2 merges |
| **12** | **Repeat M9 v0.1.7** | **NOT STARTED — BLOCKED** until re-audit PASS + operator authorization |
| **13** | **Gate A** verification | After Repeat M9 success |
| **14** | **PR3 — Market Context + MSV Depth** | **BLOCKED** until Gate A |
| **15** | **PR4 — Market Memory + Knowledge Loop** | **BLOCKED** until Gate A |
| **16** | **M10 Paper Soak** | **BLOCKED** until PR1–PR4 + Gate A + Gate B |
| **17** | **First HTX Live Account** | After all human governance gates |

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
| Full Market Data Source Integration | DEE-393 | #381 | 20/20 providers + fused context v2 |
| Pre-M9 Provider Fusion Remediation | DEE-394 | #382 | Sidecar v2 + truthful replay fusion + artifacts |
| Remediation PR1 (Task A) | DEE-397 | — | Deterministic research replay clock & state isolation (ADR-0021) |
| Remediation PR2 (Task B + C) | DEE-398 | — | Content-bound operator authorization + idempotent dataset lifecycle (ADR-0022) |

---

## Document architecture (avoid duplicates)

| Document | Role | Recovery entry? |
|----------|------|-----------------|
| **This file** | Canonical recovery + current phase + resume point | **Yes — only this** |
| `GATE-A-VALIDATION.md` | Gate A checklist | No |
| `AI-TRADER-DATA-PROVIDERS.md` | Binding provider spec | No |
| `AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md` | **Canonical operator provisioning** | No |
| `DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md` | DEE-392 phase gate record | No |
| `DEE-393-FULL-MARKET-DATA-INTEGRATION-RUNBOOK.md` | DEE-393 phase gate record | No |
| `M9-PROVIDER-FUSION-REMEDIATION-GATE.md` | DEE-394 phase gate record | No |
| `M9-ENGINEERING-CLOSURE.md` | M9 milestone closure evidence | No — points here |
| `M9-OPERATOR-RUNBOOK.md` | Operator execution procedures | No |
