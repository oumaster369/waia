export const MARKET_UNDERSTANDING_RUNTIME_MODULES_V1 = {
  exactAttribution:
    "lib/trader/intelligence/market-understanding-evidence-attribution-v1.ts",
  exactBridge: "lib/trader/intelligence/market-understanding-bridge-v0.ts",
  legacyTypes: "lib/trader/intelligence/market-understanding.types.ts",
  evaluationCycle: "lib/trader/intelligence/evaluation-cycle.ts",
  replayIdentity: "lib/trader/research/replay-repro-digest.ts",
} as const;

export const MARKET_UNDERSTANDING_IMPORT_MODULES_V1 = {
  EXACT_ATTRIBUTION:
    "@/lib/trader/intelligence/market-understanding-evidence-attribution-v1",
  EXACT_BRIDGE: "@/lib/trader/intelligence/market-understanding-bridge-v0",
  LEGACY_TYPES: "@/lib/trader/intelligence/market-understanding.types",
  REPLAY_IDENTITY: "@/lib/trader/research/replay-repro-digest",
  EVALUATION_CYCLE: "@/lib/trader/intelligence/evaluation-cycle",
  INTELLIGENCE_BARREL: "@/lib/trader/intelligence",
} as const;

export type MarketUnderstandingImportV1 = keyof typeof MARKET_UNDERSTANDING_IMPORT_MODULES_V1;

/**
 * Exact direct-import closure for production TypeScript. Generic users of the pre-existing
 * replay digest module stay listed because the module now also owns exact Understanding replay.
 */
export const MARKET_UNDERSTANDING_DIRECT_IMPORT_REACHABILITY_V1 = {
  EXACT_ATTRIBUTION: [
    "lib/trader/intelligence/evaluate-canonical-market-questions.ts",
    "lib/trader/intelligence/index.ts",
    "lib/trader/intelligence/market-understanding-bridge-v0.ts",
    "lib/trader/intelligence/market-understanding.types.ts",
    "lib/trader/research/replay-repro-digest.ts",
  ],
  EXACT_BRIDGE: [
    "lib/trader/intelligence/evaluate-canonical-market-questions.ts",
    "lib/trader/intelligence/evaluation-cycle.ts",
    "lib/trader/research/m9-market-understanding-export.ts",
  ],
  LEGACY_TYPES: [
    "lib/trader/intelligence/analytical-layers-v0.ts",
    "lib/trader/intelligence/cde-v0.ts",
    "lib/trader/intelligence/hypothesis/build-hypothesis-set.ts",
    "lib/trader/intelligence/market-state-finalization.ts",
    "lib/trader/intelligence/market-understanding-bridge-v0.ts",
    "lib/trader/intelligence/market-understanding-evidence-attribution-v1.ts",
    "lib/trader/intelligence/mi-core.types.ts",
    "lib/trader/intelligence/types.ts",
    "lib/trader/market-brain/market-brain-pipeline.ts",
    "lib/trader/market-data/fusion/context-fusion-v0.ts",
    "lib/trader/market-data/fusion/context-fusion-v1.ts",
    "lib/trader/market-data/fusion/cross-venue-triangulation.ts",
    "lib/trader/market-data/mtf/mtf-backdrop-classifier.ts",
    "lib/trader/market-data/observation-types.ts",
    "lib/trader/research/m9-market-understanding-export.ts",
    "lib/trader/research/replay-repro-digest.ts",
  ],
  REPLAY_IDENTITY: [
    "lib/trader/backtest/canvas-checkpoint-resume-harness.ts",
    "lib/trader/backtest/replay-benchmark-harness.ts",
    "lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness.ts",
    "lib/trader/backtest/streaming-evidence/streaming-evidence-recovery-harness.ts",
    "lib/trader/observability/fhv-economic-non-interference-harness.ts",
    "lib/trader/observability/fhv-full-historical-launch.ts",
    "lib/trader/observability/fhv-rehearsal-campaign-runner.ts",
    "lib/trader/research/m9-decision-trace-export.ts",
    "lib/trader/research/m9-market-understanding-export.ts",
    "lib/trader/research/m9-provider-fusion-export.ts",
  ],
  EVALUATION_CYCLE: [
    "lib/trader/intelligence/forecast-decision/wp14-forecast-decision-evidence-harness.ts",
    "lib/trader/intelligence/index.ts",
    "lib/trader/intelligence/records/wp13-intelligence-evidence-harness.ts",
    "lib/trader/knowledge/mkb-read-model-evidence-harness.ts",
    "lib/trader/live/run-live-cycle.ts",
    "lib/trader/market-brain/market-brain-pipeline.ts",
    "lib/trader/paper/paper-cycle-runner.ts",
  ],
  INTELLIGENCE_BARREL: ["lib/trader/index.ts"],
} as const satisfies Record<MarketUnderstandingImportV1, readonly string[]>;

