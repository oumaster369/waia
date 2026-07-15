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
  humanApproval: MACRO_E_PACKET_HUMAN_APPROVED_PENDING_FINAL_DIGEST_BINDING   # substantive Macro-E decisions consumed 2026-07-15; final code-point profile/matrix digests prepared; Human binding pending before Build
  childPlanStatus: CONFIRM_REQUIRED   # substantive Macro-E architecture approved; final code-point digests NOT yet Human-bound; Build NOT authorized
  programStatus: APPROVED_IDLE   # WP04–WP12 COMPLETE; final code-point digest binding required before Build; next gate APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD
  governanceStateAuthority: GIT_HEAD
  governanceReconciledFromHead: a935ecb1394c679e99b9ef387804d134a606a10e   # prior reconciliation at a935ecb; this code-point digest authority commit advances HEAD by one (44 ahead)
  latestValidatedProductionCodeSha: 993fdaba0ffd5f66837bea1c7272507183efa973
  planningTerminalState: FINAL_CODEPOINT_DIGEST_RECONCILIATION_COMPLETE
  activeWorkPackage: HTR-WP13
  macroCMigrationDecision: NONE
  macroDMigrationDecision: NONE
  macroCCodeBaselineHead: a8a709ff53f74649b5c5f39e0ba8e00af1e113de
  macroDCodeBaselineHead: 1ac0e6a8a7318be5b068dcb833f1a00ed32440a9
  macroDPreapprovalHead: 6d102f05d76fba2efd99b363799dde18a0668a71
  composerTerminalState: FINAL_CODEPOINT_DIGEST_RECONCILIATION_COMPLETE
  branch: dee-415-ai-trader-historical-test-readiness
  branchCreated: true
  buildStarted: true
  currentWorkPackage: HTR-WP13
  activeChildPlan: .cursor/plans/dee-415-htr-wp13-wp16-intelligence-rolling.plan.md   # WP13–WP16 intelligence rolling controller (ACTIVE_MACRO_E_APPROVED_PENDING_FINAL_DIGEST_BINDING); WP04–WP12 runtime-substrate controller retired
  intelligenceTranche:
    controller: .cursor/plans/dee-415-htr-wp13-wp16-intelligence-rolling.plan.md
    status: APPROVED_PENDING_FINAL_DIGEST_BINDING
    macroPackages: { HTR-MACRO-E: [HTR-WP13], HTR-MACRO-F: [HTR-WP14, HTR-WP15], HTR-MACRO-G: [HTR-WP16] }
    preferredOrderAfterWp13: [HTR-MACRO-F, HTR-MACRO-G]
    activeMacroStatus: CONFIRM_REQUIRED   # substantive architecture approved 2026-07-15; final code-point digest binding pending Human approval before Build
    d1: RESOLVED_RECORD_LEVEL_CHAIN
    d2: HUMAN_APPROVED   # APPROVE-HTR-D2 consumed 2026-07-15 (HTX_ONLY SPOT BTCUSDT+ETHUSDT; base 1m + derived 15m/1h/4h/1d; LSR+MR enabled; trend_momentum_v0 EVIDENCE_ONLY_NOT_TRADE_ELIGIBLE); enablement is NOT SVG approval / NOT an edge verdict; version-pin+lifecycle owned by WP16
    d3: SUBSTANTIVE_CONTRACT_HUMAN_APPROVED_FINAL_DIGEST_BINDING_REQUIRED   # CLARIFY-HTR-D3 consumed 2026-07-15; final code-point canonical digest 92219746… awaits Human binding
    d4: HUMAN_DECISION_REQUIRED_BEFORE_HTR_WP14
    d20: HUMAN_DECISION_REQUIRED_BEFORE_HTR_WP16
    htrHistoricalIntelligenceProfileV1: SUBSTANTIVE_CONTRACT_HUMAN_APPROVED_FINAL_DIGEST_BINDING_REQUIRED
    profileDigestCanonical: 9221974607d3a8a569c380b4699495600277449055f76391c4fa5377a6088abe   # HTR_SEMANTIC_CANONICAL_JSON_V1 code-point digest; matrix bound; NOT yet Human-bound
    profileDigestInsertionOrder: 0d156d38a9e615f0488e7c11d5de730b54a7f6270d3d0921ceea074f738b839f
    profileDigestRawFileSha256: 72ed9b17d773e1be2bc55f659c1d0ec39e9e0c8a3e5dc0f7c02795103db2cc8a
    profileDigestSupersededLocaleCompare: a9666258e046e934b2156e0dc3ad5da02eb9b7e69d994e3505a3af5b62cd8bf0   # REJECTED_CANONICALIZATION (localeCompare)
    profileDigestSupersededApproved: 9a1ed67e39c2a5e23bb83459f4f1fb52b10c88a49ebbf773b5285c90b82f706c   # SUPERSEDED_BY_SEMANTIC_GOVERNANCE_FIELD_REMOVAL
    profileDigestSupersededDraft: fac1a44f06642748c7f42bfe10790cd2e0a341fa730af1a7a83ffeec43adbec2
    profileGovernanceFieldsRemoved: [status, strategyConsumerPolicy.status, decisionBasis, strategyConsumerPolicy.ownedBy]
    profileSubstantiveRuntimeSemanticsChanged: false
    historicalEvidenceCapability: PRICE_ONLY_GROUNDED_EVIDENCE_PROFILE
    timeframeEvidenceLaneAuthorityMatrixV1: SUBSTANTIVE_CONTRACT_HUMAN_APPROVED_FINAL_DIGEST_BINDING_REQUIRED
    matrixDigestCanonical: 6296c54e35aeb311739f3ab1c30a0c452637c5abf7f2464f0b0cd906a6ef04a6   # HTR_SEMANTIC_CANONICAL_JSON_V1 code-point digest; NOT yet Human-bound
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
    macroEReadiness: READY_FOR_HUMAN_FINAL_DIGEST_BINDING_AND_BUILD_AUTHORIZATION   # substantive Macro-E decisions consumed; final code-point digests prepared; Human binding + Build authorization remain separate gates; BUILD_AUTHORIZED NO
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
    buildAuthorized: NO
  workCommitSha: null   # per-WP WORK SHAs recorded in wpNNWorkCommitSha fields (Macro D: WP11 f6cefb0, WP12 993fdab); no separate macro-level WORK commit
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
  activeMacroPackage: HTR-MACRO-E   # 2026-07-14: WP13–WP16 intelligence tranche planned; HTR-MACRO-D COMPLETE
  activeMacroWorkPackages: [HTR-WP13]
  activeMacroStatus: CONFIRM_REQUIRED   # substantive architecture approved; profile/matrix digest rebind pending Human binding before Build
  buildAuthorized: NO   # Macro-D Build authorization CONSUMED at Phase A and now COMPLETE; no new Build authorized; WP13 Build separately gated on Human authorization + D-1/D-2/D-3 + Timeframe×Evidence-Lane matrix + exact WP13 child plan
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
  remainingWorkPackages:
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
  lastValidatedGitSha: 993fdaba0ffd5f66837bea1c7272507183efa973   # Macro-D Phase-A code baseline validated green (validate:canon+lint+typecheck+tests+build); WP11/WP12 CLOSEOUT commits are docs-only on top of this validated code
  baselineTestCountAtHead:   # 2026-07-14: full `pnpm test --run` at HEAD fd2f9ca (WP12 CLOSEOUT; docs-only atop 993fdab) to reconcile the reported-count divergence
    gitSha: fd2f9cad76e409cca8a372319b0e8c572e0b9222
    command: "pnpm test --run"
    testFilesPassed: 432
    testFilesSkipped: 26
    testCasesPassed: 2570
    testCasesSkipped: 92
    testCasesFailed: 0
    exitCode: 0
    reconciliation: "Composer Macro-D report '2570 passed' is EXACT; the earlier canonical prose '2568 tests' was a documentation undercount (report typo), not a test removal/skip/weakening. Macro-C prose '2520 tests' is that macro's historical baseline. No test removed, skipped or weakened to reconcile."
  lastValidationAt: 2026-07-14
  latestValidatedBaseline: HTR-MACRO-D_PHASE_B_CLOSEOUT
  finalAuditStatus: not-started
  blockedReason: null
  timeframeEvidenceLaneAuthorityMatrixV1: SUBSTANTIVE_CONTRACT_HUMAN_APPROVED_FINAL_DIGEST_BINDING_REQUIRED   # final code-point digest 6296c54e… awaits Human binding
  positionPurposeAndExitContractV1: REQUIRED_BEFORE_HTR_WP14_BUILD   # RATIFY-POSITION-PURPOSE-AND-EXIT-CONTRACT-V1 (2026-07-14, §"Position purpose + exit contract v1"); no order intent without hypothesis/exit plan; adds/splits/merges/removes/reorders no WP
  nextHumanGate: APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD
  nextAction: "HUMAN_BIND_FINAL_CODEPOINT_DIGESTS_AND_AUTHORIZE_MACRO_E_BUILD (Human gate APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD). Substantive Macro-E decisions consumed 2026-07-15. Final code-point profile digest 9221974607d3a8a569c380b4699495600277449055f76391c4fa5377a6088abe (raw 72ed9b17…); final matrix digest 6296c54e35aeb311739f3ab1c30a0c452637c5abf7f2464f0b0cd906a6ef04a6 (raw 4aed27c0…). Canonicalizer HTR_SEMANTIC_CANONICAL_JSON_V1 (code-point comparator; localeCompare PROHIBITED). Prior localeCompare digests a9666258…/231712e… REJECTED_CANONICALIZATION. Six substantive decisions remain consumed; final digests NOT yet Human-bound. Build NOT authorized. No WP13 code/SQL/PR."
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
| Plan state | `state.status: in-progress` (HTR-WP01 COMPLETE — WORK COMMIT `6600708`; HTR-WP02 COMPLETE — WORK COMMIT `7ec02dd`, HTR-GAP-030/034 closed; HTR-WP03 COMPLETE — WORK COMMIT `35283ed`, HTR-GAP-024 baseline recorded (OPEN, closure HTR-WP22); HTR-WP04 COMPLETE — WORK COMMIT `b3abe7b`, Opus post-review PASS, validation PASS, streaming-evidence baseline recorded, HTR-GAP-005/026 remain OPEN, closure HTR-WP22; **HTR-WP05 COMPLETE** — WORK COMMIT `f90faa9`, Opus Phase-B post-review PASS, semantic parity digest equality proven (`30e9b40…`), HTR-GAP-027/029 remain OPEN, closure HTR-WP22, MIGRATION_DECISION NONE; **HTR-MACRO-A COMPLETE**; **HTR-MACRO-B COMPLETE** — HTR-WP06 (`24eb7f9`), HTR-WP07 (`10f2500`), HTR-WP08 (`0c4b8c3`), Opus Phase-B per-WP PASS, full validation green, evidence CANVAS_STATE_OK/CANVAS_MTF_PARITY_OK/RECONSTRUCTION_ORACLE_PARITY_OK (22/22 exact, 0 divergence, FULL_HISTORY_RESCANS 0, linear work), HTR-GAP-001/002/003 OPEN closure HTR-WP09, HTR-GAP-004 OPEN closure HTR-WP10, no runtime cutover, MIGRATION_DECISION NONE; **HTR-MACRO-C COMPLETE (2026-07-14, Opus Phase-B per-WP PASS): HTR-WP09 WORK `46820ac` + CLOSEOUT `3a0962f` (D-11B PASS under Memory Gate Amendment v1, bound to `7c532f5`; accepted evidence promoted), HTR-WP10 WORK `befa6c1` + validation correction `2987f37` + CLOSEOUT `1ac0e6a`; HTR-GAP-001/002/003/004/025/031 CLOSED; **HTR-MACRO-D (WP11–12) COMPLETE (2026-07-14, Opus Macro-D Phase-B per-WP PASS): HTR-WP11 WORK `f6cefb0` + CLOSEOUT `c63453d`, HTR-WP12 WORK `993fdab` + CLOSEOUT (this commit); HTR-GAP-012/013/014/015 CLOSED; `MACRO_D_MIGRATION_DECISION NONE`; WP04–WP12 rolling runtime/data-truth tranche COMPLETE; program `APPROVED_IDLE` at the WP13 planning gate — no WP13 build/child-plan/PR; real HTX 2020–2025 dataset not acquired/qualified (WP23 owns final pinning)**) |

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

