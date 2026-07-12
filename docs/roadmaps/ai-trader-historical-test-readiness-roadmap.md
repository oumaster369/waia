---
roadmapId: ROADMAP-AI-TRADER-HISTORICAL-TEST-READINESS
title: "AI-TRADER Historical-Test Readiness — Integration Roadmap"
horizon: v1
owner: Architect
linkedSpec: docs/product-specs/ai-trader-historical-test-readiness-completion.md
linkedGapRegistry: docs/gaps/ai-trader-historical-test-readiness-gap-registry.md
lastReviewed: 2026-07-12
version: 0.1.0
---

# AI-TRADER Historical-Test Readiness — Integration Roadmap

Orders the 23 work packages of DEE-415 toward `READY_FOR_FULL_HISTORICAL_TEST`. All batches share **one** Linear integration issue (DEE-415), **one** branch (`dee-415-ai-trader-historical-test-readiness`), and **one** final PR — they are **work packages inside one integration boundary**, not separate PR boundaries.

## Purpose

Sequence gap closure and implementation work for the Historical-Test Readiness program. Each batch maps 1:1 to a work package `HTR-WPNN` and a roadmap item `IB-HTR-NN`. Mandatory tail: **HTR-WP21 → HTR-WP22 → HTR-WP23**. Additional hard dependency: **HTR-WP16 → HTR-WP22**.

## Integration batches

| batchId | workPackage | title | dependsOn | riskTier | status | planPath | gapRefs | acceptanceSummary |
|---------|-------------|-------|-----------|----------|--------|----------|---------|-------------------|
| IB-HTR-01 | HTR-WP01 | Canon & readiness-contract + activation/target-subset ratification | — | T1 | in-progress | docs/plans/dee-415-ai-trader-historical-test-readiness.md | HTR-GAP-032,034,041 | Three canonical docs; activation recorded; all gaps have ownership |
| IB-HTR-02 | HTR-WP02 | Post-M9 forensic + status truth-up + program supersession | IB-HTR-01 | T1 | planned | null | HTR-GAP-030,034 | Engineering status reconciled; Gate-A rename applied |
| IB-HTR-03 | HTR-WP03 | Replay benchmark + stage timing + memory instrumentation | IB-HTR-01 | T1 | planned | null | HTR-GAP-024 | Benchmark methodology + fixtures; stage timing baseline |
| IB-HTR-04 | HTR-WP04 | Streaming evidence + partial sealing + crash-recovery reconstruction | IB-HTR-03 | T2 | planned | null | HTR-GAP-005,026 | Streaming evidence; crash-recovery path |
| IB-HTR-05 | HTR-WP05 | Checkpoint/resume + pipeline DB-disconnect + terminal states | IB-HTR-04 | T2 | planned | null | HTR-GAP-027,029 | Checkpoint/resume; DB-disconnect resilience |
| IB-HTR-06 | HTR-WP06 | Market Canvas state contract + cursor replay foundation | IB-HTR-01, IB-HTR-03 | T2 | planned | null | HTR-GAP-001 | Canvas state contract; cursor replay foundation |
| IB-HTR-07 | HTR-WP07 | Incremental closed-bar MTF aggregation | IB-HTR-06 | T2 | planned | null | HTR-GAP-003,004 | Incremental MTF; no partial-bar leakage |
| IB-HTR-08 | HTR-WP08 | Incremental reconstruction + oracle parity | IB-HTR-07 | T2 | planned | null | HTR-GAP-002 | Incremental reconstruction; divergence register applied |
| IB-HTR-09 | HTR-WP09 | Canvas runtime integration + benchmark qual + default cutover | IB-HTR-08, IB-HTR-03 | T2 | planned | null | HTR-GAP-001,002,003 | Incremental default; benchmark qualification |
| IB-HTR-10 | HTR-WP10 | No-lookahead + determinism property suites | IB-HTR-09 | T1 | planned | null | HTR-GAP-025,031 | Property suites green; determinism residuals closed |
| IB-HTR-11 | HTR-WP11 | PIT provider context + gateway enforcement + absent-lane | IB-HTR-01, IB-HTR-09 | T2 | planned | null | HTR-GAP-012,013 | PIT context; gateway enforcement |
| IB-HTR-12 | HTR-WP12 | Ingress bar-integrity gate + versioned dataset manifest | IB-HTR-01 | T2 | planned | null | HTR-GAP-014,015 | Bar-integrity gate; dataset manifest |
| IB-HTR-13 | HTR-WP13 | Intelligence-chain activation (historical run profile) | IB-HTR-09, IB-HTR-10, IB-HTR-11, IB-HTR-12 | T2 | planned | null | HTR-GAP-006,009 | MI chain ON for historical profile |
| IB-HTR-14 | HTR-WP14 | Forecast + Decision records + whyNotCash + CDE disambiguation | IB-HTR-13 | T2 | planned | null | HTR-GAP-007,008,011,036 | Record-level Forecast/Decision; whyNotCash |
| IB-HTR-15 | HTR-WP15 | MKB read-model integration for replay | IB-HTR-14 | T2 | planned | null | HTR-GAP-010 | MKB read-model wired |
| IB-HTR-16 | HTR-WP16 | Strategy pinning + gating + trial accounting | IB-HTR-13 | T2 | planned | null | HTR-GAP-020,021 | Strategy lifecycle + trial accounting |
| IB-HTR-17 | HTR-WP17 | Historical execution-simulation realism | IB-HTR-09 | T2 | planned | null | HTR-GAP-016,017,023,035 | Realistic sim; cost model on fills |
| IB-HTR-18 | HTR-WP18 | Inventory & accounting parity | IB-HTR-17 | T2 | planned | null | HTR-GAP-019,023 | Unified inventory; net vs gross |
| IB-HTR-19 | HTR-WP19 | Reality reconciliation + M9-class regression closure | IB-HTR-18 | T2 | planned | null | HTR-GAP-018,019,035 | Reconciliation; M9 regression; Postgres parity |
| IB-HTR-20 | HTR-WP20 | Guardian/exits completion + closed-trade reality invariants | IB-HTR-18, IB-HTR-19 | T2 | planned | null | HTR-GAP-022 | Guardian complete; LD-10 invariants |
| IB-HTR-21 | HTR-WP21 | Outcome Resolution, Forecast Calibration & Knowledge Confidence Update | IB-HTR-14, IB-HTR-15, IB-HTR-19, IB-HTR-20 | T2 | planned | null | HTR-GAP-010,036,037,038,039,040 | Epistemic closure; calibration; confidence update |
| IB-HTR-22 | HTR-WP22 | Resilience + performance qualification | IB-HTR-04, IB-HTR-05, IB-HTR-09, IB-HTR-16, IB-HTR-19, IB-HTR-21 | T2 | planned | null | HTR-GAP-005,024,026,027,029 | Memory soak; perf qualification; evidence recovery |
| IB-HTR-23 | HTR-WP23 | Operator runbook + readiness preflight + Execution Server package + Certification prep | IB-HTR-20, IB-HTR-22 | T1 | planned | null | HTR-GAP-028,042 | Readiness package; preflight; Human certification prep |

