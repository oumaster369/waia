export const INFORMATION_SUFFICIENCY_RUNTIME_MODULES_V2 = {
  contract: "lib/trader/intelligence/information-sufficiency/information-sufficiency-v2.ts",
  repository:
    "lib/trader/intelligence/information-sufficiency/information-sufficiency-repository-postgres.ts",
  evaluationCycle: "lib/trader/intelligence/evaluation-cycle.ts",
  forecastDecision: "lib/trader/intelligence/forecast-decision/forecast-decision-service.ts",
  forecastDecisionConstructionAuthority:
    "lib/trader/intelligence/forecast-decision/forecast-decision-construction-authority.ts",
  forecastDecisionPersistence:
    "lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres.ts",
  paperCycle: "lib/trader/paper/paper-cycle-runner.ts",
} as const;

export type InformationSufficiencyImportV2 =
  | "RUN_EVALUATION_CYCLE"
  | "BUILD_FORECAST_DECISION_BUNDLE"
  | "FORECAST_DECISION_CONSTRUCTION_AUTHORITY"
  | "FORECAST_DECISION_RAW_PERSISTENCE"
  | "FORECAST_DECISION_LOW_LEVEL_DECISION_REPOSITORY"
  | "FORECAST_DECISION_BARREL"
  | "TRADER_INTELLIGENCE_BARREL"
  | "TRADER_PAPER_BARREL"
  | "RUN_PAPER_CYCLE_ONCE"
  | "RUN_BACKTEST";

export type InformationSufficiencyConsumerDispositionV2 =
  | "NEW_OPPORTUNITY_FAIL_CLOSED"
  | "HISTORICAL_SIMULATION_FAIL_CLOSED"
  | "RESEARCH_NON_CAPITAL_EXPLICIT"
  | "PAPER_ENTRY_FAIL_CLOSED"
  | "POLL_ENTRY_FAIL_CLOSED"
  | "FIXTURE_ENTRY_FAIL_CLOSED"
  | "BACKTEST_ENTRY_FAIL_CLOSED"
  | "RUN_BACKTEST_DEFAULT_FAIL_CLOSED"
  | "RUN_BACKTEST_TYPE_ONLY"
  | "RESEARCH_NON_CAPITAL_SYNTHETIC_BOUND"
  | "GATED_COMPONENT_CONSTRUCTION"
  | "GATED_PERSISTENCE"
  | "LOW_LEVEL_READ_ONLY_COMPLETENESS"
  | "EXCLUDED_RESERVED_LIVE_UNGATED"
  | "EXPORT_ONLY";

export type InformationSufficiencyConsumerInventoryEntryV2 = Readonly<{
  path: string;
  symbols: readonly string[];
  imports: readonly InformationSufficiencyImportV2[];
  disposition: InformationSufficiencyConsumerDispositionV2;
  authorityPurpose: "NEW_OPPORTUNITY" | "RESEARCH_NON_CAPITAL" | "NONE";
}>;

/**
 * Closed inventory of every direct importer of the three capital-relevant seams.
 * Wrappers remain explicit so a new importer cannot silently inherit authority.
 */