> **Macro-E readiness is `READY_FOR_HUMAN_FINAL_DIGEST_BINDING_AND_BUILD_AUTHORIZATION`** — substantive Macro-E architecture was Human-approved 2026-07-15. Final code-point profile canonical digest `92219746…` and matrix canonical digest `6296c54e…` (canonicalizer `HTR_SEMANTIC_CANONICAL_JSON_V1`; `localeCompare` PROHIBITED) await Human binding (`APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD`). Build NOT authorized.

### Safe execution topology (execution-only macro grouping)

```yaml
HTR-MACRO-E: { workPackages: [HTR-WP13] }
HTR-MACRO-F: { workPackages: [HTR-WP14, HTR-WP15] }
HTR-MACRO-G: { workPackages: [HTR-WP16] }
```

Changes **execution topology only** — adds/removes no WP, merges no technical ownership, changes no dependency/gap ownership/per-WP WORK+CLOSEOUT requirement, permits no auto-advance between macros, authorizes no Build. **Macro E is WP13 alone** because WP13 is a foundational T2 High intelligence-chain activation that owns historical-profile activation, matrix enforcement, and the runtime shape consumed by WP14, and must independently earn WORK + Opus PASS + CLOSEOUT before Macro F Build (WP14/WP15 packets refresh from the WP13 CLOSEOUT HEAD). **Macro F groups WP14+WP15** as one sequential epistemic-consumer chain (Forecast + Decision + whyNotCash → MKB read-model), executable only after WP13 COMPLETE + D-4 + `POSITION_PURPOSE_AND_EXIT_CONTRACT_V1` + both packets refreshed + both Human-approved, with a separate WORK+Opus verdict+CLOSEOUT per WP. **Macro G keeps WP16 separate** because strategy eligibility/lifecycle gating, trial accounting and `riskMultiplier` have a different semantic owner, are gated by D-2 **and** D-20, and feed WP22 rather than the WP14→WP15→WP21 critical chain. Preferred order after WP13 closeout: **Macro F, then Macro G**. Neither future macro is authorized now.

