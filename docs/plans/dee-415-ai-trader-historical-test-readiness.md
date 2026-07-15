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
  humanApproval: MACRO_F_BUILD_AUTHORIZED   # CONFIRM-HTR-WP14-MIGRATION-V2 + CONFIRM-HTR-WP15-MIGRATION + APPROVE-HTR-MACRO-F + APPROVE-HTR-MACRO-F-BUILD consumed 2026-07-15
  programStatus: WP_ACTIVE
  childPlanStatus: APPROVED
  buildAuthorized: YES
  buildAuthorizedScope: HTR-MACRO-F / HTR-WP14 + HTR-WP15 ONLY
  composerTerminalState: READY_FOR_COMPOSER_HTR_MACRO_F_PHASE_A
  activeWorkPackage: HTR-WP14
  currentWorkPackage: HTR-WP14
  latestValidatedProductionCodeSha: 2d63eca2231bbd06ad40680a4485f74a8244bef0   # HTR-WP13 CLOSEOUT (latest validated production baseline)
  wp13WorkCommitShaPreserved: d07bb654eacb8940b194669094c995efdf2f5342
  planningTerminalState: HTR_MACRO_F_FINAL_CONSISTENCY_PATCH_COMPLETE
  governanceStateAuthority: GIT_HEAD
  governanceReconciledFromHead: c250726328d3d2241d21d8939db74d069abec6cb   # activation parent; activation SHA recorded in gitignored controllers only
  macroCMigrationDecision: NONE
  macroDMigrationDecision: NONE
  macroCCodeBaselineHead: a8a709ff53f74649b5c5f39e0ba8e00af1e113de
  macroDCodeBaselineHead: 1ac0e6a8a7318be5b068dcb833f1a00ed32440a9
  macroDPreapprovalHead: 6d102f05d76fba2efd99b363799dde18a0668a71
  branch: dee-415-ai-trader-historical-test-readiness
  branchCreated: true
  buildStarted: true
  activeChildPlan: .cursor/plans/dee-415-htr-wp13-wp16-intelligence-rolling.plan.md
  intelligenceTranche:
    controller: .cursor/plans/dee-415-htr-wp13-wp16-intelligence-rolling.plan.md
    status: MACRO_F_BUILD_AUTHORIZED
    macroPackages: { HTR-MACRO-E: [HTR-WP13], HTR-MACRO-F: [HTR-WP14, HTR-WP15], HTR-MACRO-G: [HTR-WP16] }
    preferredOrderAfterWp13: [HTR-MACRO-F, HTR-MACRO-G]
    activeMacroStatus: APPROVED   # HTR-MACRO-F Build authorized 2026-07-15 consistency patch
    d4:
      status: HUMAN_APPROVED_CONSUMED
      consumedAt: 2026-07-15
      token: |-
        APPROVE-HTR-D4:
        cde-msv-role=MARKET_STATE_CONTEXT_AND_PERMISSION_NOT_LD7_DECISION
        forecast-authority=LD6_PREREGISTERED_APPEND_ONLY
        forecast-seal=BEFORE_OUTCOME_AVAILABILITY
        forecast-horizon=OWNED_BY_FORECAST_IMMUTABLE
        forecast-invalidation=DECLARED_AT_ISSUANCE_IMMUTABLE
        decision-authority=LD7_ONE_AUTHORITATIVE_DECISION_PER_ORG_RUN_CYCLE_SYMBOL
        decision-classes=TRADE,REDUCED_RISK,NO_TRADE
        no-trade=FIRST_CLASS
        why-not-cash=REQUIRED_FOR_TRADE_OR_REDUCED_RISK
        why-cash-or-abstain=REQUIRED_FOR_NO_TRADE
        net-economics=DECISION_OWNS_COST_MODEL_REFERENCE_AND_EXPECTED_NET_VALUE
        missing-net-economics=FAIL_CLOSED_TO_NO_TRADE
        causal-lineage=WP13_CYCLE_ENVELOPE+HYPOTHESIS+CONVICTION+FORECAST
        outcome-resolution=SEPARATE_APPEND_ONLY_RECORD_OWNED_BY_WP21
        forecast-calibration=OWNED_BY_WP21
        no-lookahead=MANDATORY
        strategy-promotion=PROHIBITED
        capital-authority=HUMAN_ONLY
    positionPurposeWp14Binding:
      status: HUMAN_RATIFIED_WP14_APPLICATION_BOUND
      consumedAt: 2026-07-15
      token: |-
        BIND-POSITION-PURPOSE-AND-EXIT-CONTRACT-V1-TO-HTR-WP14:
        entry-purpose-owner=HTR-WP14
        entry-purpose-immutable=true
        retroactive-purpose-rewrite=PROHIBITED
        strategy-version-reference=REQUIRED
        strategy-version-enforcement=DEFERRED_TO_HTR-WP16
        executable-stop-target-semantics=DEFERRED_TO_HTR-WP17
        inventory-pnl-attribution=DEFERRED_TO_HTR-WP18
        guardian-exit-taxonomy=DEFERRED_TO_HTR-WP20
        outcome-learning=DEFERRED_TO_HTR-WP21
        operator-report=DEFERRED_TO_HTR-WP23
    d1: RESOLVED_RECORD_LEVEL_CHAIN
    d2: HUMAN_APPROVED   # APPROVE-HTR-D2 consumed 2026-07-15 (HTX_ONLY SPOT BTCUSDT+ETHUSDT; base 1m + derived 15m/1h/4h/1d; LSR+MR enabled; trend_momentum_v0 EVIDENCE_ONLY_NOT_TRADE_ELIGIBLE); enablement is NOT SVG approval / NOT an edge verdict; version-pin+lifecycle owned by WP16
    d3: HUMAN_APPROVED_FINAL_CODEPOINT_DIGEST_BOUND   # CLARIFY-HTR-D3 consumed 2026-07-15; final code-point canonical digest 92219746… Human-bound 2026-07-15 (APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD)
    d20: HUMAN_DECISION_REQUIRED_BEFORE_HTR_WP16
    htrHistoricalIntelligenceProfileV1: HUMAN_APPROVED_FINAL_CODEPOINT_DIGEST_BOUND
    profileDigestCanonical: 9221974607d3a8a569c380b4699495600277449055f76391c4fa5377a6088abe   # HTR_SEMANTIC_CANONICAL_JSON_V1 code-point digest; matrix bound; HUMAN_BOUND_FINAL_CODEPOINT_DIGEST 2026-07-15
    profileDigestInsertionOrder: 0d156d38a9e615f0488e7c11d5de730b54a7f6270d3d0921ceea074f738b839f
    profileDigestRawFileSha256: 72ed9b17d773e1be2bc55f659c1d0ec39e9e0c8a3e5dc0f7c02795103db2cc8a
    profileDigestSupersededLocaleCompare: a9666258e046e934b2156e0dc3ad5da02eb9b7e69d994e3505a3af5b62cd8bf0   # REJECTED_CANONICALIZATION (localeCompare)
    profileDigestSupersededApproved: 9a1ed67e39c2a5e23bb83459f4f1fb52b10c88a49ebbf773b5285c90b82f706c   # SUPERSEDED_BY_SEMANTIC_GOVERNANCE_FIELD_REMOVAL
    profileDigestSupersededDraft: fac1a44f06642748c7f42bfe10790cd2e0a341fa730af1a7a83ffeec43adbec2
    profileGovernanceFieldsRemoved: [status, strategyConsumerPolicy.status, decisionBasis, strategyConsumerPolicy.ownedBy]
    profileSubstantiveRuntimeSemanticsChanged: false
    historicalEvidenceCapability: PRICE_ONLY_GROUNDED_EVIDENCE_PROFILE
    timeframeEvidenceLaneAuthorityMatrixV1: HUMAN_APPROVED_FINAL_CODEPOINT_DIGEST_BOUND
    matrixDigestCanonical: 6296c54e35aeb311739f3ab1c30a0c452637c5abf7f2464f0b0cd906a6ef04a6   # HTR_SEMANTIC_CANONICAL_JSON_V1 code-point digest; HUMAN_BOUND_FINAL_CODEPOINT_DIGEST 2026-07-15
    matrixDigestInsertionOrder: 2e558f18a863fca6acc180929776a4ef3e710195317f091dd321c52ed7060c55
    matrixDigestRawFileSha256: 4aed27c0bfeaa853641330378962dce019a63eea22548ac4616bf03b396bfa97
    matrixDigestSupersededLocaleCompare: 231712e2916370e07def8546f70ed8434e7794e498842390c301e9a7a16baffb   # REJECTED_CANONICALIZATION (localeCompare)
    matrixDigestSupersededApproved: c91868142e8b5ed0b5db533e1811fe4a733290a204efab52f02ed592c1c01b08
    matrixDigestSupersededV1: 46d1d9cb4f6f146e4ffbc2ef60a3a98629ab28eb821772afd8d62745835fb5b9
    matrixGovernanceFieldsRemoved: [status]
    matrixSubstantiveRuntimeSemanticsChanged: false
    htrSemanticCanonicalJsonV1:
      objectKeyOrder: UNICODE_CODE_POINT_ASCENDING
      comparator: "a < b ? -1 : a > b ? 1 : 0"
      localeCompare: PROHIBITED
      objectHandling: RECURSIVE_SORT
      arrayHandling: PRESERVE_SCHEMA_ORDER
      semanticSetArrayHandling: EXPLICIT_CODE_POINT_SORT_ONLY_WHEN_SCHEMA_DECLARED_AS_SET
      output: COMPACT_JSON_STRINGIFY
      encoding: UTF8
      hash: SHA256_LOWERCASE_HEX
    repositoryCanonicalizerAudit:
      libTraderResearchDigestTs: INCOMPATIBLE   # uses localeCompare
      libWaiaCorePaymentsCanonicalJsonTs: INCOMPATIBLE   # default sort()
      libTraderBacktestSerializeBacktestEvaluationExportTs: INCOMPATIBLE   # uses localeCompare
    wp13CanonicalizeSymbolsMustUseHtrSemanticCanonicalJsonV1: [canonicalizeHistoricalProfile, canonicalizeMatrix, canonicalizeCycleEnvelope, canonicalizeHypothesisRecord, canonicalizeConvictionRecord]
    strategyDiscoveryToOperatorProposalContractV1: HUMAN_RATIFIED   # RATIFY-STRATEGY-DISCOVERY-TO-OPERATOR-PROPOSAL-CONTRACT-V1 consumed 2026-07-15; foundation only (implemented-in-dee415=false; mature-autonomous-engine=false; machine self-promotion + capital authority PROHIBITED)
    wp13MigrationDecision: CONFIRMED_WITH_ATOMIC_FAIL_CLOSED_IDEMPOTENCY   # CONFIRM-HTR-MACRO-E-MIGRATION consumed 2026-07-15. 3 append-only Postgres tables (trader_intelligence_cycle_envelope/hypothesis_record/conviction_record); service-role RLS; SQLITE_ADAPTER NOT_REQUIRED (db/AGENTS.md:148 Postgres-only MVP freeze + ADR-0017). Atomic cycle bundle HTR_WP13_ATOMIC_INTELLIGENCE_CYCLE_BUNDLE_V1 = single Postgres transaction (envelope → hypotheses code-point sorted → conviction), partial commit PROHIBITED, rollback complete bundle on any failure. Fail-closed idempotency: on conflict load-and-compare deterministic id + org + business key + schema_version + content_digest; any mismatch throws HTR_WP13_IDEMPOTENCY_CONFLICT + rollback (ON CONFLICT DO NOTHING PROHIBITED). conviction cardinality = Model B; conviction_scope ∈ {ACTIVE_HYPOTHESIS, NONE} (AGGREGATE DEFERRED_NOT_IN_SCHEMA_V1); active_hypothesis_record_id NULLABLE with scope constraint; conviction UNIQUE(org,run,cycle,symbol); hypothesis UNIQUE(org,run,cycle,symbol,hypothesis_type); DUP-14 link; migrations 0076–0081; Forecast/Decision/whyNotCash DEFERRED to WP14; no SQL created this session
    wp10EvidenceHermeticity: FINAL_PHASE_B_PASS   # 2026-07-14 Opus final Phase-B rereview PASS. Correction chain 017fcbe (FAIL symlink/case-alias) → f2413b2 (FAIL output-directory-substitution TOCTOU) → 521ddd1 (PASS cwd/inode-bound child publication + completion contract). Original WP10 seal (replay-runs/RI-P7/htr-wp10-determinism-nolookahead/, artifact fa5def37…) preserved byte-identical across befa6c1/1ac0e6a/017fcbe/f2413b2/521ddd1; accepted post-Macro-D compatibility evidence promoted separately — NOT a replacement of the original seal.
    macroEReadiness: COMPLETE   # HTR-MACRO-E COMPLETE (Composer Phase-B PASS 2026-07-15)
    wp10EvidenceHermeticityCorrection:
      status: FINAL_PHASE_B_PASS
      initialWorkCommitSha: 017fcbe4dad60bc36dcb93e538b7c52ff7be7585
      initialPhaseBVerdict: FAIL_SYMLINK_AND_CASE_ALIAS
      writerGuardWorkCommitSha: f2413b23e2d8890d5e0f40f37fe64af2600d873a
      writerGuardPhaseBVerdict: FAIL_OUTPUT_DIRECTORY_SUBSTITUTION_TOCTOU
      toctouWorkCommitSha: 521ddd11a47a735769f04aa52d0139cf2075d4dc
      finalPhaseBVerdict: PASS
      originalSealPreserved: true
      normalSuiteHermetic: true
      staticPathGuardsPass: true
      cwdInodeBoundPublicationPass: true
      incompleteCandidateFailClosed: true
      canonicalDigestPass: true
      acceptedCompatibilityEvidencePath: replay-runs/RI-P7/htr-wp10-determinism-nolookahead-post-macro-d/
      acceptedCompatibilityArtifactDigest: 3d3f7cf348228f56e294a55dce027e426957250036b4aa0f2f993d5a926b7e89
      candidateStagingManifestDigest: 13c2d68f821c150d3154741380aafa47c7c9c86557083ce330e191f0866dceb3
      harnessSourceSha256: 077e7f2a0ceb58f19b56232c187361f526b65de58425e87e38e7e20e1a2c4409
      acceptedBundleDigest: 1a80d67a650fc1a999293f2bcd32c08650c5fb56a823248acc14bc4ef5279492
    fullValidation: PASS
  workCommitSha: null
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
    - HTR-MACRO-D
  macroDStatus: COMPLETE   # 2026-07-14 Opus Macro-D Phase B: WP11 CLOSEOUT + WP12 CLOSEOUT; WP04–WP12 rolling runtime/data-truth tranche COMPLETE
  macroEStatus: COMPLETE   # 2026-07-15 Composer Phase-B: HTR-WP13 CLOSEOUT
  activeMacroPackage: HTR-MACRO-F   # refreshed from WP13 CLOSEOUT HEAD 2026-07-15
  activeMacroWorkPackages: [HTR-WP14, HTR-WP15]
  activeMacroStatus: APPROVED
  phaseBReviewerPolicy:
    defaultReviewer: COMPOSER_2_5_INDEPENDENT_SESSION
    phaseBMustBe:
      separateFromPhaseA: true
      independentContext: true
      inspectCommitsDirectly: true
      phaseAReportIsNotEvidence: true
    opusEscalation:
      onlyFor: [unresolved T2 architecture contradiction, security or safety blocker, irreducible persistence conflict, irreducible governance conflict]
    finalWholeProgramAudit:
      reviewer: OPUS_4_8_OR_SUCCESSOR_REASONING_CLASS
    legacyAlias: AWAITING_OPUS_MACRO_POST_REVIEW   # HISTORICAL alias of AWAITING_INDEPENDENT_MACRO_POST_REVIEW
  # --- HTR-WP13 CLOSEOUT (Composer Phase-B, 2026-07-15) ---
  wp13WorkCommitSha: d07bb654eacb8940b194669094c995efdf2f5342
  wp13PhaseBReviewer: COMPOSER_2_5_INDEPENDENT_SESSION
  wp13PhaseBVerdict: HTR_WP13_COMPOSER_PHASE_B_PASS_WITH_BOUNDED_FIXES
  wp13ImplementationStatus: WORK_PACKAGE_COMPLETE
  wp13PostgresIntegration: PASS
  wp13EvidenceStatus: ACCEPTED
  wp13EvidencePath: replay-runs/RI-P7/htr-wp13-intelligence-chain/
  wp13EvidenceSemanticDigest: b6b3badd0d385ca3f56b87426d32b389285273d1026be68ff421526992f6b0d5
  wp13BoundedFixes:
    - SAVEPOINT idempotency recovery for PostgreSQL 23505 (postgres-idempotent-insert.ts)
    - D-2 researchEvaluationOutcome/tradeEligible separation on StrategySignal
    - expanded Postgres integration suites (15 mandatory cases, 0 skipped)
    - evidence manifest trendMomentumResearchPreserved field (semantic digest unchanged)
  wp13PhaseBBoundedManifestAmendment:
    - lib/trader/intelligence/htr-semantic-canonical-json.ts   # shared HTR_SEMANTIC_CANONICAL_JSON_V1 helper
    - lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1-data.ts
    - lib/trader/intelligence/matrix/timeframe-evidence-lane-authority-matrix-v1-data.ts
    - lib/trader/intelligence/records/wp13-intelligence-evidence-harness.ts
    - scripts/trader/replay-wp13-intelligence-records-evidence.ts
    - tests/integration/wp13-intelligence-test-helpers.ts
    - tests/unit/trader-wp13-research-trade-eligibility.test.ts
  wp13TerminalState: WORK_PACKAGE_COMPLETE
  wp13GapsClosed:
    - HTR-GAP-006
    - HTR-GAP-009
  wp13Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
    postgresIntegration: PASS
    mandatoryPostgresCasesSkipped: 0
  wp13OpusPostReview: null   # historical Opus records preserved unchanged; WP13 Phase-B reviewed by Composer independent session
  # --- HTR-WP11 CLOSEOUT (Opus Macro-D Phase B, 2026-07-14) ---
  wp11WorkCommitSha: f6cefb064c562ae29f506cac5e319c826da3912b
  wp11OpusPostReview: PASS
  wp11AcceptedEvidencePath: replay-runs/RI-P7/htr-wp11-pit-provider-context/
  wp11AcceptedEvidenceGitSha: f6cefb064c562ae29f506cac5e319c826da3912b   # gitSha recorded in the accepted WP11 evidence report (dirtyTree: true), bound to the WP11 WORK commit
  wp11EvidenceManifestDigest: b8f043acff23c4b3d8ae5f5db13d1d40db08283928b76996d1ee5dfebcc8b20c   # independently reproduced = sha256(canonical fusedContextDigest string) from pit-provider-context-report.json
  wp11EvidenceBinding: WP11_EVIDENCE_VALID_AT_F6CEFB0   # fusedContextDigest byte-identical across a4a67ce->f6cefb0->993fdab; WP12 changed only the evidence gitSha provenance field, semantic digest unchanged
  wp11PostWorkChangeClassification:
    assertNoFutureEvidenceReorder: WP11_POST_WORK_NON_SEMANTIC_CORRECTION   # skip UNAVAILABLE/FUTURE_EVIDENCE_EXCLUDED/SIDECAR_LANE_ABSENT before the future-timestamp throw; payloads stripped by normalizeUnavailableObservation ({unavailable:true,reason}); future obs neutralized pre-fusion by guardNoLookahead; auditable degradationReasons; a genuine HEALTHY future observation still throws HTR_WP11_FUTURE_EVIDENCE_REACHABLE
    quoteForReplayCycle: WP11_POST_WORK_NON_SEMANTIC_CORRECTION   # real historical path unchanged (quoteFromBar no-op when no override); override branch only re-stamps a caller-supplied static fixture quote symbol/timestamp to the closed bar barCloseTime (past, PIT-valid); no fabricated observation/provenance/price-timeline; sidecar-v3 PIT untouched
    wp11EvidenceGitShaRestamp: WP11_POST_WORK_NON_SEMANTIC_CORRECTION   # WP12 commit updated WP11 evidence gitSha a4a67ce->f6cefb0 only; fusedContextDigest byte-identical -> not evidence-invalidating
  wp11FabricatedAvailability: false
  wp11FutureEvidenceReachable: false   # no reachable future payload downstream (strategy/CDE/Canvas/Market Understanding)
  wp11TerminalState: WORK_PACKAGE_COMPLETE
  wp11GapsClosed:
    - HTR-GAP-012
    - HTR-GAP-013
  wp11Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
  # --- HTR-WP12 CLOSEOUT (Opus Macro-D Phase B, 2026-07-14) ---
  wp12WorkCommitSha: 993fdaba0ffd5f66837bea1c7272507183efa973
  wp12OpusPostReview: PASS
  wp12AcceptedEvidencePath: replay-runs/RI-P7/htr-wp12-ingress-manifest/
  wp12AcceptedEvidenceGitSha: f6cefb064c562ae29f506cac5e319c826da3912b   # gitSha recorded in accepted WP12 evidence (dirtyTree: true) — generated atop f6cefb0 with uncommitted WP12 changes, then committed as WP12 WORK 993fdab; semantic digests reproduce byte-identically at 993fdab (verified via pnpm trader:dataset:manifest)
  wp12EvidenceBundleManifestDigest: fd7d489595f8fc20e4311c74e5d82b2957e7cca5b80319b8cb8d5f0893544663
  fhvDatasetManifestSemanticDigest: fd7d489595f8fc20e4311c74e5d82b2957e7cca5b80319b8cb8d5f0893544663   # SAME artifact — the WP12 evidence-bundle "Manifest digest" IS fhv-dataset-manifest.json manifestSemanticDigest (self-digest exclusion); intentional, not accidental conflation
  fhvGapPolicyV1Digest:
    reportedInsertionOrder: 25342542e90b183112f6b5918a75cd55e1f12b98860f4d8f8a79ebe685cfb330   # = sha256(JSON.stringify(FHV_GAP_POLICY_V1)); Composer-reported label, NOT stored in any committed evidence file
    canonicalStableDigest: 3699f03b15f0a943592ce33c49486c1bf504e7a18de3b548ad44b37dd87b9f23   # = computeStableJsonDigest(FHV_GAP_POLICY_V1) (sorted-key canonical); both fingerprint the identical exact gap-policy object recorded in the WP12 evidence
  fhvGapPolicyV1Values: { policyId: FHV_GAP_POLICY_V1, maxTotalMissingBars: 0, maxSingleGapBars: 0, interpolationAllowed: false, syntheticBarInsertionAllowed: false, silentGapDropAllowed: false, crossVenueSubstitutionAllowed: false, onAnyGap: HTR_WP12_DATASET_GAP_POLICY_DECISION_REQUIRED }
  wp12LoaderCoverage: [HistoricalBarReplaySource, HistoricalBarSource, loadQualificationBars]   # each invokes assertIngestBarsIntegrityOrThrow before first Canvas advance; FixtureBarReplaySource is purely synthetic (not a historical loader)
  wp12BarIntegrityGateClasses: [identity, non-monotonic, duplicate, interval-misalignment, non-finite-OHLCV, negative-volume, invalid-OHLC-relation, malformed-provenance, digest-mismatch]   # nine fail-closed classes; no warning-only continuation
  wp12HoldoutNoRead: RESERVED_SEALED_NOT_ACCESSED   # blindHoldout 2025-01-01..2026-01-01 SEALED_NOT_ACCESSED; only opaque sourceChecksumSha256/holdoutSeal metadata; synthetic test objects
  wp12Wp09NonInvalidation: true   # integrity gate acts at load time before benchmark execution; no D-11B rerun, no WP09 evidence/threshold/host/dataset/cycle-count change
  wp12GapClosureSemantics: "fail-closed gate + versioned manifest contract now EXIST; real HTX 2020–2025 dataset NOT yet acquired/qualified; full FHV remains unauthorized; WP23 owns final runbook/manifest pinning + real-run preflight"
  wp12TerminalState: WORK_PACKAGE_COMPLETE
  wp12GapsClosed:
    - HTR-GAP-014
    - HTR-GAP-015
  wp12Validation:
    validateCanon: PASS
    lint: PASS
    typecheck: PASS
    tests: PASS
    build: PASS
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
    - HTR-WP11
    - HTR-WP12
    - HTR-WP13
  remainingWorkPackages:
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
  lastValidatedGitSha: 2d63eca2231bbd06ad40680a4485f74a8244bef0
  baselineTestCountAtHead:
    gitSha: 2d63eca2231bbd06ad40680a4485f74a8244bef0
    command: "pnpm test --run"
    testFilesPassed: 446
    testFilesSkipped: 26
    testCasesPassed: 2607
    testCasesSkipped: 107
    testCasesFailed: 0
    exitCode: 0
    note: default-suite baseline at WP13 CLOSEOUT; Postgres-gated baseline debt recorded separately under htrGap035
  wp13PostgresMandatorySuites:
    testsPassed: 15
    testsSkipped: 0
    verdict: PASS
  htrGap035:
    status: OPEN
    classification: POSTGRES_GATED_REPOSITORY_BASELINE_DEBT
    primaryOwner: HTR-WP17
    contributingOwners: [HTR-WP18, HTR-WP19]
    closureOwner: HTR-WP19
    preExistingFailingFiles: 18
    preExistingFailingTests: 34
    wp13MandatoryTests: 15_PASS
    verifiedAtWp13CloseoutHead: 2d63eca2231bbd06ad40680a4485f74a8244bef0
    failingFileDigest: dd2dd141d5cf8b88cb632407b7cbb09ade09ad8c3396532a88d678694cbf5dad
    failingFiles:
      - tests/integration/postgres-hwm-ledger-parity.test.ts
      - tests/integration/postgres-invoice-issuance-parity.test.ts
      - tests/integration/postgres-kill-switch-parity.test.ts
      - tests/integration/postgres-order-execution-parity.test.ts
      - tests/integration/postgres-order-reconciliation-parity.test.ts
      - tests/integration/postgres-order-repository-parity.test.ts
      - tests/integration/postgres-payment-ledger-parity.test.ts
      - tests/integration/postgres-reconciliation-workflow-parity.test.ts
      - tests/integration/postgres-reporting-period-parity.test.ts
      - tests/integration/postgres-research-intelligence-parity.test.ts
      - tests/integration/postgres-runtime-coherence.test.ts
      - tests/integration/postgres-settlement-parity.test.ts
      - tests/integration/postgres-settlement-reconciliation-parity.test.ts
      - tests/integration/postgres-trader-orders-parity.test.ts
      - tests/integration/postgres-twin-engine.test.ts
      - tests/integration/postgres-twin-persistence.test.ts
      - tests/integration/postgres-twin-reasoning-prediction.test.ts
      - tests/integration/reconciliation-rls.test.ts
    macroFPolicy:
      - WP14 and WP15 mandatory Postgres suites must execute with zero skip
      - Macro F may introduce no additional failing Postgres file or test
      - exact before/after failing-set comparison required
      - pre-existing failures may not be silently reclassified as Macro F PASS
  lastValidationAt: 2026-07-15
  latestValidatedBaseline: HTR-MACRO-E_PHASE_B_CLOSEOUT
  finalAuditStatus: not-started
  blockedReason: null
  timeframeEvidenceLaneAuthorityMatrixV1: HUMAN_APPROVED_FINAL_CODEPOINT_DIGEST_BOUND   # final code-point digest 6296c54e… Human-bound 2026-07-15
  positionPurposeAndExitContractV1: HUMAN_RATIFIED_WP14_APPLICATION_BOUND   # RATIFY-POSITION-PURPOSE-AND-EXIT-CONTRACT-V1 historical; BIND-POSITION-PURPOSE-AND-EXIT-CONTRACT-V1-TO-HTR-WP14 consumed 2026-07-15
  wp14MigrationDecision: HUMAN_CONFIRMED_V2   # CONFIRM-HTR-WP14-MIGRATION-V2 consumed 2026-07-15; supersedes v1 0082..0087 three-table proposal
  wp14MigrationSupersededV1: SUPERSEDED_BEFORE_BUILD_BY_FORECAST_CARDINALITY_AND_RELATIONAL_LINK_CORRECTION
  wp15MigrationDecision: HUMAN_CONFIRMED_NONE_READ_MODEL_ONLY   # CONFIRM-HTR-WP15-MIGRATION consumed 2026-07-15
  macroFReadiness: BUILD_AUTHORIZED
  nextHumanGate: NONE_UNTIL_HTR_MACRO_F_PHASE_A_REPORT
  nextAction: COMPOSER_EXECUTE_HTR_MACRO_F_PHASE_A
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
| Plan state | `state.status: in-progress` · `programStatus: WP_ACTIVE` — **HTR-WP13 COMPLETE** (WORK `d07bb654`, CLOSEOUT `2d63eca`); **HTR-MACRO-E COMPLETE**; **HTR-MACRO-F APPROVED** (`BUILD_AUTHORIZED: YES`, scope WP14+WP15 only); `composerTerminalState: READY_FOR_COMPOSER_HTR_MACRO_F_PHASE_A`; WP14 migration V2 confirmed (4 tables, 0082..0089); WP15 read-model-only confirmed; D-4 and Position-Purpose tokens preserved verbatim. **HISTORICAL (CONSUMED/SUPERSEDED):** Macro E Build authorization, `COMPOSER_EXECUTE_HTR_MACRO_E_PHASE_A`, v1 WP14 0082..0087 three-table proposal. |

