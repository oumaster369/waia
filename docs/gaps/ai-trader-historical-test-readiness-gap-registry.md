---
registryId: GAP-AI-TRADER-HISTORICAL-TEST-READINESS
title: "AI-TRADER Historical-Test Readiness — Gap Registry"
scope: ai-trader
owner: Architect
linkedSpec: docs/product-specs/ai-trader-historical-test-readiness-completion.md
linkedRoadmap: docs/roadmaps/ai-trader-historical-test-readiness-roadmap.md
lastReviewed: 2026-07-18
version: 0.1.4
---

# AI-TRADER Historical-Test Readiness — Gap Registry

Tracks known gaps between `READY_FOR_FULL_HISTORICAL_TEST` intent and current implementation for the DEE-415 program (23 work packages, one integration boundary).

## Purpose

Make missing or partial work explicit for the Historical-Test Readiness program. Each gap has exactly one **PRIMARY_OWNER**, zero or more **CONTRIBUTING** surfaces, and a **CLOSURE** unit that produces sufficient integrated evidence to close the gap. A gap is **not** closed merely because primary code landed if qualification evidence remains outstanding.

**Terminology:**

- **PRIMARY_OWNER** — original work package whose accepted output owns the deficient contract.
- **CONTRIBUTING** — other original work packages (`HTR-WPxx` only) whose surfaces participate in the correction.
- **CLOSURE** — original work package **or** Human-approved final-audit corrective closure unit that produces sufficient integrated evidence to close the gap.

**Identifier rules:**