### Decision reconciliation

- **D-1 — ALREADY_RESOLVED.** `APPROVE-HTR-D1: record-level-chain` (recorded above). WP13 activates only the **record-level** chain and creates **no mature autonomous engines**.
- **D-3 — SUBSTANTIVE_CONTRACT_HUMAN_APPROVED; FINAL_DIGEST_BINDING_REQUIRED.** `CLARIFY-HTR-D3-HISTORICAL-PROFILE` consumed 2026-07-15. Runtime semantic contract approved; governance-only fields removed from staging JSON. Final code-point canonical digest `9221974607d3a8a569c380b4699495600277449055f76391c4fa5377a6088abe` awaits Human binding (`APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD`). Prior localeCompare digest `a9666258…` is **REJECTED_CANONICALIZATION**.
- **D-2 — HUMAN_APPROVED (consumed 2026-07-15).** HTX_ONLY SPOT; BTCUSDT+ETHUSDT; base 1m + derived 15m/1h/4h/1d; enabled historical consumers `liquidity_sweep_reversal_v0`+`mean_reversion_v0`; research-only `trend_momentum_v0` = `EVIDENCE_ONLY_NOT_TRADE_ELIGIBLE`; enablement is **not** SVG approval and **not** an edge verdict; version-pin+lifecycle owned by WP16. WP13 owns enablement set + matrix + terminal-reason + records.

