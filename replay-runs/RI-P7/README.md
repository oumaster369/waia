# RI-P7 Replay Vault Index

**Engineering recovery entry point (canonical):** [`AI-TRADER-ENGINEERING-STATUS.md`](AI-TRADER-ENGINEERING-STATUS.md) — **only** document for current phase and where to resume  
**Historical plans:** [`HISTORICAL-PLANS-INDEX.md`](HISTORICAL-PLANS-INDEX.md)

---

## Vault layout

| Directory | Milestone | Status |
|-----------|-----------|--------|
| `closed-trade-attribution-forensics-org0/` | M0 forensics | Complete |
| `dataset-regime-coverage-audit-org0/` | M0.5 audit | Complete |
| `trade-lifecycle-model-org0/` | M1 lifecycle | Complete |
| `m2-deposit-portfolio-risk-sizing-org0/` | M2 portfolio/risk | Complete |
| `m3-position-guardian-org0/` | M3 guardian | Complete |
| `m4-dynamic-sl-tp-org0/` | M4 dynamic SL/TP | Complete |
| `m5-exit-intelligence-org0/` | M5 exit intelligence | Complete |
| `m6-pattern-catalog-org0/` | M6 pattern catalog | Complete |
| `m7-event-attribution-org0/` | M7 event attribution | Complete |
| `m8-strategy-discovery-org0/` | M8 strategy discovery | Complete |
| **`m9-v2-research-campaign-org0/`** | **M9 v2 campaign** | **Closed — `M9_BLOCKED_BY_ACCOUNTING_DEFECT`** |
| `m0-pr-readiness/` · `m0-completion-audit/` | M0 governance | Historical |
| `dee-371-artifact-check/` · `gate0-*` · operator smoke logs | Pre-M0 / gate0 | Archived reference |

---

## Document classes

Evidence taxonomy: [`docs/waia-governance/EVIDENCE-POLICY.md`](../../docs/waia-governance/EVIDENCE-POLICY.md).

| Class | RI-P7 examples |
|-------|----------------|
| **accepted experimental** | `m9-research-evidence.json`, `m9-production-knowledge-asset.json`, milestone `VALIDATION.md` |
| **rejected** | `m9-research-rejection-record.json`, governed-evolution MVP on reject |
| **diagnostic** | `m9-campaign-operator-diagnostics.json` |
| **forensic** | `M9-FORENSIC-REPORT.md`, `closed-trade-attribution-forensics-org0/` |
| **archived** | `m9-v2-research-campaign-org0/archive/**` |
| **operator forensics stash** | `_operator-forensics-stash/` (gitignored — promote before commit) |

- **Recovery entry point:** `AI-TRADER-ENGINEERING-STATUS.md` · Active milestone evidence: `VALIDATION.md`, closure reports
- **Historical:** `AI-TRADER-COMPLETION-PLAN-SNAPSHOT-BEFORE-M0.md`, `M*-PLAN.md`, `WORKING_TREE_INVENTORY_BEFORE_M0.md`
- **Archived (local):** `*.log` files — gitignored; chronology in markdown execution records

---

## Active roadmap

Only `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` is active for implementation after M9 closure.