- **PRIMARY_OWNER** and **CONTRIBUTING** use **`HTR-WPxx`** identifiers only (never `HTR-Bxx` or `B21'`).
- For gaps discovered after completion of **HTR-WP01..HTR-WP23**, **CLOSURE** may identify a Human-approved corrective closure unit with identifier **`HTR-FINAL-AUDIT-CORRECTIVE-<ID>`**. Such an identifier is **not** a new work package and does **not** alter the frozen 23-WP decomposition. Its **`batchRef`** must point to the corresponding entry in the **Final-audit corrective batches** roadmap section (`IB-HTR-CORR-<ID>`).

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
| HTR-GAP-005 | Unbounded in-memory trace | blocker | closed (2026-07-18; HTR-WP22 independent Phase-B PASS; bounded-memory soak + completed-runtime D-11B qualification; accepted evidence replay-runs/RI-P7/htr-wp22-runtime-qualification/ semantic digest a7ca958c…) | HTR-WP04 | HTR-WP22 | HTR-WP22 | IB-HTR-04 |
| HTR-GAP-006 | MI-core chain default OFF | blocker | closed (2026-07-16 reconciliation; WP13 WORK d07bb65 CLOSEOUT 2d63eca activated the historical intelligence chain with globalDefaultActivation=false controller and no direct provider access; independent Composer Phase-B PASS; accepted evidence replay-runs/RI-P7/htr-wp13-intelligence-chain/ semantic digest b6b3badd…; registry-stale-open corrected against canonical integration-plan wp13GapsClosed) | HTR-WP13 | — | HTR-WP13 | IB-HTR-13 |
| HTR-GAP-007 | CDE/Decision naming conflation | major | closed (2026-07-16 reconciliation; WP14 WORK b8eeadb CLOSEOUT e4a3a38 separated CDE/MSV snapshot from Decision — cdeMsvSnapshotOnlyNotDecision=true, exactly-one-decision-per-cycle; independent Composer Phase-B PASS; accepted evidence replay-runs/RI-P7/htr-wp14-forecast-decision/ semantic digest 6fd8d3d7…; registry-stale-open corrected against canonical integration-plan wp14GapsClosed) | HTR-WP14 | — | HTR-WP14 | IB-HTR-14 |
| HTR-GAP-008 | whyNotCash + no-trade decision absent | blocker | closed (2026-07-16 reconciliation; WP14 WORK b8eeadb CLOSEOUT e4a3a38 added no-trade decision + whyNotCash — noTradeCyclesHaveNoEntryPurpose=true, every cycle carries exactly one decision; independent Composer Phase-B PASS; accepted evidence replay-runs/RI-P7/htr-wp14-forecast-decision/ semantic digest 6fd8d3d7…; registry-stale-open corrected against canonical integration-plan wp14GapsClosed) | HTR-WP14 | HTR-WP13 | HTR-WP14 | IB-HTR-14 |
| HTR-GAP-009 | Terminal reason not universal | major | closed (2026-07-16 reconciliation; WP13 WORK d07bb65 CLOSEOUT 2d63eca made every cycle carry exactly one terminal reason — everyCycleHasExactlyOneTerminalReason=true; independent Composer Phase-B PASS; accepted evidence replay-runs/RI-P7/htr-wp13-intelligence-chain/ semantic digest b6b3badd…; registry-stale-open corrected against canonical integration-plan wp13GapsClosed) | HTR-WP13 | — | HTR-WP13 | IB-HTR-13 |
| HTR-GAP-010 | MKB read-model unwired | major | closed (2026-07-17; HTR-WP21 WORK f72eed4..b71a381 + independent Phase-B PASS; evidence-driven knowledge-confidence update/decay wired via trader_knowledge_confidence_update_record; accepted evidence replay-runs/RI-P7/htr-wp21-epistemic-closure/ semantic digest c9c52c49…) | HTR-WP15 | HTR-WP21 | HTR-WP21 | IB-HTR-15 |
| HTR-GAP-011 | Forecast/Decision records absent | blocker | closed (2026-07-16 reconciliation; WP14 WORK b8eeadb CLOSEOUT e4a3a38 added forecast + decision records — everyCycleHasZeroOrMoreForecasts=true, everyCycleHasExactlyOneDecision=true, deterministic record IDs/content digests, two-generation semantic parity EXACT; independent Composer Phase-B PASS; accepted evidence replay-runs/RI-P7/htr-wp14-forecast-decision/ semantic digest 6fd8d3d7…; registry-stale-open corrected against canonical integration-plan wp14GapsClosed) | HTR-WP14 | — | HTR-WP14 | IB-HTR-14 |
| HTR-GAP-012 | PIT provider context missing | blocker | closed (2026-07-14; WP11 WORK f6cefb0 added the single sanctioned buildHistoricalIngressContext producer + sidecar-v3 PIT selection — event/ingest/availableAt eligibility, deterministic four-key tie-break, bounded freshness, all 15 optional lanes explicit incl. UNAVAILABLE/SIDECAR_LANE_ABSENT, V1/V2 byte compatibility; accepted evidence replay-runs/RI-P7/htr-wp11-pit-provider-context/ manifest digest b8f043ac…; Opus Macro-D Phase B PASS) | HTR-WP11 | — | HTR-WP11 | IB-HTR-11 |
| HTR-GAP-013 | Gateway bypass on historical paths | major | closed (2026-07-14; WP11 WORK f6cefb0 gateway enforcement — assertNoNetworkImport + assertNoFutureEvidence, no live provider/network call, replay/live normalization+degradation parity, HistoricalBarReplaySource/HistoricalBarSource/FixtureBarReplaySource routed through the sanctioned historical ingress; Opus Macro-D Phase B PASS) | HTR-WP11 | — | HTR-WP11 | IB-HTR-11 |
| HTR-GAP-014 | No ingress bar-integrity gate | blocker | closed (2026-07-14; WP12 WORK 993fdab added the fail-closed structural bar-integrity gate — nine classes: identity mismatch, non-monotonic timestamps, duplicates, interval misalignment, non-finite OHLCV, negative volume, invalid OHLC relation, malformed provenance, digest mismatch — invoked by HistoricalBarReplaySource + HistoricalBarSource + loadQualificationBars before first Canvas advance; no warning-only continuation; Opus Macro-D Phase B PASS) | HTR-WP12 | — | HTR-WP12 | IB-HTR-12 |
| HTR-GAP-015 | No versioned dataset manifest | blocker | closed (2026-07-14; WP12 WORK 993fdab added immutable content-addressed fhv-dataset-manifest/v1 — HTX_ONLY SPOT BTCUSDT+ETHUSDT, 1m base + closed-bar 15m/1h/4h/1d derivation, exact UTC half-open partitions, source checksums, normalized+bar-set digests, gap records, FHV_GAP_POLICY_V1 zero-tolerance result, self-digest exclusion, blind holdout SEALED_NOT_ACCESSED — semantic digest fd7d4895…; contract now EXISTS but the real HTX 2020–2025 dataset is NOT yet acquired/qualified and the full FHV remains unauthorized — final runbook/manifest pinning + real-run preflight owned by HTR-WP23; Opus Macro-D Phase B PASS) | HTR-WP12 | HTR-WP23 | HTR-WP12 | IB-HTR-12 |
| HTR-GAP-016 | Cancel/expire/partial-fill sim missing | major | CLOSED_REVALIDATED_ON_DEFAULT_RESEARCH_PATH (historicalCloseout 47b2ece; historicalEffectiveHead 6c6e693; historicalEvidence replay-runs/RI-P7/htr-wp17-execution-simulation/; defaultPathCorrection bc39900; defaultPathEvidence replay-runs/RI-P7/htr-wp17-default-path-conformance/; phaseB PASS 2026-07-16) | HTR-WP17 | — | HTR-WP17 | IB-HTR-17 |
| HTR-GAP-017 | Spread/impact/latency not modeled | major | CLOSED_REVALIDATED_ON_DEFAULT_RESEARCH_PATH (historicalCloseout 47b2ece; historicalEffectiveHead 6c6e693; historicalEvidence replay-runs/RI-P7/htr-wp17-execution-simulation/; defaultPathCorrection bc39900; defaultPathEvidence replay-runs/RI-P7/htr-wp17-default-path-conformance/; phaseB PASS 2026-07-16) | HTR-WP17 | — | HTR-WP17 | IB-HTR-17 |
| HTR-GAP-018 | Position/balance vs ledger reconcile missing | major | closed (2026-07-17; HTR-WP19 WORK 5558860 + default-path corrective 96144e0; independent Phase-B PASS; accounting reconciliation invariants on default path; accepted evidence replay-runs/RI-P7/htr-wp19-reality-reconciliation/ semantic digest 393d6ccc…) | HTR-WP19 | — | HTR-WP19 | IB-HTR-19 |
| HTR-GAP-019 | Dual inventory; parity; M9 accounting unproven | blocker | closed (2026-07-17; HTR-WP18/WP19 WORK + fixture corrective 077ea43; independent Phase-B PASS; dual-purpose M9 fixture + reconciliation regression; accepted evidence replay-runs/RI-P7/htr-wp19-reality-reconciliation/) | HTR-WP18 | HTR-WP19, HTR-WP20 | HTR-WP19 | IB-HTR-18 |
| HTR-GAP-020 | Strategy pinning/gating/lifecycle/trial | major | closed (2026-07-15; HTR-WP16 WORK 93d6908; independent Phase-B PASS; exact version pin, lifecycle, trial, eligibility gates; Postgres 0090–0093; accepted evidence replay-runs/RI-P7/htr-wp16-strategy-gating/) | HTR-WP16 | — | HTR-WP16 | IB-HTR-16 |
| HTR-GAP-021 | riskMultiplier unused | minor | closed (2026-07-15; HTR-WP16 applyRiskMultiplierToQuantity integrated in paper-cycle-runner; downward-only clamp; unit tests PASS) | HTR-WP16 | — | HTR-WP16 | IB-HTR-16 |
| HTR-GAP-022 | Guardian vocabulary incomplete; exit-reason | major | closed (2026-07-17; HTR-WP20 WORK b820a06 + default-path corrective 96144e0; independent Phase-B PASS; Guardian exit taxonomy, submission restrictions, closed-trade invariants; accepted evidence replay-runs/RI-P7/htr-wp20-guardian-exit-reality/ semantic digest e5fa84d6…) | HTR-WP20 | — | HTR-WP20 | IB-HTR-20 |
| HTR-GAP-023 | Cost model not on default fills; net vs gross | blocker | closed (2026-07-17; HTR-WP18 WORK 09573c5 + default-path corrective 96144e0 + RLS proof corrective 24c0eb9; independent Phase-B PASS; dual-basis accounting on default path; Postgres 0100/0101 with table-privilege denial before RLS; accepted evidence replay-runs/RI-P7/htr-wp18-accounting-parity/ semantic digest fd22742d…) | HTR-WP17 | HTR-WP18 | HTR-WP18 | IB-HTR-17 |
| HTR-GAP-024 | No per-stage timing / perf telemetry | major | closed (2026-07-18; HTR-WP22 independent Phase-B PASS; completed-runtime D-11B perf telemetry at afd9a310 with fullHistoryRescans 0; accepted evidence replay-runs/RI-P7/htr-wp22-runtime-qualification/) | HTR-WP03 | — | HTR-WP22 | IB-HTR-03 |
| HTR-GAP-025 | Determinism residuals | blocker | closed (2026-07-14; WP10 WORK befa6c1 injected deterministic clock/ID seams (deterministic-replay-id-factory, session/repository/lifecycle clock injection), removed Date.now() lookahead in evaluatedAt; fresh-process + checkpoint/resume byte-identical decisions/evidence/digests proven; Opus Macro-C Phase B PASS) | HTR-WP10 | — | HTR-WP10 | IB-HTR-10 |
| HTR-GAP-026 | All-or-nothing evidence sealing; no crash-recovery | blocker | closed (2026-07-18; HTR-WP22 independent Phase-B PASS; crash-recovery matrix + checkpoint/resume parity evidence; accepted evidence replay-runs/RI-P7/htr-wp22-runtime-qualification/) | HTR-WP04 | — | HTR-WP22 | IB-HTR-04 |
| HTR-GAP-027 | No checkpoint/resume | major | closed (2026-07-18; HTR-WP22 independent Phase-B PASS; checkpoint/resume parity + multi-position digest parity; accepted evidence replay-runs/RI-P7/htr-wp22-runtime-qualification/) | HTR-WP05 | — | HTR-WP22 | IB-HTR-05 |
| HTR-GAP-028 | Readiness preflight absent | major | closed (2026-07-18; HTR-WP23 independent Phase-B PASS; readiness preflight CLI + negative matrix + self-test; accepted evidence replay-runs/RI-P7/htr-wp23-readiness-package/) | HTR-WP23 | — | HTR-WP23 | IB-HTR-23 |
| HTR-GAP-029 | Pipeline-body DB-disconnect resilience | major | closed (2026-07-18; HTR-WP22 independent Phase-B PASS; crash-recovery matrix includes DB-disconnect recovery; accepted evidence replay-runs/RI-P7/htr-wp22-runtime-qualification/) | HTR-WP05 | — | HTR-WP22 | IB-HTR-05 |
| HTR-GAP-030 | Status/vault drift | major | closed (2026-07-12; WP02 WORK COMMIT 7ec02dd; engineering-status trued-up, HTR authority explicit, forensic canon registered) | HTR-WP02 | — | HTR-WP02 | IB-HTR-02 |
| HTR-GAP-031 | No-lookahead/determinism property-suite gaps | blocker | closed (2026-07-14; WP10 WORK befa6c1 added bounded deterministic property suites — clock-injection, default-session determinism, digest stability, order-id + lifecycle determinism, no-lookahead, closed-HTF; all green; evidence digest fa5def37; Opus Macro-C Phase B PASS) | HTR-WP10 | HTR-WP07, HTR-WP11 | HTR-WP10 | IB-HTR-10 |
| HTR-GAP-032 | Canonical artifacts not created | major | closed (2026-07-12; WORK COMMIT 6600708) | HTR-WP01 | — | HTR-WP01 | IB-HTR-01 |
| HTR-GAP-033 | Master-plan frontmatter unsafe | major | closed | — | — | — | — |
| HTR-GAP-034 | Gate-A naming collision + duplicate authority | major | closed (2026-07-12; WP01 canon + WP02 WORK COMMIT 7ec02dd; active AI-TRADER Gate-A renamed to M9 Accounting Gate, residuals classified, governance Gate A untouched, D-13 supersession recorded) | HTR-WP01 | HTR-WP02 | HTR-WP02 | IB-HTR-01 |
| HTR-GAP-035 | WP18/WP19 accounting-frontier + reconciliation Postgres local parity (Model B reclassification 2026-07-16; original CI-only/skipped-locally framing refuted; 0 env-gated skips; retained scope = accounting-class suites WP18/WP19 create) | major | closed (2026-07-17; HTR-WP18/WP19 accounting-class Postgres parity 13/13 PASS at 24c0eb9; table-privilege access control proof; independent Phase-B PASS; scope limited to accounting/reconciliation Model-B suites — not broader repository Postgres debt) | HTR-WP18 | HTR-WP19 | HTR-WP19 | IB-HTR-18 |
| HTR-GAP-036 | Forecast pre-registration + horizon resolution absent | blocker | closed (2026-07-17; HTR-WP21 independent Phase-B PASS; append-only trader_forecast_outcome_record with sealed-before-outcome resolution, PIT-realized outcomes, INVALIDATED non-scoring; accepted evidence replay-runs/RI-P7/htr-wp21-epistemic-closure/) | HTR-WP14 | HTR-WP21 | HTR-WP21 | IB-HTR-14 |
| HTR-GAP-037 | Calibration scoring (Brier/log-loss, sample-gated, survivorship-aware) MISSING | blocker | closed (2026-07-17; HTR-WP21 independent Phase-B PASS; min samples=30, FULL_RUN_CUMULATIVE window, partition [forecast_model_version, regime, horizon], Brier+log-loss with 4dp round-half-even; accepted evidence replay-runs/RI-P7/htr-wp21-epistemic-closure/) | HTR-WP21 | — | HTR-WP21 | IB-HTR-21 |
| HTR-GAP-038 | Knowledge-confidence update/decay unwired | major | closed (2026-07-17; HTR-WP21 independent Phase-B PASS; EVIDENCE_AND_MKB_READ_MODEL_ONLY authority, ±0.0500 cap, bounds [0,1], 120-bar half-life decay, prohibited same-run Decision/capital/Guardian authority; accepted evidence replay-runs/RI-P7/htr-wp21-epistemic-closure/) | HTR-WP21 | HTR-WP15 | HTR-WP21 | IB-HTR-21 |
| HTR-GAP-039 | No-trade/abstention outcome scoring absent | major | closed (2026-07-17; HTR-WP21 independent Phase-B PASS; NO_TRADE first-class abstention scoring with PIT-valid counterfactual, INVALIDATED non-wrong, no same-run capital authority; accepted evidence replay-runs/RI-P7/htr-wp21-epistemic-closure/) | HTR-WP21 | HTR-WP14 | HTR-WP21 | IB-HTR-21 |
| HTR-GAP-040 | Hypothesis outcome resolution not evidence-driven in replay | major | closed (2026-07-17; HTR-WP21 independent Phase-B PASS; hypothesis evidence linked to authoritative records, operatorDisposition PENDING unless Human acts, no automatic strategy promotion; accepted evidence replay-runs/RI-P7/htr-wp21-epistemic-closure/) | HTR-WP21 | HTR-WP13 | HTR-WP21 | IB-HTR-21 |
| HTR-GAP-041 | Activation authority + Core-uplift status not recorded | blocker | closed (2026-07-12; recorded in Completion Spec decision record, D-14/D-15) | HTR-WP01 | — | HTR-WP01 | IB-HTR-01 |
| HTR-GAP-042 | Execution Server code-ready package/manifest contracts absent | major | closed (2026-07-18; HTR-WP23 independent Phase-B PASS; Option A code-ready package manifest with no-server-mutation attestation; accepted evidence replay-runs/RI-P7/htr-wp23-readiness-package/) | HTR-WP23 | HTR-WP12 | HTR-WP23 | IB-HTR-23 |
| HTR-GAP-043 | Local Postgres parity setup-hook failure (auth.users seeding + invalid UUID fixtures; 13 suites/29 tests not executed) | major | closed (2026-07-18; HTR-WP23 independent Phase-B PASS; corrective 6647b903; GAP-043 13 files / 29 executed / 0 failed / 0 skipped; accepted evidence replay-runs/RI-P7/htr-wp23-readiness-package/) | HTR-WP23 | — | HTR-WP23 | IB-HTR-23 |
| HTR-GAP-044 | Research-intelligence Postgres parity multi-regime coverage assertion (5 tests) | major | closed (2026-07-18; HTR-WP22 independent Phase-B PASS; GAP-044 2 files / 12 executed / 0 failed / 0 skipped with real regime lineage; accepted evidence replay-runs/RI-P7/htr-wp22-runtime-qualification/) | HTR-WP13 | HTR-WP22 | HTR-WP22 | IB-HTR-13 |
| HTR-GAP-045 | Twin/runtime Postgres suites auth.users FK (28+1 tests; outside AI-TRADER Macro-H; external Twin backlog — no false closure by WP15) | minor | open (NON_BLOCKING_EXTERNAL_BACKLOG; closureOwner=external-Twin-backlog; blocking READY_FOR_FULL_HISTORICAL_TEST=false) | — | — | external-Twin-backlog | IB-HTR-15 |
| HTR-GAP-046 | D-20 monthly/strategy drawdown semantics not tracked in hot path (FA-001) | blocker | open (2026-07-18; final audit adjudication; monthlyPeakHwm aliased to account equityHwm; strategy drawdown unreachable) | HTR-WP16 | HTR-WP18, HTR-WP20, HTR-WP22 | HTR-FINAL-AUDIT-CORRECTIVE-A | IB-HTR-CORR-A |
| HTR-GAP-047 | D-5 vs FHV cost-model contradiction; no single authoritative cost object (FA-002) | blocker | open (2026-07-18; D-5 20/5/10 bps vs FHV pin 10/5 bps on default path) | HTR-WP17 | HTR-WP18, HTR-WP19, HTR-WP22, HTR-WP23 | HTR-FINAL-AUDIT-CORRECTIVE-A | IB-HTR-CORR-A |
| HTR-GAP-048 | cancelPartialEntry emitted on breach but unconsumed; partial entry remainder not cancelled (FA-003) | blocker | open (2026-07-18; safety contract defect; WP20 partial-entry cancellation incomplete) | HTR-WP20 | HTR-WP17, HTR-WP22 | HTR-FINAL-AUDIT-CORRECTIVE-A | IB-HTR-CORR-A |
| HTR-GAP-049 | FHV semantic trace + operator/six-report emitters missing; schema-only (FA-004) | blocker | open (2026-07-18; blocks code-ready FHV capability; not post-DEE-415 deferral) | HTR-WP23 | HTR-WP04, HTR-WP13, HTR-WP14, HTR-WP18, HTR-WP19, HTR-WP20, HTR-WP21, HTR-WP22 | HTR-FINAL-AUDIT-CORRECTIVE-A | IB-HTR-CORR-A |