export const INFORMATION_SUFFICIENCY_CONSUMERS_V2 = [
  {
    path: "lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2.ts",
    symbols: ["runEvaluationCycle", "informationSufficiencyAuthority"],
    imports: ["RUN_EVALUATION_CYCLE"],
    disposition: "HISTORICAL_SIMULATION_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/historical-simulation-v2/production-next-cycle-forecast-v2.ts",
    symbols: ["runEvaluationCycle", "informationSufficiencyAuthority"],
    imports: ["RUN_EVALUATION_CYCLE"],
    disposition: "HISTORICAL_SIMULATION_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/evaluation-cycle.ts",
    symbols: ["runEvaluationCycle", "buildForecastDecisionBundle"],
    imports: ["BUILD_FORECAST_DECISION_BUNDLE"],
    disposition: "NEW_OPPORTUNITY_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/forecast-decision-service.ts",
    symbols: ["buildForecastDecisionBundle", "sealForecastDecisionBundleConstruction"],
    imports: ["FORECAST_DECISION_CONSTRUCTION_AUTHORITY", "FORECAST_DECISION_RAW_PERSISTENCE"],
    disposition: "NEW_OPPORTUNITY_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/build-forecast-records.ts",
    symbols: ["buildForecastRecords", "assertForecastDecisionConstructionPermit"],
    imports: ["FORECAST_DECISION_CONSTRUCTION_AUTHORITY"],
    disposition: "GATED_COMPONENT_CONSTRUCTION",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/build-decision-record.ts",
    symbols: ["buildDecisionRecord", "assertForecastDecisionConstructionPermit"],
    imports: ["FORECAST_DECISION_CONSTRUCTION_AUTHORITY"],
    disposition: "GATED_COMPONENT_CONSTRUCTION",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/build-decision-forecast-links.ts",
    symbols: ["buildDecisionForecastLinks", "assertForecastDecisionConstructionPermit"],
    imports: ["FORECAST_DECISION_CONSTRUCTION_AUTHORITY"],
    disposition: "GATED_COMPONENT_CONSTRUCTION",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/build-entry-purpose-record.ts",
    symbols: ["buildEntryPurposeRecord", "assertForecastDecisionConstructionPermit"],
    imports: ["FORECAST_DECISION_CONSTRUCTION_AUTHORITY"],
    disposition: "GATED_COMPONENT_CONSTRUCTION",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres.ts",
    symbols: ["persistForecastDecisionBundle", "admitForecastDecisionPersistence"],
    imports: [
      "FORECAST_DECISION_CONSTRUCTION_AUTHORITY",
      "FORECAST_DECISION_LOW_LEVEL_DECISION_REPOSITORY",
    ],
    disposition: "GATED_PERSISTENCE",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/forecast-decision-completeness.ts",
    symbols: ["assertForecastDecisionChainComplete", "createDecisionRecordRepositoryPostgres"],
    imports: ["FORECAST_DECISION_LOW_LEVEL_DECISION_REPOSITORY"],
    disposition: "LOW_LEVEL_READ_ONLY_COMPLETENESS",
    authorityPurpose: "NONE",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/forecast-record-repository-postgres.ts",
    symbols: ["createForecastRecordRepositoryPostgres", "assertForecastDecisionPersistencePermit"],
    imports: ["FORECAST_DECISION_CONSTRUCTION_AUTHORITY"],
    disposition: "GATED_PERSISTENCE",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/decision-record-repository-postgres.ts",
    symbols: ["createDecisionRecordRepositoryPostgres", "assertForecastDecisionPersistencePermit"],
    imports: ["FORECAST_DECISION_CONSTRUCTION_AUTHORITY"],
    disposition: "GATED_PERSISTENCE",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/decision-forecast-link-repository-postgres.ts",
    symbols: [
      "createDecisionForecastLinkRepositoryPostgres",
      "assertForecastDecisionPersistencePermit",
    ],
    imports: ["FORECAST_DECISION_CONSTRUCTION_AUTHORITY"],
    disposition: "GATED_PERSISTENCE",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/entry-purpose-record-repository-postgres.ts",
    symbols: [
      "createEntryPurposeRecordRepositoryPostgres",
      "assertForecastDecisionPersistencePermit",
    ],
    imports: ["FORECAST_DECISION_CONSTRUCTION_AUTHORITY"],
    disposition: "GATED_PERSISTENCE",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters.ts",
    symbols: ["ForecastDecisionPersistencePermit", "ForecastDecisionBundleRepository"],
    imports: ["FORECAST_DECISION_CONSTRUCTION_AUTHORITY"],
    disposition: "GATED_PERSISTENCE",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/wp14-forecast-decision-evidence-harness.ts",
    symbols: ["runEvaluationCycle"],
    imports: ["RUN_EVALUATION_CYCLE"],
    disposition: "RESEARCH_NON_CAPITAL_EXPLICIT",
    authorityPurpose: "RESEARCH_NON_CAPITAL",
  },
  {
    path: "lib/trader/intelligence/records/wp13-intelligence-evidence-harness.ts",
    symbols: ["runEvaluationCycle"],
    imports: ["RUN_EVALUATION_CYCLE"],
    disposition: "RESEARCH_NON_CAPITAL_EXPLICIT",
    authorityPurpose: "RESEARCH_NON_CAPITAL",
  },
  {
    path: "lib/trader/knowledge/mkb-read-model-evidence-harness.ts",
    symbols: ["runEvaluationCycle", "buildForecastDecisionBundle"],
    imports: ["RUN_EVALUATION_CYCLE", "BUILD_FORECAST_DECISION_BUNDLE"],
    disposition: "RESEARCH_NON_CAPITAL_EXPLICIT",
    authorityPurpose: "RESEARCH_NON_CAPITAL",
  },
  {
    path: "lib/trader/market-brain/market-brain-pipeline.ts",
    symbols: ["runEvaluationCycle"],
    imports: ["RUN_EVALUATION_CYCLE"],
    disposition: "RESEARCH_NON_CAPITAL_EXPLICIT",
    authorityPurpose: "RESEARCH_NON_CAPITAL",
  },
  {
    path: "lib/trader/backtest/canvas-checkpoint-resume-harness.ts",
    symbols: ["runBacktest"],
    imports: ["RUN_BACKTEST"],
    disposition: "RUN_BACKTEST_DEFAULT_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/backtest/replay-benchmark-harness.ts",
    symbols: ["runBacktest"],
    imports: ["RUN_BACKTEST"],
    disposition: "RUN_BACKTEST_DEFAULT_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness.ts",
    symbols: ["runBacktest"],
    imports: ["RUN_BACKTEST"],
    disposition: "RUN_BACKTEST_DEFAULT_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/backtest/streaming-evidence/streaming-evidence-recovery-harness.ts",
    symbols: ["runBacktest"],
    imports: ["RUN_BACKTEST"],
    disposition: "RUN_BACKTEST_DEFAULT_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/epistemic/wp21-flag-off-parity.ts",
    symbols: ["RunBacktestResult"],
    imports: ["RUN_BACKTEST"],
    disposition: "RUN_BACKTEST_TYPE_ONLY",
    authorityPurpose: "NONE",
  },
  {
    path: "lib/trader/observability/fhv-economic-non-interference-harness.ts",
    symbols: ["runBacktest"],
    imports: ["RUN_BACKTEST"],
    disposition: "RUN_BACKTEST_DEFAULT_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/observability/fhv-execution-checkpoint-runtime.ts",
    symbols: ["FhvCycleBoundarySnapshot"],
    imports: ["RUN_BACKTEST"],
    disposition: "RUN_BACKTEST_TYPE_ONLY",
    authorityPurpose: "NONE",
  },
  {
    path: "lib/trader/observability/fhv-execution-checkpoint.ts",
    symbols: ["FhvCycleBoundarySnapshot"],
    imports: ["RUN_BACKTEST"],
    disposition: "RUN_BACKTEST_TYPE_ONLY",
    authorityPurpose: "NONE",
  },
  {
    path: "lib/trader/observability/fhv-full-historical-engine.ts",
    symbols: ["runFullHistoricalBacktest", "runBacktest"],
    imports: ["RUN_BACKTEST"],
    disposition: "RESEARCH_NON_CAPITAL_SYNTHETIC_BOUND",
    authorityPurpose: "RESEARCH_NON_CAPITAL",
  },
  {
    path: "lib/trader/observability/fhv-full-historical-launch.ts",
    symbols: ["SyntheticResearchNonCapitalAuthorityV2", "runFhvFullHistoricalLaunch"],
    imports: ["RUN_BACKTEST"],
    disposition: "RESEARCH_NON_CAPITAL_SYNTHETIC_BOUND",
    authorityPurpose: "RESEARCH_NON_CAPITAL",
  },
  {
    path: "lib/trader/observability/fhv-rehearsal-campaign-runner.ts",
    symbols: ["runBacktest"],
    imports: ["RUN_BACKTEST"],
    disposition: "RUN_BACKTEST_DEFAULT_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/research/capital-path-trace-harness.ts",
    symbols: ["runAllCapitalPathTraceScenarios", "runBacktest"],
    imports: ["RUN_BACKTEST"],
    disposition: "RESEARCH_NON_CAPITAL_SYNTHETIC_BOUND",
    authorityPurpose: "RESEARCH_NON_CAPITAL",
  },
  {
    path: "lib/trader/research/research-backtest-runner.ts",
    symbols: ["runBacktest"],
    imports: ["RUN_BACKTEST"],
    disposition: "RUN_BACKTEST_DEFAULT_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/research/wp21-g2-zero-fill-structural-comparison.ts",
    symbols: ["runBacktest"],
    imports: ["RUN_BACKTEST"],
    disposition: "RUN_BACKTEST_DEFAULT_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/live/run-live-cycle.ts",
    symbols: ["runLiveCycleOnce", "runEvaluationCycle"],
    imports: ["RUN_EVALUATION_CYCLE"],
    disposition: "EXCLUDED_RESERVED_LIVE_UNGATED",
    authorityPurpose: "NONE",
  },
  {
    path: "lib/trader/paper/paper-cycle-runner.ts",
    symbols: [
      "runPaperCycleOnce",
      "runFixturePaperCycles",
      "runPollPaperCycles",
      "runGuardianPhase",
    ],
    imports: ["RUN_EVALUATION_CYCLE"],
    disposition: "PAPER_ENTRY_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/paper/paper-bar-close-loop.ts",
    symbols: ["runPaperBarCloseLoop", "runPaperCycleOnce"],
    imports: ["RUN_PAPER_CYCLE_ONCE"],
    disposition: "POLL_ENTRY_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/paper/run-paper-loop-cycle.ts",
    symbols: ["runPaperLoopCycle", "runPaperCycleOnce"],
    imports: ["RUN_PAPER_CYCLE_ONCE"],
    disposition: "POLL_ENTRY_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/paper/run-fixture-paper-cycles.ts",
    symbols: ["runFixturePaperCycles"],
    imports: ["RUN_PAPER_CYCLE_ONCE"],
    disposition: "FIXTURE_ENTRY_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/backtest/backtest-runner.ts",
    symbols: ["runBacktest", "runPaperCycleOnce"],
    imports: ["RUN_PAPER_CYCLE_ONCE", "BUILD_FORECAST_DECISION_BUNDLE"],
    disposition: "BACKTEST_ENTRY_FAIL_CLOSED",
    authorityPurpose: "NEW_OPPORTUNITY",
  },
  {
    path: "lib/trader/intelligence/index.ts",
    symbols: ["runEvaluationCycle"],
    imports: ["RUN_EVALUATION_CYCLE", "FORECAST_DECISION_BARREL"],
    disposition: "EXPORT_ONLY",
    authorityPurpose: "NONE",
  },
  {
    path: "lib/trader/intelligence/forecast-decision/index.ts",
    symbols: ["buildForecastDecisionBundle", "createForecastDecisionBundleRepositoryPostgres"],
    imports: ["BUILD_FORECAST_DECISION_BUNDLE", "FORECAST_DECISION_RAW_PERSISTENCE"],
    disposition: "EXPORT_ONLY",
    authorityPurpose: "NONE",
  },
  {
    path: "lib/trader/paper/index.ts",
    symbols: ["runPaperCycleOnce"],
    imports: ["RUN_PAPER_CYCLE_ONCE"],
    disposition: "EXPORT_ONLY",
    authorityPurpose: "NONE",
  },
  {
    path: "lib/trader/index.ts",
    symbols: ["runEvaluationCycle", "mapSignalToSubmitOrder"],
    imports: ["TRADER_INTELLIGENCE_BARREL", "TRADER_PAPER_BARREL"],
    disposition: "EXPORT_ONLY",
    authorityPurpose: "NONE",
  },
] as const satisfies readonly InformationSufficiencyConsumerInventoryEntryV2[];