export const MARKET_UNDERSTANDING_PRODUCERS_V1 = [
  {
    path: MARKET_UNDERSTANDING_RUNTIME_MODULES_V1.exactAttribution,
    symbols: ["defineUnderstandingClaimV1", "defineMarketUnderstandingArtifactV1"],
    disposition: "EXACT_CONTENT_ADDRESSED_CONTRACT",
  },
  {
    path: MARKET_UNDERSTANDING_RUNTIME_MODULES_V1.exactBridge,
    symbols: ["buildExactMarketUnderstandingArtifactV1", "buildMarketUnderstandingBridge"],
    disposition: "PROFILE_RECEIPT_BOUND_DERIVATION_AND_LEGACY_PROJECTION",
  },
  {
    path: MARKET_UNDERSTANDING_RUNTIME_MODULES_V1.evaluationCycle,
    symbols: ["runEvaluationCycle", "understandingArtifact"],
    disposition: "FAIL_CLOSED_RUNTIME_COMPOSITION",
  },
  {
    path: MARKET_UNDERSTANDING_RUNTIME_MODULES_V1.replayIdentity,
    symbols: ["assertMarketUnderstandingReplayArtifactV1", "buildMarketUnderstandingReplayIdentityV1"],
    disposition: "NETWORK_INERT_EXACT_REPLAY_IDENTITY",
  },
] as const;

export const MARKET_UNDERSTANDING_LEGACY_CONSUMERS_V1 = [
  {
    path: "lib/trader/intelligence/analytical-layers-v0.ts",
    symbols: ["buildMsvUnderstandingBlock"],
    disposition: "TELEMETRY_PROJECTION_ONLY",
  },
  {
    path: "lib/trader/intelligence/cde-v0.ts",
    symbols: ["buildMsvEnvelope", "buildMsvUnderstandingBlock"],
    disposition: "TELEMETRY_PROJECTION_ONLY",
  },
  {
    path: "lib/trader/intelligence/hypothesis/build-hypothesis-set.ts",
    symbols: ["buildHypothesisSet"],
    disposition: "CAUSALLY_INERT_INPUT_COMPATIBILITY",
  },
  {
    path: "lib/trader/intelligence/market-state-finalization.ts",
    symbols: ["finalizeMarketStateSnapshot"],
    disposition: "AUDIT_CARRIER_ONLY",
  },
  {
    path: "lib/trader/intelligence/mi-core.types.ts",
    symbols: ["MarketStateSnapshot"],
    disposition: "TYPE_ONLY_AUDIT_CARRIER",
  },
  {
    path: "lib/trader/market-brain/market-brain-pipeline.ts",
    symbols: ["MarketBrainPipelineResult", "runMarketBrainPipeline"],
    disposition: "LEGACY_RESULT_TELEMETRY_ONLY",
  },
  {
    path: "lib/trader/research/m9-market-understanding-export.ts",
    symbols: ["understandingSnapshots", "researchSignals"],
    disposition: "LEGACY_FILE_EXPORT_TELEMETRY_ONLY",
  },
] as const;

