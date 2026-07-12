---
docId: HTR-WP02-POST-M9-FORENSIC
title: "AI-TRADER — Post-M9 Forensic and Status Truth-Up"
module: ai-trader
status: canon
owner: Architect
workPackage: HTR-WP02
linearIssue: DEE-415
relatedCanon:
  - docs/plans/dee-415-ai-trader-historical-test-readiness.md
  - docs/product-specs/ai-trader-historical-test-readiness-completion.md
  - docs/gaps/ai-trader-historical-test-readiness-gap-registry.md
evidenceClass: forensic-reconstruction
lastReviewed: 2026-07-12
version: 0.1.0
---

# AI-TRADER — Post-M9 Forensic and Status Truth-Up

## Purpose

This document is the **HTR-WP02 forensic and status truth-up record** for the AI-TRADER Historical-Test Readiness program (Linear **DEE-415**). It reconstructs the M9 accounting-defect timeline from **existing evidence only** (no campaign rerun), distinguishes product/accounting failure from infrastructure disconnect, records program supersession of the intelligence_evolution Cursor plan, reconciles engineering-status drift, and prepares (but does not apply) gap-closure evidence for **HTR-GAP-030** and **HTR-GAP-034**.

Authority: subordinate to the [Completion Specification](../product-specs/ai-trader-historical-test-readiness-completion.md) and [canonical integration plan](../plans/dee-415-ai-trader-historical-test-readiness.md). Forward engineering execution proceeds through HTR work packages on branch `dee-415-ai-trader-historical-test-readiness`, not through reopening the superseded intelligence_evolution roadmap as program authority.

## Evidence classification

| Label | Meaning |
|-------|---------|
| **Proven fact** | Directly supported by a cited artifact, merge commit, or structured record in-repo |
| **Inference** | Reasonable conclusion from multiple proven facts; not independently re-executed |
| **Unknown** | Not established by available evidence; requires later work package or operator action |
| **Deferred defect (mapped to WP)** | Runtime/product gap documented here; fix owned by a later HTR work package |

## M9 accounting-defect forensic

**Proven fact:** The M9 v2 operator campaign did **not** complete successfully. Official blocker: **`M9_BLOCKED_BY_ACCOUNTING_DEFECT`**.

| Event | Evidence | Classification |
|-------|----------|----------------|
| M9 build merged | PR **#371** / DEE-384 @ merge commit `87e5fb8` | Proven fact |
| Operator package merged | PR **#372** / DEE-385 @ merge commit `a9c416a` | Proven fact |
| Campaign executed, no success bundle | `M9-CAMPAIGN-EXECUTION-RECORD.md`, `M9-PR-READINESS.md` | Proven fact |
| Final attempt strategy `0.1.6` failed | `M9-CAMPAIGN-EXECUTION-RECORD.md` | Proven fact |
| Root cause isolated to SPOT inventory / position accounting | `M9-FORENSIC-REPORT.md`, `M9-ENGINEERING-CLOSURE.md` | Proven fact |

**Proven fact — failure signature:** `PaperPnLReconciliationError: sell quantity <fillQty> exceeds open quantity <openQty>` from `lib/trader/paper/derive-paper-pnl.ts` → `applySellFill()` when sell quantity exceeds the avg-cost PnL ledger's tracked open quantity.

**Proven fact — architectural conclusion (M9 forensic):** SPOT position state was derived in multiple places (PnL avg-cost ledger, lifecycle lots, strategy eval, backtest mock ledger) without a single canonical position ledger. Under multi-fill, partial-close, and guardian-exit paths these views diverged. M9 exposed divergence at Org-0 historical replay scale.

