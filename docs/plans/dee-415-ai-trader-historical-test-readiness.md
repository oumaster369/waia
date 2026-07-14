---
integrationIssue: DEE-415
integrationTitle: "AI-TRADER: complete Historical-Test Readiness program"
branch: dee-415-ai-trader-historical-test-readiness
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces:
  - local
  - github-actions
requiredValidation:
  - canon
  - lint
  - typecheck
  - unit
  - build
approvalGates:
  - program-approved
  - child-plan-approved
  - work-package-validated
  - whole-program-integration-ready
  - final-opus-audit
  - human-merge
includedIssues: []
linearStatusFlow:
  onFirstWorkPackageStart: In Progress
  onFinalPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  humanApproval: CONFIRM-DEE-415-HTR-WP01-CHILD-PLAN
  childPlanStatus: APPROVED_EXACT   # 2026-07-13: HTR-MACRO-C (WP09+WP10) refreshed EXACT + Human-approved (APPROVE-HTR-MACRO-C / -BUILD consumed) after D-11B resolution
  programStatus: APPROVED_IDLE   # 2026-07-14: HTR-MACRO-C COMPLETE (WP09+WP10 Opus Phase-B PASS); Macro D refreshed, awaiting Human approval
  activeWorkPackage: HTR-WP11   # WP09+WP10 CLOSEOUT complete (Opus Macro-C Phase B 2026-07-14); advanced to WP11
  macroCMigrationDecision: NONE
  macroCStartingHead: THIS_SESSION_PROCESS_COMMIT   # exact SHA recorded in git log + gitignored controllers; canonical authority is git log (process commit changes planning/governance only)
  macroCCodeBaselineHead: a8a709ff53f74649b5c5f39e0ba8e00af1e113de   # HTR-WP08 CLOSEOUT — latest validated production baseline; process commit changes NO production code
  composerTerminalState: null
  branch: dee-415-ai-trader-historical-test-readiness
  branchCreated: true
  buildStarted: true
  currentWorkPackage: HTR-WP11   # WP09+WP10 CLOSEOUT complete; Macro C COMPLETE; advanced to WP11
  activeChildPlan: .cursor/plans/dee-415-htr-wp04-wp12-runtime-substrate-rolling.plan.md
  workCommitSha: f90faa9f02e12b3a4a724311cd4b7805f9c12f7c
  wp01WorkCommitSha: 6600708adaf0ad7b9d07eacf275bbb31653b25a5
  wp01PostReview: PASS
  wp01Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
  wp02WorkCommitSha: 7ec02dd89fb74b2eaa7b81f384ae1c12ea6819f3
  wp02PostReview: PASS
  wp02Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
  wp02GapsClosed:
    - HTR-GAP-030
    - HTR-GAP-034
  wp03WorkCommitSha: 35283edc03efff975da3cdd489378463be07ddde
  wp03PostReview: PASS
  wp03Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
  wp03BenchmarkEvidence: replay-runs/RI-P7/htr-wp03-replay-benchmark-baseline/
  wp03GapStatus: "HTR-GAP-024 remains OPEN; baseline evidence recorded; closure HTR-WP22"
  wp04WorkCommitSha: b3abe7b9483be9b54752d5dfb38b29155c7a891d
  wp04PostReview: PASS
  wp04Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
  wp04StreamingEvidence: replay-runs/RI-P7/htr-wp04-streaming-evidence-baseline/
  wp04MigrationDecision: NONE
  wp04GapStatus: "HTR-GAP-005 and HTR-GAP-026 remain OPEN; WP04 evidence recorded; closure HTR-WP22"
  wp05WorkCommitSha: f90faa9f02e12b3a4a724311cd4b7805f9c12f7c
  wp05PostReview: PASS
  wp05Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
  wp05StreamingEvidence: replay-runs/RI-P7/htr-wp05-checkpoint-resume-baseline/
  wp05MigrationDecision: NONE
  wp05ParityDigests:
    evidenceDigest: 8a323f92129260ee9e54f26af9298be3b8e85b7ce1f1a709118d9ac43ecd9e1e
    semanticReproDigest: 34494d5aa2c279f094bd1778421199c9c07c0a24168712d08aa889ba163b0d54
    semanticParityDigest: 30e9b40ab4f2aa460bf7388053ce1ef5ed16b88da7720e548449ee7564418d03
  wp05GapStatus: "HTR-GAP-027 (resume) and HTR-GAP-029 (DB-disconnect) remain OPEN; WP05 contributes; final qualification HTR-WP22"
  macroAStatus: COMPLETE
  wp06WorkCommitSha: 24eb7f96313243c707334e57ca9a67bfd66d5ff3
  wp06PostReview: PASS
  wp06Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
  wp06Evidence: replay-runs/RI-P7/htr-wp06-canvas-contract-baseline/
  wp06EvidenceTerminal: CANVAS_STATE_OK
  wp06MigrationDecision: NONE
  wp06GapStatus: "HTR-GAP-001 WP06 Canvas state contract + cursor foundation contribution delivered; CLOSED at HTR-WP09 runtime cutover"
  wp07WorkCommitSha: 10f2500d80db65e010fd9408745b96f34369dff8
  wp07PostReview: PASS
  wp07Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
  wp07Evidence: replay-runs/RI-P7/htr-wp07-incremental-mtf-baseline/
  wp07EvidenceTerminal: CANVAS_MTF_PARITY_OK
  wp07MigrationDecision: NONE
  wp07GapStatus: "HTR-GAP-003 WP07 incremental closed-bar MTF aggregation delivered, CLOSED at HTR-WP09 runtime cutover; HTR-GAP-004 WP07 partial-bar HTF-leakage closed-bar correction delivered, closure owner HTR-WP10"
  wp08WorkCommitSha: 0c4b8c38e7e2a0f74d9b9318b66d750ed7c82ec9
  wp08PostReview: PASS
  wp08Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
  wp08Evidence: replay-runs/RI-P7/htr-wp08-incremental-reconstruction-baseline/
  wp08EvidenceTerminal: RECONSTRUCTION_ORACLE_PARITY_OK
  wp08MigrationDecision: NONE
  wp08OracleParity:
    boundaryCount: 22
    exactMatches: 22
    intentionalDefectCorrections: 0
    divergences: 0
    fullHistoryRescans: 0
    stateWithinDeclaredBounds: true
    barVisitsGrowth: LINEAR_OR_N_LOG_N
  wp08GapStatus: "HTR-GAP-002 WP08 incremental reconstruction + exact closed-boundary oracle parity delivered; CLOSED at HTR-WP09 runtime cutover"
  macroBStatus: COMPLETE
  # --- HTR-WP09 CLOSEOUT (Opus Macro-C Phase B, 2026-07-14) ---
  wp09WorkCommitSha: 46820ace551cdf0ee03c16886b313514a1afdbd3
  wp09PrequalificationCorrectionCommitSha: c57a7a09e87582f818008a413862732ce7574b9b
  wp09InstrumentationCorrectionCommitSha: bc9cb468988294652a7d82c38b17942abfa01b94
  wp09MemoryGateAlignmentCommitSha: 7c532f5ef2d936cff1a28a8f53e8f45d3377d0aa
  wp09AcceptedQualificationGitSha: 7c532f5ef2d936cff1a28a8f53e8f45d3377d0aa   # NOT the WP09 WORK SHA — Human-approved Amendment-v1 exception (see wp09QualificationBindingNote)
  wp09AcceptedQualificationHarnessSha256: 5bd9a61a5f2ed3d022f7c853f05d8e657192f4e53f08de893062ace1436c248c   # sha256 of committed replay-qualification-harness.ts at 7c532f5; prior report's d7f93b75 was a REPORT_ONLY_TYPO, never in any sealed artifact
  wp09ActiveQualificationContract: D11B_MEMORY_GATE_AMENDMENT_V1
  wp09D11bResult: PASS_UNDER_MEMORY_GATE_AMENDMENT_V1
  wp09AcceptedEvidencePath: replay-runs/RI-P7/htr-wp09-canvas-runtime-qualification/
  wp09AcceptedEvidenceSourceStaging: .cursor/plans/dee-415-d11b/qualification-staging/htr-wp09-memory-amendment-v1-attempt-1/
  wp09AcceptedEvidenceManifestDigest: 78560485f2690ed0b7c59d6e8cfe9a5183df1f65d331f6b2b13bbbf4eea0a60c
  wp09HostFingerprintSha256: 1cd9f9535e86b3f5ad13cd907f08059d5ca3650cfbf74d9120449c7355b7a774
  wp09DatasetSha256N2: e3415ffb324961ce19ce014a08d6cc3bc12bcaaba6ae380824dc7049f33a570f
  wp09HistoricalAttempts:
    firstInvalidated: { staging: .cursor/plans/dee-415-d11b/qualification-staging/htr-wp09/, manifestDigest: 10edfeaf1c99302fcf9fc8136482c1e9cfad97f8841b0e09bbd8c39cff1d7e98, status: INVALIDATED_BY_INSTRUMENTATION_FAILURE }
    replacementValidFail: { staging: .cursor/plans/dee-415-d11b/qualification-staging/htr-wp09-replacement-1/, manifestDigest: bff973996e69c14e923e4b84421a36f61921345f673367e76cb332da9c73c6cd, status: VALID_THRESHOLD_FAIL_ORIGINAL_CONTRACT }   # never relabelled PASS
    acceptedAmendmentV1: { staging: .cursor/plans/dee-415-d11b/qualification-staging/htr-wp09-memory-amendment-v1-attempt-1/, manifestDigest: 78560485f2690ed0b7c59d6e8cfe9a5183df1f65d331f6b2b13bbbf4eea0a60c, status: HTR_WP09_D11B_MEMORY_AMENDMENT_V1_PASS }
  wp09ForensicAnnotation: replay-runs/RI-P7/htr-wp09-d11b-replacement-1-forensic-annotation/
  wp09QualificationBindingNote: "Original clean-commit contract required qualificationGitSha == WP09 WORK commit (46820ac). The Human-approved D-11B Memory Gate Amendment v1 (2026-07-13) authorized a new exact qualification baseline at the memory-gate alignment HEAD 7c532f5; qualification is bound to 7c532f5, not 46820ac. The original contract is preserved as historical context; this is the recorded prospective Amendment-v1 exception."
  wp09OpusPostReview: PASS
  wp09TerminalState: WORK_PACKAGE_COMPLETE
  wp09GapsClosed:
    - HTR-GAP-001
    - HTR-GAP-002
    - HTR-GAP-003
  wp09Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
  # --- HTR-WP10 CLOSEOUT (Opus Macro-C Phase B, 2026-07-14) ---
  wp10WorkCommitSha: befa6c15ef2501f975c3f55a0b464924ed52695b
  wp10ValidationCorrectionCommitSha: 2987f37ddaca8b36760e4b9062e48bb83c6f3d13
  wp10EvidencePath: replay-runs/RI-P7/htr-wp10-determinism-nolookahead/
  wp10EvidenceArtifactDigest: fa5def3786dd85fe790c5623c09d76f31b9b67c866409e8fa8ae1ad91274926b   # independently reproduced byte-identically by the WP10 suite
  wp10ValidationCorrectionClassification:
    m9FillAssertion: STALE_TEST_CONTRACT   # `fillExecutedAtIso.length > 0` rendered stale by the Human-approved WP09 incremental-Canvas cutover (introduced at 46820ac): PASS at a8a709f/cad4541 (legacy substrate produced a fill) -> deterministic canonical NO_TRADE under incremental Canvas; removal keeps all determinism assertions + byte-identical empty-fill comparison; fill/timestamp determinism independently proven by WP10 order-id + lifecycle fixtures
    hostLiveMatchSkips: ENVIRONMENT_ONLY   # two live-host reference-match tests skip off the AC qualification host via it.skipIf(!isD11bQualificationHost()); all host-independent canonicalization/mismatch/fail-closed contract tests always run
    failClosedRegex: STALE_TEST_CONTRACT   # regex widened to the D11bHostFingerprintError message prefix (live host mismatch|canonical fingerprint mismatch); remains fail-closed, cannot accept an unrelated exception
  wp10NoWp09MeasurementCriticalChange: true   # verified: no change after 7c532f5 to harness/CLI, D-11B evaluator, Canvas advance/state contract, cutover mode, MTF/reconstruction numeric semantics, measured-stage boundaries, cycle-count contract, dataset/host binding, or sealed evidence; shared-file WP10 edits are behavior-preserving deterministic clock/ID/no-lookahead seams
  wp10OpusPostReview: PASS
  wp10TerminalState: WORK_PACKAGE_COMPLETE
  wp10GapsClosed:
    - HTR-GAP-004
    - HTR-GAP-025
    - HTR-GAP-031
  wp10Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
  macroCStatus: COMPLETE
  completedMacros:
    - HTR-MACRO-A
    - HTR-MACRO-B
    - HTR-MACRO-C
  activeMacroPackage: HTR-MACRO-D
  activeMacroWorkPackages:
    - HTR-WP11
    - HTR-WP12
  activeMacroStatus: DRAFT   # 2026-07-14: Macro C COMPLETE (WP09+WP10 Opus Phase-B PASS); Macro D refreshed in-place in the rolling controller; MACRO_D_MIGRATION_DECISION NONE; awaiting Human REVIEW_AND_APPROVE_HTR_MACRO_D
  buildAuthorized: NO   # 2026-07-14: Macro C closed; Macro D not Build-authorized
  d11bStatus: RESOLVED
  d11bDecisionStatus: HUMAN_APPROVED
  d11bApprovalDate: 2026-07-13
  d11bApprovalToken: "APPROVE-HTR-D11B: qual-bar-count=129600 qual-canvas-advance-count=129600 qual-replay-cycle-count=129581 max-total-wall-ms=1800000 max-mean-replay-cycle-ms=13.891 max-p95-replay-cycle-ms=55.564 max-2x-time-growth=2.20 max-rss-delta-bytes=536870912 max-heap-delta-bytes=268435456 max-2x-mem-growth-bytes=1048576 max-serialized-canvas-bytes=262144 measured-runs=5 max-full-dataset-runtime-range-pct=20.0 semantic-parity=EXACT digest-parity=EXACT full-history-rescans=0 host-env-fingerprint-sha256=1cd9f9535e86b3f5ad13cd907f08059d5ca3650cfbf74d9120449c7355b7a774 dataset-sha256=e3415ffb324961ce19ce014a08d6cc3bc12bcaaba6ae380824dc7049f33a570f threshold-definition-provenance-fingerprint-sha256=27217a73b1287d09d63484353fc7bc72be3faa41369c9051756dcd45fdd89992"
  d11bRole: thresholds-only   # does NOT close WP09/WP22, does NOT authorize Build, does NOT claim qualification PASS
  d11bQuiescencePolicy: PREFLIGHT_CHECKS_ONLY_NO_NUMERIC_LOAD_AVERAGE_GATE
  wp09CleanCommitQualificationSequence: APPROVE-HTR-WP09-CLEAN-COMMIT-QUALIFICATION-SEQUENCE   # bounded WP09-only lifecycle exception; unchanged macro membership / integration boundary / WORK-commit count / Human gates
  wp09PrequalificationCorrection: APPROVE-HTR-WP09-PREQUALIFICATION-CORRECTION   # 2026-07-13: canonical host-fingerprint verifier (semantic JSON, not raw file bytes) + checkpoint/resume Canvas wiring + resume parity tests; original WP09 WORK commit 46820ac preserved; separate prequalification correction commit is the Stage-C qualification baseline (Human exception to qualificationGitSha==WP09 WORK SHA)
  readyForFullHistoricalTest: false
  fullHistoricalValidationRunContract:   # v0 — Human-approved future-run contract (APPROVE-FHV-RUN-CONTRACT-V0); does NOT authorize the run during DEE-415
    version: v0
    approvalToken: APPROVE-FHV-RUN-CONTRACT-V0
    executionPhase: AFTER_DEE_415_AND_CERTIFY_HTR_READY
    venue: HTX                 # CLARIFY-FHV-RUN-CONTRACT-V0 (2026-07-13) — governing MVP is HTX-only
    venueScope: HTX_ONLY
    marketType: SPOT
    instruments: [BTCUSDT, ETHUSDT]
    symbols: [BTCUSDT, ETHUSDT]
    venueClass: spot
    primaryInterval: 1m
    baseInterval: 1m
    derivedIntervals: [15m, 1h, 4h, 1d]
    d11bDatasetVenueRole: "Binance BTCUSDT 2023-04-01..2023-06-29 = D11B_INFRASTRUCTURE_QUALIFICATION_ONLY; NOT the FHV strategy-validation venue/dataset; if exact HTX 1m history for the approved period cannot be obtained + integrity-sealed, HTR-WP12 returns a separate Human dataset-source decision package (no silent Binance/other-venue substitution)"
    derivedIntervalRule: CLOSED_BARS_ONLY
    fullPeriod: { startUtc: 2020-01-01T00:00:00Z, endUtc: 2025-12-31T23:59:00Z }
    developmentCalibration: { startUtc: 2020-01-01T00:00:00Z, endUtc: 2022-12-31T23:59:00Z }
    walkForward: { startUtc: 2023-01-01T00:00:00Z, endUtc: 2024-12-31T23:59:00Z }
    blindHoldout: { startUtc: 2025-01-01T00:00:00Z, endUtc: 2025-12-31T23:59:00Z, status: SEALED_NOT_ACCESSED }
    initialPortfolio:
      quoteCurrency: USDT
      cashUsdt: 100000
      btcQuantity: 0
      ethQuantity: 0
      leverage: 0
      borrowing: PROHIBITED
      shortSelling: PROHIBITED
      externalDepositsDuringRun: 0
      externalWithdrawalsDuringRun: 0
      portfolioMode: SHARED_MULTI_INSTRUMENT
  blindHoldout2025Status: RESERVED_SEALED_NOT_ACCESSED   # contamination audit 2026-07-13: no material strategy/parameter/threshold/feature/model-selection/promotion use of 2025 spot-1m found; no 2025 price content inspected
  d11bDatasetRole: INFRASTRUCTURE_QUALIFICATION_ONLY   # 2023-04-01..2023-06-29 90-day dataset qualifies runtime/memory thresholds only; NOT the full historical program
  drawdownLimitDecision:
    id: D-20
    status: HUMAN_DECISION_REQUIRED_BEFORE_HTR_WP16
    proposedTokenNotConsumed: "APPROVE-HTR-D20-DRAWDOWN-LIMITS: max-account-drawdown-pct=<v> max-monthly-drawdown-pct=<v> max-strategy-drawdown-pct=<v> breach-action=<CLOSE_ONLY_THEN_STOP_ACCOUNT|IMMEDIATE_STOP_ACCOUNT>"
    blocks: [HTR-WP16_ACTIVATION, HTR-WP22_FINAL_QUALIFICATION, CERTIFY_HTR_READY]
    doesNotBlock: [HTR-MACRO-C, HTR-MACRO-D]
  completedWorkPackages:
    - HTR-WP01
    - HTR-WP02
    - HTR-WP03
    - HTR-WP04
    - HTR-WP05
    - HTR-WP06
    - HTR-WP07
    - HTR-WP08
    - HTR-WP09
    - HTR-WP10
  remainingWorkPackages:
    - HTR-WP11
    - HTR-WP12
    - HTR-WP13
    - HTR-WP14
    - HTR-WP15
    - HTR-WP16
    - HTR-WP17
    - HTR-WP18
    - HTR-WP19
    - HTR-WP20
    - HTR-WP21
    - HTR-WP22
    - HTR-WP23
  prNumber: null
  prUrl: null
  lastValidatedGitSha: f90faa9f02e12b3a4a724311cd4b7805f9c12f7c
  lastValidationAt: 2026-07-12
  finalAuditStatus: not-started
  blockedReason: null
  nextAction: "HTR-MACRO-C is COMPLETE (2026-07-14): HTR-WP09 Opus Phase-B PASS (D-11B PASS under Memory Gate Amendment v1, bound to 7c532f5, accepted evidence promoted to replay-runs/RI-P7/htr-wp09-canvas-runtime-qualification/ digest 78560485; CLOSEOUT 3a0962f) and HTR-WP10 Opus Phase-B PASS (WORK befa6c1, validation correction 2987f37 test-only, evidence digest fa5def37, no WP09 measurement-critical surface changed; CLOSEOUT recorded). HTR-GAP-001/002/003 closed at WP09; HTR-GAP-004/025/031 closed at WP10. Macro D (HTR-WP11 PIT provider context + gateway enforcement + absent-lane; HTR-WP12 ingress bar-integrity gate + immutable versioned dataset manifest) refreshed in-place in the rolling controller with MACRO_D_MIGRATION_DECISION NONE; BUILD_AUTHORIZED NO. Next Human gate: REVIEW_AND_APPROVE_HTR_MACRO_D.  Prior context:  Composer 2.5 executes the approved HTR-MACRO-C packet only (HTR-WP09 canvas runtime integration + integrated D-11B qualification + default cutover, then HTR-WP10 determinism/no-lookahead qualification), from the rolling controller. D-11B is RESOLVED (Human-approved 2026-07-13; thresholds only — WP09 still owns the qualification proof; does not close WP09/WP22). HTR-MACRO-C is REFRESHED_EXACT and Human-APPROVED (APPROVE-HTR-MACRO-C + ACK-HTR-MACRO-C-MIGRATION: none + APPROVE-HTR-MACRO-C-BUILD consumed); MACRO_C_MIGRATION_DECISION NONE; MACRO_C_CODE_BASELINE_HEAD a8a709ff. BUILD_AUTHORIZED YES for Macro C only; no auto-advance to Macro D. HTR-GAP-001/002/003 close on WP09 integrated qualification PASS, HTR-GAP-004/025/031 on WP10. Full Historical Validation Run Contract v0 pinned (BTCUSDT+ETHUSDT spot 1m; 2020-01-01..2025-12-31; initial equity 100,000 USDT; 2025 blind holdout SEALED_NOT_ACCESSED); the actual multi-year run executes only AFTER DEE-415 CERTIFY-HTR-READY. Exact account/monthly drawdown percentage remains a Human gate (D-20) before HTR-WP16; it does not block Macro C/D. No intermediate PR; READY_FOR_FULL_HISTORICAL_TEST not set; the single final PR remains gated on all 23 work packages."
