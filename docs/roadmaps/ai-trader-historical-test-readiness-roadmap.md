---
roadmapId: ROADMAP-AI-TRADER-HISTORICAL-TEST-READINESS
title: "AI-TRADER Historical-Test Readiness — Integration Roadmap"
horizon: v1
owner: Architect
linkedSpec: docs/product-specs/ai-trader-historical-test-readiness-completion.md
linkedGapRegistry: docs/gaps/ai-trader-historical-test-readiness-gap-registry.md
lastReviewed: 2026-07-18
version: 0.1.2
---

# AI-TRADER Historical-Test Readiness — Integration Roadmap

Orders the 23 work packages of DEE-415 toward `READY_FOR_FULL_HISTORICAL_TEST`. All batches share **one** Linear integration issue (DEE-415), **one** branch (`dee-415-ai-trader-historical-test-readiness`), and **one** final PR — they are **work packages inside one integration boundary**, not separate PR boundaries.

## Purpose

Sequence gap closure and implementation work for the Historical-Test Readiness program. Each batch maps 1:1 to a work package `HTR-WPNN` and a roadmap item `IB-HTR-NN`. Mandatory tail: **HTR-WP21 → HTR-WP22 → HTR-WP23**. Additional hard dependency: **HTR-WP16 → HTR-WP22**.

Post-final-audit corrective closure units (`HTR-FINAL-AUDIT-CORRECTIVE-<ID>`) are tracked in a **separate** section below; they are **not** work packages and do **not** extend the frozen 23-WP decomposition.

## Integration batches