All batches use `linearIssue: DEE-415`. Whole-program `riskTier: T2`; per-batch tier describes work-package nature (informative).

**Execution topology:** No intermediate PRs. Local WORK + CLOSEOUT commits per work package on the shared branch. Single PR after HTR-WP23 + final Opus whole-program audit.

## Batch schema

```yaml
batchId: IB-HTR-<NN>           # stable within this roadmap
workPackage: HTR-WP<NN>        # 1:1 mapping
linearIssue: DEE-415           # single integration issue for all batches
title: "..."
dependsOn: [IB-HTR-..]         # predecessor batchIds
riskTier: T0 | T1 | T2 | T3 | T4
status: planned | approved | in-progress | complete | deferred
planPath: docs/plans/dee-415-ai-trader-historical-test-readiness.md  # whole-program plan
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

## Traceability

| Artefact | Link |
|----------|------|
| Completion spec | [`docs/product-specs/ai-trader-historical-test-readiness-completion.md`](../product-specs/ai-trader-historical-test-readiness-completion.md) |
| Gap registry | [`docs/gaps/ai-trader-historical-test-readiness-gap-registry.md`](../gaps/ai-trader-historical-test-readiness-gap-registry.md) |
| Canonical integration plan | [`docs/plans/dee-415-ai-trader-historical-test-readiness.md`](../plans/dee-415-ai-trader-historical-test-readiness.md) |
| Work-package crosswalk | Parent master §21 (HTR-B01..B23 → HTR-WP01..WP23) |
| Linear | DEE-415 |
| Branch | `dee-415-ai-trader-historical-test-readiness` |