## Approved decisions (recorded)

`APPROVE-HTR-PROGRAM`; `APPROVE-HTR-ACTIVATION: research-only-org0` (D-14); `ACK-HTR-CORE: m1-closed` (D-15); `APPROVE-HTR-D13: htr-supersedes` (D-13); `APPROVE-HTR-RUNTIME-SUBSTRATE: deterministic-historical-readiness-substrate` (D-16); `APPROVE-HTR-TARGET-SUBSET: scoped-htr-ratification` (D-17); `APPROVE-HTR-D1: record-level-chain` (D-1); `APPROVE-HTR-EPISTEMIC-CLOSURE: record-level` (D-18); `APPROVE-HTR-EXECSERVER: option-a-code-ready` (D-19); `APPROVE-HTR-D10: divergence-register-v1` (D-10); `APPROVE-HTR-EXECUTION-TOPOLOGY: one-integration-issue-one-branch-one-final-pr-23-sequential-child-build-plans`; **`APPROVE-HTR-D11B`** (D-11B — 2026-07-13, exact token in §"D-11B decision" below); **`APPROVE-HTR-WP09-CLEAN-COMMIT-QUALIFICATION-SEQUENCE`** (2026-07-13); **`APPROVE-HTR-MACRO-C: wp09-canvas-cutover-wp10-determinism`** + **`ACK-HTR-MACRO-C-MIGRATION: none`** + **`APPROVE-HTR-MACRO-C-BUILD`** (2026-07-13 — CONSUMED; Macro C Build authorized then, now COMPLETE 2026-07-14 with `BUILD_AUTHORIZED: NO`); **`APPROVE-FHV-RUN-CONTRACT-V0`** (2026-07-13 — Full Historical Validation Run Contract v0, a future-run contract that does NOT authorize the run during DEE-415); **`APPROVE-HTR-WP09-WP10-QUALIFICATION-BOUNDARY`** (2026-07-13 — WP09 evidence bound to the WP09 WORK commit; pre-approved WP10 determinism/no-lookahead changes may follow; no WP09 harness/Canvas/threshold/dataset/host mutation; no second D-11B attempt; final runtime re-proof owned by WP22); **`CLARIFY-FHV-RUN-CONTRACT-V0`** (2026-07-13 — venue HTX_ONLY, spot, BTCUSDT+ETHUSDT; the Binance D-11B dataset is infrastructure qualification only); **`APPROVE-HTR-MACRO-D: wp11-pit-provider-gateway-wp12-ingress-manifest`** + **`ACK-HTR-MACRO-D-MIGRATION: none`** + **`APPROVE-HTR-MACRO-D-BUILD`** (2026-07-14 — CONSUMED; HTR-MACRO-D APPROVED / `MACRO_D_MIGRATION_DECISION: NONE` / `BUILD_AUTHORIZED: YES` for Macro D only; Composer executes the exact §9-D packet, no auto-advance to WP13, single final PR still gated on all 23 WPs); **`RATIFY-FHV-INSIDE-OUT-VALIDATION-CONTRACT-V1`** (2026-07-14 — cross-cutting future-FHV contract, §"FHV inside-out validation contract v1"; maps onto WP13–WP23; adds no WP and no current implementation scope); **`RATIFY-MULTI-ACCOUNT-MULTI-POSITION-READINESS-CONTRACT-V1`** (2026-07-14 — cross-cutting offline readiness contract, §"Multi-account / multi-position readiness contract v1"; maps onto WP17–WP23; offline architecture/readiness qualification only — no live multi-account operation, no customer capital); **`RATIFY-TIMEFRAME-EVIDENCE-LANE-AUTHORITY-MATRIX-V1`** (2026-07-14 — cross-cutting future acceptance requirement, §"Timeframe × Evidence Lane authority matrix v1 (`RATIFY-TIMEFRAME-EVIDENCE-LANE-AUTHORITY-MATRIX-V1`)"; `REQUIRED_BEFORE_HTR_WP13_BUILD`; maps onto WP13/WP14/WP21/WP22/WP23; adds/splits/merges/removes/reorders no WP; exact cadence/freshness numbers grounded + Human-reviewed during WP13 planning, not this session); **`RATIFY-POSITION-PURPOSE-AND-EXIT-CONTRACT-V1`** (2026-07-14 — cross-cutting future acceptance requirement, §"Position purpose + exit contract v1 (`RATIFY-POSITION-PURPOSE-AND-EXIT-CONTRACT-V1`)"; `REQUIRED_BEFORE_HTR_WP14_BUILD`; maps onto WP14/WP16/WP17/WP18/WP20/WP21/WP22/WP23; adds/splits/merges/removes/reorders no WP). Activation boundary: Org-0 non-custodial research/historical only; no live, capital, holdout, external activation, agent authorization, gate opening, or Execution Server mutation. WP-local decisions D-11A/D-2/D-4/D-5/D-12 stop at their owning work package's Human gate on the same branch; **D-11B is RESOLVED (Human-approved)**.

