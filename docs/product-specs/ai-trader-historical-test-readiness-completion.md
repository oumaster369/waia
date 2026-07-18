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
lastReviewed: 2026-07-18
version: 0.1.2
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

### Program control state (2026-07-18)

```text
PROGRAM_STATUS=FINAL_AUDIT_CORRECTIVE_PACKET_PENDING_HUMAN_REVIEW
ORIGINAL_WORK_PACKAGES_COMPLETE=HTR-WP01..HTR-WP23
FINAL_AUDIT_VERDICT=HUMAN_REJECTED_PENDING_CORRECTIVE_CLOSURE
CERTIFY_HTR_READY=NOT_ISSUED
READY_FOR_FULL_HISTORICAL_TEST=NO
FINAL_PR_AUTHORIZED=NO
ACTIVE_CORRECTION=HTR-FINAL-AUDIT-CORRECTIVE-A
ACTIVE_CORRECTION_STATUS=EXACT_PACKET_READY_PENDING_HUMAN_REVIEW
NEXT_HUMAN_GATE=APPROVE-DEE-415-FINAL-AUDIT-CORRECTIVE-PACKET
```

Final Opus whole-program audit **technical coverage preserved**; Human **rejected** prior PASS certification recommendation due to contract-classification contradictions (FA-001..FA-004). Corrective closure required before `CERTIFY-HTR-READY` or final PR.

### Governance / activation (CG-Gov)

- [x] Activation authority recorded: research-only Org-0 lane (`APPROVE-HTR-ACTIVATION: research-only-org0`, D-14; HTR-WP01 WORK 6600708 + CLOSEOUT 60310d5).
- [x] WAIA Core uplift status recorded: M1 closed (`ACK-HTR-CORE: m1-closed`, D-15; HTR-WP01).
- [x] Scoped Target Architecture subset ratified (`APPROVE-HTR-TARGET-SUBSET: scoped-htr-ratification`, D-17; HTR-WP01).
- [x] Runtime-substrate interpretation recorded (`APPROVE-HTR-RUNTIME-SUBSTRATE: deterministic-historical-readiness-substrate`, D-16; HTR-WP01).
- [x] Repository-first program state synchronized (canonical integration plan + Linear + parent ledger after each work package; all 23 WPs closed).
- [x] All 23 work packages COMPLETE with WORK + CLOSEOUT commits on the shared branch (`HTR-WP01..HTR-WP23`; independent Phase-B PASS per WP).
- [ ] Final whole-program Opus audit PASS; full validation matrix green; readiness package exists (Human rejected prior PASS; corrective closure pending).
- [ ] Human certification (`CERTIFY-HTR-READY`, D-12) after corrective closure + re-audit PASS.

### CG-A — Data & dataset

- [x] Point-in-time (PIT) provider context enforced on historical paths (HTR-WP11 WORK f6cefb0 + CLOSEOUT c63453d; HTR-GAP-012 CLOSED).
- [x] Gateway bypass eliminated on historical paths (HTR-WP11; HTR-GAP-013 CLOSED).
- [x] Ingress bar-integrity gate operational (HTR-WP12 WORK 993fdab + CLOSEOUT fd2f9ca; HTR-GAP-014 CLOSED).
- [x] Versioned dataset manifest with reproducible fixture binding (HTR-WP12; manifest closure HTR-WP12; package contribution HTR-WP23; HTR-GAP-015 CLOSED).

### CG-B — Replay runtime

- [x] Replay benchmark methodology approved (D-11A) with golden fixtures (HTR-WP03 WORK 35283ed + CLOSEOUT b682bbc).
- [x] Per-stage timing and memory instrumentation (HTR-WP03; qualification HTR-WP22; HTR-GAP-024 CLOSED).
- [x] Checkpoint/resume and pipeline DB-disconnect resilience (HTR-WP05 WORK f90faa9 + CLOSEOUT c2ae049; qualification HTR-WP22; HTR-GAP-027/029 CLOSED).
- [x] No-lookahead and determinism property suites green (HTR-WP10 WORK befa6c1 + CLOSEOUT 1ac0e6a; HTR-GAP-004/025/031 CLOSED).

### CG-C — Market Canvas & MTF

- [x] Market Canvas state contract and cursor replay foundation (HTR-WP06 WORK 24eb7f9 + CLOSEOUT c8407a3; CANVAS_STATE_OK).
- [x] Incremental closed-bar MTF aggregation without partial-bar HTF leakage (HTR-WP07 WORK 10f2500 + CLOSEOUT 3a3d82a; HTR-WP10 closed-bar proof; HTR-GAP-003/004 CLOSED).
- [x] Incremental reconstruction with oracle parity (HTR-WP08 WORK 0c4b8c3 + CLOSEOUT a8a709f; HTR-WP09 cutover; HTR-GAP-002 CLOSED).
- [x] Canvas runtime integration, benchmark qualification, default cutover to incremental path (HTR-WP09 WORK 46820ac + CLOSEOUT 3a0962f; D-11B PASS; HTR-GAP-001 CLOSED).