| batchId | workPackage | title | dependsOn | riskTier | status | planPath | gapRefs | acceptanceSummary |
|---------|-------------|-------|-----------|----------|--------|----------|---------|-------------------|
| IB-HTR-01 | HTR-WP01 | Canon & readiness-contract + activation/target-subset ratification | — | T1 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-032,034,041 | Three canonical docs; activation recorded; all gaps have ownership (HTR-GAP-032/041 closed; HTR-GAP-034 closes at HTR-WP02) |
| IB-HTR-02 | HTR-WP02 | Post-M9 forensic + status truth-up + program supersession | IB-HTR-01 | T1 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-030,034 | Engineering status reconciled; Gate-A rename applied; forensic canon registered; HTR-GAP-030/034 closed (WP02 WORK COMMIT 7ec02dd) |
| IB-HTR-03 | HTR-WP03 | Replay benchmark + stage timing + memory instrumentation | IB-HTR-01 | T1 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-024 | Benchmark methodology + fixture (81 cycles); stage timing + memory high-water baseline; semantic parity PASS; Opus post-review PASS; validation PASS; WORK COMMIT 35283ed; evidence replay-runs/RI-P7/htr-wp03-replay-benchmark-baseline/ (HTR-GAP-024 baseline recorded, remains open, closure HTR-WP22) |
| IB-HTR-04 | HTR-WP04 | Streaming evidence + partial sealing + crash-recovery reconstruction | IB-HTR-03 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-005,026 | Streaming per-cycle evidence; atomic checksummed chunks; bounded STREAM_ONLY retention (0 retained PaperCycleResults, ≤32 buffered projections); complete/partial manifest truth; graceful SIGTERM partial sealing; hard-kill durable-prefix reconstruction; corrupt-chain quarantine; integrated research-path evidence; semantic parity PASS; Opus post-review PASS; targeted validation PASS; full validation PASS; WORK COMMIT b3abe7b; evidence replay-runs/RI-P7/htr-wp04-streaming-evidence-baseline/ (HTR-GAP-005 and HTR-GAP-026 remain open, closure HTR-WP22) |
| IB-HTR-05 | HTR-WP05 | Checkpoint/resume + pipeline DB-disconnect + terminal states | IB-HTR-04 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-027,029 | WORK f90faa9 + CLOSEOUT c2ae049; Opus Macro-A Phase-B PASS; semantic parity PASS (uninterrupted == resumed); evidence replay-runs/RI-P7/htr-wp05-checkpoint-resume-baseline/; HTR-GAP-027/029 contribution delivered (closure HTR-WP22) |
| IB-HTR-06 | HTR-WP06 | Market Canvas state contract + cursor replay foundation | IB-HTR-01, IB-HTR-03 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-001 | WORK 24eb7f9 + CLOSEOUT c8407a3; Opus Macro-B Phase-B PASS; CANVAS_STATE_OK; evidence replay-runs/RI-P7/htr-wp06-canvas-contract-baseline/; HTR-GAP-001 contribution delivered (closed HTR-WP09) |
| IB-HTR-07 | HTR-WP07 | Incremental closed-bar MTF aggregation | IB-HTR-06 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-003,004 | WORK 10f2500 + CLOSEOUT 3a3d82a; Opus Macro-B Phase-B PASS; CANVAS_MTF_PARITY_OK; evidence replay-runs/RI-P7/htr-wp07-incremental-mtf-baseline/; HTR-GAP-003 closed HTR-WP09; HTR-GAP-004 closed HTR-WP10 |
| IB-HTR-08 | HTR-WP08 | Incremental reconstruction + oracle parity | IB-HTR-07 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-002 | WORK 0c4b8c3 + CLOSEOUT a8a709f; Opus Macro-B Phase-B PASS; RECONSTRUCTION_ORACLE_PARITY_OK (22/22 exact, 0 divergence, FULL_HISTORY_RESCANS 0); evidence replay-runs/RI-P7/htr-wp08-incremental-reconstruction-baseline/; HTR-GAP-002 closed HTR-WP09 |
| IB-HTR-09 | HTR-WP09 | Canvas runtime integration + benchmark qual + default cutover | IB-HTR-08, IB-HTR-03 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-001,002,003 | Incremental default cutover shipped; D-11B PASS under Memory Gate Amendment v1 (accepted evidence replay-runs/RI-P7/htr-wp09-canvas-runtime-qualification/ digest 78560485…, bound to 7c532f5 per Human Amendment-v1 exception); Opus Macro-C Phase B PASS; WORK 46820ac; HTR-GAP-001/002/003 closed |
| IB-HTR-10 | HTR-WP10 | No-lookahead + determinism property suites | IB-HTR-09 | T1 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-025,031 | Deterministic clock/ID + no-lookahead/closed-HTF property suites green; WORK befa6c1; validation correction 2987f37 (test-only); evidence replay-runs/RI-P7/htr-wp10-determinism-nolookahead/ digest fa5def37…; no WP09 measurement-critical surface changed; Opus Macro-C Phase B PASS; HTR-GAP-004/025/031 closed; Macro C COMPLETE |
| IB-HTR-11 | HTR-WP11 | PIT provider context + gateway enforcement + absent-lane | IB-HTR-01, IB-HTR-09 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-012,013 | WORK f6cefb0 + CLOSEOUT c63453d; Opus Macro-D Phase-B PASS; PIT provider context + gateway enforcement; evidence replay-runs/RI-P7/htr-wp11-pit-provider-context/ manifest digest b8f043ac…; HTR-GAP-012/013 CLOSED |
| IB-HTR-12 | HTR-WP12 | Ingress bar-integrity gate + versioned dataset manifest | IB-HTR-01 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-014,015 | WORK 993fdab + CLOSEOUT fd2f9ca; Opus Macro-D Phase-B PASS; ingress bar-integrity gate (9 fail-closed classes) + fhv-dataset-manifest/v1; evidence replay-runs/RI-P7/htr-wp12-ingress-manifest/ bundle/manifest semantic digest fd7d4895…; HTR-GAP-014/015 CLOSED |
| IB-HTR-13 | HTR-WP13 | Intelligence-chain activation (historical run profile) | IB-HTR-09, IB-HTR-10, IB-HTR-11, IB-HTR-12 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-006,009 | WORK d07bb65 + CLOSEOUT 2d63eca; Composer Phase-B PASS; MI chain ON for historical profile; evidence replay-runs/RI-P7/htr-wp13-intelligence-chain/ semantic digest b6b3badd…; HTR-GAP-006/009 CLOSED |
| IB-HTR-14 | HTR-WP14 | Forecast + Decision records + whyNotCash + CDE disambiguation | IB-HTR-13 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-007,008,011,036 | WORK b8eeadb + CLOSEOUT e4a3a38; Composer Phase-B PASS; record-level Forecast/Decision + whyNotCash; evidence replay-runs/RI-P7/htr-wp14-forecast-decision/ semantic digest 6fd8d3d7…; HTR-GAP-007/008/011 CLOSED (HTR-GAP-036 closure HTR-WP21) |
| IB-HTR-15 | HTR-WP15 | MKB read-model integration for replay | IB-HTR-14 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-010 | WORK 645f4be + CLOSEOUT c6e94d9; Composer Phase-B PASS; MKB read-model wired; HTR-GAP-010 contribution delivered (closure HTR-WP21) |
| IB-HTR-16 | HTR-WP16 | Strategy pinning + gating + trial accounting | IB-HTR-13 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-020,021 | WORK 93d6908 + CLOSEOUT 2e8835e; Composer Phase-B PASS; strategy lifecycle + trial accounting + D-20 drawdown policy; evidence replay-runs/RI-P7/htr-wp16-strategy-gating/ semantic digest 97865938…; HTR-GAP-020/021 CLOSED |
| IB-HTR-17 | HTR-WP17 | Historical execution-simulation realism | IB-HTR-09 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-016,017,023,035 | WORK 7b4304d + corrections + CLOSEOUT 47b2ece/0e1b904; default-path revalidation PASS; evidence replay-runs/RI-P7/htr-wp17-default-path-conformance/ + historical replay-runs/RI-P7/htr-wp17-execution-simulation/; HTR-GAP-016/017 CLOSED_REVALIDATED_ON_DEFAULT_RESEARCH_PATH |
| IB-HTR-18 | HTR-WP18 | Inventory & accounting parity | IB-HTR-17 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-019,023 | WORK 09573c5 + CLOSEOUT 0444e94; independent Phase-B PASS; dual-basis accounting on default path; evidence replay-runs/RI-P7/htr-wp18-accounting-parity/ semantic digest fd22742d…; HTR-GAP-023 CLOSED |
| IB-HTR-19 | HTR-WP19 | Reality reconciliation + M9-class regression closure | IB-HTR-18 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-018,019,035 | WORK 5558860 + CLOSEOUT d1a47ac; independent Phase-B PASS; reconciliation invariants; evidence replay-runs/RI-P7/htr-wp19-reality-reconciliation/ semantic digest 393d6ccc…; HTR-GAP-018/019/035 CLOSED |
| IB-HTR-20 | HTR-WP20 | Guardian/exits completion + closed-trade reality invariants | IB-HTR-18, IB-HTR-19 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-022 | WORK b820a06 + CLOSEOUT e9cca67; independent Phase-B PASS; Guardian exit taxonomy + closed-trade invariants; evidence replay-runs/RI-P7/htr-wp20-guardian-exit-reality/ semantic digest e5fa84d6…; HTR-GAP-022 CLOSED |
| IB-HTR-21 | HTR-WP21 | Outcome Resolution, Forecast Calibration & Knowledge Confidence Update | IB-HTR-14, IB-HTR-15, IB-HTR-19, IB-HTR-20 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-010,036,037,038,039,040 | WORK f72eed4..b71a381 + CLOSEOUT 0dff99c; independent Phase-B PASS; epistemic closure; evidence replay-runs/RI-P7/htr-wp21-epistemic-closure/ semantic digest c9c52c49…; HTR-GAP-010/036/037/038/039/040 CLOSED |
| IB-HTR-22 | HTR-WP22 | Resilience + performance qualification | IB-HTR-04, IB-HTR-05, IB-HTR-09, IB-HTR-16, IB-HTR-19, IB-HTR-21 | T2 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-005,024,026,027,029,044 | Independent Phase-B PASS 2026-07-18; WORK c982660; accepted evidence replay-runs/RI-P7/htr-wp22-runtime-qualification/ manifest 2c2238e7… semantic a7ca958c…; D-11B bound to afd9a310; multi-position BTC/ETH 100000 USDT shared portfolio |
| IB-HTR-23 | HTR-WP23 | Operator runbook + readiness preflight + Execution Server package + Certification prep | IB-HTR-20, IB-HTR-22 | T1 | complete | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-028,042,043 | Independent Phase-B PASS 2026-07-18; WORK 6647b903; accepted evidence replay-runs/RI-P7/htr-wp23-readiness-package/ manifest 8093c418… semantic 1665f093…; FHV contract pinned SEALED_NOT_ACCESSED; HTX NOT_AVAILABLE; Option A code-ready package schema (FA-004 emitter gap remains open at HTR-GAP-049) |

