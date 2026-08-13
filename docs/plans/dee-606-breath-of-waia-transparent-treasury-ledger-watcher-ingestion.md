---
integrationIssue: DEE-606
integrationTitle: "Breath of WAIA — transparent treasury ledger, watcher ingestion and evidence model"
branch: dee-606-breath-of-waia-transparent-treasury-ledger-watcher-ingestion
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, build, unit-targeted, postgres-isolation-r5-safe]
approvalGates:
  - plan-approved
  - architect-review
  - human-architecture-approval
  - integration-ready
  - human-merge
includedIssues: []
deferredIssues: [DEE-607, DEE-611, DEE-612, DEE-613]
blockedByActiveWork: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: approved
  currentWorkPackage: null
  completedWorkPackages: [WP-0, WP-1, WP-2, WP-3, WP-4, WP-5, WP-6, WP-7, WP-8, WP-9]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 4a0eeb1d439f696f9d9805060fed6cefc0a308fc
  lastValidationAt: "2026-08-13"
  blockedReason: null
  nextAction: "Open the single DEE-606 PR to main (this WP), then Human squash-merge only. Do not merge from the agent. Production R2 provisioning remains NOT AUTHORIZED. Watcher remains DARK."
  wp5:
    status: COMPLETE
    blockedBy: PRODUCTION_R2_PROVISIONING_NOT_AUTHORIZED
    hd3Architecture: APPROVED_ARCHITECTURE_ONLY
    productionR2Provisioning: NOT_AUTHORIZED
    hd3Token: CONFIRM-DEE-606-HD3-R2-ARCHITECTURE-ONLY-NO-PRODUCTION-PROVISIONING
    approvalRecordingSha: bf42267ae41cf50758010585ef6b96bb0ed85df5
    startingSha: 6fcbe1faece1b3812ce9d9e03b22ef3f99fe5d79
    implementationShas:
      - c4cfcb05bb109fb8e8452bb03f425355d075eef0
      - ec318601068d9a6b3d143d4da6c609245907ad4c
    testSha: 233db89040481ac9cd4d2ba29eb060918f4748ca
    storagePort: lib/waia-core/treasury/evidence/types.ts#TreasuryEvidenceStorage
    r2Adapter: lib/waia-core/treasury/evidence/r2-adapter.ts#createR2TreasuryEvidenceStorage
    intendedBindingName: TREASURY_EVIDENCE_R2
    productionBindingProvisioned: false
    wranglerJsoncChanged: false
    productionCloudflareMutated: false
    deploymentPerformed: false
    bucketCreated: false
    bucketPublic: false
    presignedUrls: false
    directBrowserR2: false
  wp6:
    status: COMPLETE
    startingSha: 2ec87b739e3f3949d52def1ea68a9a35f0ccefcf
    implementationShas:
      - a719d2624d1958bc65bf60d550c8e97d3cbea66b
      - 8086c749f0763122766bc2254a36e871a39c7ba9
    testSha: 01fa23cea4596dba45707d74b30bb78c76f7f429
    moduleLayout: lib/waia-core/treasury/breath/**
    dedicatedNonPaginatedRepository: true
    listTransactionsQueryForbiddenAsFinancialTruth: true
    completeVerifiedSet: true
    moneyAuthority: canonical decimal string bigint
    noJsNumberMoney: true
    publicHttpRouteAdded: false
    uiChanged: false
    wp7ShareEngineImplemented: false
    r2Dependency: false
    productionR2Provisioning: NOT_AUTHORIZED
    wranglerJsoncChanged: false
    watcherDark: true
    schemaChanged: false
    migrationsChanged: false
    journalChanged: false
    dbGenerate: false
    productionStateMutated: false
    prOpened: false
    wp7Started: false
    targetedTests: "9 grouped tests covering numbered invariants 1-115"
    wp6TestsPass: true
    wp5Regression: 11/11
    wp4Regression: 27/27
    wp3Regression: 36/36
    wp2Regression: 138/138
    typecheck: PASS
    lint: PASS
    gitDiffCheck: clean
    migrationMergeOrderGate: binding
    wp9FinalMigrationReconciliation: retained
  wp7:
    status: COMPLETE
    startingSha: aa08798c0c7b2d1d627c228eb750b0f91cf0c540
    implementationShas:
      - 6408e8dfbf4e079671d762ac4830bd74ccc9f5c7
      - 05d39d0d3d5fbd9091d6c1018f05ca3442b6c7d0
    testSha: ea4c489416af417446ea0269ae91ba00e2945880
    moduleLayout: lib/waia-core/treasury/share/**
    factsRepository: lib/waia-core/treasury/share/{repository.types,memory-repository,postgres-repository}.ts
    completeUnpaginatedFacts: true
    exactQQualification: true
    trc20NetworkContractProof: true
    usdtNominalPolicyProof: true
    directRefundCorrectionNetting: true
    balanceAdjustmentExcluded: true
    unresolvedReconciliationHandling: exclude-from-Q
    currentOpenAttributionSemantics: true
    unmatchedInDenominator: true
    anonymousInDenominator: true
    unattributedInDenominator: true
    expensesOutflowsCommitmentsNonDilution: true
    exactNumeratorDenominatorBigint: true
    denominatorNonPositiveZeroShare: true
    aggregateOnlyPublicServerContract: true
    authenticatedSelfOnlyServerContract: true
    noContributorIdentityList: true
    consentFlagDoesNotPublishIdentity: true
    noEquityGovernanceSemantics: true
    noPublicHttpRoute: true
    noUi: true
    noBreathFormulaChanges: true
    noR2Dependency: true
    watcherDark: true
    productionR2Provisioning: NOT_AUTHORIZED
    wp7TestFiles:
      - tests/unit/treasury-contribution-share-engine.test.ts
      - tests/unit/treasury-contribution-share-privacy.test.ts
    wp7TestCount: 7
    wp7TestResult: 7/7 PASS
    wp6Regression: 9/9 PASS
    wp5Regression: 11/11 PASS
    wp4Regression: 27/27 PASS
    wp3Regression: 36/36 PASS
    wp2Regression: 140/140 PASS
    wp2ContributionShareCount: 7
    typecheck: PASS
    lint: PASS
    gitDiffCheck: clean
    schemaChanged: false
    migrationsChanged: false
    journalChanged: false
    dbGenerate: false
    productionStateMutated: false
    prOpened: false
    wp8Started: false
    migrationMergeOrderGate: binding
    wp9FinalMigrationReconciliation: retained
    privacyCorrection:
      classification: PUBLIC_AGGREGATE_ATTRIBUTION_TIMESTAMP_AND_READ_LEAKAGE
      startingSha: 5b9fc773e1408a2137cf6c5e7392fe9793590d22
      correctionSha: 3fb6c4ac03f478bc47f6840b4df1238accd1ef97
      status: COMPLETE
      publicAggregateAttributionDependency: false
      publicAggregateAttributionDbRead: false
      publicAggregateLastUpdatedAtInputs:
        - qualifying.verifiedAt
        - qualifying.updatedAt
        - includedVerifiedRefundCorrection.verifiedAt
        - includedVerifiedRefundCorrection.updatedAt
      selfShareAttributionDependency: true
      selfShareAttributionTimingRetained: true
      frozenSection6MathUnchanged: true
      schemaChanged: false
      migrationsChanged: false
      productionUnchanged: true
      wp8Started: false
      wp7TestResult: 9/9 PASS
      wp6Regression: 9/9 PASS
      wp5Regression: 11/11 PASS
      wp4Regression: 27/27 PASS
      wp3Regression: 36/36 PASS
      wp2Regression: 140/140 PASS
  wp8:
    status: COMPLETE
    startingSha: 3728aea04ba70f59ffd0441944c4fb657d282d6e
    testImplementationSha: ca8227fce3b588e6aae48e6d7367922ac20adeae
    boundedCorrectionSha: a91ec2c0e8cb87ffa3896064f2416177b0e0f47b
    validatedSha: a91ec2c0e8cb87ffa3896064f2416177b0e0f47b
    originMainAtWp8: d954bbed4c1a893a1b7120b1c04fa9ca485453ff
    dee518Pr458: OPEN
    dee518HeadAtWp8: 1230c7d7962b560678cea08cd9eae01609c551f4
    dedicatedComposeFile: docker-compose.postgres-treasury-validate.yml
    projectName: waia-postgres-treasury-validate
    containerIdentity: waia-postgres-treasury-validate-postgres-validate-1
    hostPort: 127.0.0.1:54339
    databaseIdentity: waia_treasury_validate
    emptyDbProof: true
    postgresVersion: "16.14"
    branchMigrationCount: 113
    branchMigrationTip: 0150_treasury_chain_observations_lifecycle_guard
    journalTipHash: 94ec107fe156de9efd8a87a9ba6fdab4476ce4b566970c9df9b3d58c5932fd1b
    journalMonotonic: PASS
    liveTreasuryTableCount: 20
    treasuryEnumCount: 18
    rlsTableCount: 20
    rlsPolicyCount: 80
    sameOrgCompositeFkCount: 24
    checkConstraintCount: 20
    treasuryTriggerCount: 6
    anonDeny: PASS
    authenticatedDeny: PASS
    crossOrgDbDenial: PASS
    appLayerIsolation: PASS
    observationLifecycleImmutability: PASS
    revisionAppendOnly: PASS
    financialCheck: PASS
    watcherVerifyPrecondition: PASS
    privateAggregateDetailSeparation: PASS
    breathUnpaginatedGt50: PASS
    bigintExactness: PASS
    resourceIdentity: PASS
    commitmentsBudgetRemaining: PASS
    internalCoalescingIdempotency: PASS
    inceptionDoubleCountPrevention: PASS
    reconciliationFreshnessAsOf: PASS
    contributionShareIsolationUnpaginated: PASS
    publicAggregateAttributionReadIsolation: PASS
    evidenceMetadataIsolation: PASS
    r2Required: false
    watcherDark: true
    wp8TestFiles:
      - tests/integration/treasury-wp8-harness.ts
      - tests/integration/treasury-postgres-isolation.test.ts
      - tests/integration/treasury-postgres-financial-invariants.test.ts
      - tests/integration/treasury-postgres-watcher-inception.test.ts
    wp8TestCount: 16
    wp8TestResult: 16/16 PASS
    wp7Regression: 9/9
    wp6Regression: 9/9
    wp5Regression: 11/11
    wp4Regression: 27/27
    wp3Regression: 36/36
    wp2Regression: 140/140
    typecheck: PASS
    lint: PASS
    gitDiffCheck: clean
    evidencePath: /tmp/dee606-wp8-postgres-isolation-a91ec2c0e8cb87ffa3896064f2416177b0e0f47b.log
    evidenceSha256: 8fa2783b912942d3c82c6419a9ae410411c31b0dfb40234576bffa69956de3df
    schemaChanged: false
    migrationsChanged: false
    journalChanged: false
    dbGenerate: false
    productionStateMutated: false
    port54329Untouched: true
    genericValidationContainerUntouched: true
    dee518Untouched: true
    executionServerUntouched: true
    r2ProductionProvisioning: NOT_AUTHORIZED
    migrationMergeOrderGate: BINDING
    wp9FinalMigrationReconciliation: REQUIRED
    prOpened: false
    wp9Started: false
    boundedDefect:
      classification: runtime type mapping bug
      surface: lib/waia-core/treasury/watcher/postgres-repository.ts#tryAcquireLease
      fix: drizzle timestamp comparison instead of Date interpolation in sql template
      schemaChangeRequired: false
    successMarker: DEE_606_WP8_R5_SAFE_POSTGRES_ISOLATION_PASS_WP8_COMPLETE_READY_FOR_WP9
  wp9:
    status: COMPLETE
    startingBranchSha: 86cead6f7a31363b4d6b15c705fd1d54141b062a
    mergedMainSha: 7c8cf38f118d852d6e766ec23ea92322bedee2d4
    dee518Pr458: MERGED
    dee518PreviousHead: 1230c7d7962b560678cea08cd9eae01609c551f4
    dee518SquashSha: 7c8cf38f118d852d6e766ec23ea92322bedee2d4
    branchSyncMethod: merge
    branchSyncMergeSha: 5f3cd44dab845dbd1805bdba66d9a3f603d6ec6a
    rebase: false
    forcePush: false
    preSyncMainJournalCount: 149
    preSyncMainJournalTip: 0148_trader_forecast_v2_open_tail_null_bounds_v1
    preReconciliationIdentities:
      - 0148_treasury_transparency_ledger_foundation
      - 0149_treasury_transparency_ledger_rls
      - 0150_treasury_chain_observations_lifecycle_guard
    mergedMainPredecessorTip: 0148_trader_forecast_v2_open_tail_null_bounds_v1
    finalIdentities:
      - 0149_treasury_transparency_ledger_foundation
      - 0150_treasury_transparency_ledger_rls
      - 0151_treasury_chain_observations_lifecycle_guard
    sqlSha256Before:
      foundation: 31f3a80e7e3b90db10795147a49e5e3f32bde89bbb96b464380a8dd7b34bbb58
      rls: e5edb01a2b95c6a1a3696974f3d94ae6769333585ee8a4a9d31b196880fdedf0
      observationGuard: 94ec107fe156de9efd8a87a9ba6fdab4476ce4b566970c9df9b3d58c5932fd1b
    sqlSha256After:
      foundation: 31f3a80e7e3b90db10795147a49e5e3f32bde89bbb96b464380a8dd7b34bbb58
      rls: e5edb01a2b95c6a1a3696974f3d94ae6769333585ee8a4a9d31b196880fdedf0
      observationGuard: 94ec107fe156de9efd8a87a9ba6fdab4476ce4b566970c9df9b3d58c5932fd1b
    sqlByteIdentity: PASS
    renameCommitSha: 7e6b152dd228d0b4d7932c8b8549056969ab606c
    journalCommitSha: d83caae99769227222be940684622bdbd1ce623f
    testCommitSha: 4a0eeb1d439f696f9d9805060fed6cefc0a308fc
    validatedSha: 4a0eeb1d439f696f9d9805060fed6cefc0a308fc
    finalJournalCount: 152
    finalJournalTip: 0151_treasury_chain_observations_lifecycle_guard
    journalMonotonic: PASS
    openMigrationBearingPrs: none
    migrationCollision: none
    migrationMergeOrderGate: RESOLVED
    emptyDbPass: true
    postgresVersion: "16.14"
    appliedMigrationCount: 152
    treasuryTables: 20
    treasuryEnums: 18
    rlsTables: 20
    rlsPolicies: 80
    sameOrgFks: 24
    checks: 20
    triggers: 6
    dee518ObjectsPresent: true
    dedicatedComposeFile: docker-compose.postgres-treasury-validate.yml
    projectName: waia-postgres-treasury-validate
    hostPort: 127.0.0.1:54339
    port54329Untouched: true
    genericValidationContainerUntouched: true
    wp8Rerun: 16/16 PASS
    wp7Regression: 9/9
    wp6Regression: 9/9
    wp5Regression: 11/11
    wp4Regression: 27/27
    wp3Regression: 36/36
    wp2Regression: 140/140
    lint: PASS
    typecheck: PASS
    build: PASS
    gitDiffCheck: clean
    evidencePath: /tmp/dee606-wp9-postgres-reconciliation-4a0eeb1d439f696f9d9805060fed6cefc0a308fc.log
    evidenceSha256: 9d9a89a8689708f1096c5156a5d054e7601d189875d97f1221b62f34be781904
    productionR2: NOT_AUTHORIZED
    watcherDark: true
    executionServerUntouched: true
    productionStateMutated: false
    dbGenerate: false
    newSchemaSemantics: false
    prReadiness: PASS
    historicalWp1Wp8EvidencePreserved: true
    successMarkers:
      - DEE_606_WP9_MIGRATION_RECONCILIATION_PASS
      - DEE_606_WP9_LOCAL_PR_READINESS_PASS
  wp4:
    status: COMPLETE
    startingSha: 6f3c8b2bd457706f33afd7466dc54907ee649e75
    implementationShas:
      - f7fcace832be58b012bbfa2f94497b044f4ebec4
      - 095f35a6d2873c597e9e8de60f373e1d1575030c
    testSha: 0e97dd134ceb5fc76e16975492ad3c5ed2a3581a
    coreOwnership: "/api/admin/treasury/** (WAIA Core; not /api/trader/admin/**)"
    genericAdminExtraction: "lib/waia-core/permissions/admin-http.ts with Trader re-exports"
    explicitOrgScope: true
    postgresOnlyFailClosed: true
    sqliteStatus: 503
    sqliteCode: TREASURY_BACKEND_UNAVAILABLE
    moneyRequest: canonical decimal string bigint
    moneyResponse: canonical base-10 string
    noNumberAuthority: true
    permissionMapping:
      read: admin.treasury.read
      mutate: admin.treasury.mutate
      publish: admin.treasury.publish
    adminRoleHasAllThree: true
    userAgentServiceHaveNone: true
    routeTable:
      - "GET/POST /api/admin/treasury/transactions"
      - "GET /api/admin/treasury/transactions/[id]"
      - "POST /api/admin/treasury/transactions/commands"
      - "GET/POST /api/admin/treasury/commitments"
      - "POST /api/admin/treasury/commitments/commands"
      - "GET/POST/PATCH /api/admin/treasury/watched-addresses"
      - "GET/POST/PATCH /api/admin/treasury/budgets"
      - "GET/POST/PATCH /api/admin/treasury/funding-needs"
      - "GET/POST /api/admin/treasury/ideal-budgets"
      - "POST /api/admin/treasury/ideal-budgets/commands"
      - "GET/POST /api/admin/treasury/runway-plans"
      - "POST /api/admin/treasury/runway-plans/commands"
      - "GET/POST /api/admin/treasury/attributions"
      - "GET/POST /api/admin/treasury/evidence"
      - "POST /api/admin/treasury/evidence/links"
      - "GET/POST /api/admin/treasury/inceptions"
      - "GET /api/admin/treasury/reconciliations (PATCH 405)"
      - "GET/PATCH /api/admin/treasury/settings"
      - "GET /api/admin/treasury/breath-preview (503 TREASURY_BREATH_READ_MODEL_NOT_READY)"
    noPublicEndpoint: true
    noUi: true
    watcherDark: true
    noWatcherEnableApi: true
    hd3: DEFERRED
    evidenceStorage: EVIDENCE_STORAGE_NOT_CONFIGURED
    breathPreview: TREASURY_BREATH_READ_MODEL_NOT_READY
    getBreathPublicSnapshotImplemented: false
    noRunwaySnapshots: true
    noEndsAtFormula: true
    noIdealAmountInvention: true
    noBurnInference: true
    contributorIdentityNotPublicByDefault: true
    sharedAuditLogs: true
    wp4TestFiles:
      - tests/unit/treasury-admin-permissions.test.ts
      - tests/unit/treasury-admin-http.test.ts
    wp4TestCount: 27
    wp4TestResult: 27/27 PASS
    wp3Regression: 36/36 PASS
    wp2Regression: 138/138 PASS
    permissionAdminRegression: PASS
    typecheck: PASS
    lint: PASS
    gitDiffCheck: clean
    schemaMigrationChanges: false
    dbGenerate: false
    productionStateMutated: false
    prOpened: false
    mergeOrderGate: BLOCK_MIGRATION_BEARING_MERGE_WHILE_DEE_518_JOURNAL_UNMERGED
    finalMigrationReconciliation: WP9_REQUIRED
  wp3:
    status: COMPLETE
    blocked: false
    implementationStarted: true
    watcherDark: true
    startingSha: afc0b9b270ed104173d84741b7bdcdfdc969f142
    implementationShas:
      - 7f0315c4ec7345cad8fd38496521238e9456b9db
      - 3ba3d9597ecb632776eb8b36c7594b750d8c2ff5
    testSha: e611808b6844675756c695c1b0c59c006604c9fb
    moduleLayout: lib/waia-core/treasury/watcher/**
    envNames:
      - TREASURY_WATCHER_ENABLED
      - TREASURY_WATCHER_CONFIRMATIONS_REQUIRED
      - TREASURY_WATCHER_RESCAN_WINDOW
      - TREASURY_WATCHER_MAX_BLOCKS_PER_CYCLE
      - TREASURY_WATCHER_LEASE_TTL_SECONDS
      - TREASURY_WATCHER_STALE_THRESHOLD_SECONDS
      - TREASURY_WATCHER_RPC_MAX_RETRIES
      - TREASURY_WATCHER_REORG_AGEOUT_MINUTES
      - TREASURY_WATCHER_MAX_PAGES_PER_BLOCK
      - TREASURY_WATCHER_USDT_CONTRACT
      - TREASURY_WATCHER_TRON_PRIMARY_URL
      - TREASURY_WATCHER_TRON_SECONDARY_URL
      - TREASURY_WATCHER_TRONGRID_API_KEY
      - TREASURY_WATCHER_TRON_SECONDARY_API_KEY
    darkDefaultProof: "loadTreasuryWatcherConfig({}).enabled === false; WATCHER_ENABLED does not enable Treasury watcher"
    orgScopedCycle: "runTreasuryWatcherCycle(context, deps) requires explicit OrgContext"
    inceptionCheckpointProof: "ACTIVE inception required; seed last_scanned_block = watcher_start_block - 1; key TRC-20:treasury org-scoped"
    eventPagination: "TronGrid v1 /v1/contracts/{}/events with event_name, block_number, limit, fingerprint; no min/max_block_number; no only_confirmed=true"
    inboundOutboundProof: "direction_scope INBOUND/OUTBOUND/BOTH; external->managed INFLOW; managed->external OUTFLOW; A->B two observations"
    observationPersistenceType: TreasuryChainObservationRecord
    observationIdempotency: "${network}:${txHash}:${transferIndex}:${watchedAddressId}"
    observationRoleLinkage: "external PRIMARY; internal OUTFLOW PRIMARY + INFLOW INTERNAL_COUNTERPARTY"
    confirmationsLifecycle: "depth<=0 skip; 1<=depth<required OBSERVED; depth>=required CONFIRMED"
    lifecycle0150Usage: "UPDATE confirmations_observed + observation_status only; related_payment_id untouched"
    semanticCoalescing: "(organization_id, network, token_contract, tx_hash, transfer_index)"
    internalABProof: "two observations, one WATCHER NEEDS_REVIEW tx, direction INTERNAL, kind null"
    noBusinessMeaning: true
    noVerify: true
    reorgDroppedProof: "provider error != drop; age-out + canonical absence -> DROPPED + RECONCILIATION_REQUIRED"
    cursorAtomicityProof: "no advance on provider/pagination/persist failure; advance after durable ingest"
    reconAsOfProof: "asOfBlock/asOfTime captured; VERIFIED-only accounting; watcher later blocks excluded"
    historicalBalanceCapability: "Tron adapter getConsolidatedBalanceAtBlock returns supported:false"
    unavailableFailClosed: true
    bigintProof: true
    wp3TestCommand: "pnpm exec vitest run tests/unit/treasury-watcher-dark.test.ts tests/unit/treasury-watcher-rules.test.ts tests/unit/treasury-watcher-adapter.test.ts tests/unit/treasury-watcher-cycle.test.ts"
    wp3TestCount: 36
    wp3TestResult: 36/36 PASS
    wp2Regression: 138/138 PASS
    typecheck: PASS
    lint: PASS
    gitDiffCheck: clean
    schemaMigrationChanges: false
    dbGenerate: false
    productionWatcherEnabled: false
    paymentWatcherIndependent: true
    paymentWatcherModified: false
    mergeOrderGate: BLOCK_MIGRATION_BEARING_MERGE_WHILE_DEE_518_JOURNAL_UNMERGED
    finalMigrationReconciliation: WP9_REQUIRED
    prOpened: false
  observationGuardAmendment:
    status: APPROVED_IMPLEMENTED_VALIDATED
    discoveredAt: "2026-08-13"
    classification: WP1_SECURITY_GUARD_CONTRADICTS_APPROVED_OBSERVATION_MUTABILITY
    blockerMarker: DEE_606_WP3_BLOCKED_BY_OBSERVATION_SCHEMA_CONTRACT_MISMATCH
    affectedTable: treasury_chain_observations
    affectedMigration: 0149_treasury_transparency_ledger_rls
    immutableFactsStillProtected: true
    deleteStillBlocked: true
    proposedMutableColumns:
      - confirmations_observed
      - observation_status
      - related_payment_id
    watcherAuthorityColumns:
      - confirmations_observed
      - observation_status
    adminAuthorityColumns:
      - related_payment_id
    correctionDisposition: ADDITIVE_FORWARD_FIX_MIGRATION_IMPLEMENTED
    migrationIdentity: 0150_treasury_chain_observations_lifecycle_guard
    finalMigrationReconciliation: WP9_REQUIRED
    mergeOrderGate: BLOCK_MIGRATION_BEARING_MERGE_WHILE_DEE_518_JOURNAL_UNMERGED
    watcherDark: true
    wp3ImplementationStarted: true
    wp3Status: COMPLETE
    architectureAmendmentSourceSha: 668f159f2c98c7fbd17b577a7de082ff12b0a5d6
    approvalToken: CONFIRM-DEE-606-OBSERVATION-GUARD-668F159F
    approvedAt: "2026-08-13"
    approvedBy: HUMAN
    approvalTokenStatus: CONSUMED
    approvalRecordingSha: 04b28dfcb3d0741aee355f31c53887177e378e07
    correctionImplementationSha: 11028f59c8b083069ee4c6909ca57828a231d9d5
    correctionValidationStatus: DEDICATED_POSTGRES_VALIDATION_PASS
    validatedAt: "2026-08-13"
    validationPort: 54339
    evidencePath: /tmp/dee606-obs-guard-correction-11028f59c8b083069ee4c6909ca57828a231d9d5.log
    evidenceSha256: fb2e5bd321f9a47519be92251e7d37864fb4c19368b7ee42a540f8b03688f6c2
    futureColumnFailClosed: true
    rlsUnchanged: true
    revisionGuardsUnchanged: true
    typecheck: PASS
    wp2Regression: 138/138 PASS
  wp2:
    status: COMPLETE
    startingSha: 7ac23d999278e366a0df428445ec8191a589cbda
    implementationSha: 44c06089cb01eab95ce1b1f118f6a15bef853f35
    validatedAt: "2026-08-13"
    filesCreated:
      - lib/waia-core/treasury/**
      - tests/unit/treasury-*.test.ts
      - tests/unit/helpers/treasury-wp2.ts
    targetedTestCommand: "pnpm exec vitest run tests/unit/treasury-transaction-fsm.test.ts tests/unit/treasury-cash-effect.test.ts tests/unit/treasury-watcher-verify.test.ts tests/unit/treasury-publication.test.ts tests/unit/treasury-commitment-lifecycle.test.ts tests/unit/treasury-contribution-share.test.ts tests/unit/treasury-inception.test.ts tests/unit/treasury-service-audit-scope.test.ts"
    targetedTestFiles: 8
    targetedTestCount: 138
    lint: PASS
    typecheck: "WP-2 modules clean; repository tsc still reports pre-existing WP-1 drizzle bigint default(0) errors in db/schema.postgres.ts:4618 and :4621 (unchanged; no schema edit in WP-2)"
    gitDiffCheck: clean
    provedInvariants:
      - transaction-fsm-allowed-and-forbidden
      - cash-effect-matrix
      - watcher-verified-precondition
      - publication-orthogonality
      - commitment-lifecycle-and-active-derivation
      - contribution-share-primitives-wp2-only
      - inception-without-checkpoint-seed
      - audit-revision-org-scope
    watcherDark: true
    httpUi: none
    schemaMigrationChanges: false
    dbGenerateRun: false
    wp7ScopeConsumed: false
    mergeOrderGate: BLOCK_MIGRATION_BEARING_MERGE_WHILE_DEE_518_JOURNAL_UNMERGED
  wp1Authoring:
    status: COMPLETE
    authoredAt: "2026-08-12"
    validation: DEDICATED_POSTGRES_VALIDATION_PASS
    note: "WP-1 COMPLETE after dedicated Postgres validation on 127.0.0.1:54339."
  wp1BoundedCorrection:
    status: CHECKPOINT_ORG_SCOPE_CORRECTED
    afterSha: c26ebad5731be312489c6f72b576827dc1245ed2
    correctedAt: "2026-08-13"
    reason: "treasury_watcher_checkpoints was keyed only by checkpoint_key; approved invariant requires all Treasury entities org-scoped. Composite PK (organization_id, checkpoint_key) + organizations FK. 0148/0149 identities unchanged."
  wp1TypeCorrection:
    status: COMPLETE
    correctedAt: "2026-08-13"
    reason: "Drizzle bigint(mode=bigint) defaults for treasury_balance_reconciliations.explained_pending_micros and tolerance_micros used number literal 0; corrected to bigint literal 0n. SQL migrations and validated Postgres semantics unchanged."
    typecheck: PASS
    postgresRevalidationRequired: false
    wp1ValidatedImplementationShaUnchanged: 0df1b9698f1af27222c60bfb11191f0cf3f85676
  wp1Validation:
    status: DEDICATED_POSTGRES_VALIDATION_PASS
    validatedImplementationSha: 0df1b9698f1af27222c60bfb11191f0cf3f85676
    validatedAt: "2026-08-13"
    port: 54339
    evidencePath: /tmp/dee606-wp1-postgres-validation-0df1b9698f1af27222c60bfb11191f0cf3f85676.log
    evidenceSha256: 462bf9d40ae72e425cbec39a70aa93bf1c9ef94623a1b5184eac06eb4bf2ab07
    passCategories:
      - empty-db-apply
      - catalog
      - enums
      - organization_id
      - watcher-checkpoint-composite-pk
      - rls
      - append-only
      - same-org-composite-fks
      - check-constraints
      - journal-monotonicity
    dee518LocalJournalTipObserved: 0148_trader_forecast_v2_open_tail_null_bounds_v1
    mergeOrderGate: BLOCK_MIGRATION_BEARING_MERGE_WHILE_DEE_518_JOURNAL_UNMERGED
  humanArchitectureApproval:
    status: COMPLETE
    approvedAt: "2026-08-12"
    approvedArchitectureSourceSha: 82377e4f4869b9bf64f26a9578c2335cdbcb8b15
    approvalToken: CONFIRM-DEE-606-ARCHITECTURE-PLAN-82377E4F
    architectReview: COMPLETE
    humanArchitectureApproval: COMPLETE
  humanDecisionDispositions:
    HD-1: APPROVED
    HD-2: APPROVED
    HD-3: APPROVED_ARCHITECTURE_ONLY
    HD-4: DEFERRED
    HD-5: APPROVED_DEFAULT_PENDING
    HD-7: APPROVED_DARK
  migrationIdentity:
    disposition: ALLOCATED_BRANCH_RESERVATION
    mainTipAtAllocation: "0109"
    dee518ReservationThrough: "0147"
    dee518LocalJournalTipObservedReadOnly: 0148_trader_forecast_v2_open_tail_null_bounds_v1
    allocatedTags:
      - 0148_treasury_transparency_ledger_foundation
      - 0149_treasury_transparency_ledger_rls
      - 0150_treasury_chain_observations_lifecycle_guard
    mergeOrderGate: BLOCK_MIGRATION_BEARING_MERGE_WHILE_DEE_518_JOURNAL_UNMERGED
    note: "Branch reservation after max(main tip 0109, DEE-518 reservation 0147). DEE-518 local worktree now also contains 0148_trader_forecast_v2_open_tail_null_bounds_v1. 0150 is a branch-local observation-guard correction reservation (not merge authority). Final identity reconciliation/renumbering is WP-9 / PR readiness. Allocation is NOT permission to Human-merge. See §13."
  r5SafePostgres:
    requiredPort: 54339
    forbiddenPortWhileR5Active: 54329
    note: "Dedicated treasury validate topology only; never stop/recreate waia-postgres-validate-1. WP-1 authoring intentionally skipped apply/validation while R5 authority work was active."
  correctionPass:
    afterSha: a95b9c1c27b9d98df66cfb944c292dd1967e5f5e
    reason: "Independent Architect review corrections (T3, accounting vs detail publication, cash equation, commitments, runway as-of, reconciliation, fund-bucket deferral)."
  integrityPass:
    afterSha: a0f00846b55a53f1f9ecb2db8c9e6bef82a156e0
    reason: "Final integrity corrections: ledger inception anchor, internal-transfer observation coalescing, temporally exact reconciliation + freshness, reconciled resource flows, budget.remaining with commitments, same-org FK integrity, kind/direction constraints."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-606 — Breath of WAIA transparent treasury (canonical implementation plan)

## Authority

- Live Linear **[DEE-606](https://linear.app/deepsense/issue/DEE-606/breath-of-waia-transparent-treasury-ledger-watcher-ingestion-and)** is the executable task contract.
- Public homepage Breath contract authored under DEE-605: `lib/landing/breath-public.ts` — **do not redesign** homepage visuals in DEE-606.
- **DEE-607** owns Admin Finance Console UX (blocked by this issue).
- **DEE-611** owns later public “Every contribution is remembered” copy (blocked by this issue + DEE-612 doctrine).
- **DEE-612 / DEE-613** are doctrine/product-governance inputs — future compatibility constraints only; not permission to invent solidarity/access workflows inside DEE-606.
- Core ownership canon: [`docs/waia-core/WAIA-CORE-ARCHITECTURE.md`](../waia-core/WAIA-CORE-ARCHITECTURE.md), ADR-0007, ADR-0014, ADR-0015.
- Risk: **T3** per [`docs/waia-governance/RISK-TIERS.md`](../waia-governance/RISK-TIERS.md) — auth permissions, admin mutation orchestration, Postgres persistence, watcher orchestration, financial state transitions, public financial publication. Requires Architect review + Human architecture approval. **T3/T4: no auto-merge**; Human merge authority is not weakened.
- Physical isolation from active DEE-518 A3-P01-R5 measurement is load-bearing for the entire batch.

## Isolation evidence (plan-time preflight)

| Surface | Value |
|--------|--------|
| DEE-606 worktree | `/Users/legco/Projects/waia-dee-606-breath-treasury` |
| Branch | `dee-606-breath-of-waia-transparent-treasury-ledger-watcher-ingestion` |
| Baseline `origin/main` | `d954bbed4c1a893a1b7120b1c04fa9ca485453ff` |
| Starting HEAD | `d954bbed4c1a893a1b7120b1c04fa9ca485453ff` (= `origin/main`) |
| First plan commit | `a95b9c1c27b9d98df66cfb944c292dd1967e5f5e` |
| DEE-518 worktree | `/Users/legco/Projects/waia` on `dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1` — **NO-TOUCH** |
| R5 screen / lock | `dee518-a3-p01-r5` / `/tmp/dee518-a3-phase.lock` — **NO-TOUCH** |
| R5 Postgres | container `waia-postgres-validate-1`, host port `127.0.0.1:54329` — **NO-TOUCH** |
| Main Postgres migration tip | `0109_trader_knowledge_confidence_update_record_rls` (journal idx 109) |
| DEE-518 reserved migrations | committed on branch through `0145_…`; **uncommitted** `0146_…`, `0147_…` in DEE-518 worktree |

## Goal

Deliver Core-owned treasury/transparency infrastructure that:

1. Observes designated treasury wallet movements (initially USDT TRC-20) as **facts**, not meaning.
2. Holds a human-governed semantic ledger with review → classify → verify lifecycle, orthogonal to detail publication.
3. Maintains a canonical VERIFIED accounting cash balance with commitment facts and on-chain reconciliation control.
4. Supports budgets, funding needs, evidence references, contribution attribution, and audit.
5. Publishes a truthful server-side read model into the existing Breath public contract (aggregates from accounting truth; row details only when DETAIL_PUBLIC).
6. Freezes backend mutation contracts so DEE-607 does not invent finance semantics.
7. Makes DEE-611’s contribution-map claims **true in data** without implementing DEE-611 copy.

---

## 1. Domain ownership decision (FROZEN)

### Decision: **Option A — new Core-owned Treasury / Transparency domain**

Breath/Treasury is a **new Core-owned domain** under `lib/waia-core/treasury/**` with its own tables, services, and observation surface. It **consumes or optionally references** Core identity / tenancy / audit / (rarely) payment observations. It does **not** encode treasury business meaning inside `payment_events` / `payments`.

### Rejected alternatives

| Option | Why rejected |
|--------|--------------|
| **B — additive semantic layer directly over Core `payments`** | Core `payments` are org-scoped **module billing** deposits with required `subjectModule ∈ {trader,twin,marketplace}`. Primary consumer is AI-Trader settlement (`subjectModule=trader`). Lifecycle is DETECTED/CONFIRMED/FAILED — no classification/publication. Outbound treasury spends are out of scope for the current billing watcher. Conflating public treasury with billing deposits violates Core/module ownership and would poison trader settlement filters. |
| **C — other** | No superior option found that preserves Core ownership without inventing a parallel identity/payment stack. |

### Ownership invariants (FROZEN)

| Concern | Owner |
|---------|-------|
| users / profiles / platform roles | Core identity |
| organizations / membership | Core tenancy |
| payer identity + `payments` / `payment_addresses` / payment watcher | Core payments (billing rail) — unchanged |
| `audit_logs` | Core shared audit stream |
| treasury observations, semantic ledger, commitments, budgets, funding needs, evidence refs, contribution attribution, Breath publication | **Core Treasury / Transparency (new)** |
| AI-Trader HWM / invoices / settlements / reporting | AI-Trader — **never reused** |

### Do not

- Duplicate user/payment identity tables.
- Repurpose `trader_*` billing/HWM/invoice/settlement tables.
- Treat detail publication as accounting authority.
- Give the treasury watcher trading/capital/custody authority.

---

## 2. Current Core payment / watcher reuse analysis

### What exists today (facts)

| Component | Behavior |
|-----------|----------|
| `payment_events` / `payments` | Org-scoped append-only billing ledger; money stored as **text**; soft-bound via `subjectModule` |
| Payment watcher | **Inbound-only** USDT TRC-20 Transfer → registered `payment_addresses`; detect → confirm → orphan-fail |
| Checkpoint | Single row PK `network` (`TRC-20`) — one cursor/lease for the billing watcher |
| `WATCHER_ENABLED` | Gates the **entire** Core payment watcher cycle |
| Idempotency | `TRC-20:{txHash}:{transferIndex}` + unique keys |
| `evidenceRef` | `watcher://…` string — **not** document blob storage |
| ADR-0014 | Read-only observer; host-agnostic cycle; no keys/signing |

### Reuse recommendation (FROZEN)

1. **Do not ingest treasury movements into `payment_events` / `payments`.**
2. **Do reuse** observation library patterns: Tron scan adapter shape, confirmation depth doctrine (ADR-0015), lease/checkpoint idea, idempotency key shape, content-digest discipline, Worker cron hosting pattern.
3. **Add a separate treasury observation surface** with its own watched-address registry, checkpoint key (`TRC-20:treasury`), and `TREASURY_WATCHER_ENABLED` (default **false**; ships DARK).
4. Optional soft `related_payment_id` only when an operator later proves coincidence with a Core billing payment.
5. Manual entries are first-class with provenance `MANUAL`.

---

## 3. Three-concept separation (FROZEN)

| Layer | Meaning | Mutability | Public by default |
|-------|---------|------------|-------------------|
| **1. Observation** | What objectively occurred on-chain or was entered as a source fact | Observation facts immutable after write | No |
| **2. Accounting / business meaning** | Classification + VERIFIED accounting membership | Append-only revisions; FSM to VERIFIED | Aggregates may publish without row detail |
| **3. Detail publication** | Whether transaction-level details are disclosed | Orthogonal `detail_publication` state | Only `DETAIL_PUBLIC` rows |

Invariant: **a blockchain transfer is never self-explanatory.** Watcher observation never implies accounting verification or detail publication.

---

## 4. Orthogonal state machines (FROZEN)

### 4.1 Accounting / review status (`treasury_tx_status`)

| State | Meaning |
|-------|---------|
| `DETECTED` | Created by watcher; unpublished; not accounting truth |
| `MANUAL_DRAFT` | Admin draft; not accounting truth |
| `NEEDS_REVIEW` | Queued for human semantic work |
| `CLASSIFIED` | Required semantic fields present; awaiting verification |
| `VERIFIED` | Human-verified accounting fact; **enters canonical accounting** |
| `RECONCILIATION_REQUIRED` | Material ambiguity; blocks silent aggregate use when unresolved set is material |
| `REJECTED` | Terminal; excluded from accounting |
| `DUPLICATE` | Terminal; points at surviving transaction; excluded |

**There is no `PUBLISHED` accounting status.** Detail disclosure is separate (§4.2).

### Allowed accounting transitions

```
DETECTED              → NEEDS_REVIEW | DUPLICATE | RECONCILIATION_REQUIRED | REJECTED
MANUAL_DRAFT          → NEEDS_REVIEW | REJECTED
NEEDS_REVIEW          → CLASSIFIED | REJECTED | DUPLICATE | RECONCILIATION_REQUIRED
CLASSIFIED            → VERIFIED | NEEDS_REVIEW | REJECTED | RECONCILIATION_REQUIRED
VERIFIED              → RECONCILIATION_REQUIRED
RECONCILIATION_REQUIRED → NEEDS_REVIEW | REJECTED | DUPLICATE | VERIFIED
REJECTED              → (terminal)
DUPLICATE             → (terminal)
```

`VERIFIED → RECONCILIATION_REQUIRED` opens correction/reopen path; return to `VERIFIED` only after ambiguity is resolved with audit.

### Authority

| Transition | Authority |
|------------|-----------|
| Watcher create `DETECTED` | `service` + `TREASURY_WATCHER_ENABLED` path |
| Watcher may propose reconciliation / duplicate candidates | service proposes; human confirms |
| Manual draft / classify / reject / confirm duplicate | `admin.treasury.mutate` |
| → `VERIFIED` | `admin.treasury.mutate` **plus** watcher confirmation precondition when `provenance=WATCHER` (§7) |
| Detail publication changes (`PRIVATE` ↔ `DETAIL_PUBLIC`) | `admin.treasury.publish` |
| Enable Breath aggregates (`breath_enabled`) | `admin.treasury.publish` |
| Public read | unauthenticated read of Breath projection only |

### 4.2 Detail publication state (`treasury_detail_publication`)

| State | Meaning |
|-------|---------|
| `PRIVATE` | Default. Row details not listed in public `recentActivity`; identity/counterparty/notes/evidence/tx hash not exposed. **Still participates in aggregates if accounting status = VERIFIED.** |
| `DETAIL_PUBLIC` | Explicitly approved for public row disclosure (label, amount, time, optional provenance URL per policy). |
| `SUPERSEDED` | Prior detail disclosure replaced by a correcting DETAIL_PUBLIC narrative; history retained. |

Detail publication does **not** gate:

- accounting cash balance
- contribution numerator/denominator
- Breath aggregate fields (`entered`, `spent`, `currentFreeFunds`, budget funded/spent, etc.)

Detail publication **does** gate:

- inclusion in `recentActivity`
- public exposure of identity, counterparty, internal notes, evidence, tx hash, explorer URL

### Immutable facts

Watcher-origin immutable after write: network, token/contract, tx hash, transfer ordinal, from/to, native atomic amount + decimals, observed timestamps, block identity, ingestion source, observation idempotency key.

After leaving `MANUAL_DRAFT`: `id`, `created_at`, provenance kind.

### Revisable via append-only revisions (while not under terminal REJECTED/DUPLICATE)

Semantic fields: purpose, category, kind, fund_bucket_code, counterparty display, project/module, milestone/stage, budget_id, funding_need_id, description, internal notes, public description, attribution proposals, nominal USD micros (under policy), detail-publication eligibility flags.

### Correction of verified mistakes (append-only)

1. Do not delete or rewrite immutable facts.
2. Move affected row to `RECONCILIATION_REQUIRED` (audit + reason).
3. Create linked `CORRECTION` / `REFUND` / `BALANCE_ADJUSTMENT` transaction with `corrects_transaction_id`.
4. Correction follows classify → verify path.
5. If original was `DETAIL_PUBLIC`, set it `SUPERSEDED` when a correcting detail row is made `DETAIL_PUBLIC`.
6. Aggregates recompute from VERIFIED set only.

### Fail-closed material reconciliation (FROZEN)

Define `material_unresolved_reconciliation = true` when any `RECONCILIATION_REQUIRED` transaction (or open balance-reconciliation case — §5.15) has non-zero potential cash effect on Breath aggregates.

If `material_unresolved_reconciliation`:

- Breath `status` must be `"pending"` (financial aggregates unavailable)
- do **not** publish knowingly unreliable totals
- contribution share engine may still compute admin-only views, but public Breath remains pending

---

## 5. Exact data model / data dictionary (proposed)

### Conventions

- Prefix: `treasury_*`.
- Tenancy: every row carries `organization_id` → dedicated **WAIA Platform Treasury** Core organization (HD-1).
- Money (FROZEN):
  - Native: `native_amount_atomic BIGINT` + `native_decimals SMALLINT` + `native_asset TEXT` + `native_contract TEXT NULL`
  - Accounting denomination micros: `accounting_amount_micros BIGINT` + `accounting_denomination_policy TEXT` (v1: `USDT_NOMINAL_USD_POLICY_V1`)
  - **Never** float/`real`/JS number as authority
- Digests: sha256 hex of canonical JSON where integrity required.

### 5.1 Enums

| Enum | Values |
|------|--------|
| `treasury_tx_status` | `DETECTED`, `MANUAL_DRAFT`, `NEEDS_REVIEW`, `CLASSIFIED`, `VERIFIED`, `RECONCILIATION_REQUIRED`, `REJECTED`, `DUPLICATE` |
| `treasury_detail_publication` | `PRIVATE`, `DETAIL_PUBLIC`, `SUPERSEDED` |
| `treasury_tx_direction` | `INFLOW`, `OUTFLOW`, `INTERNAL` |
| `treasury_tx_kind` | `OPENING_BALANCE`, `CONTRIBUTION`, `EXPENSE`, `EXTERNAL_INFLOW`, `EXTERNAL_OUTFLOW`, `INTERNAL_TRANSFER`, `REFUND`, `CORRECTION`, `BALANCE_ADJUSTMENT` |
| `treasury_provenance` | `WATCHER`, `MANUAL` |
| `treasury_budget_status` | `DRAFT`, `ACTIVE`, `SUPERSEDED`, `ARCHIVED` |
| `treasury_funding_need_status` | `OPEN`, `PARTIALLY_FUNDED`, `FUNDED`, `CLOSED`, `CANCELLED` |
| `treasury_commitment_status` | `DRAFT`, `APPROVED`, `RELEASED`, `FULFILLED`, `CANCELLED` |
| `treasury_evidence_kind` | `RECEIPT`, `INVOICE`, `CONFIRMATION`, `SCREENSHOT`, `DOCUMENT`, `CHAIN_PROVENANCE` |
| `treasury_evidence_visibility` | `ADMIN_ONLY`, `PUBLIC` |
| `treasury_attribution_status` | `UNMATCHED`, `ATTRIBUTED`, `ANONYMOUS`, `REVOKED` |
| `treasury_address_direction_scope` | `INBOUND`, `OUTBOUND`, `BOTH` |
| `treasury_balance_recon_status` | `MATCHED`, `PENDING_CONFIRMATIONS`, `MISMATCH`, `UNAVAILABLE` |

### 5.1b Fund buckets — extensible registry (FROZEN; no premature DEE-612/613 values)

**Do not** hard-code `SPONSORED_ACCESS` / `SOLIDARITY` enums in DEE-606.

Use table `treasury_fund_buckets`:

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `organization_id` | uuid FK | NO | part of PK |
| `code` | text | NO | part of PK; stable code |
| `title` | text | NO | |
| `is_active` | boolean | NO | |
| `created_at` | timestamptz | NO | |

**Primary key:** `(organization_id, code)`.  
**Seeded v1 rows only (per treasury org):** `OPERATING`, `RESERVE`, `UNASSIGNED`.

Future solidarity/access buckets may be inserted later after DEE-612/613 Human approval — schema remains compatible without canonizing unapproved doctrine now. DEE-606 does **not** implement solidarity workflows.

### 5.1c `treasury_ledger_inceptions` (FROZEN chain/watcher start boundary)

Deterministic ledger-inception anchor. Prevents `OPENING_BALANCE` + historical backfill double counting.

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `network` | text | NO | e.g. `TRC-20` |
| `token_contract` | text | NO | |
| `asset_code` | text | NO | `USDT` |
| `inception_block` | text | NO | inclusive boundary block height |
| `inception_block_hash` | text | YES | if provider/source supports it |
| `inception_time` | timestamptz | NO | |
| `opening_balance_transaction_id` | uuid | NO | FK → `treasury_transactions.id` (OPENING_BALANCE) |
| `watcher_start_block` | text | NO | first block eligible for canonical watcher ingestion; **strictly after** inception boundary |
| `evidence_object_id` | uuid | YES | evidence/provenance ref |
| `status` | text | NO | `ACTIVE` \| `SUPERSEDED` |
| `created_by_user_id` | uuid | NO | |
| `approved_by_user_id` | uuid | NO | required for ACTIVE |
| `created_at` | timestamptz | NO | |

**Binding rules:**

1. Exactly one `ACTIVE` inception per `(organization_id, network, token_contract)`.
2. Linked `OPENING_BALANCE` represents the consolidated balance of the recon-included managed treasury address set **at the inception anchor**.
3. That `OPENING_BALANCE` must be `VERIFIED`, evidence-backed, and linked here before watcher ingestion is considered canonical.
4. Treasury watcher canonical ingestion starts **strictly after** the inception boundary (`watcher_start_block` > `inception_block` numerically / as defined by chain ordering).
5. Historical transfers at or before the inception boundary **MUST NOT** also be counted as post-inception ledger movements.
6. Initial `treasury_watcher_checkpoints.last_scanned_block` for the matching checkpoint key is **deterministically seeded** from the approved inception (`watcher_start_block − 1` / equivalent scan cursor so the first scan begins at `watcher_start_block`).
7. Future ledger rebase / inception replacement is a separate explicit reconciliation/migration operation — **never** silent mutation of an ACTIVE inception.

**Required tests:** opening + historical backfill cannot double-count; checkpoint seed matches inception; transfers at/before inception excluded from semantic ledger; replacing ACTIVE inception requires SUPERSEDED path + audit.

### 5.1d Same-organization relational integrity (FROZEN)

All organization-scoped references between `treasury_*` entities **MUST** be same-organization by **database constraint**, not merely application convention.

Use composite unique keys + composite FKs (or equivalent Postgres-enforced pairs) for relationships including:

- transaction → fund bucket `(organization_id, fund_bucket_code)` → `treasury_fund_buckets(organization_id, code)`
- transaction → budget / funding need
- transaction ↔ observations via observation links
- attribution → transaction
- evidence link → transaction / evidence object
- commitment → budget / fulfillment transaction
- runway snapshot → runway plan
- inception → opening balance transaction
- reconciliation → organization (+ inception where applicable)

Cross-organization references must be impossible even through privileged app bugs. Targeted RLS remains defense-in-depth **in addition** to this invariant.

### 5.2 `treasury_watched_addresses`

| Field | Type | Null | Meaning | Mutability | Public |
|-------|------|------|---------|------------|--------|
| `id` | uuid PK | NO | | immutable | NO |
| `organization_id` | uuid FK | NO | | immutable | NO |
| `network` | text | NO | e.g. `TRC-20` | immutable | NO |
| `address` | text | NO | | immutable | NO |
| `token_contract` | text | NO | | immutable | NO |
| `asset_code` | text | NO | `USDT` | immutable | NO |
| `direction_scope` | enum | NO | | admin-updatable | NO |
| `include_in_balance_recon` | boolean | NO | default true | admin-updatable | NO |
| `label` | text | NO | | admin-updatable | NO |
| `is_active` | boolean | NO | | admin-updatable | NO |
| `created_at` / `updated_at` | timestamptz | NO | | system | NO |

**Constraints:** unique `(network, address, token_contract)`.

### 5.3 `treasury_watcher_checkpoints`

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `organization_id` | uuid FK | NO | part of PK — **not** encoded in `checkpoint_key` |
| `checkpoint_key` | text | NO | e.g. `TRC-20:treasury` — **not** bare `TRC-20`; org-local, not globally unique |
| `last_scanned_block` | text | NO | |
| `last_scanned_at` | timestamptz | NO | |
| `lease_until` | timestamptz | YES | |
| `last_error` / `last_error_at` | text/timestamptz | YES | |
| `cycle_count` | int | NO | default 0 |
| `created_at` / `updated_at` | timestamptz | NO | |

**Primary key:** `(organization_id, checkpoint_key)`. Database-enforced org-scoped identity. Do **not** rely on organization encoded inside `checkpoint_key`.

### 5.4 `treasury_chain_observations`

| Field | Type | Null | Meaning | Mutability |
|-------|------|------|---------|------------|
| `id` | uuid PK | NO | | immutable |
| `organization_id` | uuid FK | NO | | immutable |
| `watched_address_id` | uuid FK | NO | | immutable |
| `network` / `token_contract` / `asset_code` | text | NO | | immutable |
| `tx_hash` | text | NO | | immutable |
| `transfer_index` | int | NO | | immutable |
| `from_address` / `to_address` | text | NO | | immutable |
| `direction` | enum | NO | relative to watched address | immutable |
| `native_amount_atomic` / `native_decimals` | bigint/smallint | NO | | immutable |
| `block_height` | text | NO | | immutable |
| `block_timestamp` | timestamptz | YES | | immutable |
| `observed_at` | timestamptz | NO | | immutable |
| `confirmations_observed` | int | NO | | watcher until terminal |
| `confirmations_required` | int | NO | | immutable per policy |
| `observation_status` | text | NO | `OBSERVED` \| `CONFIRMED` \| `DROPPED` | watcher FSM |
| `idempotency_key` | text | NO | | immutable |
| `ingestion_source` | text | NO | | immutable |
| `raw_event_digest` | text | NO | | immutable |
| `related_payment_id` | uuid | YES | | admin later |
| `created_at` | timestamptz | NO | | immutable |

**Constraints:** unique `idempotency_key`; unique `(network, tx_hash, transfer_index, watched_address_id)`.

**Canonical blockchain Transfer identity** (org-scoped semantic coalesce key):

```
(organization_id, network, token_contract, tx_hash, transfer_index)
```

Address-relative observations may be multiple for the same Transfer; semantic ledger coalesces to one transaction (§5.5b, §7).

### 5.4a Observation lifecycle DB guard amendment (HUMAN APPROVED AND VALIDATED)

**Classification:** bounded security/persistence correction. **Not** a redesign of Treasury observation truth. **Not** new product semantics.

The Human-approved §5.4 mutability model already permits watcher evolution of `confirmations_observed` and `observation_status`, and later admin assignment of `related_payment_id`. Canonical §7 requires those lifecycle fields to be **persisted** (`OBSERVED` → `CONFIRMED` → `DROPPED`). WP-2 VERIFY reads that persisted state.

**Validated contradiction (now corrected):** `0149_treasury_transparency_ledger_rls.sql` installed `waia_treasury_chain_observations_block_mutation()` as a `BEFORE UPDATE` trigger that unconditionally raised `check_violation` for every `UPDATE`. Additive `0150_treasury_chain_observations_lifecycle_guard` replaces that function behavior without rewriting 0148/0149.

```
DEE_606_OBSERVATION_GUARD_CORRECTION_PASS_READY_TO_RESUME_WP3
```

**Corrected DB UPDATE allowlist (only these columns):**

| Column | DB guard | Application authority |
|--------|----------|------------------------|
| `confirmations_observed` | permitted UPDATE | **WATCHER SERVICE only** |
| `observation_status` | permitted UPDATE | **WATCHER SERVICE only** (`OBSERVED` \| `CONFIRMED` \| `DROPPED`) |
| `related_payment_id` | permitted UPDATE | **ADMIN mutation path only** |

The watcher **MUST NOT** alter `related_payment_id`. Admin **MUST NOT** rewrite watcher lifecycle/source facts merely because the DB trigger allows those columns. Application-layer authority remains primary; the DB guard is defense-in-depth for immutable facts.

**Immutable after INSERT (UPDATE must raise `check_violation`):** `id`, `organization_id`, `watched_address_id`, `network`, `token_contract`, `asset_code`, `tx_hash`, `transfer_index`, `from_address`, `to_address`, `direction`, `native_amount_atomic`, `native_decimals`, `block_height`, `block_timestamp`, `observed_at`, `confirmations_required`, `idempotency_key`, `ingestion_source`, `raw_event_digest`, `created_at`. Mixed allowed+immutable UPDATE is rejected atomically. **DELETE remains ALWAYS forbidden.**

**Do not introduce:** observation revision table; observation event-sourcing; replacement observation rows; destructive mutation; weakened immutable chain-fact protection; new observation states (`PENDING` / `REORGED` / `FINALIZED` / `VERIFIED`). Treasury transaction `VERIFIED` remains Human/domain authority and is **not** an observation state. `CONFIRMED` does **not** make the linked semantic transaction `VERIFIED`. Watcher still cannot VERIFY. Transaction FSM, cash-effect, contribution, publication, internal-transfer coalescing, reconciliation, and accounting membership are unchanged.

**Implemented correction:** additive `0150_treasury_chain_observations_lifecycle_guard` (`CREATE OR REPLACE FUNCTION` of `public.waia_treasury_chain_observations_block_mutation()`). Existing UPDATE/DELETE trigger identities preserved. Fail-closed comparison:

```
(to_jsonb(NEW) - 'confirmations_observed' - 'observation_status' - 'related_payment_id')
IS DISTINCT FROM
(to_jsonb(OLD) - 'confirmations_observed' - 'observation_status' - 'related_payment_id')
```

Unknown future columns remain in the jsonb comparison and are therefore immutable by default.

**Migration identity:** branch-local reservation `0150_treasury_chain_observations_lifecycle_guard` allocated at correction implementation preflight (origin/main tip `0109`; DEE-518 local tip `0148_trader_forecast_v2_open_tail_null_bounds_v1`; open PR #458 DEE-518 has no 0149/0150). **Not** merge authority. Final identity reconciliation/renumbering remains **WP-9 / PR readiness**. Merge-order gate remains binding: `BLOCK_MIGRATION_BEARING_MERGE_WHILE_DEE_518_JOURNAL_UNMERGED`.

**Dedicated Postgres validation PASS** (`docker-compose.postgres-treasury-validate.yml`, project `waia-postgres-treasury-validate`, `127.0.0.1:54339`; Postgres 16.14; empty-DB apply 113 migrations ending `0150`; evidence sha256 `fb2e5bd321f9a47519be92251e7d37864fb4c19368b7ee42a540f8b03688f6c2`). Implementation SHA `11028f59c8b083069ee4c6909ca57828a231d9d5`. typecheck PASS. WP-2 138/138 PASS.

WP-3 watcher implementation resumed under this validated persistence contract and is now **COMPLETE**. Watcher remains DARK.

### 5.5 `treasury_transactions`

| Field | Type | Null | Meaning | Mutability | Public detail |
|-------|------|------|---------|------------|---------------|
| `id` | uuid PK | NO | | immutable | only if DETAIL_PUBLIC |
| `organization_id` | uuid FK | NO | | immutable | NO |
| `status` | `treasury_tx_status` | NO | accounting FSM | FSM | NO |
| `detail_publication` | enum | NO | default `PRIVATE` | publish authority | YES state |
| `provenance` | enum | NO | | immutable | limited |
| `canonical_network` | text | YES | set for watcher-origin | immutable | NO |
| `canonical_token_contract` | text | YES | | immutable | NO |
| `canonical_tx_hash` | text | YES | | immutable | NO |
| `canonical_transfer_index` | int | YES | | immutable | NO |
| `direction` | enum | NO | | immutable after NEEDS_REVIEW | if DETAIL_PUBLIC |
| `kind` | enum | YES | null until classified | revision | if DETAIL_PUBLIC |
| `fund_bucket_code` | text | NO | default `UNASSIGNED`; FK with org | revision | NO unless policy |
| `native_*` | money fields | NO | | immutable after leave draft | amount if DETAIL_PUBLIC |
| `accounting_amount_micros` | bigint | YES | required before VERIFIED; magnitude ≥ 0 | revision until VERIFIED; then correction only | amount if DETAIL_PUBLIC |
| `accounting_denomination_policy` | text | YES | e.g. `USDT_NOMINAL_USD_POLICY_V1` | same | NO |
| `cash_effect_micros` | bigint | YES | signed effect on consolidated treasury cash; set at classify/verify per §9 | system from kind rules | NO |
| `counterparty_is_internal` | boolean | NO | true when both sides are managed treasury addresses | classify / watcher objective fact | NO |
| `occurred_at` | timestamptz | NO | | create; correction via link | if DETAIL_PUBLIC |
| `purpose` / `category` | text | YES | | revision | if DETAIL_PUBLIC |
| `counterparty_display` | text | YES | | revision | only if DETAIL_PUBLIC **and** `publish_counterparty` |
| `publish_counterparty` | boolean | NO | default false | revision | gate |
| `project_module` / `milestone_stage` | text | YES | | revision | if DETAIL_PUBLIC |
| `budget_id` / `funding_need_id` | uuid | YES | | revision | NO |
| `description` / `internal_notes` | text | YES | | revision | NO |
| `public_description` | text | YES | Breath row label | revision | if DETAIL_PUBLIC |
| `tx_hash` | text | YES | denorm (= canonical when watcher) | immutable if watcher | only if DETAIL_PUBLIC + policy |
| `corrects_transaction_id` | uuid | YES | | immutable once set | if DETAIL_PUBLIC |
| `duplicate_of_transaction_id` | uuid | YES | | on DUPLICATE | NO |
| `detail_superseded_by_id` | uuid | YES | | detail workflow | NO |
| `ledger_inception_id` | uuid | YES | required for OPENING_BALANCE | immutable once set | NO |
| `verified_at` / `verified_by_user_id` | timestamptz/uuid | YES | | on VERIFIED | NO |
| `detail_published_at` / `detail_published_by_user_id` | timestamptz/uuid | YES | | on DETAIL_PUBLIC | NO |
| `latest_revision_id` | uuid | YES | | system | NO |
| `record_content_digest` | text | NO | | system | NO |
| `created_by_user_id` | uuid | YES | | immutable | NO |
| `created_at` / `updated_at` | timestamptz | NO | | system | NO |

**Removed:** single authoritative `observation_id` on the transaction. Observation linkage is many-to-one via §5.5b.

**Semantic idempotency (watcher-origin):** unique partial index on  
`(organization_id, canonical_network, canonical_token_contract, canonical_tx_hash, canonical_transfer_index)`  
where those fields are NOT NULL. Replay cannot create a second semantic treasury transaction for the same canonical Transfer.

**Indexes:** `(organization_id, status)`; `(organization_id, detail_publication)`; `(organization_id, occurred_at desc)`; `(budget_id)`; `(kind, status)`.

**Composite FKs (same-org):**  
`(organization_id, fund_bucket_code)` → `treasury_fund_buckets`;  
`(organization_id, budget_id)` → `treasury_budgets(organization_id, id)` (budgets carry unique `(organization_id, id)`); likewise funding needs.

### 5.5a Kind / direction / cash-effect invariants (FROZEN)

Impossible combinations must not become `VERIFIED` (CHECK constraints + service guards):

| Kind | Required direction | Cash-effect rule |
|------|--------------------|------------------|
| `OPENING_BALANCE` | `INFLOW` (frozen representational direction) | `cash_effect_micros = +accounting_amount_micros` (`A > 0`) |
| `CONTRIBUTION` | `INFLOW` | `+A` (`A > 0`) |
| `EXTERNAL_INFLOW` | `INFLOW` | `+A` (`A > 0`) |
| `EXPENSE` | `OUTFLOW` | `−A` (`A > 0`) |
| `EXTERNAL_OUTFLOW` | `OUTFLOW` | `−A` (`A > 0`) |
| `INTERNAL_TRANSFER` | `INTERNAL` | `0` (consolidated); `A ≥ 0` magnitude recorded for display/audit |
| `REFUND` | `INFLOW` or `OUTFLOW` | sign follows direction (`+A` / `−A`); `A > 0` |
| `CORRECTION` / `BALANCE_ADJUSTMENT` | must agree with signed effect | `cash_effect_micros ≠ 0`; direction `INFLOW` iff effect > 0, `OUTFLOW` iff effect < 0; evidence required |

**Non-negative / positive amount constraints:** `accounting_amount_micros ≥ 0`; commitment `amount_micros > 0`; budget `planned_amount_micros > 0`; runway `daily_burn_micros > 0`; ideal `amount_micros > 0`; native atomic amounts ≥ 0.

### 5.5b `treasury_transaction_observation_links` (FROZEN)

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `transaction_id` | uuid | NO | |
| `observation_id` | uuid | NO | |
| `observation_role` | text | NO | `PRIMARY` \| `INTERNAL_COUNTERPARTY` \| `SECONDARY` |
| `created_at` | timestamptz | NO | |

**Constraints:**

- unique `(transaction_id, observation_id)`
- unique `(observation_id)` — one observation links to at most one semantic transaction
- composite FKs enforce same `organization_id` for transaction and observation

**Coalescing rules:**

- External inbound/outbound Transfer matching one managed address → normally **one** observation link → **one** semantic transaction.
- Managed A → managed B (same org, both watched) → **two** address-relative observations may link to the **same** semantic transaction; `direction = INTERNAL`; `kind` classifies as `INTERNAL_TRANSFER` (or remains unclassified until human classify, but cash effect once VERIFIED is 0); **never** two independent semantic movements; **never** double-count in aggregates.
- Watcher may objectively detect both endpoints are managed treasury addresses; it still does **not** assign business/governance meaning beyond the objective internal-transfer fact.

### 5.6 `treasury_transaction_revisions`

Append-only semantic history: `id`, `transaction_id`, `organization_id`, `seq`, `patch_json`, `actor_user_id`, `actor_type`, `reason`, digests, `created_at`. Unique `(transaction_id, seq)`; no UPDATE/DELETE.

### 5.7 `treasury_budgets`

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `code` / `title` | text | NO | |
| `period_start` / `period_end` | date | NO | |
| `currency` | text | NO | `USD` for v1 public |
| `planned_amount_micros` | bigint | NO | planned authority |
| `status` | enum | NO | |
| `is_public` | boolean | NO | include in Breath budget block |
| `notes` | text | YES | admin |
| `created_at` / `updated_at` | timestamptz | NO | |

**Constraints:** unique `(organization_id, id)` for composite FK targets; unique `(organization_id, code)`.

**Derived (not stored authority):** `funded`, `committed`, `spent`, `remaining` from §9. **No admin-maintained aggregate committed scalar.**

### 5.8 `treasury_ideal_annual_budgets`

Unchanged intent: explicit Human/admin versioned object; never inferred from donations. Fields: `id`, `organization_id`, `period_year`, `currency`, `amount_micros`, `effective_from`/`to`, `status` (`DRAFT`/`ACTIVE`/`SUPERSEDED`), `publication_state` (`PRIVATE`/`PUBLIC`), actors, `created_at`. At most one `ACTIVE`+`PUBLIC` per `(organization_id, period_year)`.

### 5.9 `treasury_funding_needs`

As before: required amount + status + public explanation; funded amount **derived** from VERIFIED contributions assigned to the need (not from detail publication).

### 5.10 Evidence objects + links

Reference contract unchanged: storage backend + object key + media type + byte size + sha256 + kind + visibility default `ADMIN_ONLY`. No large binary in financial rows. Breath never lists admin-only evidence.

**HD-3 storage backend:** **APPROVED_ARCHITECTURE_ONLY** (Human 2026-08-13, token `CONFIRM-DEE-606-HD3-R2-ARCHITECTURE-ONLY-NO-PRODUCTION-PROVISIONING`). Private Cloudflare R2, Worker-side access only, intended binding `TREASURY_EVIDENCE_R2`. Production bucket/binding/wrangler.jsonc mutation/deploy remain **NOT AUTHORIZED**.

### 5.11 `treasury_contribution_attributions`

Unchanged structure; share math uses VERIFIED set only (§6), independent of `detail_publication`.

### 5.12 `treasury_publication_settings`

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `organization_id` | uuid PK | NO | |
| `breath_enabled` | boolean | NO | master fail-closed; default false |
| `stage_label` | text | YES | |
| `work_summary` | text | YES | |
| `methodology_note` | text | NO | |
| `recent_activity_limit` | int | NO | default 5 |
| `updated_by_user_id` | uuid | YES | |
| `updated_at` | timestamptz | NO | |

### 5.13 Runway plans + runway snapshots

`treasury_runway_plans`: approved planned daily burn (`APPROVED_PLANNED_BURN`), `daily_burn_micros`, status `DRAFT`/`ACTIVE`/`SUPERSEDED`.

`treasury_runway_snapshots` (deterministic endsAt authority):

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `runway_plan_id` | uuid FK | NO | |
| `runway_as_of` | timestamptz | NO | frozen anchor |
| `free_funds_at_as_of_micros` | bigint | NO | `currentFreeFunds` at as-of |
| `approved_daily_burn_micros` | bigint | NO | copied from plan |
| `ends_at` | timestamptz | NO | computed once at snapshot creation |
| `input_digest` | text | NO | digest of accounting inputs + plan id + burn |
| `created_at` | timestamptz | NO | |

**Rule:** a new snapshot is created only when authoritative inputs change (VERIFIED cash/commitment set, ACTIVE burn plan, or explicit admin refresh under publish authority). Repeated reads return the latest snapshot’s `ends_at` unchanged.

### 5.14 `treasury_commitments` (FROZEN; replaces manual committed scalar)

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `budget_id` | uuid FK | YES | required when budget-scoped |
| `amount_micros` | bigint | NO | |
| `currency` | text | NO | `USD` |
| `purpose` | text | NO | |
| `counterparty_display` | text | YES | |
| `publish_counterparty` | boolean | NO | default false |
| `detail_publication` | enum | NO | default `PRIVATE` |
| `expected_at` | date | YES | |
| `effective_from` | timestamptz | NO | |
| `status` | `treasury_commitment_status` | NO | |
| `evidence_object_id` | uuid | YES | optional |
| `created_by_user_id` | uuid | NO | |
| `approved_by_user_id` / `approved_at` | uuid/timestamptz | YES | |
| `released_by_user_id` / `released_at` | uuid/timestamptz | YES | |
| `fulfilled_by_user_id` / `fulfilled_at` | uuid/timestamptz | YES | |
| `cancelled_by_user_id` / `cancelled_at` | uuid/timestamptz | YES | |
| `fulfills_transaction_id` | uuid | YES | expense/outflow that fulfills |
| `record_content_digest` | text | NO | |
| `created_at` / `updated_at` | timestamptz | NO | |

#### Commitment lifecycle (FROZEN)

```
DRAFT → APPROVED → RELEASED → FULFILLED
                 ↘ CANCELLED
APPROVED → CANCELLED
RELEASED → CANCELLED   # only with audit reason; rare
```

| Status | Counts toward `activeCommittedFunds`? |
|--------|----------------------------------------|
| `DRAFT` | NO |
| `APPROVED` | YES |
| `RELEASED` | YES (still reserved until fulfilled/cancelled) |
| `FULFILLED` | NO (cash effect already in VERIFIED expenses) |
| `CANCELLED` | NO |

Human/admin may CREATE / APPROVE / RELEASE / FULFILL / CANCEL. **Aggregate `committed` is always derived** — never a manually maintained scalar.

Append-only `treasury_commitment_revisions` mirrors transaction revisions.

### 5.15 `treasury_balance_reconciliations`

Independent control — **not** accounting SoT. Must be temporally exact.

| Field | Type | Null | Meaning |
|-------|------|------|---------|
| `id` | uuid PK | NO | |
| `organization_id` | uuid FK | NO | |
| `ledger_inception_id` | uuid | YES | FK to ACTIVE inception used for scope |
| `as_of_block` | text | NO | chain block height for on-chain balance read |
| `as_of_time` | timestamptz | NO | reconciliationAsOf wall/logical time |
| `observed_onchain_balance_atomic` | bigint | YES | null if provider cannot prove exact snapshot |
| `accounting_cash_balance_micros` | bigint | YES | `accountingCashBalanceAt(reconciliationAsOf)` |
| `delta_micros` | bigint | YES | observed_nominal − accounting when both known |
| `explained_pending_micros` | bigint | NO | default 0; sum of known OBSERVED/unconfirmed effects explaining delta |
| `unexplained_residual_micros` | bigint | YES | delta − explained_pending |
| `status` | enum | NO | |
| `tolerance_micros` | bigint | NO | v1: `0` for USDT nominal |
| `evidence_object_id` | uuid | YES | optional screenshot/export |
| `notes` | text | YES | admin |
| `created_by` | text | NO | `service`/`admin` |
| `created_at` | timestamptz | NO | |

#### Temporally exact accounting side (FROZEN)

```
accountingCashBalanceAt(reconciliationAsOf) =
  Σ cash_effect_micros(t) for t in VERIFIED
  where t is effective at or before reconciliationAsOf under these inclusion rules:
```

- **Watcher-origin VERIFIED rows:** include only if **all** linked observations have `block_height` ≤ `as_of_block` (chain boundary). If any linked observation lacks a comparable block height, treat that row as not includable for this as-of and mark recon `UNAVAILABLE` unless an approved alternate bound exists.
- **Manual / OPENING_BALANCE / BALANCE_ADJUSTMENT / CORRECTION facts:** include only if `occurred_at` (effective time) ≤ `as_of_time`.
- Do **not** compare a current-chain balance with an accounting total containing later movements.

If the chain provider cannot prove an exact comparable balance snapshot at the captured block/time:

```
status = UNAVAILABLE
```

Never fabricate exactness. `observed_onchain_balance_atomic` may be null when UNAVAILABLE.

#### Publication freshness (FROZEN)

v1 maximum acceptable reconciliation age: **10 minutes** (aligned to existing ~1 minute cron; no stricter repo canon found).

Breath financial aggregates may publish only when the **latest** reconciliation for the treasury org/asset is:

- `MATCHED`, or
- `PENDING_CONFIRMATIONS` **only if** the entire delta is exactly explained by known OBSERVED/unconfirmed transfers **and** `unexplained_residual_micros = 0`

Fail closed:

- `UNAVAILABLE` ⇒ Breath pending
- `MISMATCH` (unexplained residual ≠ 0 beyond tolerance) ⇒ Breath pending
- latest recon older than **10 minutes** ⇒ Breath pending (stale)

#### Other v1 rules

- Participating addresses: active watched addresses with `include_in_balance_recon=true`, same network/token, within the ACTIVE inception scope.
- Internal transfers are cash-neutral in accounting and net-zero on consolidated on-chain sum.
- Tolerance: **0 micros** under `USDT_NOMINAL_USD_POLICY_V1`.
- No custody/signing authority.

---

## 6. Contribution-attribution / share contract (FROZEN)

### Qualifying set `Q`

All must hold:

1. `kind = CONTRIBUTION`
2. `direction = INFLOW`
3. `status = VERIFIED` (not detail publication)
4. not REJECTED/DUPLICATE; not under material exclusion via open reconciliation that invalidates the row
5. asset in approved set (v1: USDT TRC-20)
6. `accounting_amount_micros IS NOT NULL`
7. `accounting_denomination_policy = USDT_NOMINAL_USD_POLICY_V1`

Refunds/corrections linked via `corrects_transaction_id`, themselves `VERIFIED`, adjust net micros.

### Share

```
numerator(user) = Σ net_micros(c) for c in Q with open ATTRIBUTED attribution to user
denominator     = Σ net_micros(c) for all c in Q   # includes UNMATCHED + ANONYMOUS
share(user)     = numerator / denominator if denominator > 0 else 0
```

Expenses / ordinary outflows / commitments **never** dilute historical share.

### Denomination policy (not market valuation)

`USDT_NOMINAL_USD_POLICY_V1`: for USDT with 6 decimals, `accounting_amount_micros = native_amount_atomic` (nominal 1 USDT ↔ 1 accounting USD unit).

This is a **nominal accounting convention for v1**, **not** a real-time market-price assertion. Future non-USDT assets require an approved valuation policy before entering `Q`.

### Privacy (HD-2 default)

Public surface: aggregate-only; no public identity list; optional authenticated self-only share. Opt-in public identities schema-ready but not published until later Human decision.

---

## 7. Watcher contract + VERIFIED precondition (FROZEN)

### Scope v1

USDT TRC-20; inbound and outbound vs active watched addresses; `TREASURY_WATCHER_ENABLED` default **false** (DARK).

Requires an `ACTIVE` `treasury_ledger_inceptions` row; canonical ingestion starts at `watcher_start_block` strictly after inception. Checkpoint is seeded from that boundary. Transfers at/before inception are never ingested as post-inception semantic movements.

### Observation idempotency (address-relative)

```
observation_idempotency_key = `${network}:${txHash}:${transferIndex}:${watchedAddressId}`
```

One observation per matched watched address is allowed.

### Semantic transfer identity + coalescing (FROZEN)

Canonical Transfer identity:

```
(organization_id, network, token_contract, tx_hash, transfer_index)
```

Semantic ledger: **exactly one** `treasury_transactions` row per canonical Transfer (unique partial index). Links via `treasury_transaction_observation_links`.

| Scenario | Observations | Semantic txs | Cash effect when VERIFIED |
|----------|--------------|--------------|---------------------------|
| External inbound to managed A | 1 | 1 | `+A` (once classified as contribution/external inflow) |
| External outbound from managed A | 1 | 1 | `−A` |
| Managed A → managed B | 2 | **1** (`INTERNAL`) | **0** |
| Replay of any of the above | no new semantic tx | still 1 | unchanged |

Watcher may objectively detect internal endpoints; it does not assign further business/governance meaning.

### Observation FSM

1. confirmations ≥ 1 → observation `OBSERVED`; ensure semantic tx exists (`DETECTED` → `NEEDS_REVIEW`) and link observation
2. confirmations ≥ required (default 20) → observation `CONFIRMED`
3. disappeared after age-out → `DROPPED` + semantic tx `RECONCILIATION_REQUIRED`
4. Periodic / cycle-end: emit balance reconciliation at captured as-of (§5.15)

### Binding VERIFIED precondition (WATCHER)

For `provenance = WATCHER`, transition to `VERIFIED` is **rejected** unless **every** linked observation satisfies:

```
observation_status = CONFIRMED
AND confirmations_observed >= confirmations_required
```

For internal transfers with two links, **both** must be CONFIRMED.

Human may **classify** while OBSERVED, but must **not** VERIFY until the precondition holds.

Until VERIFIED: excluded from accounting cash, contribution share, and public financial aggregates.

### Required tests

- classify-before-confirm allowed; verify-before-confirm rejected
- after CONFIRMED (all links), verify allowed
- OBSERVED amounts absent from aggregates and contribution share
- external inbound ⇒ one semantic tx; external outbound ⇒ one semantic tx
- managed A → managed B ⇒ two observations, one semantic tx, cash effect zero
- replay ⇒ still one semantic tx
- inception boundary: no double count with OPENING_BALANCE; checkpoint seeded correctly
- idempotent replay; DROPPED opens reconciliation

Watcher never publishes details, never sets kind/budget/attribution beyond objective internal-transfer detection, never signs/broadcasts.

---

## 8. Evidence contract (FROZEN)

Reference + metadata + sha256 only. Default `ADMIN_ONLY`. `PUBLIC` evidence requires explicit set **and** does not imply DETAIL_PUBLIC transaction disclosure unless separately approved. Every upload/link/unlink audits.

---

## 9. Canonical accounting + Breath formulas (FROZEN)

### 9.1 Signed cash-effect semantics (per VERIFIED row)

Let `A = accounting_amount_micros` (magnitude ≥ 0; kind rules in §5.5a).

| Kind | Direction | `cash_effect_micros` |
|------|-----------|----------------------|
| `OPENING_BALANCE` | `INFLOW` | `+A` (linked ACTIVE inception; evidence required; establishes since-inception starting resources) |
| `CONTRIBUTION` | `INFLOW` | `+A` |
| `EXTERNAL_INFLOW` | `INFLOW` | `+A` |
| `EXPENSE` | `OUTFLOW` | `−A` |
| `EXTERNAL_OUTFLOW` | `OUTFLOW` | `−A` |
| `REFUND` | `INFLOW` / `OUTFLOW` | `+A` / `−A` |
| `CORRECTION` / `BALANCE_ADJUSTMENT` | agrees with sign | signed non-zero; evidence required |
| `INTERNAL_TRANSFER` | `INTERNAL` | `0` consolidated |

No hidden mutable scalar balance. Each semantic transaction counted **once** in aggregates (internal coalescing).

### 9.2 Derived balances

```
V = { transactions | status = VERIFIED }

accountingCashBalance_micros =
  Σ cash_effect_micros(t) for t in V

activeCommittedFunds_micros =
  Σ amount_micros(c) for commitments c
    where status ∈ {APPROVED, RELEASED}

currentFreeFunds_micros =
  max(0, accountingCashBalance_micros − activeCommittedFunds_micros)
```

`currentFreeFunds` is **not** derived from DETAIL_PUBLIC rows only.

As-of variant for reconciliation: `accountingCashBalanceAt(reconciliationAsOf)` per §5.15.

### 9.3 Public resource flows (must reconcile with cash)

For Breath v1, resource-flow fields derive from VERIFIED **signed cash effects** (consolidated treasury cash), not from contribution-category alone:

```
resources.entered =
  Σ max(cash_effect_micros(t), 0) for t in V

resources.spent =
  Σ max(−cash_effect_micros(t), 0) for t in V

# INTERNAL_TRANSFER contributes 0 to both

resources.remaining =
  resources.entered − resources.spent
  = accountingCashBalance_micros   # exact identity
```

Implications:

- `OPENING_BALANCE` is included in `entered` for the since-inception Breath presentation.
- Positive `BALANCE_ADJUSTMENT` / inbound refunds increase `entered`; negative adjustments / outflows increase `spent`.
- `resources.spent` means **consolidated treasury cash outflow**, not merely `kind=EXPENSE`.
- Contribution-share engine remains separate (§6) and is **not** redefined here.

### 9.4 Breath field formulas

Breath publishes only when:

- `breath_enabled = true`
- ideal annual budget ACTIVE+PUBLIC present
- **no** material unresolved transaction reconciliation (§4)
- latest balance reconciliation satisfies §5.15 publication freshness (`MATCHED`, or explained `PENDING_CONFIRMATIONS` with zero unexplained residual; not stale > 10 minutes; never `UNAVAILABLE`/`MISMATCH`)

Else `status = "pending"` and numeric fields null/empty.

| Field | Rule |
|-------|------|
| `status` | `"published"` iff gates above hold; else `"pending"` |
| `lastUpdatedAt` | max timestamp among authoritative inputs used in the snapshot: VERIFIED transaction changes (`verified_at`/`updated_at`), commitment lifecycle changes, latest balance reconciliation `created_at`, ideal annual budget activation/change, latest runway snapshot `created_at`, funding-need / publication-settings changes. Must not be older than any material input used. |
| `stageLabel` | settings |
| `idealAnnualBudget` | ACTIVE+PUBLIC ideal |
| `resources.entered` / `spent` / `remaining` | §9.3 |
| `resources.allocated` | `activeCommittedFunds` (derived) |
| `resources.neededNext` | primary public funding need: required − derived funded; else null |
| `currentFreeFunds` | from §9.2 |
| `budget.planned` | active public budget planned |
| `budget.funded` | Σ VERIFIED contributions with `budget_id = active_budget` |
| `budget.committed` | Σ active commitments for that budget (`APPROVED`+`RELEASED`) — separate visible field |
| `budget.spent` | Σ VERIFIED expenses with that `budget_id` (and other VERIFIED outflows assigned to the budget per classify rules) |
| `budget.remaining` | `planned − budget.spent − budget.committed` (exact signed API value; **not** clamped; commitments reduce remaining without being falsely recorded as spent) |
| `budget.fillRatio` | `clamp(funded/planned,0,1)` if planned>0 else null |
| `runway.*` | from latest `treasury_runway_snapshots` if ACTIVE plan exists; else pending |
| `recentActivity` | only `detail_publication = DETAIL_PUBLIC` and `status = VERIFIED` (and not SUPERSEDED) |
| `work` / `methodologyNote` | settings; methodology must state `resources.spent` = consolidated cash outflow |

### 9.5 Non-equivalences

| Concept | Definition |
|---------|------------|
| On-chain wallet balance | RPC sum — reconciliation control only |
| `accountingCashBalance` | Σ VERIFIED cash effects (= `resources.remaining`) |
| `activeCommittedFunds` / `resources.allocated` | derived from commitment facts |
| `currentFreeFunds` | accounting cash − active commitments |
| Contribution totals | §6 share engine — separate from resource-flow entered |

---

## 10. Ideal annual budget (FROZEN)

Explicit versioned Human/admin object (§5.8). Gauge continues `currentFreeFunds / idealAnnualBudget`. No visual redesign.

---

## 11. Runway / countdown (FROZEN)

Invalid (removed): `endsAt = now + free/burn` (sliding).

**Deterministic snapshot:**

```
endsAt = runwayAsOf + (freeFundsAtAsOf_micros / approvedDailyBurn_micros) * 1 day
```

Stored on `treasury_runway_snapshots` at creation. Repeated reads with unchanged inputs return the same `endsAt`.

New snapshot when: VERIFIED cash set changes, active commitments change, ACTIVE burn plan changes, or explicit authorized refresh.

If no ACTIVE burn plan → runway pending.

### Required unit tests

- repeated reads → identical `endsAt`
- new VERIFIED inflow → new as-of may extend runway
- VERIFIED spend or new APPROVED commitment → may shorten runway
- no ACTIVE burn → pending

---

## 12. Admin mutation / audit contract (FROZEN)

### Permissions

| Permission | Use |
|------------|-----|
| `admin.treasury.read` | admin reads |
| `admin.treasury.mutate` | drafts, classify, verify (with preconditions), evidence, budgets, needs, attributions, commitments lifecycle, runway drafts, opening/adjustment entries, ledger inception create/approve |
| `admin.treasury.publish` | detail publication, Breath enable, activate PUBLIC ideal, activate runway plan, snapshot refresh |

Platform `admin` receives all three. Every sensitive mutation writes `audit_logs`.

### Backend contracts for DEE-607 (no UI here)

Transaction FSM; detail publication; commitments CRUD/lifecycle; budgets/needs/ideal/runway; evidence; attribution; ledger inception; balance reconciliation view; Breath preview using §9; correction workflow.

Public: `getBreathPublicSnapshot()` server-backed, fail-closed.

---

## 13. Migration + rollback + merge-order gate (FROZEN)

### Plan-time disposition

```
DEE_606_MIGRATION_IDENTITY_DEFERRED_TO_IMPLEMENTATION_PREFLIGHT
```

### Implementation preflight

1. Fetch `origin/main`; read journal tip.
2. Enumerate reserved tags from open migration-bearing PR branches + read-only awareness of DEE-518 `0110–0147`.
3. Allocate collision-free next identities; hand-author SQL + journal per `db/AGENTS.md`.
4. Prove monotonic journal order.
5. Apply **entire** `main + DEE-606` migration history on empty dedicated Postgres (port ≠ 54329).

### Merge-order gate (binding)

Filename collision avoidance alone is insufficient.

**A migration-bearing DEE-606 PR MUST NOT be Human-merged while its migration predecessor assumptions exist only on an unmerged DEE-518 branch.**

Before PR readiness / merge:

- reconcile actual merged journal on `origin/main`
- reconcile still-open migration-bearing branches
- rebase/renumber DEE-606 migrations if required
- prove empty-DB apply of resulting history

If DEE-518 migrations remain unmerged and DEE-606 would create later-numbered migrations that assume those predecessors:

```
DEE_606_MIGRATION_MERGE_BLOCKED_BY_UNMERGED_DEE_518_JOURNAL
```

Do **not** solve by touching DEE-518. Wait for main journal reality, then renumber.

### Rollback

Additive only; forward-fix; disable `breath_enabled` / keep `TREASURY_WATCHER_ENABLED=false`. No destructive DROP in integration PR.

---

## 14. RLS / security / isolation (FROZEN)

App-layer auth primary; targeted RLS deny `authenticated`/`anon` on all `treasury_*`; append-only triggers on observations/revisions; service role only; no browser secrets; publication fail-closed.

**Same-organization composite FK integrity (§5.1d)** is mandatory in addition to RLS.

Release-blocking tests:

- cross-org denial (app + DB FK)
- non-admin denial
- public endpoint never returns internal notes/evidence/admin identities
- aggregates include PRIVATE VERIFIED without leaking detail fields
- material / stale / UNAVAILABLE / MISMATCH reconciliation forces Breath pending
- impossible kind/direction/cash-effect combinations rejected before VERIFIED
- commitments reduce `budget.remaining` without being recorded as spent
- internal transfer coalescing: two observations → one semantic tx → cash effect 0
- inception + opening balance cannot double-count historical transfers

---

## 15. R5-safe DB test topology (FROZEN)

Dedicated compose `docker-compose.postgres-treasury-validate.yml`; project `waia-postgres-treasury-validate`; port **54339**; never 54329; never stop `waia-postgres-validate-1`; no global Docker restart. Plan-time: do not run Postgres tests.

---

## 16. Work packages (dependency order)

### WP-0 — Human architecture approval gate (T3)

**COMPLETE.** Human Architect approved architecture source SHA `82377e4f4869b9bf64f26a9578c2335cdbcb8b15` with token `CONFIRM-DEE-606-ARCHITECTURE-PLAN-82377E4F`. Architect review complete. Human architecture approval complete. `state.status=approved`. Implementation WPs remain incomplete until executed.

### WP-1 — Migration preflight + schema

**COMPLETE.** Dedicated Postgres validation **PASS** on `127.0.0.1:54339` (compose project `waia-postgres-treasury-validate`). Validated implementation SHA `0df1b9698f1af27222c60bfb11191f0cf3f85676`. Evidence sha256 `462bf9d40ae72e425cbec39a70aa93bf1c9ef94623a1b5184eac06eb4bf2ab07`. Empty-DB apply of full branch history (112 migrations, final `0149_treasury_transparency_ledger_rls`); 20 `treasury_*` tables all org-scoped; 18 Treasury enums; watcher checkpoint PK `(organization_id, checkpoint_key)`; RLS 20/80; append-only triggers; 24 same-org composite FKs; 20 CHECKs. Merge-order gate remains **binding** (DEE-518 local journal tip observed `0148_trader_forecast_v2_open_tail_null_bounds_v1`; not merged to main). No watcher enablement. HD-3 remains DEFERRED.

### WP-2 — Domain services

**COMPLETE.** Core-owned `lib/waia-core/treasury/**` domain/services over the validated WP-1 schema. Implementation SHA `44c06089cb01eab95ce1b1f118f6a15bef853f35`. Targeted unit tests **138/138 PASS**. Watcher remains DARK. No HTTP/UI. No schema/migration edits. No `db:generate`. WP-7 contribution engine not consumed (WP-2 primitives only). Inception does **not** seed watcher checkpoints. Merge-order gate remains binding.

### WP-3 — Treasury watcher (DARK)

**COMPLETE.** Starting SHA `afc0b9b270ed104173d84741b7bdcdfdc969f142`. Implementation SHAs `7f0315c4ec7345cad8fd38496521238e9456b9db` (persistence/adapter) and `3ba3d9597ecb632776eb8b36c7594b750d8c2ff5` (cycle/reconciliation). Tests SHA `e611808b6844675756c695c1b0c59c006604c9fb`. Module: `lib/waia-core/treasury/watcher/**` with dedicated `TreasuryWatcherRepository` beside WP-2 `TreasuryRepository`. `TREASURY_WATCHER_ENABLED` defaults **false** and is independent of payment `WATCHER_ENABLED`. Org-scoped `runTreasuryWatcherCycle(context, deps)` requires explicit `OrgContext` and an ACTIVE inception; checkpoint key `TRC-20:treasury` seeds `last_scanned_block = watcher_start_block - 1` once. TronGrid v1 contract-events scanned per `block_number` with fingerprint pagination (no undocumented min/max range; no `only_confirmed=true`). Address-relative observations use frozen idempotency `${network}:${txHash}:${transferIndex}:${watchedAddressId}`; lifecycle UPDATE uses 0150 fields `confirmations_observed` + `observation_status` only. Watcher-origin semantic txs are `WATCHER` / `PRIVATE` / `NEEDS_REVIEW` with kind null; internal A→B is two observations + one semantic INTERNAL tx with deterministic PRIMARY / INTERNAL_COUNTERPARTY roles. Reorg age-out DROPPED reopens linked txs to `RECONCILIATION_REQUIRED`. Historical chain balance is **unsupported** on the Tron adapter → reconciliation `UNAVAILABLE` unless a test adapter proves block-bound balances. Targeted WP-3 tests **36/36 PASS**; WP-2 regression **138/138 PASS**; typecheck PASS; lint PASS; `git diff --check` clean; schema/migration/journal unchanged; `db:generate` not run; production watcher not enabled; payment-watcher files unmodified. Merge-order gate remains binding; WP-9 final migration reconciliation retained. Watcher remains DARK.

### WP-4 — Admin backend HTTP contracts

**COMPLETE.** Starting SHA `6f3c8b2bd457706f33afd7466dc54907ee649e75`. Implementation SHAs `f7fcace832be58b012bbfa2f94497b044f4ebec4` (permissions + generic admin HTTP extraction + money/error/Breath port) and `095f35a6d2873c597e9e8de60f373e1d1575030c` (Core `/api/admin/treasury/**` resource/mutation contracts). Tests SHA `0e97dd134ceb5fc76e16975492ad3c5ed2a3581a`.

Core-owned admin HTTP root is `/api/admin/treasury/**` (not `/api/trader/admin/**`). Generic admin primitives live in `lib/waia-core/permissions/admin-http.ts` with compatibility re-exports from `lib/trader/admin-route-*`. Frozen permissions `admin.treasury.read` / `admin.treasury.mutate` / `admin.treasury.publish` are granted to platform `admin` only. Every operation requires explicit `organization_id` (never personal org / Trader Org-0 / watcher config / hard-coded UUID). SQLite production runtime fails closed `503 TREASURY_BACKEND_UNAVAILABLE`. Authoritative money is decimal-string bigint on the wire; serializers never use `Number(bigint)`. Transaction/commitment/inception HTTP handlers call existing domain services (no FSM reimplementation). `setDetailPublication` and other public-exposure mutations require `admin.treasury.publish`. WATCHER verify preconditions survive HTTP (no force/skip flags). Creating watched addresses does not enable the watcher; there is no `TREASURY_WATCHER_ENABLED` API. Budgets/funding needs reject caller-maintained funded/committed/spent/remaining aggregates. Ideal amount and runway daily burn require explicit Human input; WP-4 creates no runway snapshots and no `endsAt` formula. Evidence upload/create-object fails closed `EVIDENCE_STORAGE_NOT_CONFIGURED` (HD-3 still DEFERRED). Admin Breath preview fails closed `TREASURY_BREATH_READ_MODEL_NOT_READY` with no invented numeric fields; `getBreathPublicSnapshot` computation is **not** implemented; no public Treasury HTTP endpoint; no UI. Shared `audit_logs` preserved. Targeted WP-4 tests **27/27 PASS**; WP-3 regression **36/36 PASS**; WP-2 regression **138/138 PASS**; permission/admin-route regression PASS; typecheck PASS; lint PASS; `git diff --check` clean; schema/migration/journal unchanged; `db:generate` not run; watcher remains DARK. Merge-order gate remains binding; WP-9 final migration reconciliation retained.

**WP-6 boundary (historical):** WP-4 left `TreasuryBreathReadModelPort` unready. WP-6 replaced that placeholder with the live read model. `WP4_BREATH_PUBLIC_SNAPSHOT_IMPLEMENTED` remains `false` as a historical flag.

### WP-5 — Evidence storage adapter

**COMPLETE.** HD-3 remains `APPROVED_ARCHITECTURE_ONLY` (Human token `CONFIRM-DEE-606-HD3-R2-ARCHITECTURE-ONLY-NO-PRODUCTION-PROVISIONING`; approval-recording SHA `bf42267ae41cf50758010585ef6b96bb0ed85df5`). WP-5 starting SHA `6fcbe1faece1b3812ce9d9e03b22ef3f99fe5d79`. Implementation SHAs `c4cfcb05bb109fb8e8452bb03f425355d075eef0` (immutable R2 adapter), `ec318601068d9a6b3d143d4da6c609245907ad4c` (server-mediated content contracts). Tests SHA `233db89040481ac9cd4d2ba29eb060918f4748ca`.

Core-owned storage port `TreasuryEvidenceStorage` lives under `lib/waia-core/treasury/evidence/**` (`putImmutable` / `get` / `head` / `compensateUncommittedPut` only). R2 adapter `createR2TreasuryEvidenceStorage` uses Worker-binding semantics against a minimal R2-like interface (no S3 credentials). Intended future binding name `TREASURY_EVIDENCE_R2` is **not** registered. `resolveTreasuryEvidenceStorage()` returns unavailable unless tests/fixtures inject storage. Production evidence create/upload/content remains `EVIDENCE_STORAGE_NOT_CONFIGURED` until a later Human ops gate.

Object key is server-derived `treasury-evidence/v1/{organizationId}/{evidenceObjectId}` (UUIDs normalized; no filename/email/purpose/user text). Immutable PUT uses conditional `onlyIf.etagDoesNotMatch: "*"` (`If-None-Match: *`); existing key → `EVIDENCE_OBJECT_EXISTS`. SHA-256 is hashed from actual uploaded bytes (lowercase hex); the same digest is supplied as the R2 integrity option and stored in `treasury_evidence_objects.sha256`. `byteSize` is derived from actual bytes. R2 custom metadata is limited to `schemaVersion`, `organizationId`, `evidenceObjectId`, `sha256`. `storageBackend` is `cloudflare-r2`. No public URL is stored. `visibility=PUBLIC` does not expose the R2 object and does not change transaction `detail_publication`.

Upload: `POST /api/admin/treasury/evidence` `multipart/form-data` (existing Core route; JSON visibility updates preserved). ADMIN_ONLY upload requires `admin.treasury.mutate`; PUBLIC upload/visibility requires `admin.treasury.publish`; metadata/content read requires `admin.treasury.read`. Content: `GET /api/admin/treasury/evidence/[id]/content` with explicit `organization_id`; `Cache-Control: private, no-store`; `X-Content-Type-Options: nosniff`; `Content-Disposition: attachment` (server filename, not user filename). No public/anonymous evidence route. No presigned URLs. No committed-object DELETE API. Unlink does not delete the object. Registration failure after PUT compensates only that invocation's uncommitted key; compensation never deletes pre-existing or successfully registered objects. Named safety limit `TREASURY_EVIDENCE_MAX_UPLOAD_BYTES` = 10 MiB (technical, not product doctrine).

Missing R2 affects only evidence-content operations. Transactions, commitments, watcher config, payment watcher, Trader admin, and ordinary runtime initialization do not require R2. `wrangler.jsonc` unchanged (no `r2_buckets`). No bucket created. No Cloudflare mutation. No deploy. Watcher remains DARK. Schema/migrations/journal unchanged; `db:generate` not run.

WP-5 targeted tests **11/11 PASS**. WP-4 regression **27/27 PASS**. WP-3 regression **36/36 PASS**. WP-2 regression **138/138 PASS**. Permission/admin-route regression PASS. typecheck PASS. lint PASS. `git diff --check` clean. Merge-order gate remains binding; WP-9 final migration reconciliation retained.

### WP-6 — Breath read model + runway snapshots

**COMPLETE.** Starting SHA `2ec87b739e3f3949d52def1ea68a9a35f0ccefcf`. Implementation SHAs `a719d2624d1958bc65bf60d550c8e97d3cbea66b` (canonical read model + unpaginated facts repository + deterministic runway snapshots) and `8086c749f0763122766bc2254a36e871a39c7ba9` (admin Breath preview + `refresh_snapshot` + server-side `getBreathPublicSnapshot`). Tests SHA `01fa23cea4596dba45707d74b30bb78c76f7f429`.

Module: `lib/waia-core/treasury/breath/**` (`types`, `repository.types`, `memory-repository`, `postgres-repository`, `accounting`, `publication-gates`, `runway`, `read-model`, `public-snapshot`, `index`). Dedicated Breath facts repository loads complete org-scoped sets. `TreasuryRepository.listTransactions(context, query)` remains an admin listing primitive (default 50) and is **not** used as financial truth. Memory loads via `listTransactions(context)` with no query; Postgres Breath queries have no hidden `LIMIT 50`.

Canonical accounting (exact BigInt, VERIFIED set `V` complete): `accountingCashBalance = Σ cashEffectMicros(t)`; `entered = Σ max(effect, 0)`; `spent = Σ max(-effect, 0)`; `remaining = entered - spent` with identity `remaining === accountingCashBalance`. INTERNAL_TRANSFER contributes 0/0; OPENING_BALANCE is entered; signed adjustments/refunds follow cash-effect sign. PRIVATE+VERIFIED counts in aggregates; DETAIL_PUBLIC does not change totals; non-VERIFIED excluded. Null/incomplete VERIFIED `cashEffectMicros` fails closed (`VERIFIED_FINANCIAL_ROW_INCOMPLETE`); missing cash effect is never treated as zero. Values above `Number.MAX_SAFE_INTEGER` remain exact bigint.

Active committed funds = Σ `amountMicros` for `APPROVED`/`RELEASED` only (DRAFT/FULFILLED/CANCELLED excluded). `resources.allocated = activeCommittedFunds`. `currentFreeFunds = max(0, accountingCashBalance - activeCommittedFunds)`. No mutable committed scalar.

Budget candidate: `ACTIVE` + `isPublic` + current date in `periodStart..periodEnd`. Zero → budget null; one → derive; multiple → do not choose arbitrarily (`ACTIVE_PUBLIC_BUDGET_AMBIGUOUS`, not a global publication gate). Formulas: `planned = plannedAmountMicros`; `funded = Σ VERIFIED CONTRIBUTION accountingAmountMicros` assigned to the budget (PRIVATE VERIFIED still funds); `committed = APPROVED+RELEASED` for the budget; `spent = magnitude of negative VERIFIED cash effects assigned to the budget` (not only `EXPENSE`); `remaining = planned - spent - committed` (signed, not clamped); `fillRatio = clamp(funded/planned, 0, 1)` via `BREATH_FILL_RATIO_SCALE = 1_000_000n` (6 decimal display places) then convert only the bounded 0..1 display number. Display-only; never accounting authority.

Funding need: eligible public `OPEN`/`PARTIALLY_FUNDED`. Exactly one → `neededNext = requiredAmountMicros - Σ VERIFIED CONTRIBUTION accountingAmountMicros` for that need. None or multiple → `neededNext = null` (multiple also `PUBLIC_FUNDING_NEED_AMBIGUOUS`). No caller-maintained funded scalar. No invented priority. WP-7 contribution-share engine not consumed.

Material unresolved reconciliation: any `RECONCILIATION_REQUIRED` row with known non-zero cash effect, or whose cash impact cannot be proven zero, is material. Proven cash-neutral INTERNAL_TRANSFER (`cashEffectMicros === 0n`) is non-material. Material → global pending, financial numerics null.

Balance reconciliation: latest by `createdAt` DESC then id (newer bad recon cannot be bypassed by older good). Scope: latest recon `ledgerInceptionId` must equal the org’s unique ACTIVE inception; otherwise `BALANCE_RECONCILIATION_SCOPE_INVALID`. Stale iff age **> 10 minutes**; exactly 10 minutes is not stale (`BREATH_RECON_MAX_AGE_MS = 600_000`). MATCHED accepted only when internally consistent (`toleranceMicros === 0n`, `deltaMicros === 0n`, `unexplainedResidualMicros === 0n`, amounts present, `delta === observed - accounting`). PENDING_CONFIRMATIONS accepted only when residual is 0, `deltaMicros === explainedPendingMicros`, and `toleranceMicros === 0n`. Always pending: UNAVAILABLE, MISMATCH, missing, stale, scope-invalid. Breath does not RPC for a fresher balance.

Global published iff: `breath_enabled`; exactly one currently applicable ACTIVE+PUBLIC ideal annual budget; no material unresolved tx reconciliation; latest balance recon passes the freshness/control gate. Otherwise `status = pending` and financial numeric fields null. Runway availability is **not** a global gate. HD-4 remains DEFERRED; WP-6 invents no ideal amount/year and creates no production data.

`lastUpdatedAt` is the max of authoritative inputs actually used (VERIFIED `verifiedAt`/`updatedAt`, active commitment `updatedAt`, latest recon `createdAt`, ideal `createdAt` plus ideal create/publish audit times, used public budget `updatedAt`, used funding need `updatedAt`, settings `updatedAt`, runway snapshot `createdAt`). Never `now()`. Null if no timestamp exists.

recentActivity: VERIFIED + DETAIL_PUBLIC, SUPERSEDED excluded, `occurredAt DESC` then id, honor `recentActivityLimit`. Public whitelist only (no internalNotes, actor IDs, evidence keys, attribution identity). `counterpartyDisplay` only if `publishCounterparty`. Pending financial snapshot may still expose independent public detail. Public DTO never includes privileged DB/internal fields. Admin preview (`admin.treasury.read`) adds `pendingReasons` / `componentStatus` / `reconciliationGate` / `runwayStatus` and does not mutate facts.

Runway: eligible ACTIVE plan with `dailyBurnMicros > 0` currently effective. None → runway pending, no snapshot. Multiple → pending + `ACTIVE_RUNWAY_PLAN_AMBIGUOUS`. Snapshot table `treasury_runway_snapshots` (no migration). `inputDigest` is SHA-256 of the sorted VERIFIED cash set, active commitments, ACTIVE plan, and derived freeFunds (not request time). Unchanged reads return the same snapshot id / `runwayAsOf` / `endsAt`. Integer-ms floor: `durationMs = (freeFunds * DAY_MS) / burn` with `DAY_MS = 86_400_000n`; Date overflow → `RUNWAY_DATE_OUT_OF_RANGE`. Memory per-org mutex and Postgres `pg_advisory_xact_lock` + re-read before insert. Explicit `POST .../runway-plans/commands` `refresh_snapshot` requires `admin.treasury.publish`, Human actor, reason; rejects caller freeFunds/burn/endsAt/inputDigest; may create a fresh snapshot with unchanged digest; audited `treasury.runway.snapshot_refresh`. Auto-materialization is derived, not Human approval.

`getBreathPublicSnapshot(context, readModel)` is server-side under Core Treasury; requires explicit OrgContext; no anonymous `/api/treasury`, `/api/public/treasury`, or `/api/breath` route; no UI; no browser DB; no R2 dependency; production evidence storage can remain `EVIDENCE_STORAGE_NOT_CONFIGURED`. Unexpected control failure returns pending, never hardcoded financial fallbacks.

WP-6 targeted tests **9/9 PASS** (grouped coverage of numbered invariants 1–115). WP-5 regression **11/11 PASS**. WP-4 regression **27/27 PASS**. WP-3 regression **36/36 PASS**. WP-2 regression **138/138 PASS**. Admin/permission regression PASS. typecheck PASS. lint PASS. `git diff --check` clean. Schema/migrations/journal unchanged; `db:generate` not run; production state not mutated; `wrangler.jsonc` unchanged; production R2 provisioning still **NOT AUTHORIZED**; watcher DARK. Merge-order gate remains binding; WP-9 final migration reconciliation retained. PR not opened. WP-7 not started.

**nextAction:** WP-7 Contribution Share Engine may be prepared next. Do not start WP-7 in this closeout.

### WP-7 — Contribution share engine

**COMPLETE.** Starting SHA `aa08798c0c7b2d1d627c228eb750b0f91cf0c540`. Implementation SHAs `6408e8dfbf4e079671d762ac4830bd74ccc9f5c7` (exact §6 engine + unpaginated facts repository + WP-2 primitive correction) and `05d39d0d3d5fbd9091d6c1018f05ca3442b6c7d0` (aggregate-only public + authenticated self-only server contracts). Tests SHA `ea4c489416af417446ea0269ae91ba00e2945880`.

Module: `lib/waia-core/treasury/share/**` (`types`, `repository.types`, `memory-repository`, `postgres-repository`, `engine`, `public-aggregate`, `self-share`, `index`). Corrected primitives remain in `lib/waia-core/treasury/contribution-share.ts`. Dedicated contribution-share facts repository loads the complete org-scoped transaction set plus current attributions. `TreasuryRepository.listTransactions(context, query)` remains an admin listing primitive (default 50) and is **not** used as share truth. Memory loads via `listTransactions(context)` with no query; Postgres share queries have no hidden `LIMIT`.

Qualifying set **Q** requires all of: `kind = CONTRIBUTION`, `direction = INFLOW`, `status = VERIFIED`, not under a material unresolved reconciliation that invalidates the contribution, approved v1 asset = **USDT TRC-20**, `accountingAmountMicros IS NOT NULL`, `accountingDenominationPolicy = USDT_NOMINAL_USD_POLICY_V1`. WATCHER rows require `canonicalNetwork = TREASURY_USDT_V1_NETWORK` and `canonicalTokenContract = TREASURY_USDT_V1_TOKEN_CONTRACT` (`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, same identity as `USDT_TRC20_CONTRACT`). MANUAL rows require `nativeContract` equal to that canonical contract. USDT + 6 decimals + policy is necessary but not sufficient; Ethereum/other-network USDT does not qualify.

Net contribution = base qualifying `accountingAmountMicros` + direct linked **VERIFIED** `REFUND`/`CORRECTION` `cashEffectMicros` via `correctsTransactionId`. Direct linkage only (no recursive graphs). `BALANCE_ADJUSTMENT` does **not** alter historical contribution share. VERIFIED linked refund/correction with `cashEffectMicros = null` fails closed (`SHARE_ADJUSTMENT_INCOMPLETE`). Contribution `RECONCILIATION_REQUIRED` is outside Q. A directly-linked `RECONCILIATION_REQUIRED` refund/correction excludes that contribution from Q (does not silently keep unadjusted net).

Share: `numerator(user) = Σ netMicros(c)` for `c` in Q with current open `ATTRIBUTED` attribution to that authenticated user; `denominator = Σ netMicros(c)` for **all** `c` in Q. Denominator includes ATTRIBUTED, UNMATCHED, ANONYMOUS, and unattributed qualifying rows. Only the current open attribution (`revoked_at IS NULL`) counts; historical revoked rows do not win; reassignment moves numerator to the current ATTRIBUTED user; multiple open rows fail closed (`ATTRIBUTION_OPEN_AMBIGUOUS`). `consentPublicIdentity` does not affect math and does not publish identity. Expenses, ordinary outflows, commitments, runway, budget, Breath cash, and detail publication do not dilute. PRIVATE+VERIFIED still qualifies. Exact BigInt numerator/denominator as decimal strings; `denominator <= 0` → zero share. No persisted percentage scalar. No equity/ownership/governance field names.

`getPublicContributionAggregate(context, engine)` is aggregate-only (HD-2): `totalNetContributionMicros`, `qualifyingContributionCount`, `lastUpdatedAt` derived from used facts (never `now()`). No user ids, names, emails, transaction ids, attribution ids, contributor lists, or leaderboards. `getSelfContributionShare(context, authenticatedUserId, engine)` returns only that user's numerator over the global denominator. No anonymous HTTP route. No UI. No Breath formula changes. No R2 dependency. Watcher remains DARK. Production R2 provisioning still **NOT AUTHORIZED**. Schema/migrations/journal unchanged; `db:generate` not run.

WP-7 targeted tests **7/7 PASS** (grouped coverage of numbered invariants 1–85). WP-6 regression **9/9 PASS**. WP-5 regression **11/11 PASS**. WP-4 regression **27/27 PASS**. WP-3 regression **36/36 PASS**. WP-2 regression **140/140 PASS** (`treasury-contribution-share` 7 tests, was 5; +2 frozen-contract regressions for `BALANCE_ADJUSTMENT` exclusion and TRC-20 identity). typecheck PASS. lint PASS. `git diff --check` clean. Production state not mutated. PR not opened. Merge-order gate remains binding; WP-9 final migration reconciliation retained. WP-8 not started.

**nextAction:** WP-8 Isolation + R5-safe Postgres Tests may be prepared next. Do not start WP-8 in this closeout.

#### WP-7 post-closeout correction — public aggregate privacy / timestamp

**COMPLETE.** Defect `PUBLIC_AGGREGATE_ATTRIBUTION_TIMESTAMP_AND_READ_LEAKAGE`. Starting SHA `5b9fc773e1408a2137cf6c5e7392fe9793590d22`. Correction SHA `3fb6c4ac03f478bc47f6840b4df1238accd1ef97`. Frozen §6 mathematics unchanged.

Public aggregate `lastUpdatedAt` is now derived only from qualifying contribution `verifiedAt`/`updatedAt` and included VERIFIED REFUND/CORRECTION `verifiedAt`/`updatedAt`. Attribution create/reassign/revoke/`consentPublicIdentity` cannot change public totals, count, or timestamp. `computePublicAggregate` loads `loadContributionFacts` only and does not query `treasury_contribution_attributions` or read `contributorUserId`. Self-share still loads current-open attribution and retains attribution lifecycle timestamps. Facts port split: `loadContributionFacts` / `loadAttributionFacts`. Schema/migrations unchanged. Production unchanged. WP-8 was **NOT_STARTED** at this correction closeout.

WP-7 targeted tests **9/9 PASS** (was 7/7; +2 public-aggregate privacy/timestamp regressions). WP-6 **9/9**. WP-5 **11/11**. WP-4 **27/27**. WP-3 **36/36**. WP-2 **140/140**. typecheck PASS. lint PASS. `git diff --check` clean. PR not opened.

### WP-8 — Isolation + R5-safe Postgres tests

**COMPLETE.** Starting SHA `3728aea04ba70f59ffd0441944c4fb657d282d6e`. Test implementation SHA `ca8227fce3b588e6aae48e6d7367922ac20adeae`. Bounded correction SHA / validated SHA `a91ec2c0e8cb87ffa3896064f2416177b0e0f47b`.

Dedicated topology only: compose `docker-compose.postgres-treasury-validate.yml`, project `waia-postgres-treasury-validate`, container `waia-postgres-treasury-validate-postgres-validate-1`, host `127.0.0.1:54339`, database/user `waia_treasury_validate`. Empty dedicated DB proven (`treasury_*` = 0) then full current-branch Postgres history applied: **113** migrations, journal tip `0150_treasury_chain_observations_lifecycle_guard` hash `94ec107fe156de9efd8a87a9ba6fdab4476ce4b566970c9df9b3d58c5932fd1b`, monotonic 0148 < 0149 < 0150, Postgres **16.14**. Live inventory: 20 treasury tables, 18 treasury enums, RLS on 20 tables / 80 policies, 24 same-org composite FKs, 20 CHECKs, 6 treasury triggers. `anon` and `authenticated` denied on treasury rows. Port **54329** / `waia-postgres-validate-1` / project `waia` untouched (`StartedAt` `2026-08-13T07:32:07.443644672Z` unchanged).

App-layer ORG_A/ORG_B isolation PASS on real Postgres repositories. Live same-org FK negative inserts reject cross-org references. Observation 0150 lifecycle UPDATE allowed; immutable facts / DELETE rejected. Transaction and commitment revisions append-only (UPDATE/DELETE rejected). Impossible kind/direction/cash-effect combinations rejected. Watcher-origin VERIFY: zero-link reject, unconfirmed reject, all-confirmed Human path PASS. PRIVATE VERIFIED included in Breath aggregates; PRIVATE detail not leaked; DETAIL_PUBLIC recent activity allowed; non-VERIFIED excluded. >50 VERIFIED Breath facts untruncated; BigInt > `Number.MAX_SAFE_INTEGER` exact; `remaining === accountingCashBalance`. Active commitments = APPROVED+RELEASED; commitment reduces `budget.remaining` without becoming spent. Internal A→B: two observations, one semantic tx, cash effect 0 after INTERNAL_TRANSFER verify, replay idempotent. Inception checkpoint seeds `watcherStartBlock - 1`; pre-start historical transfers not ingested; post-start eligible. Reconciliation: latest wins; MATCHED exact; PENDING_CONFIRMATIONS fully explained; MISMATCH/UNAVAILABLE/stale>10m/scope mismatch pending; exactly 10m not stale; as-of later-fact exclusion. Contribution share >50 untruncated, cross-org isolated, public aggregate does not read attribution table. Evidence metadata isolated without R2. Breath does not require R2. Watcher remains DARK. Production R2 provisioning **NOT AUTHORIZED**.

Bounded same-scope correction (no schema/migration): `tryAcquireLease` Date interpolation into drizzle `sql` rejected by postgres.js; replaced with drizzle timestamp comparisons.

WP-8 dedicated Postgres suite **16/16 PASS**. WP-7 **9/9**. WP-6 **9/9**. WP-5 **11/11**. WP-4 **27/27**. WP-3 **36/36**. WP-2 **140/140**. typecheck PASS. lint PASS. `git diff --check` clean. Schema/migrations/journal unchanged; `db:generate` not run; production state not mutated. Evidence: `/tmp/dee606-wp8-postgres-isolation-a91ec2c0e8cb87ffa3896064f2416177b0e0f47b.log` sha256 `8fa2783b912942d3c82c6419a9ae410411c31b0dfb40234576bffa69956de3df`.

`migrationMergeOrderGate` remains **BINDING**. DEE-518 PR #458 still OPEN/unmerged at WP-8 (`1230c7d7962b560678cea08cd9eae01609c551f4`). WP-8 does **not** mean merge-ready. WP-9 owns final origin/main + DEE-518 + 0148/0149/0150 journal reconciliation. PR not opened. WP-9 not started.

**nextAction:** WP-9 PR Readiness may be prepared next. Do not start WP-9 in this closeout.

Success marker: `DEE_606_WP8_R5_SAFE_POSTGRES_ISOLATION_PASS_WP8_COMPLETE_READY_FOR_WP9`

Historical note: WP-8 validated **pre-reconciliation** identities `0148`/`0149`/`0150` Treasury (113 migrations on this branch before DEE-518 landed on main). Do not rewrite that evidence as if it used `0149`/`0150`/`0151`.

### WP-9 — Final migration reconciliation + PR readiness

**COMPLETE.** Starting branch SHA `86cead6f7a31363b4d6b15c705fd1d54141b062a`. Merged `origin/main` `7c8cf38f118d852d6e766ec23ea92322bedee2d4` (DEE-518 PR #458 Human squash). Branch sync: **`git merge --no-edit origin/main`** (not rebase) → merge SHA `5f3cd44dab845dbd1805bdba66d9a3f603d6ec6a`.

Main predecessor tip at reconciliation: idx 148 / `0148_trader_forecast_v2_open_tail_null_bounds_v1` (149 journal entries, idx 0..148). No other open migration-bearing PRs.

Identity mapping (executable SQL bytes identical):

| Pre-reconciliation (WP-1/WP-8 historical) | Final (WP-9) | SHA-256 |
|---|---|---|
| `0148_treasury_transparency_ledger_foundation` | `0149_treasury_transparency_ledger_foundation` | `31f3a80e7e3b90db10795147a49e5e3f32bde89bbb96b464380a8dd7b34bbb58` |
| `0149_treasury_transparency_ledger_rls` | `0150_treasury_transparency_ledger_rls` | `e5edb01a2b95c6a1a3696974f3d94ae6769333585ee8a4a9d31b196880fdedf0` |
| `0150_treasury_chain_observations_lifecycle_guard` | `0151_treasury_chain_observations_lifecycle_guard` | `94ec107fe156de9efd8a87a9ba6fdab4476ce4b566970c9df9b3d58c5932fd1b` |

Final journal: **152** entries, idx 0..151, tip `0151_treasury_chain_observations_lifecycle_guard`, `when` 1780000000149..0151 after main 0148. First 149 entries identical to merged main. `migrationMergeOrderGate` = **RESOLVED**.

Dedicated empty-DB apply PASS (`docker-compose.postgres-treasury-validate.yml`, `127.0.0.1:54339`, Postgres 16.14): 152 applied; Treasury 20 tables / 18 enums / RLS 20/80 / 24 same-org FKs / 20 CHECKs / 6 triggers; DEE-518 forecast/pattern tables present. 54329 / `waia-postgres-validate-1` untouched.

WP-8 rerun **16/16 PASS**. WP-7 **9/9**. WP-6 **9/9**. WP-5 **11/11**. WP-4 **27/27**. WP-3 **36/36**. WP-2 **140/140**. lint PASS. typecheck PASS. build PASS. `git diff --check` clean. Watcher DARK. Production R2 **NOT AUTHORIZED**. `db:generate` not run. No new Treasury schema semantics. Evidence: `/tmp/dee606-wp9-postgres-reconciliation-4a0eeb1d439f696f9d9805060fed6cefc0a308fc.log` sha256 `9d9a89a8689708f1096c5156a5d054e7601d189875d97f1221b62f34be781904`.

Validated SHA `4a0eeb1d439f696f9d9805060fed6cefc0a308fc`. Rename SHA `7e6b152dd228d0b4d7932c8b8549056969ab606c`. Journal SHA `d83caae99769227222be940684622bdbd1ce623f`.

**nextAction:** Open exactly one PR to `main`. Human squash-merge only. Agent must not merge.

Markers: `DEE_606_WP9_MIGRATION_RECONCILIATION_PASS` · `DEE_606_WP9_LOCAL_PR_READINESS_PASS`

---

## 17. Validation matrix

| Gate | Check | When |
|------|-------|------|
| Architect review + Human architecture approval | T3 gates | before implement |
| lint / typecheck / build | pnpm | PR readiness |
| Unit: FSM, verify precondition, cash equation, resource identity, budget.remaining, commitments, runway as-of, share, recon as-of/freshness, internal coalescing, inception | targeted | WP-2/3/6/7/8 |
| Postgres isolation + same-org FK on :54339 | dedicated compose | WP-8 |
| Empty-DB migration apply main+DEE-606 | §13 | WP-9 PASS (152 / tip 0151) |
| Merge-order gate vs DEE-518 | §13 | WP-9 **RESOLVED** (PR #458 squash `7c8cf38`) |
| E2E | DEE-607 owns admin e2e | — |
| Governance preflight | prepare-pr | later |

---

## 18. Acceptance criteria traceability (Linear DEE-606)

| Linear AC | Coverage |
|-----------|----------|
| Idempotent watcher ingest; unpublished details until approved; evidence; public row only after detail approval | §§4,7,8,9 |
| Manual provenance/audit | §§4,5,12 |
| Budget/funding totals reconcile from ledger + commitment facts | §§5.7,5.14,9 |
| Breath contract without privileged DB access | §9 WP-6 |
| Audit + isolation tests | §§14–15,17 |
| Domain ownership before migration | §1 |
| Schema + state machines | §§4–5 |
| Watcher idempotency + verify precondition + internal coalescing + inception | §§5.1c,5.5b,7 |
| Contribution map data truth | §6 |
| Migration + merge-order safety | §13 |
| Temporally exact recon + freshness | §5.15 |
| Resource entered/spent/remaining identity | §9.3 |

---

## 19. Out of scope

- DEE-607 UI; DEE-611 copy; DEE-612/613 doctrine publication / solidarity workflows
- AI-TRADER execution/risk/research/capital/billing changes
- Homepage visual redesign
- Invented figures; equity/governance from contribution %
- Custody/signing/disbursement automation
- Multi-chain beyond USDT TRC-20
- Historical-burn runway
- Touching DEE-518 / R5 / 54329 / Execution Server / WF_ECONOMIC / BLIND_HOLDOUT
- Creating migrations or opening/merging PR during plan phase
- Enabling `TREASURY_WATCHER_ENABLED` in production without later Human ops gate

---

## 20. Human decisions (revised)

| ID | Decision | Disposition (Human 2026-08-12) | Blocks |
|----|----------|--------------------------------|--------|
| **HD-1** | Platform treasury tenant | **APPROVED.** Use/create a dedicated Core organization for **WAIA Platform Treasury**. Do **not** reuse AI-Trader Org-0. Exact org creation/ID resolution remains WP-1 implementation precondition. | WP-1 seed |
| **HD-2** | Public contribution disclosure | **APPROVED.** v1: aggregate-only; no public contributor identity list; authenticated self-only contribution share may be supported; contributor identity remains private unless separately approved later. | DEE-611 honesty |
| **HD-3** | Evidence object storage | **APPROVED_ARCHITECTURE_ONLY** (Human 2026-08-13). Token `CONFIRM-DEE-606-HD3-R2-ARCHITECTURE-ONLY-NO-PRODUCTION-PROVISIONING`. Architecture: private Cloudflare R2, Worker-side access only, intended binding `TREASURY_EVIDENCE_R2`, no S3 credentials, no presigned URLs, no r2.dev, no custom-domain exposure, server-mediated admin upload/download only, deterministic opaque object keys, immutable after successful registration. Production bucket creation, wrangler.jsonc R2 binding, Cloudflare control-plane mutation, and deploy remain **NOT AUTHORIZED**. | WP-5 production uploads remain ops-gated; WP-5 **code** is now authorized |
| **HD-4** | Initial ideal annual budget amount/year | **DEFERRED.** Intentionally not chosen yet. Do not invent a value. Does not block schema/domain implementation. Blocks Breath pending→published financial figures if ideal budget is required by the publication contract. | Breath published status |
| **HD-5** | Initial ACTIVE runway daily burn | **APPROVED DEFAULT.** Runway remains pending until the Human explicitly approves an ACTIVE planned daily burn. Do not infer burn from historical expenses. | runway fields |
| ~~HD-6~~ | ~~manual committed scalar~~ | **REMOVED.** Commitment facts + derived totals are mandatory. | — |
| **HD-7** | Production watcher enablement | **APPROVED.** Architecture and code ship with `TREASURY_WATCHER_ENABLED=false` (DARK). Production enablement requires a separate explicit Human operational gate after implementation/merge/readiness. | ops after merge |

### Human architecture approval record

| Field | Value |
|-------|--------|
| Approval token | `CONFIRM-DEE-606-ARCHITECTURE-PLAN-82377E4F` |
| Approved architecture source SHA | `82377e4f4869b9bf64f26a9578c2335cdbcb8b15` |
| Architect review | COMPLETE |
| Human architecture approval | COMPLETE |
| Plan `state.status` | `approved` |
| WP-0 | COMPLETE |
| WP-1 | COMPLETE (`DEDICATED_POSTGRES_VALIDATION_PASS` on `:54339`) |
| WP-2 | COMPLETE (domain services; implementation SHA `44c06089cb01eab95ce1b1f118f6a15bef853f35`; 138 targeted tests) |
| Current work package | none — WP-0..WP-9 COMPLETE; Human squash-merge of the DEE-606 PR remains |
| WP-8 | COMPLETE (historical pre-reconciliation identities 0148/0149/0150 Treasury; 113 migrations / tip 0150; 16/16; merge-order was BINDING at WP-8 closeout) |
| WP-9 | COMPLETE (merge `origin/main` `7c8cf38`; Treasury identities 0149/0150/0151; 152 migrations / tip 0151; SQL bytes identical; WP-8 rerun 16/16; lint/typecheck/build PASS; merge-order **RESOLVED**) |
| WP-7 | COMPLETE (exact contribution share engine; starting SHA `aa08798c0c7b2d1d627c228eb750b0f91cf0c540`; implementation SHAs `6408e8dfbf4e079671d762ac4830bd74ccc9f5c7`, `05d39d0d3d5fbd9091d6c1018f05ca3442b6c7d0`; tests `ea4c489416af417446ea0269ae91ba00e2945880`; 7/7 WP-7 grouped invariants + 9/9 WP-6 + 11/11 WP-5 + 27/27 WP-4 + 36/36 WP-3 + 140/140 WP-2; aggregate-only public; self-only; no HTTP; no UI; no R2; schema unchanged) |
| WP-6 | COMPLETE (Breath read model + deterministic runway snapshots; starting SHA `2ec87b739e3f3949d52def1ea68a9a35f0ccefcf`; implementation SHAs `a719d2624d1958bc65bf60d550c8e97d3cbea66b`, `8086c749f0763122766bc2254a36e871a39c7ba9`; tests `01fa23cea4596dba45707d74b30bb78c76f7f429`; 9/9 WP-6 grouped invariants + 11/11 WP-5 + 27/27 WP-4 + 36/36 WP-3 + 138/138 WP-2; no public HTTP; no UI; no R2; schema unchanged) |
| WP-5 | COMPLETE (private R2 adapter code; starting SHA `6fcbe1faece1b3812ce9d9e03b22ef3f99fe5d79`; HD-3 recording `bf42267ae41cf50758010585ef6b96bb0ed85df5`; implementation SHAs `c4cfcb05bb109fb8e8452bb03f425355d075eef0`, `ec318601068d9a6b3d143d4da6c609245907ad4c`; tests `233db89040481ac9cd4d2ba29eb060918f4748ca`; 11/11 WP-5 + 27/27 WP-4 + 36/36 WP-3 + 138/138 WP-2; wrangler.jsonc unchanged; production storage unavailable; no bucket/binding/deploy) |
| WP-4 | COMPLETE (Core `/api/admin/treasury/**`; starting SHA `6f3c8b2bd457706f33afd7466dc54907ee649e75`; implementation SHAs `f7fcace832be58b012bbfa2f94497b044f4ebec4`, `095f35a6d2873c597e9e8de60f373e1d1575030c`; tests `0e97dd134ceb5fc76e16975492ad3c5ed2a3581a`; 27/27 WP-4 + 36/36 WP-3 + 138/138 WP-2; no UI; no public Breath; HD-3 DEFERRED; schema unchanged) |
| WP-3 | COMPLETE (DARK watcher; implementation SHAs `7f0315c4ec7345cad8fd38496521238e9456b9db`, `3ba3d9597ecb632776eb8b36c7594b750d8c2ff5`; tests `e611808b6844675756c695c1b0c59c006604c9fb`; 36/36 WP-3 + 138/138 WP-2; schema unchanged) |
| Observation guard amendment | **APPROVED + IMPLEMENTED + VALIDATED** — token `CONFIRM-DEE-606-OBSERVATION-GUARD-668F159F`; amendment SHA `668f159f2c98c7fbd17b577a7de082ff12b0a5d6`; approval-recording SHA `04b28dfcb3d0741aee355f31c53887177e378e07`; correction SHA `11028f59c8b083069ee4c6909ca57828a231d9d5`; tag `0150_treasury_chain_observations_lifecycle_guard`; `:54339` PASS |
| Migration identities | **Final (WP-9):** `0149_treasury_transparency_ledger_foundation`, `0150_treasury_transparency_ledger_rls`, `0151_treasury_chain_observations_lifecycle_guard` after merged main `0148_trader_forecast_v2_open_tail_null_bounds_v1`. Historical WP-1/WP-8 used pre-reconciliation `0148`/`0149`/`0150` Treasury. Merge-order gate **RESOLVED**. |

### HD-3 evidence storage — Human architecture-only approval record

| Field | Value |
|-------|--------|
| Status | **APPROVED_ARCHITECTURE_ONLY** |
| Human token | `CONFIRM-DEE-606-HD3-R2-ARCHITECTURE-ONLY-NO-PRODUCTION-PROVISIONING` |
| approvedAt | 2026-08-13 |
| approvedBy | HUMAN |
| Backend | Cloudflare R2 |
| Bucket posture | PRIVATE |
| Access | Worker-side only; server-mediated admin upload/download |
| Intended future binding | `TREASURY_EVIDENCE_R2` |
| Object key | `treasury-evidence/v1/{organizationId}/{evidenceObjectId}` |
| Immutability | no overwrite after successful registration; conditional PUT `If-None-Match: *` |
| S3 credentials in WAIA runtime | not used |
| Presigned URLs | not approved |
| r2.dev | not approved |
| Custom-domain exposure | not approved |
| Direct browser-to-R2 | not approved |
| Public evidence metadata | does **not** make the R2 object public |
| Production bucket creation | **NOT AUTHORIZED** |
| Production R2 binding / wrangler.jsonc mutation | **NOT AUTHORIZED** |
| Cloudflare control-plane mutation / deploy | **NOT AUTHORIZED** |
| WP-5 code | authorized |
| WP-5 implementation status | **COMPLETE** |

### Observation lifecycle guard amendment — Human approval record

| Field | Value |
|-------|--------|
| Status | **APPROVED** |
| Discovered | 2026-08-13 |
| Classification | WP-1 security guard contradicts approved observation mutability |
| Original architecture source SHA | `82377e4f4869b9bf64f26a9578c2335cdbcb8b15` (unchanged; still approved) |
| Architecture amendment source SHA | `668f159f2c98c7fbd17b577a7de082ff12b0a5d6` |
| Approval token | `CONFIRM-DEE-606-OBSERVATION-GUARD-668F159F` |
| Approved at | 2026-08-13 |
| Approved by | HUMAN |
| Approval-recording commit | `04b28dfcb3d0741aee355f31c53887177e378e07` |
| Correction implementation SHA | `11028f59c8b083069ee4c6909ca57828a231d9d5` |
| Correction migration tag | `0150_treasury_chain_observations_lifecycle_guard` |
| Correction validation | **PASS** — `0150_treasury_chain_observations_lifecycle_guard`; implementation SHA `11028f59c8b083069ee4c6909ca57828a231d9d5`; dedicated `:54339` empty-DB apply 113 migrations; evidence sha256 `fb2e5bd321f9a47519be92251e7d37864fb4c19368b7ee42a540f8b03688f6c2`; WP-3 now COMPLETE on this validated contract |

---

## Plan answers checklist

1. Domain ownership: **Core Treasury domain (A)** — §1  
2. Payment/watcher reuse: patterns yes; billing tables/checkpoint/flag no — §2  
3. Schema/dictionary: §5 (incl. inception, observation links, commitments, snapshots, recon, fund registry, same-org FKs)  
4. State machines: accounting FSM + detail publication — §4  
5. Contribution share: VERIFIED + nominal policy — §6  
6. Watcher + VERIFIED precondition + coalescing + inception — §7  
7. Evidence — §8  
8. Breath + accounting formulas (resource identity; budget.remaining) — §9  
9. Ideal annual budget — §10  
10. Runway as-of — §11  
11. Admin/audit — §12  
12. Privacy/publication — §§4.2,6,9  
13. Migration + merge-order — §13  
14. RLS/security + same-org integrity — §14  
15. R5-safe DB — §15  
16. Work packages — §16  
17. Validation — §17  
18. AC traceability — §18  
19. Out of scope — §19  
20. Human decisions — §20  

---

**Markers**

- First draft commit: `a95b9c1c27b9d98df66cfb944c292dd1967e5f5e`
- Architect correction commit: `a0f00846b55a53f1f9ecb2db8c9e6bef82a156e0`
- Final integrity / Human-approved architecture source SHA: `82377e4f4869b9bf64f26a9578c2335cdbcb8b15`
- Approval token: `CONFIRM-DEE-606-ARCHITECTURE-PLAN-82377E4F`
- `state.status`: **approved** (WP-0..WP-9 COMPLETE; HD-3 `APPROVED_ARCHITECTURE_ONLY`; production R2 provisioning still blocked; watcher DARK; merge-order gate **RESOLVED**; Human squash-merge of DEE-606 PR remains)
- WP-9: **COMPLETE**; merge `origin/main` `7c8cf38f118d852d6e766ec23ea92322bedee2d4` (DEE-518 #458 squash); merge commit `5f3cd44dab845dbd1805bdba66d9a3f603d6ec6a`; Treasury identities 0149/0150/0151; SQL byte identity PASS; 152 migrations / tip 0151; WP-8 rerun 16/16; lint/typecheck/build PASS; evidence sha256 `9d9a89a8689708f1096c5156a5d054e7601d189875d97f1221b62f34be781904`; agent must not merge
- WP-8: **COMPLETE** (historical pre-reconciliation); R5-safe dedicated Postgres isolation (`127.0.0.1:54339`); starting SHA `3728aea04ba70f59ffd0441944c4fb657d282d6e`; tests `ca8227fce3b588e6aae48e6d7367922ac20adeae`; bounded lease Date mapping fix / validated SHA `a91ec2c0e8cb87ffa3896064f2416177b0e0f47b`; 16/16 WP-8 + 9/9 WP-7 + 9/9 WP-6 + 11/11 WP-5 + 27/27 WP-4 + 36/36 WP-3 + 140/140 WP-2; **pre-reconciliation** 113 migrations / tip 0150; evidence sha256 `8fa2783b912942d3c82c6419a9ae410411c31b0dfb40234576bffa69956de3df`
- WP-7: **COMPLETE**; exact contribution share engine + aggregate-only/self-only contracts; starting SHA `aa08798c0c7b2d1d627c228eb750b0f91cf0c540`; implementation SHAs `6408e8dfbf4e079671d762ac4830bd74ccc9f5c7`, `05d39d0d3d5fbd9091d6c1018f05ca3442b6c7d0`; tests `ea4c489416af417446ea0269ae91ba00e2945880`; production R2 provisioning **NOT AUTHORIZED**; watcher DARK; no public HTTP; no UI
- WP-6: **COMPLETE**; Breath read model + deterministic runway snapshots; starting SHA `2ec87b739e3f3949d52def1ea68a9a35f0ccefcf`; implementation SHAs `a719d2624d1958bc65bf60d550c8e97d3cbea66b`, `8086c749f0763122766bc2254a36e871a39c7ba9`; tests `01fa23cea4596dba45707d74b30bb78c76f7f429`; production R2 provisioning **NOT AUTHORIZED**; watcher DARK; no public HTTP; no UI
- WP-5: **COMPLETE**; private R2 evidence adapter (code only); starting SHA `6fcbe1faece1b3812ce9d9e03b22ef3f99fe5d79`; approval-recording SHA `bf42267ae41cf50758010585ef6b96bb0ed85df5`; implementation SHAs `c4cfcb05bb109fb8e8452bb03f425355d075eef0`, `ec318601068d9a6b3d143d4da6c609245907ad4c`; tests `233db89040481ac9cd4d2ba29eb060918f4748ca`; production R2 provisioning **NOT AUTHORIZED**
- WP-4: **COMPLETE**; Core admin HTTP contracts; starting SHA `6f3c8b2bd457706f33afd7466dc54907ee649e75`
- HD-3: **APPROVED_ARCHITECTURE_ONLY**; token `CONFIRM-DEE-606-HD3-R2-ARCHITECTURE-ONLY-NO-PRODUCTION-PROVISIONING`; private R2 architecture/code authorized; production provisioning **NOT AUTHORIZED**
- WP-3: **COMPLETE**; DARK Treasury watcher; starting SHA `afc0b9b270ed104173d84741b7bdcdfdc969f142`
- Observation guard amendment: **APPROVED_IMPLEMENTED_VALIDATED** (§5.4a); token `CONFIRM-DEE-606-OBSERVATION-GUARD-668F159F`; amendment SHA `668f159f2c98c7fbd17b577a7de082ff12b0a5d6`; approval-recording SHA `04b28dfcb3d0741aee355f31c53887177e378e07`; correction SHA `11028f59c8b083069ee4c6909ca57828a231d9d5`; historical tag `0150_treasury_chain_observations_lifecycle_guard` (final identity `0151`)
- Prior Architect decisions remain intact: T3; Core Treasury domain; accounting/detail separation; VERIFIED accounting truth; contribution share; commitment facts; deterministic runway snapshots; no DEE-612/613 hard-coded doctrine
- Binding gates preserved: watcher ships DARK; HD-3 architecture-only (no production R2 provisioning). DEE-518 migration merge-order **RESOLVED** on WP-9 after PR #458 squash `7c8cf38`.
- Binding gates preserved: watcher ships DARK; HD-3 architecture-only (no production R2 provisioning). DEE-518 migration merge-order **RESOLVED** on WP-9 after PR #458 squash `7c8cf38`.
- WP-1 validation: **DEDICATED_POSTGRES_VALIDATION_PASS** (`127.0.0.1:54339`; SHA `0df1b9698f1af27222c60bfb11191f0cf3f85676`) — historical pre-reconciliation identities
- Observation-guard correction validation: **DEDICATED_POSTGRES_VALIDATION_PASS** (`127.0.0.1:54339`; evidence sha256 `fb2e5bd321f9a47519be92251e7d37864fb4c19368b7ee42a540f8b03688f6c2`) — historical tag `0150` pre-reconciliation
- Migration reservation **final:** **0149** foundation + **0150** RLS + **0151** observation lifecycle guard after merged main **0148** trader forecast open-tail
- `DEE_606_OBSERVATION_GUARD_CORRECTION_PASS_READY_TO_RESUME_WP3`
- `DEE_606_WP3_TREASURY_WATCHER_DARK_PASS_WP3_COMPLETE_READY_FOR_WP4`
- `DEE_606_WP4_ADMIN_BACKEND_CONTRACTS_PASS_WP4_COMPLETE`
- `DEE_606_WP5_R2_EVIDENCE_ADAPTER_PASS_WP5_COMPLETE_READY_FOR_WP6`
- `DEE_606_WP6_BREATH_READ_MODEL_RUNWAY_PASS_WP6_COMPLETE_READY_FOR_WP7`
- `DEE_606_WP7_CONTRIBUTION_SHARE_PASS_WP7_COMPLETE_READY_FOR_WP8`
- `DEE_606_WP7_PUBLIC_AGGREGATE_PRIVACY_CORRECTION_PASS_READY_FOR_WP8`
- `DEE_606_WP8_R5_SAFE_POSTGRES_ISOLATION_PASS_WP8_COMPLETE_READY_FOR_WP9`
- `DEE_606_WP9_MIGRATION_RECONCILIATION_PASS`
- `DEE_606_WP9_LOCAL_PR_READINESS_PASS`
- `CONFIRM-DEE-606-HD3-R2-ARCHITECTURE-ONLY-NO-PRODUCTION-PROVISIONING`