## D-11B decision (Human-approved) + HTR-MACRO-C governance state

> **HISTORICAL SNAPSHOT — SUPERSEDED BY MACRO-C CLOSEOUT 2026-07-14.** The governance state below is preserved as of **2026-07-13** for audit. It has since been superseded: **HTR-MACRO-C is COMPLETE** (WP09 CLOSEOUT `3a0962f`, WP10 CLOSEOUT `1ac0e6a`, Opus Phase-B per-WP PASS); D-11B PASS under Memory Gate Amendment v1 (bound to `7c532f5`); HTR-GAP-001/002/003/004/025/031 CLOSED; `BUILD_AUTHORIZED: NO` (Macro C Build consumed); active macro is now **HTR-MACRO-D (DRAFT)**. Read this section as history, not current authorization.

Factual governance state as of 2026-07-13 (thresholds only — no qualification had been run at that date; `READY_FOR_FULL_HISTORICAL_TEST` remains not set):

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
- **HTR-MACRO-C** (as of 2026-07-13) was `REFRESHED_EXACT` (rolling-controller §9-C) and **Human-APPROVED** (`APPROVE-HTR-MACRO-C: wp09-canvas-cutover-wp10-determinism` + `ACK-HTR-MACRO-C-MIGRATION: none` + `APPROVE-HTR-MACRO-C-BUILD` consumed). `MACRO_C_MIGRATION_DECISION: NONE`; `MACRO_C_CODE_BASELINE_HEAD: a8a709ff…`. At that date `BUILD_AUTHORIZED: YES` for Macro C only. **[SUPERSEDED 2026-07-14: HTR-MACRO-C is now COMPLETE — WP09/WP10 implemented, Opus Phase-B per-WP PASS; HTR-GAP-001/002/003/004/025/031 CLOSED; `BUILD_AUTHORIZED: NO`.]** `READY_FOR_FULL_HISTORICAL_TEST` remains not set.
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

## FHV inside-out validation contract v1 (`RATIFY-FHV-INSIDE-OUT-VALIDATION-CONTRACT-V1`, 2026-07-14)

`FHV_INSIDE_OUT_VALIDATION_CONTRACT_V1` defines **what the future full historical run + readiness package must be capable of producing**. It is a cross-cutting acceptance clarification bound to existing work packages — it **adds, splits, merges, removes and reorders no work package** (the frozen 23-WP decomposition is unchanged) and authorizes **no** current implementation. **It does not execute FHV now.**

**3.1 Semantic journey.** The future FHV must be able to reconstruct the complete semantic path, end to end:

```text
Source Object → PIT Observation → Normalization → Validation → Freshness/Reliability → Context Fusion →
Market Canvas → MTF/Reconstruction → Market Understanding/MSV → Hypothesis/Evidence → CDE Permission →
Strategy Signal or NoSignal → Forecast → Decision/whyNotCash → Risk → Portfolio Allocation → Order Intent →
Execution Simulation → Fill/Partial Fill → Position Lot → Guardian → Exit → Closed Trade Reality →
Accounting → Equity/PnL/Drawdown → Reconciliation → Calibration → Knowledge Update
```

**3.2 Per-module semantic boundary record.** At each meaningful module boundary the readiness architecture must support: `runId`, `cycleId`, `moduleName`, `moduleVersion`, `inputDigest`, `outputDigest`, `stateBeforeDigest`, `stateAfterDigest`, decision/reason codes, data-quality state, degradation/error state, latency, memory high-water, checkpoint identity, resume identity, downstream consumer identity. **Low-level function-call logging is NOT required.** The contract requires: complete semantic-boundary traceability; deterministic function/unit/property coverage for internal functions; a detailed trace for every Decision, order, fill, position and closed trade; aggregated health/latency/error reporting for hot internal functions; drill-down from every `TRADE` and `NO_TRADE` to its complete Evidence Package.

**3.3 Required future reports.** `FHV_PNL_REPORT`, `FHV_MODULE_HEALTH_REPORT`, `FHV_DECISION_TRACE_REPORT`, `FHV_EXECUTION_AND_POSITION_REPORT`, `FHV_RECONCILIATION_REPORT`, `FHV_KNOWLEDGE_AND_CALIBRATION_REPORT`. **The module-health report must NOT claim a module is healthy merely because final PnL is positive** (module health is evidence/latency/error-based, independent of profitability).

**3.4 Ownership mapping (existing WPs only; no new WP):**

```yaml
HTR-WP13: Market Canvas → Market Understanding semantic-trace boundaries
HTR-WP14: forecast + Decision record completeness (whyNotCash, CDE disambiguation)
HTR-WP17: order/fill/execution-simulation trace
HTR-WP18: accounting/equity/PnL/drawdown trace
HTR-WP19: reality reconciliation + fail-closed invariant proof
HTR-WP20: Guardian, exit and closed-trade truth
HTR-WP21: forecast→decision→outcome→calibration epistemic chain
HTR-WP22: deterministic end-to-end inside-out qualification, checkpoint/resume trace parity, bounded telemetry
HTR-WP23: runbook, preflight and final report schema
```

## Multi-account / multi-position readiness contract v1 (`RATIFY-MULTI-ACCOUNT-MULTI-POSITION-READINESS-CONTRACT-V1`, 2026-07-14)

`MULTI_ACCOUNT_MULTI_POSITION_READINESS_CONTRACT_V1` is an **offline architecture/readiness qualification only**. It **does not authorize live multi-account operation or customer capital**, and it **adds, splits, merges, removes and reorders no work package**.

**4.1 Primary FHV unchanged.** The primary approved FHV still uses: `org: Org-0`, `portfolioMode: SHARED_MULTI_INSTRUMENT`, `cashUsdt: 100000`, `btcQuantity: 0`, `ethQuantity: 0`, `symbols: [BTCUSDT, ETHUSDT]`, `marketType: SPOT`, `leverage: 0`, `borrowing: PROHIBITED`, `shortSelling: PROHIBITED`. **Multi-account qualification PnL must NOT be mixed into the primary FHV PnL.**

**4.2 Separate offline readiness qualification.** Before final readiness certification the architecture must prove offline: multiple account contexts; multiple simultaneous positions; multiple lots on one symbol; BTC and ETH positions simultaneously; partial fills; partial exits; different `strategyId`; different `hypothesisId`; per-account cash and risk budgets; per-account position inventory; per-account checkpoint/resume; account-level stop/close-only behaviour; a separate global stop authority; fair scheduling; bounded memory; no starvation; **zero cross-account state leakage**.

**4.3 Required account-identity propagation.** Future execution/accounting paths must **not** assume a global single account. Propagate: `orgId`, `accountId`, `venueAccountId`, `portfolioId`, `strategyId`, `hypothesisId`, `orderId`, `fillId`, `positionLotId`. **No fill, balance change, position mutation or risk event for one account may affect another account.**

**4.4 Ownership mapping (existing WPs only; no new WP):**

```yaml
HTR-WP17: account-scoped execution simulation; multiple lots; partial fills/exits; no single-account singleton
HTR-WP18: per-account cash ledger, inventory, equity and PnL; aggregate operator view without accounting-truth mixing
HTR-WP19: per-account reconciliation; cross-account leakage is a hard FAIL
HTR-WP20: account-scoped CLOSE_ONLY/STOP_ACCOUNT; separate global kill authority
HTR-WP22: deterministic multi-account/multi-position stress fixture; checkpoint/resume; fairness; boundedness; isolation
HTR-WP23: capacity envelope; per-account checkpoint paths; per-account reports; aggregate operator report; restart + kill-switch procedures
```

## Timeframe × Evidence Lane authority matrix v1 (`RATIFY-TIMEFRAME-EVIDENCE-LANE-AUTHORITY-MATRIX-V1`, 2026-07-14)

```text
TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1:
REQUIRED_BEFORE_HTR_WP13_BUILD
```

`TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1` is a Human-ratified future planning + acceptance requirement. It **adds, splits, merges, removes and reorders no work package** (the frozen 23-WP decomposition is unchanged) and authorizes **no** implementation of WP13–WP23 in this session. The exact machine-readable matrix must be grounded and Human-reviewed during WP13 planning — **do not invent arbitrary cadence/freshness numbers here.**

**Per-lane definition.** For every evidence lane the future matrix must define: `laneId`; source/provider class; market question answered; refresh cadence or event trigger; maximum age/freshness; PIT availability rule; timeframes allowed to read it; fields/state it may influence; decisions it is forbidden to make; absence/degradation reason code; historical replay source.

**Hard invariants.**

```text
no timeframe directly calls a provider
1D/4H/1H/15m own structure/scenario context
1m owns execution-safety precision only
1m cannot create higher-timeframe understanding
HTF state changes only on closed-bar boundaries
slow context cannot independently create BUY/SELL
missing lane is explicit UNAVAILABLE
```

**Ownership mapping (existing WPs only; no new WP):**

```yaml
HTR-WP13: exact matrix definition and historical-profile enforcement
HTR-WP14: Decision/Forecast records show which lanes influenced the decision
HTR-WP21: outcome/calibration attribution by evidence lane
HTR-WP22: deterministic matrix-conformance qualification
HTR-WP23: runbook and report schema
```

## WP13–WP16 intelligence tranche (planning, 2026-07-14 — topology, D-1/D-2/D-3, matrix v2, historical profile v2)

Recorded per two Human-authorized bounded sessions (both **CONSUMED**, both planning/governance only — **no** production code, WP implementation, Build, migration execution, PR, FHV/M9/holdout/paper/live): `AUTHORIZE-HTR-WP13-WP16-INTELLIGENCE-TRANCHE-PLANNING` (2026-07-14, topology + drafts) and `AUTHORIZE-HTR-MACRO-E-FINAL-PREAPPROVAL-RECONCILIATION` (2026-07-14, finalization). The exact per-WP packets, matrix JSON and profile JSON live in the gitignored controller [`.cursor/plans/dee-415-htr-wp13-wp16-intelligence-rolling.plan.md`](../../.cursor/plans/dee-415-htr-wp13-wp16-intelligence-rolling.plan.md) and its staging directory; this section is the tracked governance summary.