export const INFORMATION_SUFFICIENCY_PRODUCERS_V2 = [
  {
    path: INFORMATION_SUFFICIENCY_RUNTIME_MODULES_V2.contract,
    symbols: [
      "defineRequiredInformationProfileV2",
      "evaluateInformationSufficiencyV2",
      "assertInformationSufficiencyReceiptV2",
    ],
    disposition: "PURE_CONTENT_ADDRESSED_EVALUATOR",
  },
  {
    path: INFORMATION_SUFFICIENCY_RUNTIME_MODULES_V2.repository,
    symbols: [
      "persistRequiredInformationProfileV2Postgres",
      "persistInformationSufficiencyReceiptV2Postgres",
    ],
    disposition: "SERVICE_ONLY_APPEND_ONLY_PERSISTENCE",
  },
] as const;

export const INFORMATION_SUFFICIENCY_GUARDIAN_LANE_V2 = {
  path: "lib/trader/paper/paper-cycle-runner.ts",
  symbols: ["runGuardianPhase", "evaluatePositionGuardian", "mapExitIntentToSubmitOrder"],
  purpose: "OPEN_POSITION_REASSESSMENT",
  disposition: "SEPARATE_RISK_REDUCING_EXIT_LANE",
  blockedByNewOpportunityInsufficiency: false,
  createsCapitalAuthority: false,
} as const;

