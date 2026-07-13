---
registryId: GAP-AI-TRADER-HISTORICAL-TEST-READINESS
title: "AI-TRADER Historical-Test Readiness — Gap Registry"
scope: ai-trader
owner: Architect
linkedSpec: docs/product-specs/ai-trader-historical-test-readiness-completion.md
linkedRoadmap: docs/roadmaps/ai-trader-historical-test-readiness-roadmap.md
lastReviewed: 2026-07-13
version: 0.1.0
---

# AI-TRADER Historical-Test Readiness — Gap Registry

Tracks known gaps between `READY_FOR_FULL_HISTORICAL_TEST` intent and current implementation for the DEE-415 program (23 work packages, one integration boundary).

## Purpose

Make missing or partial work explicit for the Historical-Test Readiness program. Each gap has exactly one **PRIMARY_OWNER** work package, zero or more **CONTRIBUTING** work packages, and a **CLOSURE** work package (where sufficient evidence exists to close). A gap is **not** closed merely because primary code landed if qualification evidence remains outstanding.

Gap ownership uses **`HTR-WPxx`** identifiers only (never `HTR-Bxx` or `B21'`).

**Load-bearing invariants:**

- **HTR-GAP-005** (unbounded in-memory trace): PRIMARY **HTR-WP04** · CONTRIBUTING **HTR-WP22** · CLOSURE **HTR-WP22** (final complete-runtime memory soak).
- **HTR-GAP-026** (evidence all-or-nothing / crash-recovery): the evidence-loss gap — **not** HTR-GAP-016.
- **HTR-GAP-036..040** (epistemic): owned/closed primarily at **HTR-WP21**; HTR-GAP-037 calibration PRIMARY+CLOSURE **HTR-WP21**.
- **HTR-GAP-033** (master-plan frontmatter safety): **closed** (parent §8 frontmatter controller).
- **HTR-GAP-042** (Execution Server code-ready package): PRIMARY/CLOSURE **HTR-WP23**.

## Gap entries