```text
APPROVE-HTR-D2: venue=HTX market=SPOT symbols=BTCUSDT,ETHUSDT base=1m derived=15m,1h,4h,1d enabled-historical-consumers=liquidity_sweep_reversal_v0,mean_reversion_v0 research-only=trend_momentum_v0 research-only-semantics=EVIDENCE_ONLY_NOT_TRADE_ELIGIBLE strategy-promotion=PROHIBITED edge-verdict=NOT_CLAIMED version-rule=PIN_EXACT_REGISTERED_VERSION_AT_WP16 portfolio=SHARED_MULTI_INSTRUMENT wp13-owns=consumer-set+matrix+terminal-reason+records wp16-owns=version-pin+lifecycle-gating+trial+riskMultiplier
```

### `HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1` (SUBSTANTIVE_CONTRACT_HUMAN_APPROVED · FINAL_DIGEST_BINDING_REQUIRED)

Explicit, versioned historical run profile (staging: `.cursor/plans/dee-415-htr-wp13-wp16-staging/htr-historical-intelligence-profile-v1.json`) that activates the record-level MI-core chain **only** through an explicit seam (`runBacktest historicalProfile → runEvaluationCycle`), **never** as a global default. Contains **no governance/planning status fields**. Pins venueScope `HTX_ONLY`, marketType `SPOT`, symbols `[BTCUSDT, ETHUSDT]`, baseInterval `1m`, derivedIntervals `[15m,1h,4h,1d]` (`CLOSED_BARS_ONLY`); enabled intelligence stages; `strategyConsumerPolicy` with enabled LSR+MR and research-only TM (`EVIDENCE_ONLY_NOT_TRADE_ELIGIBLE`); `historicalEvidenceCapability: PRICE_ONLY_GROUNDED_EVIDENCE_PROFILE`; matrix digest pin in `providerEvidenceLanePolicy.matrixDigestCanonical`. **Final code-point canonical digest:** `9221974607d3a8a569c380b4699495600277449055f76391c4fa5377a6088abe` (insertion-order `0d156d38…`; raw-file `72ed9b17…`). Canonicalizer: `HTR_SEMANTIC_CANONICAL_JSON_V1` (`localeCompare` PROHIBITED). **Substantive runtime semantics unchanged.**