provenance:
  createdFrom: roadmap-batch
  supersedes: docs/plans/dee-415-htr-b01-readiness-canon.md
  parentMaster: .cursor/plans/ai-trader_historical-test-readiness_master_20260711.plan.md
  gapRegistry: docs/gaps/ai-trader-historical-test-readiness-gap-registry.md
  relatedRoadmap: docs/roadmaps/ai-trader-historical-test-readiness-roadmap.md
  relatedSpec: docs/product-specs/ai-trader-historical-test-readiness-completion.md
---

# DEE-415 — AI-TRADER: complete Historical-Test Readiness program (canonical integration plan)

> **Single canonical integration plan** for DEE-415 = ONE integration boundary containing 23 sequential work packages (`HTR-WP01..HTR-WP23`), implemented by Build-enabled child Cursor plans one at a time on the shared branch `dee-415-ai-trader-historical-test-readiness`, with a local commit after each work package, ONE final whole-program Opus audit, ONE PR to `dev`, and ONE Human squash merge. It is the **repository-first integration authority for DEE-415 after its first commit**. The `.cursor/plans/` parent controller and child plans are local execution/controller artifacts (mutable), not canonical authority.

## Authority and topology

- **Core invariant:** DEE-415 = one integration issue = one canonical integration plan (this file) = one primary branch (`dee-415-ai-trader-historical-test-readiness`) = one final PR = one Human merge event. The 23 implementation stages are **internal work packages**, not PR boundaries (`INTEGRATION-BOUNDARY-POLICY.md`: "Never split merely because a plan has several steps — those are work-packages inside one PR").
- **Parent controller (guidance/ledger):** `.cursor/plans/ai-trader_historical-test-readiness_master_20260711.plan.md` (rev 5, gitignored).
- **After first commit:** this canonical integration plan `state` + Linear DEE-415 + `git log` are authoritative; the scratch parent is a synchronized mirror.
- Only **one child plan** may be active at a time; all work packages use the **same branch**; each work package produces its own **local commits** (one WORK + one CLOSEOUT); **no child plan may open a PR**; only the final integration closeout (after HTR-WP23 + final Opus audit) prepares the **single final PR**.
- **Execution topology for the WP05–WP12 rolling tranche (rev 5, execution-only — no technical/scope/gap/decision change):** work packages are executed in Human-pre-approved **macros** (`HTR-MACRO-A [WP05]`, `HTR-MACRO-B [WP06–08]`, `HTR-MACRO-C [WP09–10]`, `HTR-MACRO-D [WP11–12]`). One Composer Build session executes the WPs of **one** approved macro sequentially (internal advance only; one WORK commit + targeted validation per WP; full validation at macro end), and one Human-authorized Opus Phase-B session audits the macro with a **per-WP** PASS/FAIL verdict and **one CLOSEOUT commit per WP**. This replaces "one work package per Build session" for WP05–WP12 only; **WP01–WP04 used one WP per Build**. The WP layer is fully preserved (per-WP packet, WORK+CLOSEOUT commits, Opus verdict, gap/decision ownership); no macro merges, adds, removes, renumbers, or reorders any work package; every Human/D-11B/migration gate is held; the integration boundary is unchanged (one branch, zero intermediate PRs, one final PR, one merge).
- **Final PR prohibited** until all 23 work packages are COMPLETE, parent/canonical states synchronized, the full validation matrix is green, the readiness package exists, and Opus completes the final whole-program audit.

