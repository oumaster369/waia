export const INFORMATION_INQUIRY_RUNTIME_MODULES_V1 = {
  contracts: "lib/trader/intelligence/information-inquiry/contracts-v1.ts",
  historicalAnalogue:
    "lib/trader/intelligence/information-inquiry/historical-analogue-contract-v1.ts",
  topDownReconstruction:
    "lib/trader/intelligence/information-inquiry/top-down-reconstruction-v1.ts",
  planner: "lib/trader/intelligence/information-inquiry/information-need-planner-v1.ts",
  loop: "lib/trader/intelligence/information-inquiry/information-inquiry-loop-v1.ts",
  scheduler: "lib/trader/intelligence/information-inquiry/inquiry-scheduler-v1.ts",
  runtime: "lib/trader/intelligence/information-inquiry/information-inquiry-runtime-v1.ts",
  liveGateway: "lib/trader/market-data/market-data-gateway.ts",
  livePollSource: "lib/trader/market-data/htx-bar-poll-source.ts",
  historicalIngress: "lib/trader/market-data/replay/historical-ingress-gateway.ts",
  historicalSelector:
    "lib/trader/market-data/replay/information-need-replay-selection-v1.ts",
} as const;

export const INFORMATION_INQUIRY_IMPORT_MODULES_V1 = {
  CONTRACTS: "@/lib/trader/intelligence/information-inquiry/contracts-v1",
  HISTORICAL_ANALOGUE:
    "@/lib/trader/intelligence/information-inquiry/historical-analogue-contract-v1",
  TOP_DOWN_RECONSTRUCTION:
    "@/lib/trader/intelligence/information-inquiry/top-down-reconstruction-v1",
  PLANNER: "@/lib/trader/intelligence/information-inquiry/information-need-planner-v1",
  LOOP: "@/lib/trader/intelligence/information-inquiry/information-inquiry-loop-v1",
  SCHEDULER: "@/lib/trader/intelligence/information-inquiry/inquiry-scheduler-v1",
  RUNTIME: "@/lib/trader/intelligence/information-inquiry/information-inquiry-runtime-v1",
  BARREL: "@/lib/trader/intelligence/information-inquiry",
} as const;

export type InformationInquiryImportV1 = keyof typeof INFORMATION_INQUIRY_IMPORT_MODULES_V1;

export type InformationInquiryConsumerDispositionV1 =
  | "PURE_INTERNAL_COMPOSITION"
  | "LIVE_SELECTIVE_ACQUISITION"
  | "HISTORICAL_AS_OF_NETWORK_INERT"
  | "STANDARD_PAPER_FAIL_CLOSED"
  | "STANDARD_POLL_FAIL_CLOSED"
  | "STANDARD_WORKER_DEFAULT_FAIL_CLOSED"
  | "STANDARD_BACKTEST_AS_OF_FAIL_CLOSED"
  | "TYPE_ONLY"
  | "EXPORT_ONLY";

export type InformationInquiryConsumerEntryV1 = Readonly<{
  path: string;
  symbols: readonly string[];
  imports: readonly InformationInquiryImportV1[];
  disposition: InformationInquiryConsumerDispositionV1;
  createsCapitalAuthority: false;
}>;