### `TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1` (SUBSTANTIVE_CONTRACT_HUMAN_APPROVED · FINAL_DIGEST_BINDING_REQUIRED)

Exact machine-readable matrix (staging: `.cursor/plans/dee-415-htr-wp13-wp16-staging/timeframe-evidence-lane-authority-matrix-v1.json`) over **16 lanes** (1 HTX spot 1m price + 15 UNAVAILABLE sidecar lanes). Contains **no governance status fields**. **Final code-point canonical digest:** `6296c54e35aeb311739f3ab1c30a0c452637c5abf7f2464f0b0cd906a6ef04a6` (insertion-order `2e558f18…`; raw-file `4aed27c0…`). Canonicalizer: `HTR_SEMANTIC_CANONICAL_JSON_V1`. FHV scope: `PRICE_ONLY_GROUNDED_EVIDENCE`; `MULTI_SOURCE_HISTORICAL_VALIDATION: NOT_PERFORMED`.

### HTR-WP13 migration decision

```yaml
MIGRATION_DECISION: CONFIRMED_WITH_ATOMIC_FAIL_CLOSED_IDEMPOTENCY   # CONFIRM-HTR-MACRO-E-MIGRATION consumed 2026-07-15
ACTIVE_MACRO_STATUS: CONFIRM_REQUIRED   # substantive architecture approved; profile/matrix digest rebind pending
BUILD_AUTHORIZED: NO
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

### Architecture-only WP14 / WP15 / WP16

`ARCHITECTURE_ONLY`, `REFRESH_REQUIRED_AFTER_WP13_CLOSEOUT`, `BUILD_AUTHORIZED NO`. **WP14** (Macro F): Forecast + Decision + whyNotCash + CDE/LD-7 disambiguation + net economics + entry-purpose ownership (gaps 007/008/011/036; gates WP13 COMPLETE, D-4, `POSITION_PURPOSE_AND_EXIT_CONTRACT_V1`, migration). **WP15** (Macro F): MKB read-model integration, global spine tenant-read-only, tenant-scoped outcomes, eligibility via sanctioned contract (gap 010; gate WP14 COMPLETE; grouped with WP14 only after both refreshed from WP13 CLOSEOUT HEAD). **WP16** (Macro G): strategy-version pinning, lifecycle eligibility (`STRAT_TM_STRATEGY_NOT_ALLOWED`), trial accounting, `riskMultiplier`, position-purpose gating, pinned D-20 drawdown policy (gaps 020/021; gates WP13 COMPLETE, D-2, D-20, migration).

### Human Macro-E decisions (CONSUMED 2026-07-15)

WP10 evidence-hermeticity is **RESOLVED_FINAL_PHASE_B_PASS** (closeout `b132166`). The six exact Macro-E
tokens below were **CONSUMED 2026-07-15** (`APPROVE_FINAL_D2_D3_MATRIX_MIGRATION_STRATEGY_FOUNDATION_AND_MACRO_E_PACKET`),
after applying the mandatory persistence amendment (atomic cycle bundle + fail-closed idempotency; `AGGREGATE`
removed from schema v1). Build authorization remains a **separate later** gate and is **NOT** consumed:

1. `APPROVE-HTR-D2: venue=HTX market=SPOT symbols=BTCUSDT,ETHUSDT base=1m derived=15m,1h,4h,1d enabled-historical-consumers=liquidity_sweep_reversal_v0,mean_reversion_v0 research-only=trend_momentum_v0 research-only-semantics=EVIDENCE_ONLY_NOT_TRADE_ELIGIBLE strategy-promotion=PROHIBITED edge-verdict=NOT_CLAIMED version-rule=PIN_EXACT_REGISTERED_VERSION_AT_WP16 portfolio=SHARED_MULTI_INSTRUMENT wp13-owns=consumer-set+matrix+terminal-reason+records wp16-owns=version-pin+lifecycle-gating+trial+riskMultiplier`
2. `CLARIFY-HTR-D3-HISTORICAL-PROFILE: profile-id=HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 profile-digest=9a1ed67e… (SUPERSEDED — corrected digest a9666258… awaits rebind) supersedes-draft-digest=fac1a44f… historical-evidence-capability=PRICE_ONLY_GROUNDED_EVIDENCE_PROFILE global-default=PROHIBITED historical-only=YES`
3. `APPROVE-TIMEFRAME-EVIDENCE-LANE-AUTHORITY-MATRIX-V1: matrix-digest=c9186814… (SUPERSEDED — corrected digest 231712e… awaits rebind) fhv-scope-limitation=PRICE_ONLY_GROUNDED_EVIDENCE multi-source-historical-validation=NOT_PERFORMED`
4. `CONFIRM-HTR-MACRO-E-MIGRATION: tables=trader_intelligence_cycle_envelope,trader_intelligence_hypothesis_record,trader_intelligence_conviction_record posture=POSTGRES_ONLY+APPEND_ONLY+SERVICE_ROLE_RLS+ORG_SCOPED sqlite-adapter=NOT_REQUIRED bundle-write=SINGLE_ATOMIC_POSTGRES_TRANSACTION partial-cycle-bundle=PROHIBITED conflict-policy=VERIFY_DETERMINISTIC_ID_AND_CONTENT_DIGEST same-key-same-content=IDEMPOTENT_REPLAY_ACCEPTED same-key-different-content=HTR_WP13_IDEMPOTENCY_CONFLICT silent-on-conflict-do-nothing=PROHIBITED hypothesis-idempotency=UNIQUE(org,run,cycle,symbol,hypothesis_type) conviction-cardinality=MODEL_B_ONE_CYCLE_LEVEL_ACTIVE_CONVICTION conviction-idempotency=UNIQUE(org,run,cycle,symbol) conviction-scope=ACTIVE_HYPOTHESIS|NONE aggregate-scope=DEFERRED_NOT_IN_SCHEMA_V1 active-hypothesis-link=NULLABLE_COMPOSITE_FK_WITH_SCOPE_CONSTRAINT cycle-envelope-idempotency=UNIQUE(org,run,cycle,symbol) numeric=CANONICAL_DECIMAL_STRING backfill=NONE rollback=DROP_REVERSE_ORDER migration-files=0076..0081 deferred-to-wp14=forecast,decision,whyNotCash`
5. `RATIFY-STRATEGY-DISCOVERY-TO-OPERATOR-PROPOSAL-CONTRACT-V1: implemented-in-dee415=false mature-autonomous-engine-authorized=false foundation-preservation-required=true machine-self-promotion=PROHIBITED machine-capital-authority=PROHIBITED future-program-required=true` (additive foundation obligation; adds no WP and no current Build scope)
6. `APPROVE-HTR-INTELLIGENCE-MACRO-E: wp13-historical-intelligence-chain`

(full forms in controller §10). **All six substantive tokens were consumed 2026-07-15.** Corrected profile/matrix digests prepared 2026-07-15 but **NOT yet Human-bound** — narrow rebind gate `APPROVE_CORRECTED_HTR_PROFILE_DIGEST_AND_MACRO_E_BUILD`. Build approval remains a **separate later** token — explicitly **not** issued here.

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

## Position purpose + exit contract v1 (`RATIFY-POSITION-PURPOSE-AND-EXIT-CONTRACT-V1`, 2026-07-14)

```text
POSITION_PURPOSE_AND_EXIT_CONTRACT_V1:
REQUIRED_BEFORE_HTR_WP14_BUILD
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