> **HISTORICAL (CONSUMED / SUPERSEDED 2026-07-15 Phase-A):** Macro-E Phase-A Build was `BUILD_AUTHORIZED: YES` under `APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD` (CONSUMED). **Current-facing (post Phase-B CLOSEOUT):** HTR-MACRO-E **COMPLETE**; HTR-WP13 **WORK_PACKAGE_COMPLETE**; `BUILD_AUTHORIZED: NO`. Final code-point profile canonical digest `92219746…` and matrix canonical digest `6296c54e…` (canonicalizer `HTR_SEMANTIC_CANONICAL_JSON_V1`; `localeCompare` PROHIBITED) remain `HUMAN_BOUND_FINAL_CODEPOINT_DIGEST`. Macro F `REFRESHED_CONFIRM_REQUIRED` (not WP14/WP15/WP16 Build; no FHV, blind holdout, paper, live or capital).

### Safe execution topology (execution-only macro grouping)

```yaml
HTR-MACRO-E: { workPackages: [HTR-WP13] }
HTR-MACRO-F: { workPackages: [HTR-WP14, HTR-WP15] }
HTR-MACRO-G: { workPackages: [HTR-WP16] }
```

Changes **execution topology only** — adds/removes no WP, merges no technical ownership, changes no dependency/gap ownership/per-WP WORK+CLOSEOUT requirement, permits no auto-advance between macros. **The topology decision alone authorizes no Build.** The separately consumed `APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD` does authorize HTR-MACRO-E / HTR-WP13 Phase A. **Macro E is WP13 alone** because WP13 is a foundational T2 High intelligence-chain activation that owns historical-profile activation, matrix enforcement, and the runtime shape consumed by WP14, and must independently earn WORK + Opus PASS + CLOSEOUT before Macro F Build (WP14/WP15 packets refresh from the WP13 CLOSEOUT HEAD). **Macro F groups WP14+WP15** as one sequential epistemic-consumer chain (Forecast + Decision + whyNotCash → MKB read-model), executable only after WP13 COMPLETE + D-4 + `POSITION_PURPOSE_AND_EXIT_CONTRACT_V1` + both packets refreshed + both Human-approved, with a separate WORK+Opus verdict+CLOSEOUT per WP. **Macro G keeps WP16 separate** because strategy eligibility/lifecycle gating, trial accounting and `riskMultiplier` have a different semantic owner, are gated by D-2 **and** D-20, and feed WP22 rather than the WP14→WP15→WP21 critical chain. Preferred order after WP13 closeout: **Macro F, then Macro G**. Neither future macro is authorized now.

### Decision reconciliation

- **D-1 — ALREADY_RESOLVED.** `APPROVE-HTR-D1: record-level-chain` (recorded above). WP13 activates only the **record-level** chain and creates **no mature autonomous engines**.
- **D-3 — HUMAN_APPROVED_FINAL_CODEPOINT_DIGEST_BOUND.** `CLARIFY-HTR-D3-HISTORICAL-PROFILE` consumed 2026-07-15. Runtime semantic contract approved; governance-only fields removed from staging JSON. Final code-point canonical digest `9221974607d3a8a569c380b4699495600277449055f76391c4fa5377a6088abe` is **HUMAN_BOUND_FINAL_CODEPOINT_DIGEST** (`APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD` consumed 2026-07-15). Prior localeCompare digest `a9666258…` is **REJECTED_CANONICALIZATION_LOCALECOMPARE**; original `9a1ed67e…` is **SUPERSEDED_DIGEST_INTEGRITY_DEFECT**.
- **D-2 — HUMAN_APPROVED (consumed 2026-07-15).** HTX_ONLY SPOT; BTCUSDT+ETHUSDT; base 1m + derived 15m/1h/4h/1d; enabled historical consumers `liquidity_sweep_reversal_v0`+`mean_reversion_v0`; research-only `trend_momentum_v0` = `EVIDENCE_ONLY_NOT_TRADE_ELIGIBLE`; enablement is **not** SVG approval and **not** an edge verdict; version-pin+lifecycle owned by WP16. WP13 owns enablement set + matrix + terminal-reason + records.

```text
APPROVE-HTR-D2: venue=HTX market=SPOT symbols=BTCUSDT,ETHUSDT base=1m derived=15m,1h,4h,1d enabled-historical-consumers=liquidity_sweep_reversal_v0,mean_reversion_v0 research-only=trend_momentum_v0 research-only-semantics=EVIDENCE_ONLY_NOT_TRADE_ELIGIBLE strategy-promotion=PROHIBITED edge-verdict=NOT_CLAIMED version-rule=PIN_EXACT_REGISTERED_VERSION_AT_WP16 portfolio=SHARED_MULTI_INSTRUMENT wp13-owns=consumer-set+matrix+terminal-reason+records wp16-owns=version-pin+lifecycle-gating+trial+riskMultiplier
```

### `HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1` (HUMAN_APPROVED · FINAL_CODEPOINT_DIGEST_HUMAN_BOUND)

Explicit, versioned historical run profile (staging: `.cursor/plans/dee-415-htr-wp13-wp16-staging/htr-historical-intelligence-profile-v1.json`) that activates the record-level MI-core chain **only** through an explicit seam (`runBacktest historicalProfile → runEvaluationCycle`), **never** as a global default. Contains **no governance/planning status fields**. Pins venueScope `HTX_ONLY`, marketType `SPOT`, symbols `[BTCUSDT, ETHUSDT]`, baseInterval `1m`, derivedIntervals `[15m,1h,4h,1d]` (`CLOSED_BARS_ONLY`); enabled intelligence stages; `strategyConsumerPolicy` with enabled LSR+MR and research-only TM (`EVIDENCE_ONLY_NOT_TRADE_ELIGIBLE`); `historicalEvidenceCapability: PRICE_ONLY_GROUNDED_EVIDENCE_PROFILE`; matrix digest pin in `providerEvidenceLanePolicy.matrixDigestCanonical`. **Final code-point canonical digest:** `9221974607d3a8a569c380b4699495600277449055f76391c4fa5377a6088abe` (insertion-order `0d156d38…`; raw-file `72ed9b17…`). Canonicalizer: `HTR_SEMANTIC_CANONICAL_JSON_V1` (`localeCompare` PROHIBITED). **Substantive runtime semantics unchanged.**

### `TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1` (HUMAN_APPROVED · FINAL_CODEPOINT_DIGEST_HUMAN_BOUND)

Exact machine-readable matrix (staging: `.cursor/plans/dee-415-htr-wp13-wp16-staging/timeframe-evidence-lane-authority-matrix-v1.json`) over **16 lanes** (1 HTX spot 1m price + 15 UNAVAILABLE sidecar lanes). Contains **no governance status fields**. **Final code-point canonical digest:** `6296c54e35aeb311739f3ab1c30a0c452637c5abf7f2464f0b0cd906a6ef04a6` (insertion-order `2e558f18…`; raw-file `4aed27c0…`). Canonicalizer: `HTR_SEMANTIC_CANONICAL_JSON_V1`. FHV scope: `PRICE_ONLY_GROUNDED_EVIDENCE`; `MULTI_SOURCE_HISTORICAL_VALIDATION: NOT_PERFORMED`.

### HTR-WP13 migration decision

```yaml
MIGRATION_DECISION: CONFIRMED_WITH_ATOMIC_FAIL_CLOSED_IDEMPOTENCY   # CONFIRM-HTR-MACRO-E-MIGRATION consumed 2026-07-15
ACTIVE_MACRO_STATUS: APPROVED   # APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD consumed 2026-07-15; final code-point digests Human-bound
BUILD_AUTHORIZED: NO   # HISTORICAL Phase-A authorization CONSUMED; Macro E COMPLETE; Macro F unauthorized
```

**Amendment consumed 2026-07-15 (`CONFIRM-HTR-MACRO-E-MIGRATION`):** the earlier package's
`INSERT ON CONFLICT DO NOTHING` is **PROHIBITED** (it can silently accept a same-key/different-content
replay). Persistence is an **atomic cycle bundle** `HTR_WP13_ATOMIC_INTELLIGENCE_CYCLE_BUNDLE_V1` — one
`runWaiaPostgresTransaction` writing envelope → hypothesis records (sorted by `hypothesis_type` code point)
→ conviction record; partial commit PROHIBITED; any failure rolls back the complete bundle. **Fail-closed
idempotency** per table: on conflict, load the existing row by the exact business key and compare
deterministic row id + organization id + business-key fields + schema version + canonical content digest;
accept only when all are identical, otherwise throw `HTR_WP13_IDEMPOTENCY_CONFLICT` and roll back.
`conviction_scope='AGGREGATE'` is **removed from schema v1** (`DEFERRED_NOT_IN_SCHEMA_V1`); schema-v1 scope ∈
{`ACTIVE_HYPOTHESIS`, `NONE`}. Full contract + content-digest coverage + exact transaction/conflict tests in
controller §7.6/§7.7; exact file/symbol packet in §7.4.

**Resolved to Outcome B (migration required) via a read-only schema/repository audit at HEAD `fd2f9ca`.** The existing `trader_mi_*` tables implement the LD-5a declarative-claim doctrine (registry/evidence/confidence-judgment; DDL `db/migrations_postgres/0026–0036`), are **orphaned** from `runEvaluationCycle`/`runBacktest`, and are semantically/granularly wrong for WP13 per-cycle records; there is **no** conviction, LD-7 decision, or forecast table. WP13 identities (`runId`, `cycleId`, `symbol`, profile/matrix digests, in-cycle `hypothesisType`, conviction value/class/reason-codes, DUP-14 authoritative link, persisted terminal reason) are **not representable** without new schema (no column overloading / JSON abuse; existing `UNIQUE(org,hypothesis_key,seq)` cannot enforce `(org,run,cycle,symbol)` replay parity). **Exact package (Postgres-only, append-only, service-role RLS; no SQL created):** three new tables — `trader_intelligence_cycle_envelope` (one row per org/run/cycle/symbol + universal `terminal_reason_code` + input/output semantic digests; `UNIQUE(organization_id,run_id,cycle_id,symbol)`), `trader_intelligence_hypothesis_record` (the **8 competing per-cycle hypotheses** — one row per `hypothesis_type` — with `authoritative_link_digest` DUP-14 + optional `mi_hypothesis_id` FK; `UNIQUE(organization_id,run_id,cycle_id,symbol,hypothesis_type)`), `trader_intelligence_conviction_record` (**exactly one cycle-level active conviction row per cycle** — Model B `MODEL_B_ONE_CYCLE_LEVEL_ACTIVE_CONVICTION`, proven from `lib/trader/intelligence/hypothesis/build-hypothesis-set.ts` + `mi-core.types.ts` `MarketStateSnapshot.activeOpportunity: MarketOpportunity | null`; `UNIQUE(organization_id,run_id,cycle_id,symbol)`; **`active_hypothesis_record_id` NULLABLE** composite-FK → `trader_intelligence_hypothesis_record(id, organization_id)`; **`conviction_scope` `ACTIVE_HYPOTHESIS`|`NONE`** (schema v1; `AGGREGATE` = `DEFERRED_NOT_IN_SCHEMA_V1`) with the exact constraint `(scope='ACTIVE_HYPOTHESIS' AND active_hypothesis_record_id IS NOT NULL) OR (scope='NONE' AND active_hypothesis_record_id IS NULL)`, so the no-active-hypothesis / no-hypothesis cycle persists deterministically as `conviction_scope=NONE` + null link (still persisting conviction value/class/reason-codes/sustained state) — the earlier proposed `hypothesis_record_id NOT NULL` was too strict for the nullable `activeHypothesis`/`activeOpportunity` runtime + `MI_HYP_NO_ACTIVE` reason code); numeric fields as canonical decimal STRING for byte-identical replay; migration files `0076–0081` (DDL+RLS pairs); **`SQLITE_ADAPTER: NOT_REQUIRED`** (`db/AGENTS.md:148` Postgres-only MVP Execution Freeze + ADR-0017: no new SQLite migrations/adapters for new trader features until Post-MVP DEE-85); backfill NONE; rollback = DROP reverse order; **Forecast/Decision/whyNotCash explicitly DEFERRED to WP14**. Human confirmation token `CONFIRM-HTR-MACRO-E-MIGRATION` was **consumed 2026-07-15** (full form in controller §10). **No SQL was created in this planning session.**

### Architecture-only WP14 / WP15 / WP16 (SUPERSEDED — see §"HTR-MACRO-F exact implementation packets")

**HISTORICAL / SUPERSEDED 2026-07-15.** The architecture-only placeholders below are replaced by exact packets in §"HTR-MACRO-F exact implementation packets (2026-07-15)".

`ARCHITECTURE_ONLY`, `REFRESH_REQUIRED_AFTER_WP13_CLOSEOUT`, `BUILD_AUTHORIZED NO`. **WP14** (Macro F): Forecast + Decision + whyNotCash + CDE/LD-7 disambiguation + net economics + entry-purpose ownership (gaps 007/008/011/036; gates WP13 COMPLETE, D-4, `POSITION_PURPOSE_AND_EXIT_CONTRACT_V1`, migration). **WP15** (Macro F): MKB read-model integration, global spine tenant-read-only, tenant-scoped outcomes, eligibility via sanctioned contract (gap 010; gate WP14 COMPLETE; grouped with WP14 only after both refreshed from WP13 CLOSEOUT HEAD). **WP16** (Macro G): strategy-version pinning, lifecycle eligibility (`STRAT_TM_STRATEGY_NOT_ALLOWED`), trial accounting, `riskMultiplier`, position-purpose gating, pinned D-20 drawdown policy (gaps 020/021; gates WP13 COMPLETE, D-2, D-20, migration).

### Human Macro-E decisions (CONSUMED 2026-07-15)

WP10 evidence-hermeticity is **RESOLVED_FINAL_PHASE_B_PASS** (closeout `b132166`). The six exact Macro-E
tokens below were **CONSUMED 2026-07-15** (`APPROVE_FINAL_D2_D3_MATRIX_MIGRATION_STRATEGY_FOUNDATION_AND_MACRO_E_PACKET`),
after applying the mandatory persistence amendment (atomic cycle bundle + fail-closed idempotency; `AGGREGATE`
removed from schema v1). Build authorization remains a **separate later** gate and is **NOT** consumed:

1. `APPROVE-HTR-D2: venue=HTX market=SPOT symbols=BTCUSDT,ETHUSDT base=1m derived=15m,1h,4h,1d enabled-historical-consumers=liquidity_sweep_reversal_v0,mean_reversion_v0 research-only=trend_momentum_v0 research-only-semantics=EVIDENCE_ONLY_NOT_TRADE_ELIGIBLE strategy-promotion=PROHIBITED edge-verdict=NOT_CLAIMED version-rule=PIN_EXACT_REGISTERED_VERSION_AT_WP16 portfolio=SHARED_MULTI_INSTRUMENT wp13-owns=consumer-set+matrix+terminal-reason+records wp16-owns=version-pin+lifecycle-gating+trial+riskMultiplier`
2. `CLARIFY-HTR-D3-HISTORICAL-PROFILE: profile-id=HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 profile-digest=9a1ed67e… (as-consumed; SUPERSEDED_DIGEST_INTEGRITY_DEFECT) supersedes-draft-digest=fac1a44f… historical-evidence-capability=PRICE_ONLY_GROUNDED_EVIDENCE_PROFILE global-default=PROHIBITED historical-only=YES` — final code-point digest binding recorded below.
3. `APPROVE-TIMEFRAME-EVIDENCE-LANE-AUTHORITY-MATRIX-V1: matrix-digest=c9186814… (as-consumed; SUPERSEDED_DIGEST_INTEGRITY_DEFECT) fhv-scope-limitation=PRICE_ONLY_GROUNDED_EVIDENCE multi-source-historical-validation=NOT_PERFORMED` — final code-point digest binding recorded below.
4. `CONFIRM-HTR-MACRO-E-MIGRATION: tables=trader_intelligence_cycle_envelope,trader_intelligence_hypothesis_record,trader_intelligence_conviction_record posture=POSTGRES_ONLY+APPEND_ONLY+SERVICE_ROLE_RLS+ORG_SCOPED sqlite-adapter=NOT_REQUIRED bundle-write=SINGLE_ATOMIC_POSTGRES_TRANSACTION partial-cycle-bundle=PROHIBITED conflict-policy=VERIFY_DETERMINISTIC_ID_AND_CONTENT_DIGEST same-key-same-content=IDEMPOTENT_REPLAY_ACCEPTED same-key-different-content=HTR_WP13_IDEMPOTENCY_CONFLICT silent-on-conflict-do-nothing=PROHIBITED hypothesis-idempotency=UNIQUE(org,run,cycle,symbol,hypothesis_type) conviction-cardinality=MODEL_B_ONE_CYCLE_LEVEL_ACTIVE_CONVICTION conviction-idempotency=UNIQUE(org,run,cycle,symbol) conviction-scope=ACTIVE_HYPOTHESIS|NONE aggregate-scope=DEFERRED_NOT_IN_SCHEMA_V1 active-hypothesis-link=NULLABLE_COMPOSITE_FK_WITH_SCOPE_CONSTRAINT cycle-envelope-idempotency=UNIQUE(org,run,cycle,symbol) numeric=CANONICAL_DECIMAL_STRING backfill=NONE rollback=DROP_REVERSE_ORDER migration-files=0076..0081 deferred-to-wp14=forecast,decision,whyNotCash`
5. `RATIFY-STRATEGY-DISCOVERY-TO-OPERATOR-PROPOSAL-CONTRACT-V1: implemented-in-dee415=false mature-autonomous-engine-authorized=false foundation-preservation-required=true machine-self-promotion=PROHIBITED machine-capital-authority=PROHIBITED future-program-required=true` (additive foundation obligation; adds no WP and no current Build scope)
6. `APPROVE-HTR-INTELLIGENCE-MACRO-E: wp13-historical-intelligence-chain`

(full forms in controller §10). **All six substantive tokens were consumed 2026-07-15.**

**Final code-point digest binding (CONSUMED 2026-07-15 — `APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD`).** This Human decision binds the final code-point profile and matrix digests, supersedes all draft/originally-approved/governance-cleanup/`localeCompare` digests, and authorizes Composer Phase A for **HTR-MACRO-E / HTR-WP13 only** (not WP14/WP15/WP16; no FHV, blind holdout, paper, live or capital deployment). The complete digest history, classified:

```yaml
ORIGINAL_CONSUMED_PROFILE_DIGEST:
  value: 9a1ed67e39c2a5e23bb83459f4f1fb52b10c88a49ebbf773b5285c90b82f706c
  status: SUPERSEDED_DIGEST_INTEGRITY_DEFECT

INTERMEDIATE_GOVERNANCE_CLEAN_PROFILE_DIGEST:
  value: a9666258e046e934b2156e0dc3ad5da02eb9b7e69d994e3505a3af5b62cd8bf0
  status: REJECTED_CANONICALIZATION_LOCALECOMPARE

FINAL_PROFILE_DIGEST:
  value: 9221974607d3a8a569c380b4699495600277449055f76391c4fa5377a6088abe
  status: HUMAN_BOUND_FINAL_CODEPOINT_DIGEST

ORIGINAL_CONSUMED_MATRIX_DIGEST:
  value: c91868142e8b5ed0b5db533e1811fe4a733290a204efab52f02ed592c1c01b08
  status: SUPERSEDED_DIGEST_INTEGRITY_DEFECT

INTERMEDIATE_GOVERNANCE_CLEAN_MATRIX_DIGEST:
  value: 231712e2916370e07def8546f70ed8434e7794e498842390c301e9a7a16baffb
  status: REJECTED_CANONICALIZATION_LOCALECOMPARE

FINAL_MATRIX_DIGEST:
  value: 6296c54e35aeb311739f3ab1c30a0c452637c5abf7f2464f0b0cd906a6ef04a6
  status: HUMAN_BOUND_FINAL_CODEPOINT_DIGEST
```

Exact consumed decision (recorded verbatim; the six substantive tokens above remain preserved as history and are **not** rewritten or reopened):

```text
APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD: profile-id=HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 profile-canonical-digest=9221974607d3a8a569c380b4699495600277449055f76391c4fa5377a6088abe profile-raw-file-sha256=72ed9b17d773e1be2bc55f659c1d0ec39e9e0c8a3e5dc0f7c02795103db2cc8a matrix-id=TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1 matrix-canonical-digest=6296c54e35aeb311739f3ab1c30a0c452637c5abf7f2464f0b0cd906a6ef04a6 matrix-raw-file-sha256=4aed27c0bfeaa853641330378962dce019a63eea22548ac4616bf03b396bfa97 canonicalizer=HTR_SEMANTIC_CANONICAL_JSON_V1 object-key-order=UNICODE_CODE_POINT_ASCENDING locale-compare=PROHIBITED active-macro=HTR-MACRO-E active-work-packages=HTR-WP13 macro-build-authorized=YES scope=RESEARCH_ONLY_HISTORICAL paper=PROHIBITED live=PROHIBITED capital-authority=PROHIBITED holdout-access=PROHIBITED
```

### HTR-WP13 conviction cardinality resolution (Model B — evidence-backed, 2026-07-14)

Independently resolved from runtime code (not planning prose). The MI-core evaluation chain (`lib/trader/intelligence/evaluation-cycle.ts` → `hypothesis/build-hypothesis-set.ts` → `decision-chain.ts`, typed by `mi-core.types.ts`) has this cardinality per `(organization_id, run_id, cycle_id, symbol)`:

- **Hypotheses — many (fixed 8):** `buildHypothesisSet` always emits one `MarketHypothesis` per `hypothesisType` (8 types in `hypothesis.types.ts`). → hypothesis table `UNIQUE(org,run,cycle,symbol,hypothesis_type)`; up to 8 rows/cycle.
- **Active hypothesis — zero or one:** `HypothesisSet.activeHypothesis = ranked[0] ?? null` (highest confidence; non-null whenever any hypothesis exists, which is always true in the current engine, but the type and `MI_HYP_NO_ACTIVE` reason code keep the zero case legal).
- **Conviction — exactly one authoritative cycle-level record:** `MarketStateSnapshot.activeOpportunity: MarketOpportunity | null` + scalar `conviction`; `MarketOpportunity` carries the single `conviction`, `sustainedCycles`, `authorized`, `reasonCode`. Sustained-cycle counts live in transient `HypothesisSessionState.sustainedCyclesByType` (session state, not a persisted per-hypothesis conviction ledger).

**Selected model: Model B (one cycle-level active conviction).** Model A (per-hypothesis conviction ledger) is rejected because runtime does **not** maintain an independent persisted conviction per hypothesis — only one authoritative active conviction per cycle. A repo audit (2026-07-15) of every `aggregate*` symbol in `lib/trader` confirms there is **no** conviction-level `AGGREGATE` persistence state distinct from active-hypothesis and NONE (the hits are provider-health / MTF resampling / discovery rank / regime-label reporting), so `AGGREGATE` is removed from schema v1.

Final conviction table (`trader_intelligence_conviction_record`):

```yaml
rowCardinality: exactly one per (organization_id, run_id, cycle_id, symbol)
uniqueKey: UNIQUE(organization_id, run_id, cycle_id, symbol)     # = idempotency key
convictionScope: ACTIVE_HYPOTHESIS | NONE                       # NOT NULL; AGGREGATE = DEFERRED_NOT_IN_SCHEMA_V1
scopeConstraint: (scope='ACTIVE_HYPOTHESIS' AND active_hypothesis_record_id IS NOT NULL) OR (scope='NONE' AND active_hypothesis_record_id IS NULL)
activeHypothesisRecordId: NULLABLE                               # composite FK (active_hypothesis_record_id, organization_id) -> trader_intelligence_hypothesis_record(id, organization_id)
nullability: active_hypothesis_record_id NULL iff conviction_scope = NONE (conviction value/class/reason-codes/sustained state still persisted)
deterministicIdDerivation: id = deterministic UUID from (org, run, cycle, symbol) via ADR-0021 deterministic newId; no wall-clock/random
deterministicOrdering: rows ordered by (run_id, cycle_id, symbol); hypothesis rows by hypothesis_type code-point order
contentDigestCoverage: conviction_value(decimal string) + conviction_class + reason_codes_json(canonical) + sustained_cycles + conviction_scope + active_hypothesis link digest; created_at EXCLUDED
cycleEnvelopeRelationship: composite FK (cycle_envelope_id, organization_id) -> trader_intelligence_cycle_envelope; 1:1 with the cycle envelope
hypothesisRelationship: references the active/top hypothesis row (the one exposed as MarketOpportunity)
sustainedCycleCalculation: MarketOpportunity.sustainedCycles (deterministic sustainedCyclesByType accumulation; strengthening-only increment)
```

Explicit case resolution:

```text
multiple competing hypotheses in one cycle   -> 8 hypothesis rows; one conviction row scope=ACTIVE_HYPOTHESIS linked to the top hypothesis
one hypothesis becomes active                -> conviction_scope=ACTIVE_HYPOTHESIS; active_hypothesis_record_id = that row
hypotheses exist but none authorized         -> conviction row still written (authorized=false captured via conviction_class/reason_codes); scope=ACTIVE_HYPOTHESIS on top hypothesis
no valid hypothesis produced                 -> conviction_scope=NONE; active_hypothesis_record_id NULL (defensive; engine currently always emits 8)
no active hypothesis (MI_HYP_NO_ACTIVE)       -> conviction_scope=NONE; active_hypothesis_record_id NULL
conviction strengthens across cycles         -> sustained_cycles increments deterministically; distinct cycle_id => distinct conviction row
active hypothesis changes                    -> new cycle row links to the new top hypothesis type
checkpoint/resume repeats a persisted cycle  -> attempt deterministic insert -> on conflict load exact existing row -> compare deterministic id + organization + business key + schema version + canonical content digest -> identical = IDEMPOTENT_REPLAY_ACCEPTED -> mismatch = HTR_WP13_IDEMPOTENCY_CONFLICT -> rollback complete atomic cycle bundle
```

Exact schema tests to add at WP13 Build (not created this session): `tests/unit/trader-wp13-conviction-record.test.ts` (asserts one-conviction-per-cycle, NONE-scope + null active link, idempotent re-insert) and `tests/unit/trader-wp13-intelligence-records-schema.test.ts` (asserts hypothesis `UNIQUE(...,hypothesis_type)` up to 8 rows).

## `STRATEGY_DISCOVERY_TO_OPERATOR_PROPOSAL_CONTRACT_V1` (additive foundation, `RATIFY-STRATEGY-DISCOVERY-TO-OPERATOR-PROPOSAL-CONTRACT-V1`, 2026-07-14)

Additive preservation contract (adds **no** WP, **no** current Build scope). Preserves the target future scenario: **Accumulated Market Knowledge → Pattern Discovery → Research Hypothesis → Strategy Candidate → Autonomous Historical Qualification → Evidence Package → Argumented Proposal to Operator → Human Decision.**

**Scope boundary.** DEE-415 must **not** implement a mature Pattern Discovery Engine or Strategy Synthesis Engine.

```yaml
implementedInDEE415: false
matureAutonomousEngineAuthorized: false
foundationPreservationRequired: true
machineSelfPromotion: prohibited
machineCapitalAuthority: prohibited
futureProgramRequired: true
```

This is a foundation and extension-seam obligation, not an expansion of WP13 Build scope.

**WP ownership mapping (foundations only):**

```yaml
HTR-WP13:
  owns: [deterministic hypothesis lineage, conviction lineage, universal terminal reason, profile and matrix binding, records queryable for future pattern discovery, preservation of no-hypothesis and no-trade observations]
HTR-WP14:
  owns: [preregistered Forecast records, Decision records, whyNotCash, causal decision history]
HTR-WP15:
  owns: [deterministic MKB read-model, pattern/research query seam, knowledge eligibility and aging visibility]
HTR-WP16:
  owns: [strategy lifecycle and exact version pinning, preservation of a future machine-proposed candidate admission seam, only DRAFT or RESEARCHING initial state, no automatic PAPER/LIVE/trade eligibility]
HTR-WP17_TO_WP20:
  owns: [realistic cost/execution/accounting/closed-trade evidence]
HTR-WP21:
  owns: [outcome resolution, forecast calibration, hypothesis correctness, knowledge-confidence update, feedback into future pattern discovery]
HTR-WP22:
  owns: [reproducibility and performance qualification]
HTR-WP23:
  owns: [operator-facing Evidence Package readiness, future Strategy Synthesis program handoff]
```

WP16 does **not** implement machine generation — it only preserves lifecycle compatibility for a future candidate origin (DRAFT/RESEARCHING only; no automatic PAPER/LIVE/trade eligibility).

**Historical qualification policy (future target; no fixed threshold enters WP13):** validation horizon is configurable, up to ~3 years when sufficient qualified history exists; shorter periods only with explicit data-availability/regime justification; the candidate may not choose a convenient successful period after seeing results; discovery/training data separated from validation; walk-forward windows sequential; untouched validation isolated; blind holdout sealed + single-shot; cost/slippage/fees applied; max drawdown + recovery reported; results broken down by regime/symbol/period; parameter stability + sensitivity tested; comparison with cash/no-trade + simple baselines required. **No fixed 3-year threshold is introduced into WP13.**