## Program goal

Bring AI-TRADER from `dev@f23c51e` to `READY_FOR_FULL_HISTORICAL_TEST` = a code-ready, Human-deployable Execution Server package (Option A). This is an infrastructure + epistemic-integrity qualification (make a full historical run trustworthy, reproducible, and self-scoring), **not** an edge/profitability verdict (ADR-0010). Out of scope: multi-year validation, walk-forward, blind holdout, edge verdict, Strategy Validation Gate approval, paper soak, live trading, real capital, deployed Execution Server qualification.

## Identity and state

| Field | Value |
|-------|-------|
| Linear issue | DEE-415 — https://linear.app/deepsense/issue/DEE-415/ai-trader-htr-b01-ratify-historical-test-readiness-canon-and-program |
| Risk tier (whole program) | T2 |
| Execution label | product |
| Program label | program:ai-trader |
| Branch | `dee-415-ai-trader-historical-test-readiness` (created from `origin/dev` @ `f23c51e`; HTR-WP01 WORK COMMIT `6600708`) |
| PR target / merge | `dev` / squash |
| Planned PR count | 1 · Planned merge count | 1 · Work-package count | 23 |
| Baseline | `dev` @ `f23c51e0ac2eab3ca374e2bd6aee3ceb0ea935e1` (activation baseline / branch base) |
| Plan state | `state.status: in-progress` (HTR-WP01 COMPLETE — WORK COMMIT `6600708`; HTR-WP02 COMPLETE — WORK COMMIT `7ec02dd`, HTR-GAP-030/034 closed; HTR-WP03 COMPLETE — WORK COMMIT `35283ed`, HTR-GAP-024 baseline recorded (OPEN, closure HTR-WP22); HTR-WP04 COMPLETE — WORK COMMIT `b3abe7b`, Opus post-review PASS, validation PASS, streaming-evidence baseline recorded, HTR-GAP-005/026 remain OPEN, closure HTR-WP22; **HTR-WP05 COMPLETE** — WORK COMMIT `f90faa9`, Opus Phase-B post-review PASS, semantic parity digest equality proven (`30e9b40…`), HTR-GAP-027/029 remain OPEN, closure HTR-WP22, MIGRATION_DECISION NONE; **HTR-MACRO-A COMPLETE**; **HTR-MACRO-B COMPLETE** — HTR-WP06 (`24eb7f9`), HTR-WP07 (`10f2500`), HTR-WP08 (`0c4b8c3`), Opus Phase-B per-WP PASS, full validation green, evidence CANVAS_STATE_OK/CANVAS_MTF_PARITY_OK/RECONSTRUCTION_ORACLE_PARITY_OK (22/22 exact, 0 divergence, FULL_HISTORY_RESCANS 0, linear work), HTR-GAP-001/002/003 OPEN closure HTR-WP09, HTR-GAP-004 OPEN closure HTR-WP10, no runtime cutover, MIGRATION_DECISION NONE; **D-11B RESOLVED (Human-approved 2026-07-13, thresholds only); HTR-MACRO-C (WP09–10) REFRESHED_EXACT + Human-APPROVED, MACRO_C_MIGRATION_DECISION NONE, BUILD_AUTHORIZED YES for Macro C only; Composer executes the approved Macro C packet next**) |

