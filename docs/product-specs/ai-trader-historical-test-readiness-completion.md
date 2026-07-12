---
specId: PCS-AI-TRADER-HISTORICAL-TEST-READINESS
title: "AI-TRADER — Historical-Test Readiness Completion Specification"
module: ai-trader
maturity: draft
owner: Architect
sourceOfTruth:
  - docs/AI-TRADER-PRODUCT-CONSTITUTION.md
  - docs/ai-trader/AI-TRADER-MASTER-SPEC-v2.md
  - docs/ai-trader/AI-TRADER-TARGET-ARCHITECTURE.md
  - docs/plans/dee-415-ai-trader-historical-test-readiness.md
relatedGaps: docs/gaps/ai-trader-historical-test-readiness-gap-registry.md
relatedRoadmap: docs/roadmaps/ai-trader-historical-test-readiness-roadmap.md
lastReviewed: 2026-07-12
version: 0.1.0
---

# AI-TRADER — Historical-Test Readiness Completion Specification

Defines **done** for the DEE-415 Historical-Test Readiness program: the measurable state `READY_FOR_FULL_HISTORICAL_TEST`.

## Purpose

Bring AI-TRADER from the current `dev` baseline to a **code-ready, Human-deployable Execution Server package** (Option A, ADR-0023) so a full historical validation run is **trustworthy, reproducible, and self-scoring**. This is an **infrastructure + epistemic-integrity qualification**, not an edge or profitability verdict (ADR-0010).

This spec is the product-completion authority for the 23-work-package program tracked by Linear **DEE-415** on branch `dee-415-ai-trader-historical-test-readiness`. One integration boundary; one final PR; one Human squash merge.

## Scope

- Org-0, non-custodial, historical/research lane only (`AUTHORIZED_FOR_RESEARCH_ONLY`).
- All gate groups **CG-A through CG-H** (conjunctive — all must pass with evidence).
- 23 sequential work packages (`HTR-WP01..HTR-WP23`) on a single shared branch.
- Record-level Forecast → Decision → Risk → Execution → Reality chain depth (D-1); deterministic historical-readiness runtime substrate (D-16); scoped Target Architecture subset (D-17).
- Epistemic closure at record level: outcome resolution, calibration scoring, knowledge-confidence update (D-18; primarily HTR-WP21).
- Code-ready Execution Server package with operator instructions (Option A, D-19; HTR-WP23).
- Repository-first program state after first DEE-415 commit (canonical integration plan + Linear + git log).

## Out of scope

- Profitable edge or strategy verdict.
- Blind holdout access or walk-forward campaigns.
- Strategy Validation Gate approval.
- Paper soak or live trading readiness.
- Real capital, custodial Org-0 live, or agent authorization.
- Deployed or qualified Execution Server (deployment is the first step of the separate Full Historical Validation Program).
- Execution Server mutation during HTR (campaigns run `local`/CI on bounded fixtures).
- Mature autonomous engines (Strategy Synthesis, Portfolio Intelligence beyond caps).
- Multi-year validation program execution (deferred after readiness).

Link: [`docs/waia-governance/NON-GOALS.md`](../waia-governance/NON-GOALS.md).

## Acceptance criteria

`READY_FOR_FULL_HISTORICAL_TEST` is granted **only** when all gate groups below are measurably true **and** the Human Architect certifies (`CERTIFY-HTR-READY`, D-12). Default state: `NOT_READY`. Composer never sets `READY_FOR_FULL_HISTORICAL_TEST`.

### Governance / activation (CG-Gov)

- [ ] Activation authority recorded: research-only Org-0 lane (`APPROVE-HTR-ACTIVATION: research-only-org0`, D-14).
- [ ] WAIA Core uplift status recorded: M1 closed (`ACK-HTR-CORE: m1-closed`, D-15).
- [ ] Scoped Target Architecture subset ratified (`APPROVE-HTR-TARGET-SUBSET: scoped-htr-ratification`, D-17).
- [ ] Runtime-substrate interpretation recorded (`APPROVE-HTR-RUNTIME-SUBSTRATE: deterministic-historical-readiness-substrate`, D-16).
- [ ] Repository-first program state synchronized (canonical integration plan + Linear + parent ledger after each work package).
- [ ] All 23 work packages COMPLETE with WORK + CLOSEOUT commits on the shared branch.
- [ ] Final whole-program Opus audit PASS; full validation matrix green; readiness package exists.
- [ ] Human certification (`CERTIFY-HTR-READY`, D-12) after HTR-WP23.

### CG-A — Data & dataset