All batches use `linearIssue: DEE-415`. Whole-program `riskTier: T2`; per-batch tier describes work-package nature (informative).

**Execution topology:** No intermediate PRs. Local WORK + CLOSEOUT commits per work package on the shared branch. Single PR after corrective closure + final Opus whole-program re-audit PASS + Human `CERTIFY-HTR-READY`.

## Final-audit corrective batches

Bounded post-WP23 corrective closure units inside the existing DEE-415 integration boundary. **Not** part of the frozen `HTR-WP01..HTR-WP23` decomposition.

> **HTR-FINAL-AUDIT-CORRECTIVE-A is not WP24.** It does not alter or extend the frozen HTR-WP01..HTR-WP23 decomposition. It is a bounded post-WP corrective closure unit inside the existing DEE-415 integration boundary.

| correctiveBatchId | correctiveUnit | dependsOn | riskTier | status | packetSha256 | packetPath | gapRefs | acceptanceSummary |
|-------------------|------------------|-----------|----------|--------|--------------|------------|---------|-------------------|
| IB-HTR-CORR-A | HTR-FINAL-AUDIT-CORRECTIVE-A | IB-HTR-23 | T2 | planned | e73e7a422ebb9692ef097ecbea3e4e629704a04ff0d950dda4f24bae69bd89da | .cursor/plans/dee-415-final-audit-corrective/e73e7a422ebb9692ef097ecbea3e4e629704a04ff0d950dda4f24bae69bd89da/dee-415-final-audit-corrective-exact-packet.plan.md | HTR-GAP-046, HTR-GAP-047, HTR-GAP-048, HTR-GAP-049 | Human rejected prior PASS classification; exact corrective packet pending Human review (`APPROVE-DEE-415-FINAL-AUDIT-CORRECTIVE-PACKET`); blocks CERTIFY-HTR-READY and final PR until C-A5 integrated re-audit PASS |

