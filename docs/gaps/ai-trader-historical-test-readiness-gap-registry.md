---
registryId: GAP-AI-TRADER-HISTORICAL-TEST-READINESS
title: "AI-TRADER Historical-Test Readiness — Gap Registry"
scope: ai-trader
owner: Architect
linkedSpec: docs/product-specs/ai-trader-historical-test-readiness-completion.md
linkedRoadmap: docs/roadmaps/ai-trader-historical-test-readiness-roadmap.md
lastReviewed: 2026-07-16
version: 0.1.1
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
| HTR-GAP-001 | No incremental replay / O(N²) / no Canvas | blocker | closed (2026-07-14; WP09 runtime cutover WORK 46820ac made incremental Canvas the default replay substrate; D-11B PASS under Memory Gate Amendment v1 at 7c532f5, accepted evidence replay-runs/RI-P7/htr-wp09-canvas-runtime-qualification/ digest 78560485…, fullHistoryRescans 0, semantic+digest parity EXACT; Opus Macro-C Phase B PASS) | HTR-WP06 | HTR-WP07, HTR-WP08 | HTR-WP09 | IB-HTR-06 |
| HTR-GAP-002 | Reconstruction full recompute | blocker | closed (2026-07-14; WP09 runtime cutover WORK 46820ac shipped incremental reconstruction as default with exact closed-boundary oracle parity and FULL_HISTORY_RESCANS 0 proven under the accepted D-11B Amendment-v1 qualification; Opus Macro-C Phase B PASS) | HTR-WP08 | — | HTR-WP09 | IB-HTR-08 |
| HTR-GAP-003 | MTF full resample | blocker | closed (2026-07-14; WP09 runtime cutover WORK 46820ac shipped incremental closed-bar MTF aggregation as default with byte-exact oracle parity under the accepted D-11B Amendment-v1 qualification; Opus Macro-C Phase B PASS) | HTR-WP07 | — | HTR-WP09 | IB-HTR-07 |
| HTR-GAP-004 | Partial-bar HTF leakage | blocker | closed (2026-07-14; WP10 WORK befa6c1 closed-HTF/no-lookahead property suites prove still-forming buckets never enter HTF structure and no partial-bar leakage; full validation green; Opus Macro-C Phase B PASS) | HTR-WP07 | HTR-WP10 | HTR-WP10 | IB-HTR-07 |
| HTR-GAP-005 | Unbounded in-memory trace | blocker | open (2026-07-12; WP04 WORK COMMIT b3abe7b + CLOSEOUT supplied bounded STREAM_ONLY retention — 0 retained PaperCycleResults, ≤32 buffered evidence projections, fixed O(1) buffer high-water at N=40 and N=81 (both 32), no O(N) final rebuild, M9 exporters stream the iterator; semantic-parity PASS; baseline at replay-runs/RI-P7/htr-wp04-streaming-evidence-baseline/; CLOSURE remains HTR-WP22 full complete-runtime memory soak) | HTR-WP04 | HTR-WP22 | HTR-WP22 | IB-HTR-04 |
| HTR-GAP-006 | MI-core chain default OFF | blocker | closed (2026-07-16 reconciliation; WP13 WORK d07bb65 CLOSEOUT 2d63eca activated the historical intelligence chain with globalDefaultActivation=false controller and no direct provider access; independent Composer Phase-B PASS; accepted evidence replay-runs/RI-P7/htr-wp13-intelligence-chain/ semantic digest b6b3badd…; registry-stale-open corrected against canonical integration-plan wp13GapsClosed) | HTR-WP13 | — | HTR-WP13 | IB-HTR-13 |
| HTR-GAP-007 | CDE/Decision naming conflation | major | closed (2026-07-16 reconciliation; WP14 WORK b8eeadb CLOSEOUT e4a3a38 separated CDE/MSV snapshot from Decision — cdeMsvSnapshotOnlyNotDecision=true, exactly-one-decision-per-cycle; independent Composer Phase-B PASS; accepted evidence replay-runs/RI-P7/htr-wp14-forecast-decision/ semantic digest 6fd8d3d7…; registry-stale-open corrected against canonical integration-plan wp14GapsClosed) | HTR-WP14 | — | HTR-WP14 | IB-HTR-14 |
| HTR-GAP-008 | whyNotCash + no-trade decision absent | blocker | closed (2026-07-16 reconciliation; WP14 WORK b8eeadb CLOSEOUT e4a3a38 added no-trade decision + whyNotCash — noTradeCyclesHaveNoEntryPurpose=true, every cycle carries exactly one decision; independent Composer Phase-B PASS; accepted evidence replay-runs/RI-P7/htr-wp14-forecast-decision/ semantic digest 6fd8d3d7…; registry-stale-open corrected against canonical integration-plan wp14GapsClosed) | HTR-WP14 | HTR-WP13 | HTR-WP14 | IB-HTR-14 |
| HTR-GAP-009 | Terminal reason not universal | major | closed (2026-07-16 reconciliation; WP13 WORK d07bb65 CLOSEOUT 2d63eca made every cycle carry exactly one terminal reason — everyCycleHasExactlyOneTerminalReason=true; independent Composer Phase-B PASS; accepted evidence replay-runs/RI-P7/htr-wp13-intelligence-chain/ semantic digest b6b3badd…; registry-stale-open corrected against canonical integration-plan wp13GapsClosed) | HTR-WP13 | — | HTR-WP13 | IB-HTR-13 |
| HTR-GAP-010 | MKB read-model unwired | major | open | HTR-WP15 | HTR-WP21 | HTR-WP21 | IB-HTR-15 |
| HTR-GAP-011 | Forecast/Decision records absent | blocker | closed (2026-07-16 reconciliation; WP14 WORK b8eeadb CLOSEOUT e4a3a38 added forecast + decision records — everyCycleHasZeroOrMoreForecasts=true, everyCycleHasExactlyOneDecision=true, deterministic record IDs/content digests, two-generation semantic parity EXACT; independent Composer Phase-B PASS; accepted evidence replay-runs/RI-P7/htr-wp14-forecast-decision/ semantic digest 6fd8d3d7…; registry-stale-open corrected against canonical integration-plan wp14GapsClosed) | HTR-WP14 | — | HTR-WP14 | IB-HTR-14 |
| HTR-GAP-012 | PIT provider context missing | blocker | closed (2026-07-14; WP11 WORK f6cefb0 added the single sanctioned buildHistoricalIngressContext producer + sidecar-v3 PIT selection — event/ingest/availableAt eligibility, deterministic four-key tie-break, bounded freshness, all 15 optional lanes explicit incl. UNAVAILABLE/SIDECAR_LANE_ABSENT, V1/V2 byte compatibility; accepted evidence replay-runs/RI-P7/htr-wp11-pit-provider-context/ manifest digest b8f043ac…; Opus Macro-D Phase B PASS) | HTR-WP11 | — | HTR-WP11 | IB-HTR-11 |
| HTR-GAP-013 | Gateway bypass on historical paths | major | closed (2026-07-14; WP11 WORK f6cefb0 gateway enforcement — assertNoNetworkImport + assertNoFutureEvidence, no live provider/network call, replay/live normalization+degradation parity, HistoricalBarReplaySource/HistoricalBarSource/FixtureBarReplaySource routed through the sanctioned historical ingress; Opus Macro-D Phase B PASS) | HTR-WP11 | — | HTR-WP11 | IB-HTR-11 |
| HTR-GAP-014 | No ingress bar-integrity gate | blocker | closed (2026-07-14; WP12 WORK 993fdab added the fail-closed structural bar-integrity gate — nine classes: identity mismatch, non-monotonic timestamps, duplicates, interval misalignment, non-finite OHLCV, negative volume, invalid OHLC relation, malformed provenance, digest mismatch — invoked by HistoricalBarReplaySource + HistoricalBarSource + loadQualificationBars before first Canvas advance; no warning-only continuation; Opus Macro-D Phase B PASS) | HTR-WP12 | — | HTR-WP12 | IB-HTR-12 |
| HTR-GAP-015 | No versioned dataset manifest | blocker | closed (2026-07-14; WP12 WORK 993fdab added immutable content-addressed fhv-dataset-manifest/v1 — HTX_ONLY SPOT BTCUSDT+ETHUSDT, 1m base + closed-bar 15m/1h/4h/1d derivation, exact UTC half-open partitions, source checksums, normalized+bar-set digests, gap records, FHV_GAP_POLICY_V1 zero-tolerance result, self-digest exclusion, blind holdout SEALED_NOT_ACCESSED — semantic digest fd7d4895…; contract now EXISTS but the real HTX 2020–2025 dataset is NOT yet acquired/qualified and the full FHV remains unauthorized — final runbook/manifest pinning + real-run preflight owned by HTR-WP23; Opus Macro-D Phase B PASS) | HTR-WP12 | HTR-WP23 | HTR-WP12 | IB-HTR-12 |
| HTR-GAP-016 | Cancel/expire/partial-fill sim missing | major | REOPENED_PENDING_WP17_DEFAULT_PATH_CONFORMANCE_REVALIDATION (historicalCloseout 47b2ece; historicalEffectiveHead 6c6e693; historicalEvidence replay-runs/RI-P7/htr-wp17-execution-simulation/; reopenReason default research path did not propagate WP17 profile) | HTR-WP17 | — | HTR-WP17 | IB-HTR-17 |
| HTR-GAP-017 | Spread/impact/latency not modeled | major | REOPENED_PENDING_WP17_DEFAULT_PATH_CONFORMANCE_REVALIDATION (historicalCloseout 47b2ece; historicalEffectiveHead 6c6e693; historicalEvidence replay-runs/RI-P7/htr-wp17-execution-simulation/; reopenReason default research path did not propagate WP17 profile) | HTR-WP17 | — | HTR-WP17 | IB-HTR-17 |
| HTR-GAP-018 | Position/balance vs ledger reconcile missing | major | open | HTR-WP19 | — | HTR-WP19 | IB-HTR-19 |
| HTR-GAP-019 | Dual inventory; parity; M9 accounting unproven | blocker | open | HTR-WP18 | HTR-WP19, HTR-WP20 | HTR-WP19 | IB-HTR-18 |
| HTR-GAP-020 | Strategy pinning/gating/lifecycle/trial | major | closed (2026-07-15; HTR-WP16 WORK 93d6908; independent Phase-B PASS; exact version pin, lifecycle, trial, eligibility gates; Postgres 0090–0093; accepted evidence replay-runs/RI-P7/htr-wp16-strategy-gating/) | HTR-WP16 | — | HTR-WP16 | IB-HTR-16 |
| HTR-GAP-021 | riskMultiplier unused | minor | closed (2026-07-15; HTR-WP16 applyRiskMultiplierToQuantity integrated in paper-cycle-runner; downward-only clamp; unit tests PASS) | HTR-WP16 | — | HTR-WP16 | IB-HTR-16 |
| HTR-GAP-022 | Guardian vocabulary incomplete; exit-reason | major | open | HTR-WP20 | — | HTR-WP20 | IB-HTR-20 |
| HTR-GAP-023 | Cost model not on default fills; net vs gross | blocker | open | HTR-WP17 | HTR-WP18 | HTR-WP18 | IB-HTR-17 |
| HTR-GAP-024 | No per-stage timing / perf telemetry | major | open (2026-07-12; WP03 WORK COMMIT 35283ed supplied benchmark instrumentation, per-stage timing baseline, memory high-water, semantic-parity evidence, baseline evidence at replay-runs/RI-P7/htr-wp03-replay-benchmark-baseline/; CLOSURE remains HTR-WP22 full-runtime perf qualification) | HTR-WP03 | — | HTR-WP22 | IB-HTR-03 |
| HTR-GAP-025 | Determinism residuals | blocker | closed (2026-07-14; WP10 WORK befa6c1 injected deterministic clock/ID seams (deterministic-replay-id-factory, session/repository/lifecycle clock injection), removed Date.now() lookahead in evaluatedAt; fresh-process + checkpoint/resume byte-identical decisions/evidence/digests proven; Opus Macro-C Phase B PASS) | HTR-WP10 | — | HTR-WP10 | IB-HTR-10 |
| HTR-GAP-026 | All-or-nothing evidence sealing; no crash-recovery | blocker | open (2026-07-12; WP04 WORK COMMIT b3abe7b + CLOSEOUT supplied streaming per-cycle evidence, atomic checksummed chain-linked chunks, complete/partial manifest truth, graceful SIGTERM partial sealing, hard-kill durable-prefix reconstruction, orphan-temp handling, corrupt-chain quarantine, integrated research-path evidence; baseline at replay-runs/RI-P7/htr-wp04-streaming-evidence-baseline/; CLOSURE remains HTR-WP22) | HTR-WP04 | — | HTR-WP22 | IB-HTR-04 |
| HTR-GAP-027 | No checkpoint/resume | major | open | HTR-WP05 | — | HTR-WP22 | IB-HTR-05 |
| HTR-GAP-028 | Readiness preflight absent | major | open | HTR-WP23 | — | HTR-WP23 | IB-HTR-23 |
| HTR-GAP-029 | Pipeline-body DB-disconnect resilience | major | open | HTR-WP05 | — | HTR-WP22 | IB-HTR-05 |
| HTR-GAP-030 | Status/vault drift | major | closed (2026-07-12; WP02 WORK COMMIT 7ec02dd; engineering-status trued-up, HTR authority explicit, forensic canon registered) | HTR-WP02 | — | HTR-WP02 | IB-HTR-02 |
| HTR-GAP-031 | No-lookahead/determinism property-suite gaps | blocker | closed (2026-07-14; WP10 WORK befa6c1 added bounded deterministic property suites — clock-injection, default-session determinism, digest stability, order-id + lifecycle determinism, no-lookahead, closed-HTF; all green; evidence digest fa5def37; Opus Macro-C Phase B PASS) | HTR-WP10 | HTR-WP07, HTR-WP11 | HTR-WP10 | IB-HTR-10 |
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