export const INFORMATION_INQUIRY_PRODUCERS_V1 = [
  {
    path: INFORMATION_INQUIRY_RUNTIME_MODULES_V1.contracts,
    symbols: [
      "defineInformationInquiryPolicyV1",
      "defineInformationAcquisitionSelectionV1",
      "assertInformationAcquisitionSelectionV1",
    ],
    disposition: "IMMUTABLE_CONTENT_ADDRESSED_CONTRACT",
  },
  {
    path: INFORMATION_INQUIRY_RUNTIME_MODULES_V1.historicalAnalogue,
    symbols: ["defineHistoricalAnalogueQueryV1", "defineHistoricalAnalogueResultV1"],
    disposition: "INERT_ANALOGUE_IDENTITY_ONLY",
  },
  {
    path: INFORMATION_INQUIRY_RUNTIME_MODULES_V1.topDownReconstruction,
    symbols: ["defineTopDownReconstructionV1", "assertTopDownReconstructionV1"],
    disposition: "PURE_TOP_DOWN_RECONSTRUCTION",
  },
  {
    path: INFORMATION_INQUIRY_RUNTIME_MODULES_V1.planner,
    symbols: ["buildInformationNeedPlanningBundleV1", "assertInformationInquiryPlanningBundleV1"],
    disposition: "PROFILE_AUTHORIZED_DETERMINISTIC_PLANNER",
  },
  {
    path: INFORMATION_INQUIRY_RUNTIME_MODULES_V1.loop,
    symbols: ["runInformationInquiryLoopV1", "assertInformationInquiryLoopReceiptV1"],
    disposition: "BOUNDED_DETERMINISTIC_LOOP",
  },
  {
    path: INFORMATION_INQUIRY_RUNTIME_MODULES_V1.scheduler,
    symbols: ["scheduleInformationInquiryV1"],
    disposition: "BOUNDED_FAIR_SCHEDULER",
  },
  {
    path: INFORMATION_INQUIRY_RUNTIME_MODULES_V1.runtime,
    symbols: ["InformationInquiryCycleAuthorityResolverV1", "runInformationInquiryRuntimeV1"],
    disposition: "MANDATORY_FIRST_RUNTIME_COMPOSITION",
  },
] as const;

export const INFORMATION_INQUIRY_DIRECT_CONSUMERS_V1 = [
  {
    path: "lib/trader/intelligence/information-inquiry/information-inquiry-runtime-v1.ts",
    symbols: ["runInformationInquiryRuntimeV1"],
    imports: ["CONTRACTS", "LOOP", "PLANNER"],
    disposition: "PURE_INTERNAL_COMPOSITION",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/intelligence/information-inquiry/historical-analogue-contract-v1.ts",
    symbols: ["defineHistoricalAnalogueQueryV1"],
    imports: ["CONTRACTS"],
    disposition: "PURE_INTERNAL_COMPOSITION",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/intelligence/information-inquiry/information-inquiry-loop-v1.ts",
    symbols: ["runInformationInquiryLoopV1"],
    imports: ["CONTRACTS", "PLANNER"],
    disposition: "PURE_INTERNAL_COMPOSITION",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/intelligence/information-inquiry/information-need-planner-v1.ts",
    symbols: ["buildInformationNeedPlanningBundleV1"],
    imports: ["CONTRACTS", "HISTORICAL_ANALOGUE", "TOP_DOWN_RECONSTRUCTION"],
    disposition: "PURE_INTERNAL_COMPOSITION",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/intelligence/information-inquiry/inquiry-scheduler-v1.ts",
    symbols: ["scheduleInformationInquiryV1"],
    imports: ["CONTRACTS", "PLANNER"],
    disposition: "PURE_INTERNAL_COMPOSITION",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/intelligence/information-inquiry/top-down-reconstruction-v1.ts",
    symbols: ["defineTopDownReconstructionV1"],
    imports: ["CONTRACTS"],
    disposition: "PURE_INTERNAL_COMPOSITION",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/intelligence/information-inquiry/index.ts",
    symbols: ["contracts-v1", "information-inquiry-loop-v1"],
    imports: [
      "CONTRACTS",
      "HISTORICAL_ANALOGUE",
      "TOP_DOWN_RECONSTRUCTION",
      "PLANNER",
      "LOOP",
      "SCHEDULER",
      "RUNTIME",
    ],
    disposition: "EXPORT_ONLY",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/market-data/types.ts",
    symbols: ["InformationAcquisitionReceiptV1"],
    imports: ["CONTRACTS"],
    disposition: "TYPE_ONLY",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/market-data/market-data-gateway.ts",
    symbols: ["acquireSelectedInformation", "informationAcquisition"],
    imports: ["CONTRACTS"],
    disposition: "LIVE_SELECTIVE_ACQUISITION",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/market-data/htx-bar-poll-source.ts",
    symbols: ["fetchMandatoryEvaluationBundle", "fetchSelectedEvaluationBundle"],
    imports: ["CONTRACTS"],
    disposition: "LIVE_SELECTIVE_ACQUISITION",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/market-data/capture/capture-provider-snapshot.ts",
    symbols: ["captureProviderSnapshot", "informationSelection"],
    imports: ["CONTRACTS"],
    disposition: "LIVE_SELECTIVE_ACQUISITION",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/market-data/replay/information-need-replay-selection-v1.ts",
    symbols: ["selectInformationNeedReplayEvidenceV1"],
    imports: ["CONTRACTS"],
    disposition: "HISTORICAL_AS_OF_NETWORK_INERT",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/market-data/replay/historical-ingress-gateway.ts",
    symbols: ["buildHistoricalIngressContext", "informationSelection"],
    imports: ["CONTRACTS"],
    disposition: "HISTORICAL_AS_OF_NETWORK_INERT",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/paper/paper-cycle.types.ts",
    symbols: ["PaperInformationInquiryResolverV1"],
    imports: ["BARREL"],
    disposition: "TYPE_ONLY",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/paper/paper-cycle-runner.ts",
    symbols: ["resolveHtxInformationInquiryCycleV1", "runPaperCycleOnce"],
    imports: ["BARREL"],
    disposition: "STANDARD_PAPER_FAIL_CLOSED",
    createsCapitalAuthority: false,
  },
  {
    path: "lib/trader/backtest/backtest-runner.ts",
    symbols: ["informationInquiryResolver", "runInformationInquiryRuntimeV1"],
    imports: ["BARREL"],
    disposition: "STANDARD_BACKTEST_AS_OF_FAIL_CLOSED",
    createsCapitalAuthority: false,
  },
] as const satisfies readonly InformationInquiryConsumerEntryV1[];