## WP-13 (next work package — planning gate)

**HTR-MACRO-C is COMPLETE** (2026-07-14, Opus Macro-C Phase-B per-WP PASS). HTR-WP09 (Canvas runtime integration + default incremental cutover): WORK `46820ac` + CLOSEOUT `3a0962f`; D-11B PASS under Memory Gate Amendment v1, qualification bound to `7c532f5` (Human Amendment-v1 exception), accepted evidence promoted to `replay-runs/RI-P7/htr-wp09-canvas-runtime-qualification/` (digest `78560485…`). HTR-WP10 (no-lookahead + determinism property suites): WORK `befa6c1` + validation correction `2987f37` (test-only) + CLOSEOUT `1ac0e6a`; evidence `replay-runs/RI-P7/htr-wp10-determinism-nolookahead/` (digest `fa5def37…`); no WP09 measurement-critical surface changed. HTR-GAP-001/002/003 CLOSED at WP09; HTR-GAP-004/025/031 CLOSED at WP10. Full repository validation green (`validate:canon` + lint + typecheck + 2520 tests + build).

**HTR-MACRO-D is COMPLETE** (2026-07-14, Opus Macro-D Phase-B independent post-review, per-WP PASS). HTR-WP11 (PIT provider context + gateway enforcement + absent-lane): WORK `f6cefb0` + CLOSEOUT `c63453d`; single sanctioned `buildHistoricalIngressContext`, sidecar-v3 PIT selection, all 15 optional lanes explicit incl. UNAVAILABLE/`SIDECAR_LANE_ABSENT`, no live provider/network call, replay/live parity; accepted evidence `replay-runs/RI-P7/htr-wp11-pit-provider-context/` (manifest digest `b8f043ac…`, reproduced); post-WORK changes classified WP11_POST_WORK_NON_SEMANTIC_CORRECTION (no fabricated availability, no future evidence reachable). HTR-WP12 (ingress bar-integrity gate + immutable versioned FHV dataset manifest): WORK `993fdab` + CLOSEOUT (this commit); nine fail-closed integrity classes gate every historical loader before first Canvas advance; `fhv-dataset-manifest/v1` (HTX_ONLY SPOT BTCUSDT+ETHUSDT, 1m base + closed-bar 15m/1h/4h/1d, UTC half-open partitions, `FHV_GAP_POLICY_V1` zero-tolerance) semantic digest `fd7d4895…`; blind holdout `RESERVED_SEALED_NOT_ACCESSED`. HTR-GAP-012/013 CLOSED at WP11; HTR-GAP-014/015 CLOSED at WP12. Gap-closure semantics: the fail-closed gate + versioned manifest contract now exist; the real HTX 2020–2025 dataset has **not** been acquired or qualified; the full FHV remains unauthorized; HTR-WP23 owns final runbook/manifest pinning + real-run preflight.