## Batch schema (ordinary work packages)

Maps **exactly** `IB-HTR-01..IB-HTR-23` ↔ `HTR-WP01..HTR-WP23`. Corrective batches use the separate schema below.

```yaml
batchId: IB-HTR-<NN>           # stable within this roadmap; NN = 01..23 only
workPackage: HTR-WP<NN>        # 1:1 mapping; WP01..WP23 only
linearIssue: DEE-415           # single integration issue for all batches
title: "..."
dependsOn: [IB-HTR-..]         # predecessor batchIds (ordinary WP batches only)
riskTier: T0 | T1 | T2 | T3 | T4
status: planned | approved | in-progress | complete | deferred
planPath: docs/plans/dee-415-ai-trader-historical-test-readiness.md  # whole-program plan
gapRefs: [HTR-GAP-...]
acceptanceSummary: "..."
```

## Corrective batch schema

Post-final-audit closure units only. **Not** work packages; **not** `HTR-WP24`.

```yaml
correctiveBatchId: IB-HTR-CORR-<ID>   # e.g. IB-HTR-CORR-A
correctiveUnit: HTR-FINAL-AUDIT-CORRECTIVE-<ID>
dependsOn: [IB-HTR-..]                # typically IB-HTR-23
riskTier: T0 | T1 | T2 | T3 | T4
status: planned | approved | in-progress | complete | deferred
packetSha256: "<sha256 of immutable exact packet>"
packetPath: ".cursor/plans/dee-415-final-audit-corrective/<sha256>/dee-415-final-audit-corrective-exact-packet.plan.md"
gapRefs: [HTR-GAP-...]
acceptanceSummary: "..."
```

## Dependencies

**Mandatory serial chains:**

- **Canon:** HTR-WP01 → HTR-WP02
- **Measurement:** HTR-WP03 → HTR-WP04 → HTR-WP05
- **Runtime:** HTR-WP06 → HTR-WP07 → HTR-WP08 → HTR-WP09 → HTR-WP10
- **Data-truth:** HTR-WP11 ∥ HTR-WP12 (parallel until integration at WP13)
- **Intelligence:** HTR-WP13 → HTR-WP14 → HTR-WP15; HTR-WP16 ∥
- **Execution:** HTR-WP17 → HTR-WP18 → HTR-WP19
- **Epistemic:** HTR-WP14/WP15/WP19/WP20 → HTR-WP21
- **Convergence:** **HTR-WP21 → HTR-WP22 → HTR-WP23**; also **HTR-WP16 → HTR-WP22**

Dependencies order work packages **inside one branch**; they are not PR boundaries.

**Corrective dependency:** `IB-HTR-CORR-A` depends on `IB-HTR-23` only.

## Traceability

| Artefact | Link |
|----------|------|
| Completion spec | [`docs/product-specs/ai-trader-historical-test-readiness-completion.md`](../product-specs/ai-trader-historical-test-readiness-completion.md) |
| Gap registry | [`docs/gaps/ai-trader-historical-test-readiness-gap-registry.md`](../gaps/ai-trader-historical-test-readiness-gap-registry.md) |
| Canonical integration plan | [`docs/plans/dee-415-ai-trader-historical-test-readiness.md`](../plans/dee-415-ai-trader-historical-test-readiness.md) |
| Work-package crosswalk | Parent master §21 (HTR-B01..B23 → HTR-WP01..WP23) |
| Linear | DEE-415 |
| Branch | `dee-415-ai-trader-historical-test-readiness` |