**Operator proposal package (future machine proposal must contain):** pattern discovered; economic/market rationale; source knowledge + hypothesis lineage; strategy candidate version; entry/no-trade/exit/risk rules; applicable + failure regimes; falsification conditions; data periods + separation; net PnL after costs; max drawdown + recovery; trade count + statistical sufficiency; parameter sensitivity; regime/symbol/period breakdown; walk-forward result; untouched validation result; blind-holdout status; known failure modes; remaining uncertainty; recommended next gate. **Allowed machine recommendations:** `REJECT`, `NEEDS_MORE_EVIDENCE`, `READY_FOR_BLIND_HOLDOUT`, `READY_FOR_PAPER_SOAK`, `READY_FOR_HUMAN_REVIEW`. **The machine may never promote itself.**

## HTR-MACRO-F exact implementation packets (2026-07-15, V2 activation)

Refreshed from production baseline `2d63eca2231bbd06ad40680a4485f74a8244bef0` (HTR-WP13 CLOSEOUT). Status: **`APPROVED`** · **`BUILD_AUTHORIZED: YES`** (scope HTR-MACRO-F / HTR-WP14+HTR-WP15 only). V1 migration proposal (`0082..0087` three-table, `forecast_record_ids_json`) **`SUPERSEDED_BEFORE_BUILD_BY_FORECAST_CARDINALITY_AND_RELATIONAL_LINK_CORRECTION`** — never consumed, never implemented.

### D-4 (consumed 2026-07-15 — token preserved verbatim)

```yaml
status: HUMAN_APPROVED_CONSUMED
consumedAt: 2026-07-15
token: |-
  APPROVE-HTR-D4:
  cde-msv-role=MARKET_STATE_CONTEXT_AND_PERMISSION_NOT_LD7_DECISION
  forecast-authority=LD6_PREREGISTERED_APPEND_ONLY
  forecast-seal=BEFORE_OUTCOME_AVAILABILITY
  forecast-horizon=OWNED_BY_FORECAST_IMMUTABLE
  forecast-invalidation=DECLARED_AT_ISSUANCE_IMMUTABLE
  decision-authority=LD7_ONE_AUTHORITATIVE_DECISION_PER_ORG_RUN_CYCLE_SYMBOL
  decision-classes=TRADE,REDUCED_RISK,NO_TRADE
  no-trade=FIRST_CLASS
  why-not-cash=REQUIRED_FOR_TRADE_OR_REDUCED_RISK
  why-cash-or-abstain=REQUIRED_FOR_NO_TRADE
  net-economics=DECISION_OWNS_COST_MODEL_REFERENCE_AND_EXPECTED_NET_VALUE
  missing-net-economics=FAIL_CLOSED_TO_NO_TRADE
  causal-lineage=WP13_CYCLE_ENVELOPE+HYPOTHESIS+CONVICTION+FORECAST
  outcome-resolution=SEPARATE_APPEND_ONLY_RECORD_OWNED_BY_WP21
  forecast-calibration=OWNED_BY_WP21
  no-lookahead=MANDATORY
  strategy-promotion=PROHIBITED
  capital-authority=HUMAN_ONLY
```

CDE/MSV (`buildMsvEnvelope` / `TradingPermission`) constrains permission only; it is never persisted as the LD-7 Decision. Research strategy evaluations remain separate evidence (`StrategySignal.researchEvaluationOutcome` / `tradeEligible`).

### Position-Purpose WP14 application (consumed 2026-07-15 — token preserved verbatim)

```yaml
status: HUMAN_RATIFIED_WP14_APPLICATION_BOUND
consumedAt: 2026-07-15
token: |-
  BIND-POSITION-PURPOSE-AND-EXIT-CONTRACT-V1-TO-HTR-WP14:
  entry-purpose-owner=HTR-WP14
  entry-purpose-immutable=true
  retroactive-purpose-rewrite=PROHIBITED
  strategy-version-reference=REQUIRED
  strategy-version-enforcement=DEFERRED_TO_HTR-WP16
  executable-stop-target-semantics=DEFERRED_TO_HTR-WP17
  inventory-pnl-attribution=DEFERRED_TO_HTR-WP18
  guardian-exit-taxonomy=DEFERRED_TO_HTR-WP20
  outcome-learning=DEFERRED_TO_HTR-WP21
  operator-report=DEFERRED_TO_HTR-WP23
```

Historical ratification `RATIFY-POSITION-PURPOSE-AND-EXIT-CONTRACT-V1` (2026-07-14) preserved; not re-ratified.

### WP14 migration audit verdict (V2)

**`WP14_MIGRATION_NEW_POSTGRES_TABLES_REQUIRED`** — four append-only Postgres tables; SQLite adapter **`NOT_REQUIRED`**.

| Table | Verdict | Reason |
|-------|---------|--------|
| `trader_market_predictions` | REJECT reuse | RI-P4 legacy; mutable `outcome_json`; no run/cycle/symbol lineage |
| `trader_mi_hypothesis` | REJECT reuse | LD-5a versioned registry; not per-cycle |
| `trader_mi_evidence` | REJECT reuse | LD-5a evidence ledger; wrong granularity |
| `trader_mi_confidence_judgment` | REJECT reuse | Human ordinal confidence; not LD-7 Decision |
| `trader_intelligence_cycle_envelope` | CONSUME FK only | WP13 owner |
| `trader_intelligence_hypothesis_record` | CONSUME FK only | WP13 owner |
| `trader_intelligence_conviction_record` | CONSUME FK only | WP13 owner |

**Cardinality:** Forecast `0..N` per org/run/cycle/symbol · Decision exactly `1` per org/run/cycle/symbol · Decision–Forecast links `0..N` · Entry-Purpose `0` for NO_TRADE, exactly `1` for TRADE/REDUCED_RISK.

**Exact migrations (Postgres-only; append-only; service-role RLS; no SQL created this session):**

```yaml
migrationFiles:
  - db/migrations_postgres/0082_trader_intelligence_forecast_record.sql
  - db/migrations_postgres/0083_trader_intelligence_forecast_record_rls.sql
  - db/migrations_postgres/0084_trader_intelligence_decision_record.sql
  - db/migrations_postgres/0085_trader_intelligence_decision_record_rls.sql
  - db/migrations_postgres/0086_trader_intelligence_decision_forecast_link.sql
  - db/migrations_postgres/0087_trader_intelligence_decision_forecast_link_rls.sql
  - db/migrations_postgres/0088_trader_intelligence_entry_purpose_record.sql
  - db/migrations_postgres/0089_trader_intelligence_entry_purpose_record_rls.sql
tables:
  trader_intelligence_forecast_record:
    columns: [id uuid PK, organization_id uuid NOT NULL, cycle_envelope_id uuid NOT NULL, hypothesis_record_id uuid NOT NULL, conviction_record_id uuid NOT NULL, run_id text NOT NULL, cycle_id text NOT NULL, symbol text NOT NULL, forecast_key_digest text NOT NULL, evaluated_at timestamptz NOT NULL, issued_at timestamptz NOT NULL, evidence_cutoff_at timestamptz NOT NULL, target_window_start_at timestamptz NOT NULL, target_window_end_at timestamptz NOT NULL, market_question text NOT NULL, invalidation_conditions_json text NOT NULL, scenario_set_json text NOT NULL, forecast_confidence_json text NOT NULL, historical_profile_id text NOT NULL, historical_profile_digest text NOT NULL, matrix_digest text NOT NULL, evidence_digest text NOT NULL, authoritative_link_digest text NOT NULL, forecast_model_version text NOT NULL, content_digest text NOT NULL, schema_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()]
    unique: [(id, organization_id), (organization_id, run_id, cycle_id, symbol, forecast_key_digest)]
    forecastKeyDigestInputs: [organization_id, run_id, cycle_id, symbol, hypothesis_record_id, target_window_start_at, target_window_end_at, market_question, forecast_model_version]
    checks: [evidence_cutoff_at <= issued_at, issued_at <= target_window_start_at, target_window_start_at < target_window_end_at, digest fields lowercase 64-char hex]
    fk: [(cycle_envelope_id, organization_id) -> trader_intelligence_cycle_envelope, (hypothesis_record_id, organization_id) -> trader_intelligence_hypothesis_record, (conviction_record_id, organization_id) -> trader_intelligence_conviction_record]
    appendOnly: true
  trader_intelligence_decision_record:
    columns: [id uuid PK, organization_id uuid NOT NULL, cycle_envelope_id uuid NOT NULL, conviction_record_id uuid NOT NULL, run_id text NOT NULL, cycle_id text NOT NULL, symbol text NOT NULL, evaluated_at timestamptz NOT NULL, issued_at timestamptz NOT NULL, decision_class text NOT NULL, universal_terminal_reason_code text NOT NULL, why_not_cash_json text NULL, why_cash_or_abstain_json text NULL, gross_expected_reward text NULL, expected_fees text NULL, expected_slippage text NULL, expected_other_costs text NULL, expected_reward_after_costs text NULL, cost_model_id text NULL, cost_model_version text NULL, cost_evidence_state text NOT NULL, cde_msv_permission_snapshot_json text NOT NULL, reason_codes_json text NOT NULL, strategy_id text NULL, strategy_version text NULL, content_digest text NOT NULL, schema_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()]
    unique: [(id, organization_id), (organization_id, run_id, cycle_id, symbol)]
    enums: { decision_class: [TRADE, REDUCED_RISK, NO_TRADE], cost_evidence_state: [AVAILABLE, UNAVAILABLE, NOT_APPLICABLE] }
    checks: TRADE/REDUCED_RISK require why_not_cash + cost AVAILABLE + net-economics + strategy_id/version; NO_TRADE requires why_cash_or_abstain; cost UNAVAILABLE forces NO_TRADE with COST_EVIDENCE_UNAVAILABLE
    note: no forecast_record_ids_json — Forecast links live only in trader_intelligence_decision_forecast_link
    appendOnly: true
  trader_intelligence_decision_forecast_link:
    columns: [id uuid PK, organization_id uuid NOT NULL, decision_record_id uuid NOT NULL, forecast_record_id uuid NOT NULL, link_role text NOT NULL, ordinal integer NOT NULL, content_digest text NOT NULL, schema_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()]
    unique: [(id, organization_id), (organization_id, decision_record_id, forecast_record_id), (organization_id, decision_record_id, ordinal)]
    linkRoles: [PRIMARY, SUPPORTING]
    invariants: [ordinal >= 0, at most one PRIMARY per Decision, linked Forecasts share org/run/cycle/symbol with Decision, TRADE/REDUCED_RISK require at least one link, NO_TRADE may have zero links]
    fk: [(decision_record_id, organization_id) -> trader_intelligence_decision_record, (forecast_record_id, organization_id) -> trader_intelligence_forecast_record]
    appendOnly: true
  trader_intelligence_entry_purpose_record:
    columns: [id uuid PK, organization_id uuid NOT NULL, decision_record_id uuid NOT NULL, primary_forecast_record_id uuid NOT NULL, hypothesis_record_id uuid NOT NULL, run_id text NOT NULL, cycle_id text NOT NULL, symbol text NOT NULL, original_thesis_json text NOT NULL, expected_path text NOT NULL, forecast_horizon text NOT NULL, entry_reason text NOT NULL, entry_condition_json text NOT NULL, invalidation_condition_json text NOT NULL, initial_stop_model_json text NOT NULL, target_model_json text NOT NULL, optional_partial_targets_json text NULL, maximum_holding_until timestamptz NOT NULL, why_not_cash_json text NOT NULL, risk_amount_json text NOT NULL, expected_reward_after_costs text NOT NULL, evidence_digest text NOT NULL, strategy_id text NOT NULL, strategy_version text NOT NULL, content_digest text NOT NULL, schema_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()]
    unique: [(id, organization_id), (organization_id, decision_record_id), (organization_id, run_id, cycle_id, symbol)]
    invariants: [exists only for TRADE/REDUCED_RISK, primary Forecast linked PRIMARY on same Decision, maximum_holding_until > Decision issued_at, purpose immutable after publication]
    fk: [(decision_record_id, organization_id) -> trader_intelligence_decision_record, (primary_forecast_record_id, organization_id) -> trader_intelligence_forecast_record, (hypothesis_record_id, organization_id) -> trader_intelligence_hypothesis_record]
    appendOnly: true
atomicBundle: HTR_WP14_ATOMIC_FORECAST_DECISION_LINK_ENTRY_PURPOSE_BUNDLE_V1
insertOrder: Forecast records sorted by forecast_key_digest code-point order, then one Decision, then links sorted by ordinal then forecast_record_id, then optional Entry-Purpose
idempotency: SAVEPOINT rollback, reload, compare deterministic id + org + business key + schema_version + content_digest; ON CONFLICT DO NOTHING prohibited
wp13CrossBundle: separate transaction boundaries; WP13 committed + WP14 failed = HTR_WP14_DECISION_CHAIN_INCOMPLETE; fail-closed resumable via assertForecastDecisionChainComplete
```

### WP15 migration audit verdict

**`WP15_MIGRATION_NONE_READ_MODEL_ONLY`**

Deterministic read model over WP13 + WP14 tables + `trader_knowledge_edges` + legacy `trader_market_predictions` (observation-only) + `trader_market_events`. Future WP21 outcomes via injected `OutcomeResolutionReadPort` only — no nonexistent WP21 table reference. Semantic clock: explicit `asOf` only (no `now()`, `Date.now()`, host clock).

### HTR-WP14 exact implementation packet