## Approved decisions (recorded)

`APPROVE-HTR-PROGRAM`; `APPROVE-HTR-ACTIVATION: research-only-org0` (D-14); `ACK-HTR-CORE: m1-closed` (D-15); `APPROVE-HTR-D13: htr-supersedes` (D-13); `APPROVE-HTR-RUNTIME-SUBSTRATE: deterministic-historical-readiness-substrate` (D-16); `APPROVE-HTR-TARGET-SUBSET: scoped-htr-ratification` (D-17); `APPROVE-HTR-D1: record-level-chain` (D-1); `APPROVE-HTR-EPISTEMIC-CLOSURE: record-level` (D-18); `APPROVE-HTR-EXECSERVER: option-a-code-ready` (D-19); `APPROVE-HTR-D10: divergence-register-v1` (D-10); `APPROVE-HTR-EXECUTION-TOPOLOGY: one-integration-issue-one-branch-one-final-pr-23-sequential-child-build-plans`; **`APPROVE-HTR-D11B`** (D-11B — 2026-07-13, exact token in §"D-11B decision" below); **`APPROVE-HTR-WP09-CLEAN-COMMIT-QUALIFICATION-SEQUENCE`** (2026-07-13); **`APPROVE-HTR-MACRO-C: wp09-canvas-cutover-wp10-determinism`** + **`ACK-HTR-MACRO-C-MIGRATION: none`** + **`APPROVE-HTR-MACRO-C-BUILD`** (2026-07-13 — Macro C APPROVED / `BUILD_AUTHORIZED: YES` for Macro C only); **`APPROVE-FHV-RUN-CONTRACT-V0`** (2026-07-13 — Full Historical Validation Run Contract v0, a future-run contract that does NOT authorize the run during DEE-415); **`APPROVE-HTR-WP09-WP10-QUALIFICATION-BOUNDARY`** (2026-07-13 — WP09 evidence bound to the WP09 WORK commit; pre-approved WP10 determinism/no-lookahead changes may follow; no WP09 harness/Canvas/threshold/dataset/host mutation; no second D-11B attempt; final runtime re-proof owned by WP22); **`CLARIFY-FHV-RUN-CONTRACT-V0`** (2026-07-13 — venue HTX_ONLY, spot, BTCUSDT+ETHUSDT; the Binance D-11B dataset is infrastructure qualification only). Activation boundary: Org-0 non-custodial research/historical only; no live, capital, holdout, external activation, agent authorization, gate opening, or Execution Server mutation. WP-local decisions D-11A/D-2/D-4/D-5/D-12 stop at their owning work package's Human gate on the same branch; **D-11B is RESOLVED (Human-approved)**.

## D-11B decision (Human-approved) + HTR-MACRO-C governance state

Factual governance state as of 2026-07-13 (thresholds only — no qualification has been run; no gap is closed; `READY_FOR_FULL_HISTORICAL_TEST` is not set):

- **D-11B: RESOLVED — Human-approved.** The Human Architect issued the exact D-11B decision token:

```text
APPROVE-HTR-D11B: qual-bar-count=129600 qual-canvas-advance-count=129600 qual-replay-cycle-count=129581 max-total-wall-ms=1800000 max-mean-replay-cycle-ms=13.891 max-p95-replay-cycle-ms=55.564 max-2x-time-growth=2.20 max-rss-delta-bytes=536870912 max-heap-delta-bytes=268435456 max-2x-mem-growth-bytes=1048576 max-serialized-canvas-bytes=262144 measured-runs=5 max-full-dataset-runtime-range-pct=20.0 semantic-parity=EXACT digest-parity=EXACT full-history-rescans=0 host-env-fingerprint-sha256=1cd9f9535e86b3f5ad13cd907f08059d5ca3650cfbf74d9120449c7355b7a774 dataset-sha256=e3415ffb324961ce19ce014a08d6cc3bc12bcaaba6ae380824dc7049f33a570f threshold-definition-provenance-fingerprint-sha256=27217a73b1287d09d63484353fc7bc72be3faa41369c9051756dcd45fdd89992
```

  All earlier D-11B proposals remain **`SUPERSEDED_NOT_HUMAN_APPROVED`** (retained as audit history only).