export const INFORMATION_INQUIRY_STANDARD_COMPOSITION_V1 = [
  {
    path: "lib/trader/paper/paper-cycle.types.ts",
    symbols: ["PaperCycleInput", "PaperInformationInquiryResolverV1"],
    disposition: "TYPE_ONLY",
  },
  {
    path: "lib/trader/paper/paper-cycle-runner.ts",
    symbols: ["runPaperCycleOnce", "resolveHtxInformationInquiryCycleV1"],
    disposition: "STANDARD_PAPER_FAIL_CLOSED",
  },
  {
    path: "lib/trader/paper/paper-bar-close-loop.ts",
    symbols: ["runPaperBarCloseLoop", "informationInquiryResolver"],
    disposition: "STANDARD_POLL_FAIL_CLOSED",
  },
  {
    path: "lib/trader/paper/run-paper-loop-cycle.ts",
    symbols: ["runPaperLoopCycle", "resolveHtxInformationInquiryCycleV1"],
    disposition: "STANDARD_POLL_FAIL_CLOSED",
  },
  {
    path: "lib/trader/paper/paper-loop-worker.types.ts",
    symbols: ["PaperLoopCycleDeps", "informationInquiryResolver"],
    disposition: "TYPE_ONLY",
  },
  {
    path: "lib/trader/paper/build-worker-deps.ts",
    symbols: ["buildPaperLoopDepsFromEnv"],
    disposition: "STANDARD_WORKER_DEFAULT_FAIL_CLOSED",
  },
  {
    path: "lib/trader/backtest/backtest-runner.ts",
    symbols: ["runBacktest", "informationInquiryResolver", "runInformationInquiryRuntimeV1"],
    disposition: "STANDARD_BACKTEST_AS_OF_FAIL_CLOSED",
  },
] as const;

export const INFORMATION_INQUIRY_REPLAY_BOUNDARIES_V1 = [
  INFORMATION_INQUIRY_RUNTIME_MODULES_V1.historicalIngress,
  INFORMATION_INQUIRY_RUNTIME_MODULES_V1.historicalSelector,
] as const;