export const INFORMATION_SUFFICIENCY_FORBIDDEN_BYPASS_MARKERS_V2 = [
  "SUFFICIENCY_BYPASS",
  "SKIP_INFORMATION_SUFFICIENCY",
  "ASSUME_INFORMATION_SUFFICIENT",
] as const;

export function auditInformationSufficiencyConsumerInventoryV2(): string[] {
  const errors: string[] = [];
  const consumers: readonly InformationSufficiencyConsumerInventoryEntryV2[] =
    INFORMATION_SUFFICIENCY_CONSUMERS_V2;
  const paths = consumers.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) errors.push("DUPLICATE_CONSUMER_PATH");
  for (const entry of consumers) {
    if (entry.symbols.length === 0) errors.push(`CONSUMER_WITHOUT_SYMBOL:${entry.path}`);
    if (
      entry.disposition === "RESEARCH_NON_CAPITAL_EXPLICIT" ||
      entry.disposition === "RESEARCH_NON_CAPITAL_SYNTHETIC_BOUND"
    ) {
      if (entry.authorityPurpose !== "RESEARCH_NON_CAPITAL") {
        errors.push(`NON_CAPITAL_AUTHORITY_MISMATCH:${entry.path}`);
      }
    } else if (
      entry.disposition === "EXPORT_ONLY" ||
      entry.disposition === "LOW_LEVEL_READ_ONLY_COMPLETENESS" ||
      entry.disposition === "EXCLUDED_RESERVED_LIVE_UNGATED" ||
      entry.disposition === "RUN_BACKTEST_TYPE_ONLY"
    ) {
      if (entry.authorityPurpose !== "NONE") {
        errors.push(`NON_CAPITAL_SEAM_AUTHORITY_MISMATCH:${entry.path}`);
      }
    } else if (entry.authorityPurpose !== "NEW_OPPORTUNITY") {
      errors.push(`CAPITAL_SEAM_AUTHORITY_MISMATCH:${entry.path}`);
    }
  }
  if (
    INFORMATION_SUFFICIENCY_GUARDIAN_LANE_V2.blockedByNewOpportunityInsufficiency ||
    INFORMATION_SUFFICIENCY_GUARDIAN_LANE_V2.createsCapitalAuthority
  ) {
    errors.push("GUARDIAN_LANE_AUTHORITY_MISMATCH");
  }
  return errors;
}