- **D-11B role: thresholds only.** The token defines acceptance thresholds; it does **not** claim WP09 passed, does **not** claim integrated scaling/parity proven, does **not** close WP09 or WP22, and does **not** authorize Build by itself.
- **WP09 role: proof.** HTR-WP09 must run the single integrated D-11B qualification attempt and prove the incremental default meets the approved thresholds (fail-closed on any miss).
- **WP22 role: final re-proof.** HTR-WP22 re-proves the approved thresholds against the completed HTR runtime; no auto-tighten/loosen — any change requires a separate Human-approved D-11B amendment.
- **Approved quiescence policy: `PREFLIGHT_CHECKS_ONLY_NO_NUMERIC_LOAD_AVERAGE_GATE`.** No numeric load-average or thermal ceiling is introduced. Load averages and thermal/power state are recorded (before N1, after N1, before N2, after N2) as diagnostics only; high load alone never invalidates an attempt, excludes a slow run, or permits a repeat-until-PASS rerun. An explicit OS thermal/throttling warning invalidates the complete attempt; absence of a thermal command is recorded but non-invalidating. Objective invalidation reasons: AC power lost, low-power mode enabled, machine sleep, process interruption, instrumentation failure, dataset/digest mismatch, code/harness mutation during the attempt, competing WAIA trader benchmark/replay/qualification process, explicit OS thermal/power warning.
- **WP09 clean-commit qualification sequence** (`APPROVE-HTR-WP09-CLEAN-COMMIT-QUALIFICATION-SEQUENCE`, bounded WP09-only lifecycle exception; unchanged macro membership, integration boundary, WORK-commit count and Human gates): Stage A runs implementation-readiness checks (unit/integration on bounded deterministic fixtures, parity smoke, harness self-tests, dataset-digest verify, host-fingerprint self-test, qualification-preflight self-test, scope-boundary, lint/typecheck) with the full N1/N2 attempt forbidden; Stage B creates exactly one WP09 WORK commit (`DEE-415 feat(trader): integrate canvas runtime + default incremental cutover`, no amend) containing the implementation, tests, integrated qualification harness/CLI, deterministic fixture readiness checks and required package script; Stage C, on a clean HEAD, binds `qualificationGitSha` = the WP09 WORK commit and `qualificationDirtyTree: false`, verifies the approved host fingerprint and N1/N2 dataset digests, runs the single permitted attempt, writes raw output only to a gitignored immutable staging location, computes an evidence manifest/digest and records the staging path + digest in the gitignored controllers. Accepted evidence is independently verified and promoted during Opus Phase B into `replay-runs/RI-P7/htr-wp09-canvas-runtime-qualification/`.
- **WP09→WP10 qualification boundary** (`APPROVE-HTR-WP09-WP10-QUALIFICATION-BOUNDARY`, 2026-07-13 — clarifies, does not change, the approved Macro C scope; supersedes the overbroad "no production/test/harness/tracked-document change after Stage C begins" rule). **Stage-C freeze:** from the start of the WP09 Stage-C attempt until its raw evidence + manifest + digest are completely sealed, no tracked file may change. **Evidence binding:** WP09 qualification evidence is permanently bound to the exact WP09 WORK commit SHA, the committed WP09 qualification harness SHA, the approved host fingerprint, the approved N1/N2 dataset digests, and the approved D-11B thresholds — never to the WP10 or Macro-C final SHA. After a valid WP09 PASS and complete seal, Composer may internally advance to the already Human-approved WP10 packet and create the separate WP10 WORK commit; WP10 does not retroactively relabel WP09 evidence. **WP10 permitted boundary:** WP10 may modify only its approved determinism / no-lookahead scope; it must not modify the WP09 harness/CLI, D-11B thresholds, dataset/digests, host fingerprint, Canvas state contract, Canvas advance semantics, incremental MTF/reconstruction numeric semantics, WP09 cutover mode, the qualification result/staged evidence, or the WP09 WORK commit. For shared files (especially `evaluation-cycle.ts`) WP10 changes only the approved deterministic-clock/ID/no-lookahead seams. **Invalidation rule:** a WP10 change invalidates WP09 qualification only if it changes a WP09 measurement-critical surface (harness/CLI, Canvas advance/cutover semantics, thresholds, dataset, host binding, cycle-count contract, measured-stage boundaries, semantic/digest parity, or staged evidence); ordinary pre-approved WP10 deterministic changes do not. A required measurement-critical WP10 change forces STOP `WP10_CHANGE_INVALIDATES_WP09_QUALIFICATION` (no automatic D-11B rerun; no second D-11B attempt is authorized in Macro C). **Macro-end claims** may state only that WP09 passed D-11B on the exact WP09 WORK commit, WP10 passed its deterministic/no-lookahead contract, WP10 did not mutate a WP09 measurement-critical surface, and full repository validation passed — never that the WP09 attempt qualified the WP10 SHA or the final HTR runtime. Final completed-runtime D-11B re-proof is owned by **HTR-WP22**.
- **WP09 prequalification correction** (`APPROVE-HTR-WP09-PREQUALIFICATION-CORRECTION` + `CLARIFY-HTR-D11B-HOST-FINGERPRINT`, 2026-07-13): Stage-C host preflight blocked on a false mismatch because the verifier hashed raw reference-file bytes (including a trailing LF) instead of the canonical sorted-key compact JSON semantic object (`1cd9f953…`). A separate prequalification correction commit completes the omitted WP09 checkpoint/resume Canvas wiring and canonical host verification; the original WP09 WORK commit `46820ac` remains immutable; `qualificationGitSha` binds to the correction commit HEAD (explicit Human exception).
- **HTR-MACRO-C** is `REFRESHED_EXACT` (rolling-controller §9-C) and **Human-APPROVED** (2026-07-13: `APPROVE-HTR-MACRO-C: wp09-canvas-cutover-wp10-determinism` + `ACK-HTR-MACRO-C-MIGRATION: none` + `APPROVE-HTR-MACRO-C-BUILD` consumed). `MACRO_C_MIGRATION_DECISION: NONE`; `MACRO_C_CODE_BASELINE_HEAD: a8a709ff…`. **`BUILD_AUTHORIZED: YES` for HTR-MACRO-C only** (Composer 2.5 executes WP09 then WP10; no auto-advance to Macro D; the single final PR remains gated on all 23 WPs). WP09 and WP10 are **not** implemented/complete; HTR-GAP-001/002/003/004/025/031 remain **OPEN**; `READY_FOR_FULL_HISTORICAL_TEST` is **not** set.
- **WP09 replacement D-11B attempt (2026-07-13):** valid **THRESHOLDS_NOT_MET** under the original D-11B contract (`rssGrowthFor2xN = 5,308,416 B > 1,048,576 B`). Opus memory-gate forensic verdict: **`VALID_THRESHOLD_FAIL_GATE_DEFINITION_MISALIGNED`**. Sealed evidence: `.cursor/plans/dee-415-d11b/qualification-staging/htr-wp09-replacement-1/` (manifest `bff973996…`). Forensic annotation (tracked, non-regenerating): `replay-runs/RI-P7/htr-wp09-d11b-replacement-1-forensic-annotation/`. This result is **permanently classified VALID FAIL under the original contract** and must never be retroactively relabelled PASS.
- **D-11B Memory Gate Amendment v1 (Human-approved 2026-07-13):** `AUTHORIZE-HTR-D11B-MEMORY-GATE-AMENDMENT-V1` + one amended attempt authorization `AUTHORIZE-HTR-WP09-D11B-AMENDED-MEMORY-ATTEMPT`. Governs **prospective** qualification attempts only; does not rewrite prior sealed evidence.

```yaml
D11B_MEMORY_GATE_AMENDMENT_V1:
  STATUS: HUMAN_APPROVED
  APPROVAL_DATE: 2026-07-13
  FORENSIC_BASIS: VALID_THRESHOLD_FAIL_GATE_DEFINITION_MISALIGNED

  RETIRED_ACCEPTANCE_GATE:
    field: max2xMemoryGrowthBytes
    value: 1048576
    measuredQuantity: pre-GC process peak delta growth
    disposition: DIAGNOSTIC_ONLY
    reason: "same-N fresh-process RSS variance exceeds the complete gate; metric measures V8/GC/allocator high-water rather than retained runtime state"

  PRESERVED_ABSOLUTE_PROCESS_SAFETY_GATES:
    maxRssDeltaBytes: 536870912
    maxHeapUsedDeltaBytes: 268435456

  NEW_RETAINED_STATE_GATE:
    field: maxN2P95PostGcLiveHeapDeltaBytes
    value: 4194304
    aggregation: nearest-rank p95 over all five valid N2 warm runs
    measurement: "postGcHeapUsedBytes - preRunPostGcHeapUsedBytes"
    negativeDeltaPolicy: clamp_to_zero
    purpose: "detect reachable retained state after runtime completion, not transient allocation churn"

  PRESERVED_BOUNDEDNESS_GATES:
    retainedCycleResults: 0
    maxBufferedProjections: 32
    maxSerializedCanvasBytes: 262144
    fullHistoryRescans: 0

  DIAGNOSTIC_ONLY:
    - rssGrowthFor2xN
    - heapGrowthFor2xN
    - bars1mPrefixLength
    - bars1mPrefixEstimatedReferenceBytes

  UNCHANGED_GATES:
    - bar counts
    - Canvas advance counts
    - replay cycle counts
    - wall time
    - mean cycle time
    - p95 cycle time
    - runtime range
    - wall-time 2x scaling
    - semantic parity
    - digest parity
    - dataset identity
    - host identity
```

The historical Human token `APPROVE-HTR-D11B` (including `max-2x-mem-growth-bytes=1048576`) remains in audit
text; after Amendment v1 it is **not** the active acceptance gate.

## Full Historical Validation Run Contract v0 (Human-approved future-run contract)