export const INFORMATION_INQUIRY_SUFFICIENCY_CONSUMERS_V1 = [
  {
    path: INFORMATION_INQUIRY_RUNTIME_MODULES_V1.contracts,
    symbols: ["InformationAnalysisPurposeV2", "InformationRequirementClassV2"],
    disposition: "DEE_621_CONTRACT_BINDING",
  },
  {
    path: INFORMATION_INQUIRY_RUNTIME_MODULES_V1.planner,
    symbols: ["assertRequiredInformationProfileV2", "assertInformationSufficiencyReceiptV2"],
    disposition: "DEE_621_PROFILE_AND_RECEIPT_BINDING",
  },
  {
    path: INFORMATION_INQUIRY_RUNTIME_MODULES_V1.loop,
    symbols: ["evaluateInformationSufficiencyV2"],
    disposition: "DEE_621_FINAL_HARD_FLOOR",
  },
  {
    path: INFORMATION_INQUIRY_RUNTIME_MODULES_V1.runtime,
    symbols: ["bindInformationSufficiencyReceiptAuthorityV2"],
    disposition: "DEE_621_RUNTIME_AUTHORITY_BINDING",
  },
] as const;

export const INFORMATION_INQUIRY_GUARDIAN_LANE_V1 = {
  path: "lib/trader/paper/paper-cycle-runner.ts",
  symbol: "runGuardianPhase",
  disposition: "SEPARATE_RISK_REDUCING_EXIT_LANE",
  consumesInquiry: false,
  blockedByNewOpportunityInquiry: false,
  createsCapitalAuthority: false,
} as const;

export const INFORMATION_INQUIRY_FORBIDDEN_AUTHORITY_SEGMENTS_V1 = [
  "/intelligence/forecast-decision/",
  "/risk/",
  "/execution/",
  "/reality/",
  "/guardian/",
  "/holdout/",
  "/live/",
] as const;

export const INFORMATION_INQUIRY_FORBIDDEN_BYPASS_MARKERS_V1 = [
  "INQUIRY_BYPASS",
  "SKIP_INFORMATION_INQUIRY",
  "ASSUME_INFORMATION_COMPLETE",
  "ALLOW_UNBOUNDED_INFORMATION_INQUIRY",
  "USE_LATEST_INQUIRY_EVIDENCE",
] as const;

export function auditInformationInquiryConsumerInventoryV1(): string[] {
  const errors: string[] = [];
  const directConsumers: readonly InformationInquiryConsumerEntryV1[] =
    INFORMATION_INQUIRY_DIRECT_CONSUMERS_V1;
  const directPaths = directConsumers.map((entry) => entry.path);
  if (new Set(directPaths).size !== directPaths.length) errors.push("DUPLICATE_DIRECT_CONSUMER");
  const compositionPaths = INFORMATION_INQUIRY_STANDARD_COMPOSITION_V1.map((entry) => entry.path);
  if (new Set(compositionPaths).size !== compositionPaths.length) {
    errors.push("DUPLICATE_STANDARD_COMPOSITION_SEAM");
  }
  for (const entry of directConsumers) {
    if (entry.symbols.length === 0) errors.push(`DIRECT_CONSUMER_WITHOUT_SYMBOL:${entry.path}`);
    if (entry.createsCapitalAuthority) errors.push(`CAPITAL_AUTHORITY_LEAK:${entry.path}`);
    if (
      INFORMATION_INQUIRY_FORBIDDEN_AUTHORITY_SEGMENTS_V1.some((segment) =>
        `/${entry.path}`.includes(segment),
      )
    ) {
      errors.push(`FORBIDDEN_AUTHORITY_CONSUMER:${entry.path}`);
    }
  }
  if (
    INFORMATION_INQUIRY_GUARDIAN_LANE_V1.consumesInquiry ||
    INFORMATION_INQUIRY_GUARDIAN_LANE_V1.blockedByNewOpportunityInquiry ||
    INFORMATION_INQUIRY_GUARDIAN_LANE_V1.createsCapitalAuthority
  ) {
    errors.push("GUARDIAN_LANE_AUTHORITY_MISMATCH");
  }
  return errors;
}