export const MARKET_UNDERSTANDING_INDIRECT_CONSUMERS_V1 = [
  {
    path: "lib/trader/paper/paper-cycle-runner.ts",
    symbol: "runPaperCycleOnce",
    disposition: "IN_MEMORY_RESULT_CARRIER_NO_DIRECT_IDENTITY_IMPORT",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/backtest/backtest-runner.ts",
    symbol: "runBacktest",
    disposition: "HISTORICAL_RESULT_CARRIER_NO_DIRECT_IDENTITY_IMPORT",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/research/research-orchestrator.ts",
    symbol: "runResearchPipelinePostgres",
    disposition: "BLIND_ORCHESTRATOR_WITHOUT_PROFILE_RECEIPT_AUTHORITY",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/market-brain/market-brain-pipeline.ts",
    symbol: "runMarketBrainPipeline",
    disposition: "RESEARCH_NON_CAPITAL_LEGACY_RESULT_ONLY",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/intelligence/forecast-decision/forecast-decision-service.ts",
    symbol: "buildForecastDecisionBundle",
    disposition: "NO_ARTIFACT_INPUT_OR_GATE",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/intelligence/forecast-decision/wp14-forecast-decision-evidence-harness.ts",
    symbol: "runWp14ForecastDecisionEvidenceHarness",
    disposition: "SYNTHETIC_EVIDENCE_HARNESS_NO_CAPITAL_AUTHORITY",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/intelligence/records/wp13-intelligence-evidence-harness.ts",
    symbol: "runWp13IntelligenceEvidenceHarness",
    disposition: "SYNTHETIC_EVIDENCE_HARNESS_NO_CAPITAL_AUTHORITY",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/knowledge/mkb-read-model-evidence-harness.ts",
    symbol: "runWp15MkbReadModelEvidenceHarness",
    disposition: "SYNTHETIC_EVIDENCE_HARNESS_NO_CAPITAL_AUTHORITY",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/live/run-live-cycle.ts",
    symbol: "runLiveCycleOnce",
    disposition: "RESERVED_LIVE_INDIRECT_LEGACY_ONLY_NO_PROFILE_RECEIPT",
    createsCapitalAuthority: false,
  },
] as const;

export const MARKET_UNDERSTANDING_EXPORT_AND_PERSISTENCE_V1 = [
  {
    path: "lib/trader/intelligence/evaluate-canonical-market-questions.ts",
    disposition: "COMPATIBILITY_EXPORT_ONLY",
    exactArtifact: true,
  },
  {
    path: "lib/trader/intelligence/index.ts",
    disposition: "INTELLIGENCE_EXPORT_ONLY",
    exactArtifact: true,
  },
  {
    path: "lib/trader/index.ts",
    disposition: "SELECTIVE_RESULT_CARRIER_EXPORT_NO_EXACT_SYMBOL",
    exactArtifact: false,
  },
  {
    path: "lib/trader/research/m9-market-understanding-export.ts",
    disposition: "BOUNDED_FILE_EXPORT_EXACT_IDENTITY_AND_LEGACY_TELEMETRY",
    exactArtifact: true,
  },
  {
    path: "lib/trader/research/m9-decision-trace-export.ts",
    disposition: "BOUNDED_FILE_EXPORT_EXACT_IDENTITY",
    exactArtifact: true,
  },
  {
    path: "lib/trader/backtest/streaming-evidence/cycle-evidence-projection.ts",
    disposition: "EXACT_ARTIFACT_OMITTED_LEGACY_TRACE_ONLY",
    exactArtifact: false,
  },
  {
    path: "lib/trader/backtest/streaming-evidence/streaming-evidence-reader.ts",
    disposition: "EXACT_ARTIFACT_NOT_RECONSTRUCTED_LEGACY_TRACE_ONLY",
    exactArtifact: false,
  },
] as const;

export const MARKET_UNDERSTANDING_DURABLE_PERSISTENCE_V1 = {
  owner: "DEE-623",
  status: "DEFERRED",
  repository: null,
  migration: null,
  createsCapitalAuthority: false,
} as const;

export const MARKET_UNDERSTANDING_GUARDIAN_LANE_V1 = {
  path: "lib/trader/paper/paper-cycle-runner.ts",
  symbol: "runGuardianPhase",
  consumesExactArtifact: false,
  consumesCanonicalSourcePitTrust: false,
  disposition: "SEPARATE_RISK_REDUCING_EXIT_LANE",
  createsCapitalAuthority: false,
} as const;