The **WP04–WP12 rolling runtime/data-truth tranche is COMPLETE** and the **WP13–WP16 intelligence tranche is `APPROVED_PENDING_FINAL_DIGEST_BINDING`** (substantive Macro-E packet Human-approved 2026-07-15; final code-point digests prepared — see §"WP13–WP16 intelligence tranche"). The program is `APPROVED_IDLE` at the **`APPROVE_FINAL_CODEPOINT_PROFILE_MATRIX_DIGESTS_AND_MACRO_E_BUILD`** Human gate. Topology: **HTR-MACRO-E [WP13]** (exact packet, substantive contract approved; final digest binding required) / **HTR-MACRO-F [WP14,WP15]** (architecture-only) / **HTR-MACRO-G [WP16]** (architecture-only). D-3 profile digest `92219746…`; matrix digest `6296c54e…`; canonicalizer `HTR_SEMANTIC_CANONICAL_JSON_V1` (`localeCompare` PROHIBITED). WP13 `MIGRATION_DECISION` **`CONFIRMED_WITH_ATOMIC_FAIL_CLOSED_IDEMPOTENCY`**; conviction cardinality Model B `MODEL_B_ONE_CYCLE_LEVEL_ACTIVE_CONVICTION`; `conviction_scope` ∈ {`ACTIVE_HYPOTHESIS`,`NONE`}; `AGGREGATE` = `DEFERRED_NOT_IN_SCHEMA_V1`. **`MACRO_E_READINESS: READY_FOR_HUMAN_FINAL_DIGEST_BINDING_AND_BUILD_AUTHORIZATION`** — final digests prepared but NOT yet Human-bound; Build NOT authorized. No WP13 code, no SQL and no PR.

## Acceptance (whole program)

`READY_FOR_FULL_HISTORICAL_TEST` is met when all gate groups CG-A..CG-H pass (measurable, evidence-backed), all 23 work packages are COMPLETE with local commits on the shared branch, the final Opus whole-program audit passes, the full validation matrix is green, the readiness package exists, and the Human Architect certifies (`CERTIFY-HTR-READY`, D-12). Per-work-package acceptance is defined in each child plan; the whole-program acceptance is conjunctive across all 23.

## Validation

Per work package: `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` (+ `pnpm validate:canon` when canonical docs change; + CI `postgres-integration` when Postgres parity in scope) + Opus post-review where required. Full matrix + governance preflight (`./scripts/linear/preflight-pr-governance.sh`) run once before the single final PR. No campaign/M9/walk-forward/holdout/paper/live/Supabase/Cloudflare/Execution-Server command.

## STOP conditions

Approval-token mismatch; activation beyond research-only; Founders-reserved action required; verified canonical contradiction; missing standard; scope expansion beyond the active work package; any attempt to open a PR before WP23 + final audit; any attempt to create additional Linear issues, additional branches, or intermediate merges; validation failure unfixable within the active work package. On STOP: set `state.blockedReason`, report to Human; never push/merge.
