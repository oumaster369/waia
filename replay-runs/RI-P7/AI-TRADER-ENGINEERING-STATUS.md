# AI-TRADER — Canonical Engineering Recovery Entry Point

> **Document role:** The **single** canonical entry point for engineering recovery after M9 closure.  
> Do not create parallel status, checkpoint, or recovery documents — update **this file** only.

**Last synchronized:** 2026-07-06 (post PR #373 merge)  
**Integration branch:** `dev` @ `39d17add20f0e23f6617ed4a286bfa73b7fe6683`  
**Approved active roadmap:** `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` (Cursor plan — local; not committed per `.gitignore`)

---

## Current engineering phase

**Phase I — Post-M9 Recovery Entry (PR1)**

M9 Engineering Closure is complete. The repository is in **`READY_FOR_PR1`** state. Implementation resumes **only** through the approved Intelligence Evolution roadmap — not through the historical completion-plan snapshot or superseded Cursor plans.

---

## Where engineering resumes

| Field | Value |
|-------|--------|
| **Resume at** | **PR1 — Canonical Position Ledger** |
| **Linear** | Groom next issue from approved roadmap (not yet filed at sync time) |
| **Branch** | New `dee-<NN>-*` from current `dev` |
| **Do not start** | PR3, PR4, M10, or live trading until Gate A passes |

**Immediate next action for implementers:** Read the approved roadmap → groom PR1 → branch from `dev` → implement Canonical Position Ledger only.

---

## Current state (summary)

| Item | Value |
|------|--------|
| Milestone closed | M9 v2 research campaign |
| Official result | **`M9_BLOCKED_BY_ACCOUNTING_DEFECT`** |
| Root cause | SPOT inventory / position accounting (`PaperPnLReconciliationError`) |
| Architecture verdict | **`READY_FOR_PR1`** |
| Closure PR | #373 (DEE-386) merged `2026-07-06` |

M9 milestone evidence (forensics, validation, operator records): `m9-v2-research-campaign-org0/` — **not** the recovery entry point.

---

## Canonical next engineering sequence

Implementation proceeds **only** through the approved Intelligence Evolution roadmap.  
**PR3 and PR4 do not start until Gate A passes.**

| Step | Task | Status |
|------|------|--------|
| **1** | **PR1 — Canonical Position Ledger** | **NEXT — resume here** |
| **2** | **PR2 — Spot Lifecycle Hardening** | After PR1 |
| **3** | **Repeat M9 v0.1.7** (fresh operator authorization) | **Mandatory stop after PR2** — before Gate A |
| **4** | **Gate A** verification | After Repeat M9 success |
| **5** | **PR3 — Market Context + MSV Depth** | **BLOCKED** until Gate A |
| **6** | **PR4 — Market Memory + Knowledge Loop** | **BLOCKED** until Gate A |
| **7** | **M10 Paper Soak** | **BLOCKED** until PR1–PR4 + Gate A + Gate B |
| **8** | **First HTX Live Account** | After all human governance gates |

---

## M9 merge lineage (`dev`)

| Phase | Linear | PR | SHA |
|-------|--------|-----|-----|
| Build | DEE-384 | #371 | `87e5fb8` |
| Operator package | DEE-385 | #372 | `a9c416a` |
| Engineering closure | DEE-386 | #373 | `39d17ad` |

---

## Document architecture (avoid duplicates)

| Document | Role | Recovery entry? |
|----------|------|-----------------|
| **This file** | Canonical recovery + current phase + resume point | **Yes — only this** |
| `M9-ENGINEERING-CLOSURE.md` | M9 milestone closure evidence | No — points here |
| `AI-TRADER-COMPLETION-PLAN-SNAPSHOT-BEFORE-M0.md` | Historical frozen plan (pre-M0) | No — see `HISTORICAL-PLANS-INDEX.md` |
| `HISTORICAL-PLANS-INDEX.md` | Annotated superseded plans | No |
| `docs/ai-trader/README.md` | Doctrine / program navigation | No — routes here for active work |
| `docs/waia-governance/WAIA-RECOVERY-2026.md` | 2026 workstation recovery snapshot | No — unrelated scope |
| `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` | **Active implementation roadmap** | No — authoritative plan; this file records checkpoint |

---

## Cross-links

- M9 closure evidence: `m9-v2-research-campaign-org0/M9-ENGINEERING-CLOSURE.md`
- Historical plans: `HISTORICAL-PLANS-INDEX.md`
- Vault index: `README.md`
- AI-TRADER docs index: `../../docs/ai-trader/README.md`