## Intake rules

- Add a gap when implementation lags an **active** completion spec acceptance criterion.
- Do **not** use gaps for product semantics disputes — escalate via [`docs/waia-governance/EXECUTION-CONTRACT.md`](../waia-governance/EXECUTION-CONTRACT.md).
- Gap closure updates this registry on the shared DEE-415 branch in the same work package that produces closure evidence.
- No additional Linear issues for individual work packages unless a verified independent integration boundary appears and the Human explicitly approves.

## Resolution workflow

1. Triage gap → assign `severity`, `PRIMARY_OWNER`, `CONTRIBUTING`, `CLOSURE`.
2. Map to roadmap batch: ordinary gaps → integration batch `IB-HTR-NN` + work package `HTR-WPNN`; post-final-audit gaps → corrective batch `IB-HTR-CORR-<ID>` + corrective unit `HTR-FINAL-AUDIT-CORRECTIVE-<ID>`.
3. Execute via Build-enabled child Cursor plan on branch `dee-415-ai-trader-historical-test-readiness` (ordinary WP closure **or** Human-approved final-audit corrective closure unit).
4. Close gap when CLOSURE unit evidence is recorded; set `status: closed`, `closedAt`, and `batchRef` (`IB-HTR-NN` or `IB-HTR-CORR-<ID>` as applicable).
5. Whole-program gap closeout included in the DEE-415 branch before the single final PR.

## Traceability

| Artefact | Link |
|----------|------|
| Completion spec | [`docs/product-specs/ai-trader-historical-test-readiness-completion.md`](../product-specs/ai-trader-historical-test-readiness-completion.md) |
| Roadmap | [`docs/roadmaps/ai-trader-historical-test-readiness-roadmap.md`](../roadmaps/ai-trader-historical-test-readiness-roadmap.md) |
| Canonical integration plan | [`docs/plans/dee-415-ai-trader-historical-test-readiness.md`](../plans/dee-415-ai-trader-historical-test-readiness.md) |
| Linear | DEE-415 |
| Lifecycle | [`docs/waia-governance/LIFECYCLE.md`](../waia-governance/LIFECYCLE.md) |