| gapId | summary | severity | status | PRIMARY_OWNER | CONTRIBUTING | CLOSURE | batchRef |
|-------|---------|----------|--------|---------------|--------------|---------|----------|
| HTR-GAP-001 | No incremental replay / O(N²) / no Canvas | blocker | open (2026-07-13; WP06 WORK COMMIT 24eb7f9 delivered immutable Market Canvas state contract, pure deterministic reducer, single 1m sequence-validation owner, bounded 32-bar ring, deterministic serialization + digest-addressed sidecar, cursor foundation; CANVAS_STATE_OK; no runtime cutover; closure remains HTR-WP09) | HTR-WP06 | HTR-WP07, HTR-WP08 | HTR-WP09 | IB-HTR-06 |
| HTR-GAP-002 | Reconstruction full recompute | blocker | open | HTR-WP08 | — | HTR-WP09 | IB-HTR-08 |
| HTR-GAP-003 | MTF full resample | blocker | open (2026-07-13; WP07 WORK COMMIT 10f2500 delivered shared per-bar MTF accumulator + incremental 1m→15m/1h/4h/1d aggregation, strict closed-bar-only emission, bounded closed tails, byte-preserved legacy oracle; CANVAS_MTF_PARITY_OK; no runtime cutover; closure remains HTR-WP09) | HTR-WP07 | — | HTR-WP09 | IB-HTR-07 |
| HTR-GAP-004 | Partial-bar HTF leakage | blocker | open (2026-07-13; WP07 WORK COMMIT 10f2500 delivered closed-bar-only HTF emission that excludes still-forming buckets from HTF structure; qualification closure remains HTR-WP10) | HTR-WP07 | HTR-WP10 | HTR-WP10 | IB-HTR-07 |
| HTR-GAP-005 | Unbounded in-memory trace | blocker | open (2026-07-12; WP04 WORK COMMIT b3abe7b + CLOSEOUT supplied bounded STREAM_ONLY retention — 0 retained PaperCycleResults, ≤32 buffered evidence projections, fixed O(1) buffer high-water at N=40 and N=81 (both 32), no O(N) final rebuild, M9 exporters stream the iterator; semantic-parity PASS; baseline at replay-runs/RI-P7/htr-wp04-streaming-evidence-baseline/; CLOSURE remains HTR-WP22 full complete-runtime memory soak) | HTR-WP04 | HTR-WP22 | HTR-WP22 | IB-HTR-04 |
| HTR-GAP-006 | MI-core chain default OFF | blocker | open | HTR-WP13 | — | HTR-WP13 | IB-HTR-13 |
| HTR-GAP-007 | CDE/Decision naming conflation | major | open | HTR-WP14 | — | HTR-WP14 | IB-HTR-14 |
| HTR-GAP-008 | whyNotCash + no-trade decision absent | blocker | open | HTR-WP14 | HTR-WP13 | HTR-WP14 | IB-HTR-14 |
| HTR-GAP-009 | Terminal reason not universal | major | open | HTR-WP13 | — | HTR-WP13 | IB-HTR-13 |
| HTR-GAP-010 | MKB read-model unwired | major | open | HTR-WP15 | HTR-WP21 | HTR-WP21 | IB-HTR-15 |
| HTR-GAP-011 | Forecast/Decision records absent | blocker | open | HTR-WP14 | — | HTR-WP14 | IB-HTR-14 |
| HTR-GAP-012 | PIT provider context missing | blocker | open | HTR-WP11 | — | HTR-WP11 | IB-HTR-11 |
| HTR-GAP-013 | Gateway bypass on historical paths | major | open | HTR-WP11 | — | HTR-WP11 | IB-HTR-11 |
| HTR-GAP-014 | No ingress bar-integrity gate | blocker | open | HTR-WP12 | — | HTR-WP12 | IB-HTR-12 |
| HTR-GAP-015 | No versioned dataset manifest | blocker | open | HTR-WP12 | HTR-WP23 | HTR-WP12 | IB-HTR-12 |
| HTR-GAP-016 | Cancel/expire/partial-fill sim missing | major | open | HTR-WP17 | — | HTR-WP17 | IB-HTR-17 |
| HTR-GAP-017 | Spread/impact/latency not modeled | major | open | HTR-WP17 | — | HTR-WP17 | IB-HTR-17 |
| HTR-GAP-018 | Position/balance vs ledger reconcile missing | major | open | HTR-WP19 | — | HTR-WP19 | IB-HTR-19 |
| HTR-GAP-019 | Dual inventory; parity; M9 accounting unproven | blocker | open | HTR-WP18 | HTR-WP19, HTR-WP20 | HTR-WP19 | IB-HTR-18 |
| HTR-GAP-020 | Strategy pinning/gating/lifecycle/trial | major | open | HTR-WP16 | — | HTR-WP16 | IB-HTR-16 |
| HTR-GAP-021 | riskMultiplier unused | minor | open | HTR-WP16 | — | HTR-WP16 | IB-HTR-16 |
| HTR-GAP-022 | Guardian vocabulary incomplete; exit-reason | major | open | HTR-WP20 | — | HTR-WP20 | IB-HTR-20 |
| HTR-GAP-023 | Cost model not on default fills; net vs gross | blocker | open | HTR-WP17 | HTR-WP18 | HTR-WP18 | IB-HTR-17 |
| HTR-GAP-024 | No per-stage timing / perf telemetry | major | open (2026-07-12; WP03 WORK COMMIT 35283ed supplied benchmark instrumentation, per-stage timing baseline, memory high-water, semantic-parity evidence, baseline evidence at replay-runs/RI-P7/htr-wp03-replay-benchmark-baseline/; CLOSURE remains HTR-WP22 full-runtime perf qualification) | HTR-WP03 | — | HTR-WP22 | IB-HTR-03 |
| HTR-GAP-025 | Determinism residuals | blocker | open | HTR-WP10 | — | HTR-WP10 | IB-HTR-10 |
| HTR-GAP-026 | All-or-nothing evidence sealing; no crash-recovery | blocker | open (2026-07-12; WP04 WORK COMMIT b3abe7b + CLOSEOUT supplied streaming per-cycle evidence, atomic checksummed chain-linked chunks, complete/partial manifest truth, graceful SIGTERM partial sealing, hard-kill durable-prefix reconstruction, orphan-temp handling, corrupt-chain quarantine, integrated research-path evidence; baseline at replay-runs/RI-P7/htr-wp04-streaming-evidence-baseline/; CLOSURE remains HTR-WP22) | HTR-WP04 | — | HTR-WP22 | IB-HTR-04 |
| HTR-GAP-027 | No checkpoint/resume | major | open | HTR-WP05 | — | HTR-WP22 | IB-HTR-05 |
| HTR-GAP-028 | Readiness preflight absent | major | open | HTR-WP23 | — | HTR-WP23 | IB-HTR-23 |
| HTR-GAP-029 | Pipeline-body DB-disconnect resilience | major | open | HTR-WP05 | — | HTR-WP22 | IB-HTR-05 |
| HTR-GAP-030 | Status/vault drift | major | closed (2026-07-12; WP02 WORK COMMIT 7ec02dd; engineering-status trued-up, HTR authority explicit, forensic canon registered) | HTR-WP02 | — | HTR-WP02 | IB-HTR-02 |
| HTR-GAP-031 | No-lookahead/determinism property-suite gaps | blocker | open | HTR-WP10 | HTR-WP07, HTR-WP11 | HTR-WP10 | IB-HTR-10 |
| HTR-GAP-032 | Canonical artifacts not created | major | closed (2026-07-12; WORK COMMIT 6600708) | HTR-WP01 | — | HTR-WP01 | IB-HTR-01 |
| HTR-GAP-033 | Master-plan frontmatter unsafe | major | closed | — | — | — | — |
| HTR-GAP-034 | Gate-A naming collision + duplicate authority | major | closed (2026-07-12; WP01 canon + WP02 WORK COMMIT 7ec02dd; active AI-TRADER Gate-A renamed to M9 Accounting Gate, residuals classified, governance Gate A untouched, D-13 supersession recorded) | HTR-WP01 | HTR-WP02 | HTR-WP02 | IB-HTR-01 |
| HTR-GAP-035 | Postgres parity CI-only (skipped locally) | major | open | HTR-WP17 | HTR-WP18, HTR-WP19 | HTR-WP19 | IB-HTR-17 |
| HTR-GAP-036 | Forecast pre-registration + horizon resolution absent | blocker | open | HTR-WP14 | HTR-WP21 | HTR-WP21 | IB-HTR-14 |
| HTR-GAP-037 | Calibration scoring (Brier/log-loss, sample-gated, survivorship-aware) MISSING | blocker | open | HTR-WP21 | — | HTR-WP21 | IB-HTR-21 |
| HTR-GAP-038 | Knowledge-confidence update/decay unwired | major | open | HTR-WP21 | HTR-WP15 | HTR-WP21 | IB-HTR-21 |
| HTR-GAP-039 | No-trade/abstention outcome scoring absent | major | open | HTR-WP21 | HTR-WP14 | HTR-WP21 | IB-HTR-21 |
| HTR-GAP-040 | Hypothesis outcome resolution not evidence-driven in replay | major | open | HTR-WP21 | HTR-WP13 | HTR-WP21 | IB-HTR-21 |
| HTR-GAP-041 | Activation authority + Core-uplift status not recorded | blocker | closed (2026-07-12; recorded in Completion Spec decision record, D-14/D-15) | HTR-WP01 | — | HTR-WP01 | IB-HTR-01 |
| HTR-GAP-042 | Execution Server code-ready package/manifest contracts absent | major | open | HTR-WP23 | HTR-WP12 | HTR-WP23 | IB-HTR-23 |

