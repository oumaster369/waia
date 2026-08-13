import type {
  FhvCampaignKind,
  FHV_OPERATOR_STATUS_SCHEMA_VERSION,
} from "@/lib/trader/observability/fhv-observability.constants";

export type FhvBoundedSummaryItem = Readonly<{
  id: string;
  label: string;
  atUtc: string;
  artifactRef: string;
}>;

export type FhvHoldoutStatusV1 = Readonly<{
  holdoutState: "SEALED_NOT_ACCESSED";
  holdoutGate: "CLOSED" | "OPEN";
  holdoutDatasetDigest: string;
  holdoutAccessAttempts: number;
  blindHoldoutStatus: "SEALED_NOT_ACCESSED";
  holdoutAccess: "PROHIBITED_UNTIL_OPERATOR_PROCEDURE";
}>;

export type FhvOperatorStatusV1 = Readonly<{
  schemaVersion: typeof FHV_OPERATOR_STATUS_SCHEMA_VERSION;
  observedAt: string;
  campaignKind: FhvCampaignKind;
  alertPolicyDigest: string;
  campaign: Readonly<{
    organizationId: string;
    runId: string;
    phase: string;
    codeSha: string;
    artifactDigest: string;
    datasetSeal: string;
    datasetDigest: string;
    configurationDigest: string;
    currentSymbol: string | null;
    historicalCursor: string | null;
    partition: string;
    barsProcessed: number | null;
    barsTotal: number | null;
    completionPct: number | null;
    throughputCurrent: number | null;
    throughputRolling: number | null;
    etaUtc: string | null;
    startedAt: string;
    elapsedMs: number;
    lastCheckpointAt: string | null;
    checkpointAgeMs: number | null;
    heartbeatAt: string | null;
    heartbeatState: string;
    heartbeatAgeMs: number | null;
    processRestartCount: number | null;
    terminalState: string;
    terminalReason: string | null;
  }>;
  host: Readonly<{
    cpuPct: number | null;
    loadAvg1: number | null;
    loadAvg5: number | null;
    loadAvg15: number | null;
    ramUsedPct: number | null;
    swapUsedPct: number | null;
    diskFreeBytes: number | null;
    diskTotalBytes: number | null;
    artifactDirBytes: number | null;
    artifactGrowthBytesPerHour: number | null;
    inodeUsedPct: number | null;
    processStatus: string | null;
    serviceStatus: string | null;
    postgresConnectivity: "ok" | "degraded" | "unavailable" | "unknown";
    datasetReadable: boolean | null;
    openFiles: number | null;
    ntpHealthy: boolean | null;
  }>;
  marketIntelligence: Readonly<{
    regime: string | null;
    dataQualityScore: number | null;
    activeHypothesesSummary: readonly FhvBoundedSummaryItem[];
    competingHypothesesSummary: readonly FhvBoundedSummaryItem[];
    conviction: number | null;
    cdePermission: string | null;
    allowedStrategyFamilies: readonly string[];
    vetoesSummary: readonly FhvBoundedSummaryItem[];
    terminalReasonCodes: readonly string[];
    marketStateConfidence: number | null;
  }>;
  strategies: Readonly<{
    activeVersions: readonly string[];
    eligibility: string | null;
    signalsCreated: number | null;
    signalsRejected: number | null;
    candidateStrategiesSummary: readonly FhvBoundedSummaryItem[];
    validationStatus: string | null;
    promotionStatus: string | null;
  }>;
  tradingSimulation: Readonly<{
    ordersCount: number | null;
    fillsCount: number | null;
    openPositionsCount: number | null;
    closedPositionsCount: number | null;
    cash: string | null;
    equity: string | null;
    grossPnl: string | null;
    netPnl: string | null;
    realizedPnl: string | null;
    unrealizedPnl: string | null;
    accountDrawdownBps: number | null;
    monthlyDrawdownBps: number | null;
    exposure: string | null;
    guardianState: string | null;
    reconciliationState: "ok" | "degraded" | "failed" | "unknown" | null;
    accountingFrontierSequence: number | null;
    recentOrdersSummary: readonly FhvBoundedSummaryItem[];
    recentFillsSummary: readonly FhvBoundedSummaryItem[];
    openPositionsSummary: readonly FhvBoundedSummaryItem[];
  }>;
  evidence: Readonly<{
    lastSemanticEventId: string | null;
    eventSequence: number | null;
    eventStreamLagMs: number | null;
    lastSealedArtifactRef: string | null;
    artifactWriteHealth: "ok" | "degraded" | "failed" | "UNAVAILABLE";
    evidenceHealth: "ok" | "degraded" | "failed" | "UNAVAILABLE";
    digestState: string;
    reportGenerationState: string;
    checkpointIntegrity: "ok" | "degraded" | "failed";
    coverageMatrixState: string | null;
    recentEvidenceEventIds: readonly string[];
  }>;
  holdout: FhvHoldoutStatusV1;
  recentAlerts: readonly FhvBoundedSummaryItem[];
  pagination: Readonly<{
    alerts: string | null;
    semanticEvents: string | null;
    orders: string | null;
    fills: string | null;
    commands: string | null;
  }>;
}>;