```yaml
objective: Persist LD-6 Forecast (0..N) + LD-7 Decision (1) + relational Decision–Forecast links + entry-purpose with WP13 lineage, CDE/MSV disambiguation, net-economics fail-closed, WP13/WP14 cross-bundle completeness, byte-identical replay idempotency
runtimeCallGraph: |
  runBacktest(historicalProfile) -> runEvaluationCycle -> buildIntelligenceCycleBundle -> persistIntelligenceCycleBundle (WP13 atomic bundle)
  -> buildForecastRecords -> buildDecisionRecord -> buildDecisionForecastLinks -> buildEntryPurposeRecord (TRADE/REDUCED_RISK only)
  -> persistForecastDecisionBundle (single Postgres transaction per HTR_WP14_ATOMIC_FORECAST_DECISION_LINK_ENTRY_PURPOSE_BUNDLE_V1)
  -> assertForecastDecisionChainComplete
ownedGaps:
  HTR-GAP-007: { owner: HTR-WP14, expectedAfterPhaseB: CLOSED_IF_ALL_ACCEPTANCE_PASSES }
  HTR-GAP-008: { owner: HTR-WP14, expectedAfterPhaseB: CLOSED_IF_ALL_ACCEPTANCE_PASSES }
  HTR-GAP-011: { owner: HTR-WP14, expectedAfterPhaseB: CLOSED_IF_ALL_ACCEPTANCE_PASSES }
  HTR-GAP-036: { primaryContribution: HTR-WP14, closureOwner: HTR-WP21, expectedAfterMacroF: OPEN_CONTRIBUTION_DELIVERED }
dependencies: [HTR-WP13 COMPLETE, D-4 CONSUMED, POSITION_PURPOSE_WP14_BOUND]
CREATE_FILES:
  - lib/trader/intelligence/forecast-decision/forecast-decision.types.ts
  - lib/trader/intelligence/forecast-decision/serialize-forecast-decision.ts
  - lib/trader/intelligence/forecast-decision/derive-forecast-decision-ids.ts
  - lib/trader/intelligence/forecast-decision/build-forecast-records.ts
  - lib/trader/intelligence/forecast-decision/build-decision-record.ts
  - lib/trader/intelligence/forecast-decision/build-decision-forecast-links.ts
  - lib/trader/intelligence/forecast-decision/build-entry-purpose-record.ts
  - lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters.ts
  - lib/trader/intelligence/forecast-decision/forecast-record-repository-postgres.ts
  - lib/trader/intelligence/forecast-decision/decision-record-repository-postgres.ts
  - lib/trader/intelligence/forecast-decision/decision-forecast-link-repository-postgres.ts
  - lib/trader/intelligence/forecast-decision/entry-purpose-record-repository-postgres.ts
  - lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres.ts
  - lib/trader/intelligence/forecast-decision/forecast-decision-completeness.ts
  - lib/trader/intelligence/forecast-decision/forecast-decision-service.ts
  - lib/trader/intelligence/forecast-decision/errors.ts
  - lib/trader/intelligence/forecast-decision/index.ts
  - lib/trader/intelligence/forecast-decision/wp14-forecast-decision-evidence-harness.ts
  - scripts/trader/replay-wp14-forecast-decision-evidence.ts
  - db/migrations_postgres/0082_trader_intelligence_forecast_record.sql
  - db/migrations_postgres/0083_trader_intelligence_forecast_record_rls.sql
  - db/migrations_postgres/0084_trader_intelligence_decision_record.sql
  - db/migrations_postgres/0085_trader_intelligence_decision_record_rls.sql
  - db/migrations_postgres/0086_trader_intelligence_decision_forecast_link.sql
  - db/migrations_postgres/0087_trader_intelligence_decision_forecast_link_rls.sql
  - db/migrations_postgres/0088_trader_intelligence_entry_purpose_record.sql
  - db/migrations_postgres/0089_trader_intelligence_entry_purpose_record_rls.sql
MODIFY_FILES:
  - lib/trader/intelligence/evaluation-cycle.ts
  - lib/trader/intelligence/decision-chain.ts
  - lib/trader/intelligence/types.ts
  - lib/trader/backtest/backtest-runner.ts
  - lib/trader/intelligence/index.ts
  - db/schema.postgres.ts
  - db/migrations_postgres/meta/_journal.json
  - package.json
READ_ONLY_REUSE:
  - lib/trader/intelligence/htr-semantic-canonical-json.ts
  - lib/trader/intelligence/records/postgres-idempotent-insert.ts
  - lib/trader/intelligence/records/intelligence-records.types.ts
  - lib/trader/intelligence/records/repository-adapters.ts
FROZEN_DO_NOT_MODIFY:
  - lib/trader/intelligence/records/postgres-idempotent-insert.ts
  - lib/trader/intelligence/records/wp13-intelligence-evidence-harness.ts
  - lib/trader/intelligence/records/hypothesis-record-repository-postgres.ts
  - lib/trader/intelligence/records/cycle-envelope-repository-postgres.ts
  - lib/trader/intelligence/records/conviction-record-repository-postgres.ts
  - lib/trader/intelligence/records/index.ts
  - lib/trader/intelligence/records/intelligence-records-service.ts
  - lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres.ts
  - lib/trader/intelligence/records/repository-adapters.ts
  - lib/trader/intelligence/records/serialize-intelligence-records.ts
  - lib/trader/intelligence/records/intelligence-records.types.ts
  - lib/trader/intelligence/records/errors.ts
  - lib/trader/research/wp10-determinism-evidence-harness.ts
  - lib/trader/market-data/canvas/market-canvas.ts
  - lib/trader/market-data/canvas/incremental-mtf.ts
  - lib/trader/market-data/canvas/canvas-state-check-harness.ts
  - lib/trader/market-data/canvas/canvas-reconstruction-parity-harness.ts
  - lib/trader/market-data/canvas/incremental-reconstruction.ts
  - lib/trader/market-data/canvas/market-canvas-serialization.ts
  - lib/trader/market-data/canvas/index.ts
  - lib/trader/market-data/canvas/market-canvas.types.ts
  - lib/trader/market-data/canvas/canvas-mtf-parity-harness.ts
  - lib/trader/market-data/replay/replay-pit-selector.ts
  - lib/trader/market-data/replay/sidecar-content-digest.ts
  - lib/trader/market-data/replay/provider-sidecar-types.ts
  - lib/trader/market-data/replay/pit-context-evidence-harness.ts
  - lib/trader/market-data/replay/historical-ingress-gateway.ts
  - lib/trader/market-data/replay/replay-lane-normalizer.ts
  - db/migrations_postgres/0026_trader_mi_hypothesis.sql through db/migrations_postgres/0081_trader_intelligence_conviction_record_rls.sql
symbols:
  FORECAST_RECORD_SCHEMA_VERSION: waia.trader.intelligence_forecast_record.v1
  DECISION_RECORD_SCHEMA_VERSION: waia.trader.intelligence_decision_record.v1
  DECISION_FORECAST_LINK_SCHEMA_VERSION: waia.trader.intelligence_decision_forecast_link.v1
  ENTRY_PURPOSE_RECORD_SCHEMA_VERSION: waia.trader.intelligence_entry_purpose_record.v1
  DecisionClass: TRADE | REDUCED_RISK | NO_TRADE
  CostEvidenceState: AVAILABLE | UNAVAILABLE | NOT_APPLICABLE
  DecisionForecastLinkRole: PRIMARY | SUPPORTING
  buildForecastRecords: fn
  buildDecisionRecord: fn
  buildDecisionForecastLinks: fn
  buildEntryPurposeRecord: fn
  persistForecastDecisionBundle: fn
  assertForecastDecisionChainComplete: fn
  deriveForecastRecordId: fn
  deriveDecisionRecordId: fn
  deriveDecisionForecastLinkId: fn
  deriveEntryPurposeRecordId: fn
  deriveForecastKeyDigest: fn
  ForecastDecisionIdempotencyConflictError: class code HTR_WP14_IDEMPOTENCY_CONFLICT
  HtrWp14DecisionChainIncompleteError: class code HTR_WP14_DECISION_CHAIN_INCOMPLETE
tests:
  unit:
    - tests/unit/trader-wp14-forecast-cardinality.test.ts
    - tests/unit/trader-wp14-forecast-seal.test.ts
    - tests/unit/trader-wp14-decision-record.test.ts
    - tests/unit/trader-wp14-decision-forecast-links.test.ts
    - tests/unit/trader-wp14-no-trade.test.ts
    - tests/unit/trader-wp14-why-not-cash.test.ts
    - tests/unit/trader-wp14-cost-evidence-fail-closed.test.ts
    - tests/unit/trader-wp14-cde-msv-disambiguation.test.ts
    - tests/unit/trader-wp14-entry-purpose.test.ts
    - tests/unit/trader-wp14-forecast-decision-digest.test.ts
    - tests/unit/trader-wp14-idempotency-fail-closed.test.ts
    - tests/unit/trader-wp14-atomic-bundle.test.ts
    - tests/unit/trader-wp14-chain-completeness.test.ts
    - tests/unit/trader-wp14-lineage.test.ts
  postgresMandatory:
    - tests/integration/postgres-trader-forecast-decision-parity.test.ts
    - tests/integration/postgres-trader-forecast-decision-idempotency.test.ts
    - tests/integration/postgres-trader-forecast-decision-completeness.test.ts
evidenceCommand: pnpm trader:wp14:evidence
evidencePath: replay-runs/RI-P7/htr-wp14-forecast-decision/
workCommitMessage: "DEE-415 feat(trader): add forecast and decision records (HTR-WP14)"
phaseATerminalState: AWAITING_INDEPENDENT_MACRO_POST_REVIEW
stopConditions: [WP14_TOUCHES_FROZEN_SUBSTRATE, WP14_WP13_SCOPE_REGRESSION, HTR_WP14_IDEMPOTENCY_CONFLICT, HTR_WP14_DECISION_CHAIN_INCOMPLETE, WP14_COST_FABRICATION, WP14_CDE_PERSISTED_AS_DECISION, WP14_LOOKAHEAD, WP14_POSTGRES_BASELINE_REGRESSION]
```

### HTR-WP15 exact implementation packet

```yaml
objective: Deterministic MKB read model with tenant-scoped resolved-outcome view, knowledge eligibility/aging, pattern-discovery query seam, injected optional OutcomeResolutionReadPort — no capital authority
runtimeCallGraph: |
  queryMkbReadModel(context, query, asOf, outcomePort?) -> MkbReadModelSource + mkb-read-model-postgres adapters
ownedGaps:
  HTR-GAP-010: { primaryContribution: HTR-WP15, closureOwner: HTR-WP21, expectedAfterMacroF: OPEN_CONTRIBUTION_DELIVERED }
WP15_PHASE_A_DEPENDENCIES:
  - HTR-WP13_COMPLETE
  - HTR-WP14_PHASE_A_WORK_COMMIT_EXISTS
  - HTR-WP14_TARGETED_VALIDATION_PASS
  - HTR-WP14_MANDATORY_POSTGRES_ZERO_SKIP
  - HTR-WP14_EVIDENCE_PASS
  - HTR-WP14_SCOPE_AUDIT_PASS
  - HTR-WP14_TRACKED_TREE_CLEAN
  - NO_WP14_STOP_CONDITION
outcomePortContract:
  interface: OutcomeResolutionReadPort
  productionWp21OutcomeAdapter: ABSENT
  defaultOutcomeRows: EMPTY
  unresolvedForecastClassification: UNRESOLVED
  legacyPredictionClassification: OBSERVATION_ONLY_OR_INELIGIBLE
  semanticClock: explicit asOf only
CREATE_FILES:
  - lib/trader/knowledge/mkb-read-model.types.ts
  - lib/trader/knowledge/mkb-knowledge-state.ts
  - lib/trader/knowledge/mkb-read-model-source.ts
  - lib/trader/knowledge/mkb-read-model-postgres.ts
  - lib/trader/knowledge/mkb-read-model-queries.ts
  - lib/trader/knowledge/mkb-read-model.ts
  - lib/trader/knowledge/mkb-read-model-evidence-harness.ts
  - scripts/trader/replay-wp15-mkb-read-model-evidence.ts
MODIFY_FILES:
  - lib/trader/knowledge/market-memory.ts
  - lib/trader/knowledge/index.ts
  - package.json
FROZEN_DURING_WP15:
  - lib/trader/intelligence/forecast-decision/forecast-decision.types.ts
  - lib/trader/intelligence/forecast-decision/serialize-forecast-decision.ts
  - lib/trader/intelligence/forecast-decision/derive-forecast-decision-ids.ts
  - lib/trader/intelligence/forecast-decision/build-forecast-records.ts
  - lib/trader/intelligence/forecast-decision/build-decision-record.ts
  - lib/trader/intelligence/forecast-decision/build-decision-forecast-links.ts
  - lib/trader/intelligence/forecast-decision/build-entry-purpose-record.ts
  - lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters.ts
  - lib/trader/intelligence/forecast-decision/forecast-record-repository-postgres.ts
  - lib/trader/intelligence/forecast-decision/decision-record-repository-postgres.ts
  - lib/trader/intelligence/forecast-decision/decision-forecast-link-repository-postgres.ts
  - lib/trader/intelligence/forecast-decision/entry-purpose-record-repository-postgres.ts
  - lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres.ts
  - lib/trader/intelligence/forecast-decision/forecast-decision-completeness.ts
  - lib/trader/intelligence/forecast-decision/forecast-decision-service.ts
  - lib/trader/intelligence/forecast-decision/errors.ts
  - lib/trader/intelligence/forecast-decision/index.ts
  - lib/trader/intelligence/forecast-decision/wp14-forecast-decision-evidence-harness.ts
  - scripts/trader/replay-wp14-forecast-decision-evidence.ts
  - db/migrations_postgres/0082_trader_intelligence_forecast_record.sql
  - db/migrations_postgres/0083_trader_intelligence_forecast_record_rls.sql
  - db/migrations_postgres/0084_trader_intelligence_decision_record.sql
  - db/migrations_postgres/0085_trader_intelligence_decision_record_rls.sql
  - db/migrations_postgres/0086_trader_intelligence_decision_forecast_link.sql
  - db/migrations_postgres/0087_trader_intelligence_decision_forecast_link_rls.sql
  - db/migrations_postgres/0088_trader_intelligence_entry_purpose_record.sql
  - db/migrations_postgres/0089_trader_intelligence_entry_purpose_record_rls.sql
symbols:
  MKB_KNOWLEDGE_STATES: [OBSERVATION_ONLY, UNRESOLVED, RESOLVED_CORRECT, RESOLVED_INCORRECT, INSUFFICIENT_EVIDENCE, STALE, INELIGIBLE]
  MkbReadModelSource: interface
  OutcomeResolutionReadPort: interface
  queryMkbReadModel: fn
  queryForecastDecisionLineage: fn
  queryPatternDiscoveryCandidates: fn
  queryNoTradeObservations: fn
  queryHypothesisFamiliesByRegime: fn
  assertNoCapitalAuthority: fn
tests:
  unit:
    - tests/unit/trader-wp15-mkb-read-model.test.ts
    - tests/unit/trader-wp15-knowledge-state.test.ts
    - tests/unit/trader-wp15-lineage-queries.test.ts
    - tests/unit/trader-wp15-tenant-boundary.test.ts
    - tests/unit/trader-wp15-no-unresolved-as-knowledge.test.ts
    - tests/unit/trader-wp15-deterministic-as-of.test.ts
    - tests/unit/trader-wp15-optional-outcome-port.test.ts
    - tests/unit/trader-wp15-incomplete-chain-ineligible.test.ts
    - tests/unit/trader-wp15-no-hardcoded-strategy-universe.test.ts
  postgresMandatory:
    - tests/integration/postgres-trader-mkb-read-model-parity.test.ts
evidenceCommand: pnpm trader:wp15:evidence
evidencePath: replay-runs/RI-P7/htr-wp15-mkb-read-model/
workCommitMessage: "DEE-415 feat(trader): add deterministic market-knowledge read model (HTR-WP15)"
phaseATerminalState: AWAITING_INDEPENDENT_MACRO_POST_REVIEW
stopConditions: [WP15_MUTATES_SOURCE_OF_TRUTH, WP15_CAPITAL_AUTHORITY, WP15_STRATEGY_PROMOTION, WP15_BLIND_HOLDOUT_ACCESS, WP15_HARDCODED_STRATEGY_UNIVERSE, WP15_POSTGRES_BASELINE_REGRESSION, WP15_MODIFIES_WP14_FILES]
migrationDecision: NONE_READ_MODEL_ONLY
```