## Intake rules

- Add a gap when implementation lags an **active** completion spec acceptance criterion.
- Do **not** use gaps for product semantics disputes — escalate via [`docs/waia-governance/EXECUTION-CONTRACT.md`](../waia-governance/EXECUTION-CONTRACT.md).
- Gap closure updates this registry on the shared DEE-415 branch in the same work package that produces closure evidence.
- No additional Linear issues for individual work packages unless a verified independent integration boundary appears and the Human explicitly approves.

## Resolution workflow

1. Triage gap → assign `severity`, `PRIMARY_OWNER`, `CONTRIBUTING`, `CLOSURE`.
2. Map to roadmap integration batch (`IB-HTR-NN`) and work package (`HTR-WPNN`).
3. Execute via Build-enabled child Cursor plan on branch `dee-415-ai-trader-historical-test-readiness`.
4. Close gap when CLOSURE work package evidence is recorded; set `status: closed`, `closedAt`, and `batchRef`.
5. Whole-program gap closeout included in the DEE-415 branch before the single final PR.

## Traceability

| Artefact | Link |
|----------|------|
| Completion spec | [`docs/product-specs/ai-trader-historical-test-readiness-completion.md`](../product-specs/ai-trader-historical-test-readiness-completion.md) |
| Roadmap | [`docs/roadmaps/ai-trader-historical-test-readiness-roadmap.md`](../roadmaps/ai-trader-historical-test-readiness-roadmap.md) |
| Canonical integration plan | [`docs/plans/dee-415-ai-trader-historical-test-readiness.md`](../plans/dee-415-ai-trader-historical-test-readiness.md) |
| Linear | DEE-415 |
| Lifecycle | [`docs/waia-governance/LIFECYCLE.md`](../waia-governance/LIFECYCLE.md) |