- [ ] Point-in-time (PIT) provider context enforced on historical paths (HTR-WP11).
- [ ] Gateway bypass eliminated on historical paths (HTR-WP11).
- [ ] Ingress bar-integrity gate operational (HTR-WP12).
- [ ] Versioned dataset manifest with reproducible fixture binding (HTR-WP12; manifest closure HTR-WP12, package contribution HTR-WP23).

### CG-B — Replay runtime

- [ ] Replay benchmark methodology approved (D-11A) with golden fixtures (HTR-WP03).
- [ ] Per-stage timing and memory instrumentation (HTR-WP03; qualification HTR-WP22).
- [ ] Checkpoint/resume and pipeline DB-disconnect resilience (HTR-WP05; qualification HTR-WP22).
- [ ] No-lookahead and determinism property suites green (HTR-WP10).

### CG-C — Market Canvas & MTF

- [ ] Market Canvas state contract and cursor replay foundation (HTR-WP06).
- [ ] Incremental closed-bar MTF aggregation without partial-bar HTF leakage (HTR-WP07, HTR-WP10).
- [ ] Incremental reconstruction with oracle parity (HTR-WP08, HTR-WP09).
- [ ] Canvas runtime integration, benchmark qualification, default cutover to incremental path (HTR-WP09).

### CG-D — Decision chain (record-level)

- [ ] Intelligence-chain activation for historical run profile (HTR-WP13).
- [ ] Forecast records (LD-6) and Decision records (LD-7) with whyNotCash and no-trade first-class (HTR-WP14).
- [ ] CDE/LD-7 naming disambiguation (D-4; HTR-WP14).
- [ ] Terminal reason universal across chain (HTR-WP13).
- [ ] MKB read-model wired for replay (HTR-WP15).
- [ ] Strategy pinning, gating, and trial accounting (HTR-WP16).

### CG-E — Trading simulation & reality

- [ ] Historical execution-simulation realism: cancel/expire/partial-fill, spread/impact/latency (HTR-WP17).
- [ ] Cost model on default fills; net vs gross accounting (HTR-WP17, HTR-WP18).
- [ ] Unified inventory and accounting parity; dual-inventory eliminated (HTR-WP18).
- [ ] Reality reconciliation and M9-class regression closure (HTR-WP19).
- [ ] Postgres parity validated beyond CI-only skip (HTR-WP19).

### CG-F — Guardian & exits

- [ ] Guardian vocabulary complete; exit-reason invariants (HTR-WP20).
- [ ] Closed-trade reality invariants aligned with LD-10 (HTR-WP20).

### CG-G — Evidence / quality / ops (+ Execution Server package)

- [ ] Streaming evidence with partial sealing and crash-recovery reconstruction (HTR-WP04; qualification HTR-WP22).
- [ ] Bounded in-memory trace; complete-runtime memory soak (HTR-WP04 primary, HTR-WP22 closure for HTR-GAP-005).
- [ ] Campaign manifest and readiness preflight CLI (HTR-WP23).
- [ ] Full test matrix green (`pnpm lint`, `typecheck`, `test --run`, `build`, `validate:canon`; Postgres integration when in scope).
- [ ] **Code-ready Execution Server package** (Option A): manifests, contracts, resource assumptions, commands, checkpoint/evidence semantics, operator instructions — ready for Human-operated deployment; **not** "server already deployed" (HTR-WP23, §32B).

### CG-H — Outcome resolution, calibration & knowledge confidence

- [ ] Forecast pre-registration and horizon resolution against PIT-realized data (HTR-WP14, HTR-WP21).
- [ ] Resolution states per LD-6; hypothesis terminal resolution evidence-driven in replay (HTR-WP21).
- [ ] Calibration scoring: Brier/log-loss, sample-gated, survivorship-aware (HTR-WP21).
- [ ] Knowledge-confidence update/decay: deterministic, never autonomous; human-gated global promotion (HTR-WP21).
- [ ] No-trade/abstention outcome scoring (HTR-WP21).
- [ ] Deterministic replay of resolution and calibration (ADR-0021; HTR-WP21).

## Dependencies

- **Product canon:** [`docs/AI-TRADER-PRODUCT-CONSTITUTION.md`](../AI-TRADER-PRODUCT-CONSTITUTION.md)
- **Master spec:** [`docs/ai-trader/AI-TRADER-MASTER-SPEC-v2.md`](../ai-trader/AI-TRADER-MASTER-SPEC-v2.md)
- **Target architecture (scoped subset):** [`docs/ai-trader/AI-TRADER-TARGET-ARCHITECTURE.md`](../ai-trader/AI-TRADER-TARGET-ARCHITECTURE.md)
- **ADRs:** ADR-0010 (replay scope), ADR-0021 (determinism), ADR-0023 (Execution Server plane)
- **Canonical integration plan:** [`docs/plans/dee-415-ai-trader-historical-test-readiness.md`](../plans/dee-415-ai-trader-historical-test-readiness.md)
- **Gap registry:** [`docs/gaps/ai-trader-historical-test-readiness-gap-registry.md`](../gaps/ai-trader-historical-test-readiness-gap-registry.md)
- **Roadmap:** [`docs/roadmaps/ai-trader-historical-test-readiness-roadmap.md`](../roadmaps/ai-trader-historical-test-readiness-roadmap.md)
- **Linear:** DEE-415 (single integration issue for all 23 work packages)