### CG-D — Decision chain (record-level)

- [x] Intelligence-chain activation for historical run profile (HTR-WP13 WORK d07bb65 + CLOSEOUT 2d63eca; HTR-GAP-006 CLOSED).
- [x] Forecast records (LD-6) and Decision records (LD-7) with whyNotCash and no-trade first-class (HTR-WP14 WORK b8eeadb + CLOSEOUT e4a3a38; HTR-GAP-007/008/011 CLOSED).
- [x] CDE/LD-7 naming disambiguation (D-4; HTR-WP14; HTR-GAP-007 CLOSED).
- [x] Terminal reason universal across chain (HTR-WP13; HTR-GAP-009 CLOSED).
- [x] MKB read-model wired for replay (HTR-WP15 WORK 645f4be + CLOSEOUT c6e94d9; HTR-GAP-010 CLOSED at HTR-WP21).
- [x] Strategy pinning, gating, and trial accounting (HTR-WP16 WORK 93d6908 + CLOSEOUT 2e8835e; HTR-GAP-020/021 CLOSED).

### CG-E — Trading simulation & reality

- [x] Historical execution-simulation realism: cancel/expire/partial-fill, spread/impact/latency (HTR-WP17 WORK 7b4304d + default-path CLOSEOUT 0e1b904; HTR-GAP-016/017 CLOSED_REVALIDATED).
- [ ] Single authoritative cost model on default fills; net vs gross accounting without D-5/FHV contradiction (HTR-WP17, HTR-WP18; **HTR-GAP-047**).
- [x] Unified inventory and accounting parity; dual-inventory eliminated (HTR-WP18 WORK 09573c5 + CLOSEOUT 0444e94; HTR-GAP-023 CLOSED).
- [x] Reality reconciliation and M9-class regression closure (HTR-WP19 WORK 5558860 + CLOSEOUT d1a47ac; HTR-GAP-018/019 CLOSED).
- [x] Postgres parity validated beyond CI-only skip (HTR-WP19; HTR-GAP-035 CLOSED).
- [ ] D-20 monthly/strategy drawdown contract enforced in hot path (peak-equity HWM, monthly/strategy attribution, fail-closed response; **HTR-GAP-046**).

### CG-F — Guardian & exits

- [x] Guardian vocabulary complete; exit-reason invariants (HTR-WP20 WORK b820a06 + CLOSEOUT e9cca67; HTR-GAP-022 CLOSED).
- [x] Closed-trade reality invariants aligned with LD-10 (HTR-WP20).
- [ ] Partial-entry cancellation consumed end-to-end on Guardian breach (`cancelPartialEntry` not merely emitted; **HTR-GAP-048**).

### CG-G — Evidence / quality / ops (+ Execution Server package)

- [x] Streaming evidence with partial sealing and crash-recovery reconstruction (HTR-WP04 WORK b3abe7b; qualification HTR-WP22; HTR-GAP-005/026 CLOSED).
- [x] Bounded in-memory trace; complete-runtime memory soak (HTR-WP04 primary, HTR-WP22 closure for HTR-GAP-005).
- [x] Campaign manifest and readiness preflight CLI (HTR-WP23 WORK 6647b903 + CLOSEOUT 4e1345e; HTR-GAP-028 CLOSED).
- [x] Full test matrix green (`pnpm lint`, `typecheck`, `test --run`, `build`, `validate:canon`; Postgres integration when in scope; validated at HTR-WP23 closeout).
- [ ] FHV semantic trace JSONL emitter + six operator report builders (not schema-only; **HTR-GAP-049**).
- [ ] **Code-ready Execution Server package** (Option A): manifests, contracts, resource assumptions, commands, checkpoint/evidence semantics, operator instructions — ready for Human-operated deployment; **not** "server already deployed" (HTR-WP23 schema present; emitter/trace gap blocks acceptance until **HTR-GAP-049** closure; §32B).

### CG-H — Outcome resolution, calibration & knowledge confidence

- [x] Forecast pre-registration and horizon resolution against PIT-realized data (HTR-WP14 + HTR-WP21 WORK f72eed4..b71a381 + CLOSEOUT 0dff99c; HTR-GAP-036 CLOSED).
- [x] Resolution states per LD-6; hypothesis terminal resolution evidence-driven in replay (HTR-WP21; HTR-GAP-040 CLOSED).
- [x] Calibration scoring: Brier/log-loss, sample-gated, survivorship-aware (HTR-WP21; HTR-GAP-037 CLOSED).
- [x] Knowledge-confidence update/decay: deterministic, never autonomous; human-gated global promotion (HTR-WP21; HTR-GAP-038 CLOSED).
- [x] No-trade/abstention outcome scoring (HTR-WP21; HTR-GAP-039 CLOSED).
- [x] Deterministic replay of resolution and calibration (ADR-0021; HTR-WP21; accepted evidence replay-runs/RI-P7/htr-wp21-epistemic-closure/).

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