Recorded per Human decision `APPROVE-FHV-RUN-CONTRACT-V0` (2026-07-13) and clarified by `CLARIFY-FHV-RUN-CONTRACT-V0` (2026-07-13 — venue `HTX_ONLY`, spot, BTCUSDT+ETHUSDT; dates/portfolio/report contract unchanged). **This is a future-run contract; it does NOT authorize a full historical run during DEE-415.** The actual multi-year execution runs only **AFTER DEE-415 is complete and `CERTIFY-HTR-READY` (D-12) is issued**. The governing AI-TRADER MVP is **HTX-only, spot-only, BTCUSDT and ETHUSDT**. The Binance BTCUSDT `2023-04-01…2023-06-29` 90-day dataset is **`D11B_INFRASTRUCTURE_QUALIFICATION_ONLY`** (runtime/memory thresholds) and must **not** become — by implication or default — the FHV strategy-validation venue or dataset. If exact HTX 1m history for the approved period cannot later be obtained and integrity-sealed, **HTR-WP12 must return a separate Human dataset-source decision package** (no silent Binance/other-venue substitution).

```yaml
FULL_HISTORICAL_VALIDATION_RUN_CONTRACT_V0:
  executionPhase: AFTER_DEE_415_AND_CERTIFY_HTR_READY
  venue: HTX                 # CLARIFY-FHV-RUN-CONTRACT-V0 (2026-07-13)
  venueScope: HTX_ONLY
  marketType: SPOT
  instruments: [BTCUSDT, ETHUSDT]
  symbols: [BTCUSDT, ETHUSDT]
  venueClass: spot
  primaryInterval: 1m
  baseInterval: 1m
  derivedIntervals: [15m, 1h, 4h, 1d]
  derivedIntervalRule: CLOSED_BARS_ONLY
  d11bDatasetVenueRole: D11B_INFRASTRUCTURE_QUALIFICATION_ONLY   # Binance 2023-04-01..2023-06-29; NOT the FHV venue/dataset
  fullPeriod:            { startUtc: 2020-01-01T00:00:00Z, endUtc: 2025-12-31T23:59:00Z }
  developmentCalibration:{ startUtc: 2020-01-01T00:00:00Z, endUtc: 2022-12-31T23:59:00Z }
  walkForward:           { startUtc: 2023-01-01T00:00:00Z, endUtc: 2024-12-31T23:59:00Z }
  blindHoldout:          { startUtc: 2025-01-01T00:00:00Z, endUtc: 2025-12-31T23:59:00Z, status: SEALED_NOT_ACCESSED }
  initialPortfolio:
    quoteCurrency: USDT
    cashUsdt: 100000
    btcQuantity: 0
    ethQuantity: 0
    leverage: 0
    borrowing: PROHIBITED
    shortSelling: PROHIBITED
    externalDepositsDuringRun: 0
    externalWithdrawalsDuringRun: 0
    portfolioMode: SHARED_MULTI_INSTRUMENT
```

**Exact initial portfolio state:** starting cash **100,000 USDT**, **0 BTC**, **0 ETH**, a single **shared** BTC/ETH portfolio, **no leverage / no borrowing / no short-selling**, and **zero external deposits or withdrawals** during the run. **Exact date intervals:** full `2020-01-01T00:00:00Z … 2025-12-31T23:59:00Z`; development/calibration `2020-01-01 … 2022-12-31`; walk-forward `2023-01-01 … 2024-12-31`; blind holdout `2025-01-01 … 2025-12-31`.

**Blind-holdout protection.** Repository/evidence contamination audit (2026-07-13, no 2025 price content inspected): no manifest, fixture, test, replay-run, script, or plan uses 2025 BTCUSDT/ETHUSDT spot-1m content for strategy development, parameter tuning, threshold setting, feature selection, model selection, or promotion. The only 2025 calendar references are the D-11B clean-window **search-universe upper bound** (`…2025-12-31`, selected window `2023-04-01…2023-06-29`) and synthetic macro-provider timestamps in `tests/fixtures/trader/m9-provider-sidecar-v2.json` (not price data). **`BLIND_HOLDOUT_2025_STATUS: RESERVED_SEALED_NOT_ACCESSED`.** The actual integrity/dataset-manifest implementation and sealed-holdout access procedure remain owned by HTR-WP12 and the later Full Historical Validation Program.

## Drawdown contract (canonical equity series, maximum drawdown, risk response)

The completed HTR runtime must support a canonical **point-in-time equity series**. For each accepted portfolio event and each closed 1m bar:

```text
equity_t = available_cash_t + marked_value_of_open_positions_t - already_accrued_not_yet_deducted_costs_t
runningEquityHighWater_t = max(equity_0 … equity_t)
drawdownAbs_t = runningEquityHighWater_t - equity_t
drawdownPct_t = drawdownAbs_t / runningEquityHighWater_t * 100
maximumDrawdownPct = max(drawdownPct_t)
```

All financial values use the trader's **exact numeric type** (`ScaledDecimal`, `lib/trader/risk/numeric.ts`, 8-dp bigint) — **no binary floating point for financial truth** (Master Spec §16).

**Required outputs:** maximum drawdown absolute + percent; drawdown start / trough / recovery timestamps (or `NOT_RECOVERED`); drawdown duration; recovery duration; current drawdown; account/portfolio drawdown; strategy-attributed drawdown; symbol-attributed drawdown; regime-attributed drawdown; monthly drawdown; consecutive-loss state. **Adverse-intrabar diagnostic:** a conservative drawdown using valid bar extremes (long inventory marked against the bar low), with **no future bar influencing a prior decision** — this metric is reporting/risk evidence and is **separately labelled** from closed-bar drawdown.

**Risk response.** At the approved drawdown limit, Risk must **fail closed** through existing authority (`RiskDecisionOutcome`, `lib/trader/risk/types.ts`): `APPROVE | RESIZE | REJECT | CLOSE_ONLY | STOP_ACCOUNT`, with a deterministic, reason-coded action hierarchy. The system must **not**: let a strategy override the drawdown gate; let AI change the limit; increase risk after a breach; reset HWM or drawdown on restart; hide drawdown via deposits/withdrawals; or conflate the realized-only **billing HWM** (`lib/trader/billing/**`, `foldCumulativeRealizedStrategyProfit`) with the **portfolio mark-to-market risk/equity drawdown HWM**. Billing HWM and risk/equity drawdown HWM are **distinct concepts with distinct owners, names and tests**.

## Drawdown-limit decision (D-20 — Human gate before HTR-WP16)

**Canon/code audit (2026-07-13).** No exact Human-approved account or monthly drawdown **percentage** exists in canon or code:
- Risk Doctrine (LD-8) / Master Spec §13 / Implementation Program (AT-E7) require "position/loss/drawdown/exposure limits" and "max monthly drawdown" **structurally, with no numeric value**.
- **ADR-0010** explicitly defers quantitative drawdown caps to **operator-set attestation** ("this amendment defines the evidence class, not numeric gates").
- Code (`lib/trader/risk/capital-limits-evaluator.ts`) enforces an **absolute USDT** `maxDrawdown` (→ `STOP_ACCOUNT`, reason `RISK_MAX_DRAWDOWN`) and `maxDailyLoss` (→ `REJECT`, `RISK_MAX_DAILY_LOSS`); the only configured values are **test/paper defaults** in `lib/trader/risk/limits/defaults.ts` (`maxDrawdown: "1000"`, `maxDailyLoss: "500"`) — **not** ratified policy. The risk `drawdown` field (`lib/trader/portfolio/to-account-risk-state.ts`) is underwater-vs-run-start, **not** peak-equity or monthly; `max consecutive losses` is not yet implemented; legacy mock paths hardcode drawdown to `"0"`.
- Billing HWM (30% performance fee, cumulative realized profit) is a **separate, already-approved** concept and does not supply a risk drawdown percentage.

**No approved exact value exists → Human decision package (D-20, next unused Decision-Register id):**

1. Recommended `MAX_ACCOUNT_DRAWDOWN_PCT`: **25%** (peak-equity mark-to-market, fail-closed).
2. Recommended `MAX_MONTHLY_DRAWDOWN_PCT`: **15%** (calendar-month peak-equity).
3. Recommended strategy-level limit: **20%** per strategy-attributed equity slice.
4. Breach action: **`CLOSE_ONLY` first, then `STOP_ACCOUNT`** if the account limit is breached or drawdown deepens after `CLOSE_ONLY` (immediate `STOP_ACCOUNT` reserved for the account hard cap).
5. Rationale: 25% account / 15% monthly is a conventional research-grade capital-preservation envelope for a shared spot BTC/ETH portfolio without leverage; a per-strategy 20% cap isolates a single strategy's decay before it endangers the account; `CLOSE_ONLY`-then-`STOP_ACCOUNT` de-risks before a hard stop, matching the existing deterministic verb hierarchy.
6. Sensitivity: tighter (15%/10%/12%) reduces terminal-equity variance but raises false-halt/whipsaw risk over 2020–2025 volatility regimes; looser (35%/20%/30%) lowers halt frequency but weakens the capital-preservation guarantee the historical result must demonstrate.
7. **Exact proposed token (NOT consumed):**