## Decision record

Program and architecture-scope tokens recorded at HTR-WP01:

| Token | Decision |
|-------|----------|
| `APPROVE-HTR-PROGRAM` | Umbrella program authorization (research-only lane) |
| `APPROVE-HTR-ACTIVATION: research-only-org0` | D-14 — Org-0 non-custodial historical/research only |
| `ACK-HTR-CORE: m1-closed` | D-15 — WAIA Core M1 closed; WC-E3 RBAC deferred post-MVP |
| `APPROVE-HTR-D13: htr-supersedes` | D-13 — HTR supersedes `intelligence_evolution` as program authority |
| `APPROVE-HTR-RUNTIME-SUBSTRATE: deterministic-historical-readiness-substrate` | D-16 — substrate ≠ autonomous engine |
| `APPROVE-HTR-TARGET-SUBSET: scoped-htr-ratification` | D-17 — scoped Target Architecture adoption register |
| `APPROVE-HTR-D1: record-level-chain` | D-1 — record-level chain depth, no engines |
| `APPROVE-HTR-EPISTEMIC-CLOSURE: record-level` | D-18 — record-level resolution + calibration + confidence (WP21) |
| `APPROVE-HTR-EXECSERVER: option-a-code-ready` | D-19 — Option A code-ready package (§32B) |
| `APPROVE-HTR-D10: divergence-register-v1` | D-10 — Approved Semantic Divergence Register framework |
| `APPROVE-HTR-EXECUTION-TOPOLOGY: one-integration-issue-one-branch-one-final-pr-23-sequential-child-build-plans` | One DEE-415 boundary, 23 WPs, one final PR |

### Contradiction register resolutions (CR-01..CR-16)

| CR | Resolution |
|----|------------|
| CR-01 | Record-level chain ratified at WP01; not mature engines (D-1) |
| CR-05 | CDE/LD-7 disambiguation at WP14 (D-4) |
| CR-07 | Engineering-status truth-up at WP02 |
| CR-09 | Incremental default at WP09; oracle flag for diagnostic |
| CR-10 | Determinism residuals closed at WP10 |
| CR-11 | HTR supersedes intelligence_evolution; retained as evidence (D-13) |
| CR-12 | intelligence_evolution "Gate A" → **M9 Accounting Gate**; HTR uses CG-A..CG-H |
| CR-13 | Research-only lane authorized; Founders-reserved unconditional actions separate (D-14) |
| CR-14 | Runtime substrate approved; not autonomous engines (D-16) |
| CR-15 | Plumbing gate ≠ epistemic validity; HTR includes WP21 closure (D-18) |
| CR-16 | Readiness = code-ready package; no server mutation during HTR (D-19) |

### Supersession

- HTR supersedes `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` as **program authority** (D-13); retained as historical/evidence source (**not mutated**).
- intelligence_evolution "Gate A" renamed **M9 Accounting Gate** in HTR canon (closure at HTR-WP02 for HTR-GAP-034).
- Completed intelligence_evolution work preserved; pending Market Memory + Knowledge Loop (PR4) maps to **HTR-WP15 + HTR-WP21**.

### Boundary

This spec ends at the **code-ready Execution Server package** and Human certification. Deployment and qualification of the Execution Server is the first step of the **Full Historical Validation Program** (separate, out of scope here).

## Traceability

| Artefact | Link |
|----------|------|
| Completion spec | This file (`PCS-AI-TRADER-HISTORICAL-TEST-READINESS`) |
| Gap registry | [`docs/gaps/ai-trader-historical-test-readiness-gap-registry.md`](../gaps/ai-trader-historical-test-readiness-gap-registry.md) |
| Roadmap | [`docs/roadmaps/ai-trader-historical-test-readiness-roadmap.md`](../roadmaps/ai-trader-historical-test-readiness-roadmap.md) |
| Canonical integration plan | [`docs/plans/dee-415-ai-trader-historical-test-readiness.md`](../plans/dee-415-ai-trader-historical-test-readiness.md) |
| Parent master (local) | `.cursor/plans/ai-trader_historical-test-readiness_master_20260711.plan.md` |
| Linear | DEE-415 |
| Branch | `dee-415-ai-trader-historical-test-readiness` |