**Inference:** Subsequent PR1 (#375 / DEE-388) and PR2 (DEE-389) addressed portions of inventory/lifecycle hardening, but **full historical-test accounting parity** remains a deferred runtime concern — mapped to **HTR-WP18** (inventory & accounting parity) and **HTR-WP19** (M9-class regression closure).

**Unknown:** Whether current `dev` @ `f23c51e` (activation baseline) would pass a Repeat M9 rerun without further HTR work — **no rerun performed in WP02**.

## Repeat M9 infrastructure disconnect

**Proven fact:** Repeat M9 v0.1.7 attempt `0.1.7+mi-repeat-20260709` failed with **`CAMPAIGN_INFRA_DISCONNECT`**, distinct from the accounting defect.

| Field | Value | Source |
|-------|-------|--------|
| failureCode | `CAMPAIGN_INFRA_DISCONNECT` | `m9-research-rejection-record.json` |
| failureMessage | `write CONNECTION_CLOSED aws-1-eu-central-1.pooler.supabase.com:5432` | `m9-research-rejection-record.json` |
| strategyVersion | `0.1.7+mi-repeat-20260709` | `m9-research-rejection-record.json` |
| rejectedAt | `2026-07-09T17:34:48.032Z` | `m9-research-rejection-record.json` |
| blindConsumed | `false` | `m9-research-rejection-record.json` |

**Proven fact:** `M9-OPERATOR-RUNBOOK.md` classifies `CAMPAIGN_INFRA_DISCONNECT` as a transient Postgres/network failure — **not** a strategy or accounting defect.

**Proven fact:** `lib/trader/research/finalize-research-campaign-outcome.ts` and `tests/unit/trader-campaign-outcome-db-resilience.test.ts` implement/classify infra-disconnect campaign outcomes.

**Deferred defect (mapped to WP):** DB-disconnect resilience during long campaigns → **HTR-WP05** (checkpoint/resume + DB-disconnect resilience) and **HTR-WP22** (resilience + performance qualification).

## Deferred runtime defects → owning work packages

| Defect / gap | Owner WP | Evidence basis |
|--------------|----------|----------------|
| Canonical SPOT inventory / avg-cost PnL ledger parity | HTR-WP18, HTR-WP19 | `M9-FORENSIC-REPORT.md`; HTR-GAP entries for accounting |
| Historical execution-simulation realism | HTR-WP17 | Master spec / gap registry |
| Campaign crash-recovery / partial evidence sealing | HTR-WP04, HTR-WP22 | HTR-GAP-026 |
| DB-disconnect during Repeat M9 | HTR-WP05, HTR-WP22 | `m9-research-rejection-record.json` |
| Market Memory + Knowledge Loop (former PR4) | HTR-WP15, HTR-WP21 | D-13 supersession mapping |

## Engineering-status truth-up

**Proven fact:** Before HTR-WP02, `replay-runs/RI-P7/AI-TRADER-ENGINEERING-STATUS.md` (last synchronized 2026-07-08) contained stale/overstated claims:

- **Approved active roadmap** pointed to `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` — superseded as program authority by D-13 / HTR DEE-415.
- **Integration branch** cited `dev` @ `108a632` with DEE-398 "In progress" as the live resume point — superseded by the HTR integration branch and work-package ledger.
- **Gate A** (AI-TRADER sense) used without disambiguation from governance Agent-Charter Gate A.

**WP02 corrections (this work package):** Engineering-status updated to record HTR supersession, preserve Phase I historical facts under a dated historical section, rename active **M9 Accounting Gate** (formerly "Gate A") prose, and state that forward resume authority is the HTR canonical integration plan — not a Repeat M9 operator authorization under the old roadmap alone.

Historical M9 merge lineage, PR tables, and M9 evidence pointers are **preserved** — not deleted.

## Program supersession

**Proven fact:** Decision **D-13** (`APPROVE-HTR-D13: htr-supersedes`) records that the Historical-Test Readiness program supersedes `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` as **program authority**.

| intelligence_evolution item | HTR mapping | Status |
|----------------------------|-------------|--------|
| PR1–PR2.6, DEE-392–394, DEE-397 remediation | Partially merged on `dev`; forensic evidence preserved | Historical — merged portions remain in Git |
| Repeat M9 / Gate A verification | Superseded as **program gate** by HTR readiness gates CG-A..CG-H + M9 Accounting Gate rename | Not active program authority |
| PR3 Market Context / MSV depth | HTR-WP15 (MKB read-model) + related WPs | Pending in HTR |
| PR4 Market Memory + Knowledge Loop | **HTR-WP15** + **HTR-WP21** | Pending in HTR |

**Proven fact:** The intelligence_evolution plan file is **retained unmodified** as historical/evidence source (gitignored `.cursor/plans/`).

## Gate-A naming reconciliation

**Proven fact:** "Gate A" in the AI-TRADER/M9-accounting sense collided with the unrelated governance **Agent Charter Gate A → D** model (`docs/waia-governance/**`).

**WP02 action:** Active AI-TRADER-sense prose renamed to **`M9 Accounting Gate`** (with "(formerly 'Gate A')" on first use per modified file) in the enumerated file list only:

- `replay-runs/RI-P7/AI-TRADER-ENGINEERING-STATUS.md`
- `docs/ai-trader/AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md`
- `docs/ai-trader/AI-TRADER-DATA-PROVIDERS.md`
- `docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`
- `docs/ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md`

**Untouched:** governance Gate A→D corpus; HTR canon already describing the rename; `GATE-A-VALIDATION.md` filename; ADR-0010 dated reconciliation line.

HTR readiness gates remain **CG-A..CG-H** (distinct from M9 Accounting Gate).

## DEE-412 assessment

**Proven fact — stale-state discrepancy:**

| Source | State |
|--------|-------|
| Linear **DEE-412** | **In Progress** ("DEV OS: evidence policy and M9 resilience (vNext Slice E)") |
| GitHub **PR #398** | **CLOSED** — not merged (`mergedAt=null`) |

**Inference:** DEE-412 Linear status does not reflect PR #398 closure. The issue appears stale relative to Git evidence.

**Human recommendation (read-only — no Linear mutation in WP02):** After Human review of this forensic record, either (a) reopen/rebase PR #398 and move DEE-412 to In Review, or (b) cancel DEE-412 with documented rationale, or (c) create a new scoped issue if vNext Slice E scope is still required — **separate Human-authorized action**. DEE-415 remains **In Progress**.

## Gap-closure evidence (for Opus Phase B)

Evidence packages prepared here; **not applied** to the Gap Registry in Composer Phase A.

### HTR-GAP-030 — Status/vault drift

| Criterion | Evidence |
|-----------|----------|
| Stale engineering-status roadmap pointer | Superseded: intelligence_evolution → HTR canonical plan (`docs/plans/dee-415-ai-trader-historical-test-readiness.md`) — see §Engineering-status truth-up |
| Stale branch/phase claims | Updated: HTR integration branch + activation baseline documented; Phase I preserved as historical |
| Vault/evidence pointers | M9 evidence paths verified present under `replay-runs/RI-P7/m9-v2-research-campaign-org0/` |
| Forensic canon registered | This document + README HTR block link |

**Opus Phase B may close HTR-GAP-030** if the above reconciliation is accepted.

### HTR-GAP-034 — Gate-A naming collision + duplicate authority

| Criterion | Evidence |
|-----------|----------|
| Gate-A rename in active AI-TRADER prose | Enumerated files updated — see §Gate-A naming reconciliation |
| Duplicate program authority | D-13 supersession recorded; intelligence_evolution retained as historical only |
| HTR gates distinct | CG-A..CG-H unchanged; M9 Accounting Gate disambiguated from governance Gate A |

**Opus Phase B may close HTR-GAP-034** if the above reconciliation is accepted.

## Evidence citations

| Claim | Citation |
|-------|----------|
| M9 accounting blocker | `replay-runs/RI-P7/m9-v2-research-campaign-org0/M9-FORENSIC-REPORT.md` |
| M9 closure verdict | `replay-runs/RI-P7/m9-v2-research-campaign-org0/M9-ENGINEERING-CLOSURE.md` |
| Campaign timeline | `replay-runs/RI-P7/m9-v2-research-campaign-org0/M9-CAMPAIGN-EXECUTION-RECORD.md` |
| Infra disconnect record | `replay-runs/RI-P7/m9-v2-research-campaign-org0/m9-research-rejection-record.json` |
| Infra disconnect runbook | `replay-runs/RI-P7/m9-v2-research-campaign-org0/M9-OPERATOR-RUNBOOK.md` |
| M9 build merge | PR #371 @ `87e5fb8` |
| M9 operator merge | PR #372 @ `a9c416a` |
| Activation baseline | PR #400 @ `f23c51e` |
| DEE-412 / PR #398 stale state | Linear DEE-412 In Progress; PR #398 CLOSED unmerged |
| HTR supersession | `docs/product-specs/ai-trader-historical-test-readiness-completion.md` (D-13); `docs/plans/dee-415-ai-trader-historical-test-readiness.md` |
| Gap ownership | `docs/gaps/ai-trader-historical-test-readiness-gap-registry.md` (HTR-GAP-030, HTR-GAP-034) |
| WP02 WORK COMMIT branch | `dee-415-ai-trader-historical-test-readiness` (predecessor CLOSEOUT `60310d5`) |