```text
APPROVE-HTR-D20-DRAWDOWN-LIMITS: max-account-drawdown-pct=25 max-monthly-drawdown-pct=15 max-strategy-drawdown-pct=20 breach-action=CLOSE_ONLY_THEN_STOP_ACCOUNT hwm-basis=PEAK_EQUITY_MARK_TO_MARKET billing-hwm-distinct=true applies-to-research-replay=true
```

```yaml
DRAWDOWN_LIMIT_DECISION:
  id: D-20
  status: HUMAN_DECISION_REQUIRED_BEFORE_HTR_WP16
  blocks:
    - HTR-WP16_ACTIVATION
    - HTR-WP22_FINAL_QUALIFICATION
    - CERTIFY_HTR_READY
  doesNotBlock:
    - HTR-MACRO-C
    - HTR-MACRO-D
```

The proposed token is **not** consumed. D-20 does **not** block HTR-MACRO-C (WP09/WP10) or HTR-MACRO-D (WP11/WP12).

## Mandatory quality PnL report contract (versioned)

A versioned PnL report contract implemented by the owning later WPs (WP18 canonical owner; WP19 reconciliation; WP23 pins it in the readiness package) and invoked by the Full Historical Validation Program. Minimum fields:

```yaml
capital:      { initialEquityUsdt:, finalEquityUsdt:, minimumEquityUsdt:, maximumEquityUsdt: }
returns:      { grossPnlUsdt:, netPnlUsdt:, totalReturnPct:, annualizedReturnPct:, realizedPnlUsdt:, unrealizedPnlUsdt: }
costs:        { feesUsdt:, spreadCostUsdt:, slippageUsdt:, impactCostUsdt:, totalCostUsdt:, feeDragPct: }
drawdown:     { maxClosedBarDrawdownUsdt:, maxClosedBarDrawdownPct:, maxAdverseIntrabarDrawdownUsdt:, maxAdverseIntrabarDrawdownPct:,
                drawdownStartUtc:, drawdownTroughUtc:, drawdownRecoveryUtc:, maxDrawdownDuration:, recoveryDuration:, recovered: }
trades:       { tradeCount:, winningTrades:, losingTrades:, winRate:, averageWinUsdt:, averageLossUsdt:, payoffRatio:, profitFactor:, expectancyPerTradeUsdt:, consecutiveLossMax: }
riskAdjusted: { sharpeRatio:, sortinoRatio:, returnSamplingMethod:, riskFreeRateAssumption: }
activity:     { turnoverUsdt:, averageExposurePct:, maximumExposurePct:, timeInMarketPct: }
breakdowns:   { bySymbol:, byStrategyVersion:, byRegime:, byMonth:, byYear: }
benchmarks:   { cashBaseline:, btcBuyAndHoldReference:, ethBuyAndHoldReference: }
provenance:   { codeSha:, dirtyTree:, datasetManifestDigest:, runConfigDigest:, strategyVersions:, costModelVersion:, riskPolicyVersion:, initialPortfolioDigest: }
```

Rules: every financial number uses exact numeric truth; the derivation is reproducible; the report digest is deterministic; **gross vs net** and **realized vs unrealized** are never conflated; **billing HWM never replaces risk drawdown**; and the report must **reconcile to final portfolio equity**.

## Work-package ownership amendments (cross-cutting historical-run requirements)

These amendments **bind missing cross-cutting acceptance requirements to existing work packages**. They do **not** add, split, merge, remove, renumber or reorder any work package — the frozen 23-WP decomposition is unchanged.

- **HTR-WP12** (ingress bar-integrity + versioned dataset manifest): add a future **Full Historical Validation dataset-manifest** capability — exact full-period + partition boundaries, symbol/venue/interval identity, source-object checksums, normalized data digests, PIT/provider provenance, gap/duplicate/out-of-order results, and blind-holdout **sealed metadata without semantic access**. WP12 must **not** execute the full historical run.
- **HTR-WP16** (strategy pinning + gating + trial accounting): add the pinned account/strategy/monthly **drawdown policy** (from D-20), deterministic drawdown-gate reason codes, downward-only risk handling, trial halt/`CLOSE_ONLY` semantics, and **no reset across restart**. An unresolved exact D-20 limit **blocks WP16 activation**.
- **HTR-WP17** (historical execution-simulation realism): add the **initial-portfolio input contract** — starting cash `100000 USDT`, zero starting positions, no leverage/borrowing/shorting, no external cash flows, a single cost-application point, costs included in net equity and drawdown, and **identical initial-portfolio semantics across replay, walk-forward and holdout**.
- **HTR-WP18** (inventory & accounting parity): **canonical owner** of the cash ledger, position valuation, exact equity/NAV series, realized/unrealized PnL, gross/net PnL, equity high-water, closed-bar maximum drawdown, adverse-intrabar drawdown diagnostic, drawdown duration/recovery, restart parity, and the **shared BTC/ETH portfolio** accounting.
- **HTR-WP19** (reality reconciliation): add reconciliation proving `cash + marked positions = equity`, `orders/fills/lots = positions`, `realized + unrealized - costs = net economic result`, and `equity-curve terminal value = reconciled final account value`. Any difference **fails closed**.
- **HTR-WP20** (Guardian/exits + closed-trade reality): add Guardian/Risk interaction — a drawdown breach **cannot widen risk**; appropriate `CLOSE_ONLY`/exit/`STOP_ACCOUNT` action; no new position after a hard breach; explicit exit + terminal reason codes; closed-trade truth and portfolio-level truth remain distinct.
- **HTR-WP22** (resilience + performance qualification): add qualification of equity/drawdown determinism, checkpoint/resume parity (no HWM reset, no drawdown reset, identical equity/drawdown digest before and after recovery), the drawdown-breach action, bounded memory of equity reporting, the exact 100,000-USDT fixture, a multi-position BTC/ETH fixture, and correct cost/partial-fill effects on drawdown.
- **HTR-WP23** (runbook + readiness preflight + Execution Server package): the runbook/readiness package must **pin** the exact FHV Run Contract v0, initial capital, symbols, date intervals, partition boundaries, dataset digests, cost model, risk/drawdown limits, report schema, checkpoint/evidence paths, holdout access procedure, and operator confirmation tokens. The preflight must **reject a run** when any required parameter is missing or differs.

## Supersession

Supersedes the B01-only canonical plan `docs/plans/dee-415-htr-b01-readiness-canon.md` (renamed into this whole-program plan). `.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md` is superseded as program authority (D-13), retained as historical/evidence source (not mutated); its "Gate A" is renamed `M9 Accounting Gate` in HTR canon; completed work preserved; pending work (PR4) maps to HTR-WP15 + HTR-WP21.

## Work-package ledger (23)

WP01 detail lives in the child plan `.cursor/plans/dee-415-htr-wp01-readiness-canon.plan.md` (and, once implemented, in the created canonical artifacts). This ledger tracks whole-program state; it is not the child execution contract.