export const MARKET_UNDERSTANDING_BLIND_HOLDOUT_BOUNDARIES_V1 = [
  "lib/trader/research/blind-holdout-engine.ts",
  "lib/trader/research/research-orchestrator.ts",
  "lib/trader/research/verify-sealed-research-dataset.ts",
] as const;

export const MARKET_UNDERSTANDING_FORBIDDEN_AUTHORITY_SEGMENTS_V1 = [
  "/intelligence/forecast",
  "/intelligence/decision",
  "/risk/",
  "/execution/",
  "/guardian/",
  "/exits/",
  "/live/",
  "/reality/",
  "/holdout/",
  "/research/blind-",
] as const;

export const MARKET_UNDERSTANDING_FORBIDDEN_DIRECT_IMPORT_MODULES_V1 = [
  MARKET_UNDERSTANDING_IMPORT_MODULES_V1.EXACT_ATTRIBUTION,
  MARKET_UNDERSTANDING_IMPORT_MODULES_V1.EXACT_BRIDGE,
  MARKET_UNDERSTANDING_IMPORT_MODULES_V1.LEGACY_TYPES,
  MARKET_UNDERSTANDING_IMPORT_MODULES_V1.REPLAY_IDENTITY,
  "@/lib/trader/intelligence",
  "@/lib/trader/mi/canonical-observation-v1",
  "@/lib/trader/mi/canonical-pit-repository-postgres",
  "@/lib/trader/mi/canonical-pit-service-postgres",
  "@/lib/trader/mi/mi-source.types",
  "@/lib/trader/mi/source-provenance-service",
  "@/lib/trader/mi/trust-as-of-repository-postgres",
  "@/lib/trader/mi/trust-as-of-v1",
] as const;

export const MARKET_UNDERSTANDING_FORBIDDEN_BYPASS_MARKERS_V1 = [
  "MARKET_UNDERSTANDING_BYPASS",
  "SKIP_MARKET_UNDERSTANDING_AUTHENTICATION",
  "ASSUME_MARKET_UNDERSTANDING_COMPLETE",
  "USE_FUSED_PROVENANCE_AS_CANONICAL_EVIDENCE",
  "ALLOW_BLIND_HOLDOUT_UNDERSTANDING",
  "PERSIST_MARKET_UNDERSTANDING_V1",
] as const;

export function auditMarketUnderstandingConsumerInventoryV1(): string[] {
  const errors: string[] = [];
  for (const [kind, paths] of Object.entries(MARKET_UNDERSTANDING_DIRECT_IMPORT_REACHABILITY_V1)) {
    if ((paths as readonly string[]).length === 0) errors.push(`DIRECT_IMPORT_KIND_EMPTY:${kind}`);
    if (new Set(paths).size !== paths.length) errors.push(`DUPLICATE_DIRECT_IMPORT:${kind}`);
  }
  for (const entry of MARKET_UNDERSTANDING_INDIRECT_CONSUMERS_V1) {
    if (entry.createsCapitalAuthority) errors.push(`CAPITAL_AUTHORITY_LEAK:${entry.path}`);
  }
  if (
    MARKET_UNDERSTANDING_GUARDIAN_LANE_V1.consumesExactArtifact ||
    MARKET_UNDERSTANDING_GUARDIAN_LANE_V1.consumesCanonicalSourcePitTrust ||
    MARKET_UNDERSTANDING_GUARDIAN_LANE_V1.createsCapitalAuthority
  ) {
    errors.push("GUARDIAN_LANE_AUTHORITY_MISMATCH");
  }
  if (
    MARKET_UNDERSTANDING_DURABLE_PERSISTENCE_V1.owner !== "DEE-623" ||
    MARKET_UNDERSTANDING_DURABLE_PERSISTENCE_V1.status !== "DEFERRED" ||
    MARKET_UNDERSTANDING_DURABLE_PERSISTENCE_V1.repository !== null ||
    MARKET_UNDERSTANDING_DURABLE_PERSISTENCE_V1.migration !== null
  ) {
    errors.push("DURABLE_PERSISTENCE_SCOPE_LEAK");
  }
  return errors;
}