### Macro F internal advance contract

Macro F may advance WP14 to WP15 inside one Build session only when WP14 WORK commit exists, WP14 targeted tests pass, WP14 mandatory Postgres suites execute with zero skip, WP14 evidence passes, WP14 scope audit passes, tracked tree clean, and no STOP fired. WP15 receives a separate WORK commit. Phase-A creates WORK commits only; CLOSEOUT commits occur in separate independent Phase-B sessions per WP. No advance to WP16.

### Consumed Human tokens (2026-07-15 activation)

```text
CONFIRM-HTR-WP14-MIGRATION-V2:
verdict=WP14_MIGRATION_NEW_POSTGRES_TABLES_REQUIRED
tables=trader_intelligence_forecast_record,trader_intelligence_decision_record,trader_intelligence_decision_forecast_link,trader_intelligence_entry_purpose_record
migration-files=0082..0089
forecast-cardinality=ZERO_TO_MANY_PER_ORG_RUN_CYCLE_SYMBOL
decision-cardinality=EXACTLY_ONE_PER_ORG_RUN_CYCLE_SYMBOL
decision-forecast-link=RELATIONAL_APPEND_ONLY
entry-purpose=ZERO_FOR_NO_TRADE_EXACTLY_ONE_FOR_TRADE_OR_REDUCED_RISK
atomic-bundle=HTR_WP14_ATOMIC_FORECAST_DECISION_LINK_ENTRY_PURPOSE_BUNDLE_V1
wp13-cross-bundle-completeness=FAIL_CLOSED_RESUMABLE
idempotency=SAVEPOINT_LOAD_AND_COMPARE_DETERMINISTIC_ID_BUSINESS_KEY_SCHEMA_VERSION_CONTENT_DIGEST
sqlite-adapter=NOT_REQUIRED

CONFIRM-HTR-WP15-MIGRATION:
verdict=WP15_MIGRATION_NONE_READ_MODEL_ONLY
future-outcomes=INJECTED_OPTIONAL_OUTCOME_RESOLUTION_READ_PORT
nonexistent-wp21-table-reference=PROHIBITED
legacy-predictions=OBSERVATION_ONLY_OR_INELIGIBLE
semantic-clock=EXPLICIT_AS_OF_ONLY

APPROVE-HTR-MACRO-F:
wp14=forecast+decision+decision-forecast-link+entry-purpose+complete-chain-fail-closed
wp15=deterministic-mkb-read-model+optional-outcome-port+pattern-discovery-query-seam
strategy-discovery-foundation=PRESERVED
strategy-universe-hardcoding=PROHIBITED
strategy-self-promotion=PROHIBITED
capital-authority=HUMAN_ONLY

APPROVE-HTR-MACRO-F-BUILD:
activation-parent=c250726328d3d2241d21d8939db74d069abec6cb
work-packages=HTR-WP14,HTR-WP15
internal-advance=HTR-WP14_TO_HTR-WP15_ONLY
phase-a-work-commit-each-wp=true
phase-a-closeout-commit=false
phase-b-separate-independent-session=true
phase-b-closeout-commit-each-wp=true
phase-b-default-reviewer=COMPOSER_2_5_INDEPENDENT_SESSION
build-wp16=false
final-pr=false
fhv=false
holdout=false
paper=false
live=false
capital=false
```

## Position purpose + exit contract v1 (`RATIFY-POSITION-PURPOSE-AND-EXIT-CONTRACT-V1`, 2026-07-14)

```text
POSITION_PURPOSE_AND_EXIT_CONTRACT_V1:
HUMAN_RATIFIED_WP14_APPLICATION_BOUND   # HISTORICAL ratification RATIFY-POSITION-PURPOSE-AND-EXIT-CONTRACT-V1 (2026-07-14); BIND consumed 2026-07-15
```

`POSITION_PURPOSE_AND_EXIT_CONTRACT_V1` is a Human-ratified future planning + acceptance requirement. It **adds, splits, merges, removes and reorders no work package** and authorizes **no** implementation of the later-WP requirements now.

**No order intent may eventually exist without:** `hypothesisId`, `originalThesis`, `expectedPath`, `forecastHorizon`, `entryReason`, `entryCondition`, `invalidationCondition`, `initialStopModel`, `targetModel`, `optionalPartialTargets`, `maximumHoldingTime`, `whyNotCash`, `riskAmount`, `expectedRewardAfterCosts`, `decisionId`, `forecastId`, `evidenceDigest`.

**Position management must preserve:** original thesis; current thesis state; expected path versus actual path; remaining reward/risk; time expiry; invalidation; target fulfilment; partial exits; breakeven/trailing rules; account and portfolio risk state.

**Hard invariants.**

```text
no purposeless position
no order without an exit plan
stop may not widen risk
profitable position may close when thesis fails
losing position may remain only while thesis and risk remain valid
time expiry is part of the hypothesis
closed trade must reconcile to fills, costs, PnL and hypothesis outcome
AI recommends; Human controls strategy promotion and capital authority
```

**Ownership mapping (existing WPs only; no new WP):**

```yaml
HTR-WP14: hypothesis/forecast/Decision/whyNotCash and entry-purpose records
HTR-WP16: strategy eligibility and position-purpose gating
HTR-WP17: executable stop/target/partial-fill/partial-exit simulation
HTR-WP18: lot-level inventory and PnL attribution
HTR-WP20: Guardian action vocabulary, invalidation and exit-reason taxonomy
HTR-WP21: thesis/outcome resolution and learning
HTR-WP22: end-to-end deterministic qualification
HTR-WP23: final trace and report schema
```

## Capital semantics + LIVE_MINIMUM_CAPITAL_DECISION (future, non-blocking)

The FHV initial portfolio **`100000 USDT`** is the **initial portfolio of the approved FHV Run Contract v0 only**. It is **NOT** a minimum customer deposit, a minimum future live balance, an onboarding threshold, or a universal per-strategy capital minimum.

```yaml
LIVE_MINIMUM_CAPITAL_DECISION:
  status: HUMAN_DECISION_REQUIRED_AFTER_COST_RISK_CAPACITY_EVIDENCE
  futureInputs: [HTX-minimum-notional, fee-and-spread-burden, expected-slippage, risk-per-trade,
                 diversification-requirements, drawdown-reserve, position-size-granularity,
                 operating-and-reconciliation-safety-margin]
  blocks: []                 # does NOT block HTR-MACRO-D; no numeric minimum assigned in this pass
```

## AI and Human authority (canonical, restated)

`AI = research, analysis, hypothesis, scoring and recommendation` · `Human = promotion, capital, permissions, risk limits and final authorization`. Hard invariants (no current Macro-D implementation scope added): AI is **recommend-only**; AI cannot promote a strategy to capital; cannot alter risk limits; cannot authorize a new account; cannot increase capital; cannot bypass CDE, Decision, Risk or Guardian; cannot treat trading frequency as success. A justified **`NO_TRADE` is a valid successful result**; positive PnL **without evidence does not prove knowledge**; the Human/operator retains final stop and promotion authority.

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
| HTR-WP11 | PIT provider context + gateway enforcement + absent-lane | WP01,WP09 | backend | COMPLETE (Opus Macro-D Phase B PASS 2026-07-14; WORK `f6cefb0`; single sanctioned `buildHistoricalIngressContext` + sidecar-v3 PIT selection, all 15 optional lanes explicit incl. UNAVAILABLE/SIDECAR_LANE_ABSENT, no live provider/network call, replay/live parity; accepted evidence `replay-runs/RI-P7/htr-wp11-pit-provider-context/` manifest digest `b8f043ac…`; post-WORK non-semantic corrections (assertNoFutureEvidence reorder, quoteForReplayCycle fixture-timestamp binding, evidence gitSha restamp) classified, no fabricated availability, no future evidence reachable; HTR-GAP-012/013 CLOSED) | `f6cefb0` (WORK) |
| HTR-WP12 | Ingress bar-integrity gate + versioned dataset manifest | WP01 | backend | COMPLETE (Opus Macro-D Phase B PASS 2026-07-14; WORK `993fdab`; nine fail-closed integrity classes gate HistoricalBarReplaySource/HistoricalBarSource/loadQualificationBars before first Canvas advance; immutable `fhv-dataset-manifest/v1` HTX_ONLY SPOT BTCUSDT+ETHUSDT 1m→closed-bar 15m/1h/4h/1d, UTC half-open partitions, source checksums, normalized+bar-set digests, `FHV_GAP_POLICY_V1` zero-tolerance, self-digest exclusion; semantic digest `fd7d4895…` (= evidence-bundle manifest digest); blind holdout RESERVED_SEALED_NOT_ACCESSED; no WP09 invalidation; real HTX 2020–2025 dataset NOT acquired/qualified — final pinning HTR-WP23; HTR-GAP-014/015 CLOSED) | `993fdab` (WORK) |
| HTR-WP13 | Intelligence-chain activation (historical run profile) | WP09,WP10,WP11,WP12 | ai | COMPLETE (Composer Phase-B PASS_WITH_BOUNDED_FIXES) | `d07bb654` (WORK) + `2d63eca` (CLOSEOUT) |
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

## WP-13 (next work package — planning gate)

**HTR-MACRO-C is COMPLETE** (2026-07-14, Opus Macro-C Phase-B per-WP PASS). HTR-WP09 (Canvas runtime integration + default incremental cutover): WORK `46820ac` + CLOSEOUT `3a0962f`; D-11B PASS under Memory Gate Amendment v1, qualification bound to `7c532f5` (Human Amendment-v1 exception), accepted evidence promoted to `replay-runs/RI-P7/htr-wp09-canvas-runtime-qualification/` (digest `78560485…`). HTR-WP10 (no-lookahead + determinism property suites): WORK `befa6c1` + validation correction `2987f37` (test-only) + CLOSEOUT `1ac0e6a`; evidence `replay-runs/RI-P7/htr-wp10-determinism-nolookahead/` (digest `fa5def37…`); no WP09 measurement-critical surface changed. HTR-GAP-001/002/003 CLOSED at WP09; HTR-GAP-004/025/031 CLOSED at WP10. Full repository validation green (`validate:canon` + lint + typecheck + 2520 tests + build).

**HTR-MACRO-D is COMPLETE** (2026-07-14, Opus Macro-D Phase-B independent post-review, per-WP PASS). HTR-WP11 (PIT provider context + gateway enforcement + absent-lane): WORK `f6cefb0` + CLOSEOUT `c63453d`; single sanctioned `buildHistoricalIngressContext`, sidecar-v3 PIT selection, all 15 optional lanes explicit incl. UNAVAILABLE/`SIDECAR_LANE_ABSENT`, no live provider/network call, replay/live parity; accepted evidence `replay-runs/RI-P7/htr-wp11-pit-provider-context/` (manifest digest `b8f043ac…`, reproduced); post-WORK changes classified WP11_POST_WORK_NON_SEMANTIC_CORRECTION (no fabricated availability, no future evidence reachable). HTR-WP12 (ingress bar-integrity gate + immutable versioned FHV dataset manifest): WORK `993fdab` + CLOSEOUT (this commit); nine fail-closed integrity classes gate every historical loader before first Canvas advance; `fhv-dataset-manifest/v1` (HTX_ONLY SPOT BTCUSDT+ETHUSDT, 1m base + closed-bar 15m/1h/4h/1d, UTC half-open partitions, `FHV_GAP_POLICY_V1` zero-tolerance) semantic digest `fd7d4895…`; blind holdout `RESERVED_SEALED_NOT_ACCESSED`. HTR-GAP-012/013 CLOSED at WP11; HTR-GAP-014/015 CLOSED at WP12. Gap-closure semantics: the fail-closed gate + versioned manifest contract now exist; the real HTX 2020–2025 dataset has **not** been acquired or qualified; the full FHV remains unauthorized; HTR-WP23 owns final runbook/manifest pinning + real-run preflight.

The **WP04–WP12 rolling runtime/data-truth tranche is COMPLETE**. **HTR-MACRO-E is COMPLETE** (2026-07-15). HTR-WP13 WORK `d07bb654` preserved; CLOSEOUT `2d63eca`. **HTR-MACRO-F BUILD AUTHORIZED** (`BUILD_AUTHORIZED: YES`, scope WP14+WP15 only); `composerTerminalState: READY_FOR_COMPOSER_HTR_MACRO_F_PHASE_A`; WP14 migration V2 (4 tables, 0082..0089); WP15 read-model-only. Next action: `COMPOSER_EXECUTE_HTR_MACRO_F_PHASE_A`. **HISTORICAL (CONSUMED/SUPERSEDED):** v1 WP14 0082..0087 proposal, Macro E Build authorization, `APPROVE_HTR_MACRO_F_MIGRATIONS_AND_BUILD` gate.

## Acceptance (whole program)

`READY_FOR_FULL_HISTORICAL_TEST` is met when all gate groups CG-A..CG-H pass (measurable, evidence-backed), all 23 work packages are COMPLETE with local commits on the shared branch, the final Opus whole-program audit passes, the full validation matrix is green, the readiness package exists, and the Human Architect certifies (`CERTIFY-HTR-READY`, D-12). Per-work-package acceptance is defined in each child plan; the whole-program acceptance is conjunctive across all 23.

## Validation

Per work package: `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` (+ `pnpm validate:canon` when canonical docs change; + CI `postgres-integration` when Postgres parity in scope) + Opus post-review where required. Full matrix + governance preflight (`./scripts/linear/preflight-pr-governance.sh`) run once before the single final PR. No campaign/M9/walk-forward/holdout/paper/live/Supabase/Cloudflare/Execution-Server command.

## STOP conditions

Approval-token mismatch; activation beyond research-only; Founders-reserved action required; verified canonical contradiction; missing standard; scope expansion beyond the active work package; any attempt to open a PR before WP23 + final audit; any attempt to create additional Linear issues, additional branches, or intermediate merges; validation failure unfixable within the active work package. On STOP: set `state.blockedReason`, report to Human; never push/merge.