| WP | Title | dependsOn | label | status | local commit |
|----|-------|-----------|-------|--------|--------------|
| HTR-WP01 | Canon & readiness-contract + activation/target-subset ratification | — | product | COMPLETE (Opus post-review PASS) | `6600708` (WORK) |
| HTR-WP02 | Post-M9 forensic + status truth-up + program supersession | WP01 | product | COMPLETE (Opus post-review PASS; HTR-GAP-030/034 closed) | `7ec02dd` (WORK) |
| HTR-WP03 | Replay benchmark + stage timing + memory instrumentation | WP01 | backend | COMPLETE (Opus post-review PASS; HTR-GAP-024 baseline evidence recorded, remains OPEN, closure HTR-WP22) | `35283ed` (WORK) |
| HTR-WP04 | Streaming evidence + partial sealing + crash-recovery reconstruction | WP03 | backend | COMPLETE (Opus post-review PASS; full validation PASS; streaming-evidence baseline recorded; HTR-GAP-005/026 remain OPEN, closure HTR-WP22) | `b3abe7b` (WORK) |
| HTR-WP05 | Checkpoint/resume + pipeline DB-disconnect + terminal states | WP04 | backend | COMPLETE (Opus post-review PASS; semantic parity digest equality proven; full validation PASS; HTR-GAP-027/029 remain OPEN, closure HTR-WP22) | `f90faa9` (WORK) |
| HTR-WP06 | Market Canvas state contract + cursor replay foundation | WP01,WP03 | backend | COMPLETE (Opus Phase-B PASS; WORK `24eb7f9`; CANVAS_STATE_OK; HTR-GAP-001 contribution, remains OPEN, closure HTR-WP09) | `24eb7f9` (WORK) |
| HTR-WP07 | Incremental closed-bar MTF aggregation | WP06 | backend | COMPLETE (Opus Phase-B PASS; WORK `10f2500`; CANVAS_MTF_PARITY_OK; HTR-GAP-003 contribution remains OPEN closure HTR-WP09; HTR-GAP-004 closed-bar correction remains OPEN closure HTR-WP10) | `10f2500` (WORK) |
| HTR-WP08 | Incremental reconstruction + oracle parity | WP07 | backend | COMPLETE (Opus Phase-B PASS; WORK `0c4b8c3`; RECONSTRUCTION_ORACLE_PARITY_OK — 22/22 exact, 0 divergence, FULL_HISTORY_RESCANS 0, bounds true, work growth linear; HTR-GAP-002 contribution remains OPEN closure HTR-WP09) | `0c4b8c3` (WORK) |
| HTR-WP09 | Canvas runtime integration + benchmark qual + default cutover | WP08,WP03 | backend | COMPLETE (Opus Macro-C Phase B PASS 2026-07-14; WORK `46820ac`; prequalification correction `c57a7a0`; instrumentation correction `bc9cb46`; memory-gate alignment `7c532f5`; D-11B PASS under Memory Gate Amendment v1, accepted evidence `replay-runs/RI-P7/htr-wp09-canvas-runtime-qualification/` digest `78560485…`; qualification bound to `7c532f5` per Human Amendment-v1 exception; HTR-GAP-001/002/003 CLOSED) | `46820ac` (WORK) |
| HTR-WP10 | No-lookahead + determinism property suites | WP09 | backend | COMPLETE (Opus Macro-C Phase B PASS 2026-07-14; WORK `befa6c1`; validation correction `2987f37` — test-only; evidence `replay-runs/RI-P7/htr-wp10-determinism-nolookahead/` digest `fa5def37…`; no WP09 measurement-critical surface changed; full validation green; HTR-GAP-004/025/031 CLOSED; Macro C COMPLETE) | `befa6c1` (WORK) |
| HTR-WP11 | PIT provider context + gateway enforcement + absent-lane | WP01,WP09 | backend | pending | — |
| HTR-WP12 | Ingress bar-integrity gate + versioned dataset manifest | WP01 | backend | pending | — |
| HTR-WP13 | Intelligence-chain activation (historical run profile) | WP09,WP10,WP11,WP12 | ai | pending | — |
| HTR-WP14 | Forecast + Decision records + whyNotCash + CDE disambiguation | WP13 | ai | pending | — |
| HTR-WP15 | MKB read-model integration for replay | WP14 | ai | pending | — |
| HTR-WP16 | Strategy pinning + gating + trial accounting | WP13 | ai | pending | — |
| HTR-WP17 | Historical execution-simulation realism | WP09 | backend | pending | — |
| HTR-WP18 | Inventory & accounting parity | WP17 | backend | pending | — |
| HTR-WP19 | Reality reconciliation + M9-class regression closure | WP18 | backend | pending | — |
| HTR-WP20 | Guardian/exits completion + closed-trade reality invariants | WP18,WP19 | backend | pending | — |
| HTR-WP21 | Outcome Resolution, Forecast Calibration & Knowledge Confidence Update | WP14,WP15,WP19,WP20 | ai | pending | — |
| HTR-WP22 | Resilience + performance qualification | WP04,WP05,WP09,WP16,WP19,WP21 | backend | pending | — |
| HTR-WP23 | Operator runbook + readiness preflight + Execution Server package + Certification prep | WP20,WP22 | infra | pending | — |

Mandatory tail: **HTR-WP21 → HTR-WP22 → HTR-WP23**; also **HTR-WP16 → HTR-WP22**. Full dependency graph: parent master §40.

## WP01 summary (COMPLETE — former HTR-B01 technical content)

HTR-WP01 is **COMPLETE** (WORK COMMIT `6600708`, Opus post-review PASS, validation PASS). It created the three canonical artifacts and recorded decisions/supersession (no runtime code):
- `docs/product-specs/ai-trader-historical-test-readiness-completion.md` — Completion Spec; `READY_FOR_FULL_HISTORICAL_TEST` = code-ready Execution Server package; gate groups CG-A..CG-H; explicit exclusions; decision record.
- `docs/gaps/ai-trader-historical-test-readiness-gap-registry.md` — HTR-GAP-001..042 with PRIMARY/CONTRIBUTING/CLOSURE (HTR-GAP-005 = WP04/WP22/WP22; no `B21'`).
- `docs/roadmaps/ai-trader-historical-test-readiness-roadmap.md` — 23 work packages `IB-HTR-01..23` with dependency graph incl. WP21→WP22→WP23 and WP16→WP22.
- Modify `docs/ai-trader/README.md` (discoverability pointer). Local commit: `DEE-415 docs(trader): establish historical-test readiness canon`.

## Execution rule

```text
No intermediate PRs.
No intermediate merges.
Every HTR-WPxx is implemented and validated locally on the same DEE-415 branch.
A single PR is opened only after HTR-WP23, final full validation, and the final Opus whole-program audit.
```

## WP-09 (current work package)

**HTR-MACRO-B is COMPLETE** (HTR-WP06 Market Canvas state contract + cursor foundation, WORK `24eb7f9`; HTR-WP07 incremental closed-bar MTF aggregation, WORK `10f2500`; HTR-WP08 incremental reconstruction + oracle parity, WORK `0c4b8c3`). Opus Phase-B post-implementation audit issued PASS for all three WPs with bounded review fixes (verification-script temp-workspace cleanup, real deterministic incremental-work counters, dead-import cleanup, evidence regeneration) landed in the three CLOSEOUT commits. Full repository validation is green in the supported local environment; evidence terminals `CANVAS_STATE_OK`, `CANVAS_MTF_PARITY_OK`, `RECONSTRUCTION_ORACLE_PARITY_OK` (22/22 exact closed-boundary `contentDigest` parity, 0 divergences, `FULL_HISTORY_RESCANS: 0`, state within declared bounds, linear work growth). HTR-GAP-001/002/003 remain OPEN with closure owner HTR-WP09; HTR-GAP-004 remains OPEN with closure owner HTR-WP10; no runtime cutover (owned by HTR-WP09); MIGRATION_DECISION NONE.

The next work package is **HTR-WP09** (Canvas runtime integration + benchmark qual + default cutover), the first WP of **HTR-MACRO-C (WP09+WP10)**, tracked in the rolling controller `.cursor/plans/dee-415-htr-wp04-wp12-runtime-substrate-rolling.plan.md`. **D-11B is RESOLVED** (Human-approved 2026-07-13; thresholds only — WP09 still owns the integrated qualification proof). **HTR-MACRO-C is REFRESHED_EXACT and Human-APPROVED** (`APPROVE-HTR-MACRO-C` + `ACK-HTR-MACRO-C-MIGRATION: none` + `APPROVE-HTR-MACRO-C-BUILD` consumed; `MACRO_C_MIGRATION_DECISION: NONE`; `MACRO_C_CODE_BASELINE_HEAD: a8a709ff`); **`BUILD_AUTHORIZED: YES` for Macro C only** (no auto-advance to Macro D). Composer 2.5 executes the approved Macro C packet next. HTR-WP01 COMPLETE (`6600708`); HTR-WP02 (`7ec02dd`); HTR-WP03 (`35283ed`); HTR-WP04 (`b3abe7b`); HTR-WP05 (`f90faa9`); HTR-WP06 (`24eb7f9`); HTR-WP07 (`10f2500`); HTR-WP08 (`0c4b8c3`). This heading also satisfies the canonical-plan validator's `## WP-*` requirement.

## Acceptance (whole program)

`READY_FOR_FULL_HISTORICAL_TEST` is met when all gate groups CG-A..CG-H pass (measurable, evidence-backed), all 23 work packages are COMPLETE with local commits on the shared branch, the final Opus whole-program audit passes, the full validation matrix is green, the readiness package exists, and the Human Architect certifies (`CERTIFY-HTR-READY`, D-12). Per-work-package acceptance is defined in each child plan; the whole-program acceptance is conjunctive across all 23.

## Validation

Per work package: `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` (+ `pnpm validate:canon` when canonical docs change; + CI `postgres-integration` when Postgres parity in scope) + Opus post-review where required. Full matrix + governance preflight (`./scripts/linear/preflight-pr-governance.sh`) run once before the single final PR. No campaign/M9/walk-forward/holdout/paper/live/Supabase/Cloudflare/Execution-Server command.

## STOP conditions

Approval-token mismatch; activation beyond research-only; Founders-reserved action required; verified canonical contradiction; missing standard; scope expansion beyond the active work package; any attempt to open a PR before WP23 + final audit; any attempt to create additional Linear issues, additional branches, or intermediate merges; validation failure unfixable within the active work package. On STOP: set `state.blockedReason`, report to Human; never push/merge.
