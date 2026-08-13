import { readFileSync, statSync } from "node:fs";

import type { ReplayCheckpointRecord } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { computeFhvAlertPolicyDigest } from "@/lib/trader/observability/fhv-alert-policy-v1";
import { buildClosedHoldoutStatus } from "@/lib/trader/observability/fhv-holdout-redaction";
import {
  FHV_OPERATOR_STATUS_MAX_BYTES,
  FHV_OPERATOR_STATUS_SCHEMA_VERSION,
  FHV_STATUS_MAX_CANDIDATES,
  FHV_STATUS_MAX_EVIDENCE_EVENT_IDS,
  FHV_STATUS_MAX_HYPOTHESES,
  FHV_STATUS_MAX_OPEN_POSITIONS,
  FHV_STATUS_MAX_RECENT_ALERTS,
  FHV_STATUS_MAX_RECENT_FILLS,
  FHV_STATUS_MAX_RECENT_ORDERS,
  FHV_STATUS_MAX_RISK_REDUCTIONS,
  FHV_STATUS_MAX_VETOES,
  type FhvCampaignKind,
} from "@/lib/trader/observability/fhv-observability.constants";
import {
  produceFhvBarsProcessed,
  produceFhvEvidenceEventSequence,
  produceFhvEvidenceHealth,
  produceFhvHostStringStatus,
  produceFhvThroughputCyclesPerMinute,
  produceFhvTradingSimulationCounts,
  resolveFhvProducerNumber,
  resolveFhvProducerString,
} from "@/lib/trader/observability/fhv-operator-status-producers";
import {
  resolveBarsTotal,
  resolveCampaignTerminalState,
} from "@/lib/trader/observability/fhv-telemetry-probes";

import type {
  FhvBoundedSummaryItem,
  FhvOperatorStatusV1,
} from "@/lib/trader/observability/fhv-operator-status-v1.types";

function truncateSummaries<T>(items: readonly T[], max: number): readonly T[] {
  return items.slice(0, max);
}

export type BuildFhvOperatorStatusInput = Readonly<{
  observedAt?: string;
  campaignKind?: FhvCampaignKind;
  alertPolicyDigest?: string;
  organizationId?: string;
  runId: string;
  phase: string;
  codeSha: string;
  artifactDigest: string;
  datasetSeal: string;
  datasetDigest: string;
  configurationDigest: string;
  currentSymbol?: string | null;
  historicalCursor?: string | null;
  partition?: string;
  barsProcessed?: number;
  barsTotal?: number;
  startedAt?: string;
  lastCheckpointAt?: string | null;
  heartbeatAt?: string | null;
  heartbeatState?: string;
  heartbeatAgeMs?: number | null;
  processRestartCount?: number;
  terminalState?: string;
  terminalReason?: string | null;
  checkpoint?: ReplayCheckpointRecord | null;
  hostTelemetry?: Partial<FhvOperatorStatusV1["host"]>;
  holdoutDatasetDigest?: string;
  recentAlerts?: readonly FhvBoundedSummaryItem[];
  evidenceHealth?: "ok" | "degraded" | "failed" | "UNAVAILABLE";
  /** Authoritative evidence-stream sequence when a real producer exists. */
  authoritativeEvidenceEventSequence?: number;
}>;

export function buildFhvOperatorStatusV1(input: BuildFhvOperatorStatusInput): FhvOperatorStatusV1 {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const startedAt = input.startedAt ?? observedAt;
  const heartbeatAt = input.heartbeatAt ?? null;
  const heartbeatState = input.heartbeatState ?? (heartbeatAt ? "OK" : "UNKNOWN_OR_MISSING");
  const barsProcessedProducer = produceFhvBarsProcessed({
    explicitBarsProcessed: input.barsProcessed,
    checkpoint: input.checkpoint,
  });
  const barsProcessed = resolveFhvProducerNumber(barsProcessedProducer);
  const barsTotal = resolveBarsTotal({
    pinnedBarsTotal: input.barsTotal ?? null,
    manifestBarsTotal: null,
  });
  const completionPct =
    barsTotal !== null && barsTotal > 0 && barsProcessed !== null
      ? Math.min(100, (barsProcessed / barsTotal) * 100)
      : null;
  const elapsedMs = Math.max(0, Date.parse(observedAt) - Date.parse(startedAt));
  const checkpointAgeMs = input.lastCheckpointAt
    ? Math.max(0, Date.parse(observedAt) - Date.parse(input.lastCheckpointAt))
    : null;
  const heartbeatAgeMs =
    heartbeatAt !== null
      ? Math.max(0, Date.parse(observedAt) - Date.parse(heartbeatAt))
      : (input.heartbeatAgeMs ?? null);
  const throughputProducer = produceFhvThroughputCyclesPerMinute({
    barsProcessed,
    elapsedMs,
  });
  const throughputCurrent = resolveFhvProducerNumber(throughputProducer);
  const tradingCounts = produceFhvTradingSimulationCounts({ checkpoint: input.checkpoint });
  const eventSequence = resolveFhvProducerNumber(
    produceFhvEvidenceEventSequence({
      checkpoint: input.checkpoint,
      authoritativeEventSequence: input.authoritativeEvidenceEventSequence,
    }),
  );
  const evidenceHealthProducer = produceFhvEvidenceHealth({
    evidenceHealth: input.evidenceHealth,
  });
  const evidenceHealthValue = evidenceHealthProducer.available
    ? evidenceHealthProducer.value
    : ("UNAVAILABLE" as const);

  const accounting = input.checkpoint?.accountingFrontierState;

  const status: FhvOperatorStatusV1 = {
    schemaVersion: FHV_OPERATOR_STATUS_SCHEMA_VERSION,
    observedAt,
    campaignKind: input.campaignKind ?? "CERTIFIED_BASELINE_FHV",
    alertPolicyDigest: input.alertPolicyDigest ?? computeFhvAlertPolicyDigest(),
    campaign: {
      organizationId: input.organizationId ?? "unknown",
      runId: input.runId,
      phase: input.phase,
      codeSha: input.codeSha,
      artifactDigest: input.artifactDigest,
      datasetSeal: input.datasetSeal,
      datasetDigest: input.datasetDigest,
      configurationDigest: input.configurationDigest,
      currentSymbol: input.currentSymbol ?? null,
      historicalCursor: input.historicalCursor ?? null,
      partition: input.partition ?? "developmentCalibration",
      barsProcessed,
      barsTotal,
      completionPct,
      throughputCurrent,
      throughputRolling: throughputCurrent,
      etaUtc: null,
      startedAt,
      elapsedMs,
      lastCheckpointAt: input.lastCheckpointAt ?? null,
      checkpointAgeMs,
      heartbeatAt,
      heartbeatState,
      heartbeatAgeMs,
      processRestartCount:
        typeof input.processRestartCount === "number" ? input.processRestartCount : null,
      terminalState: resolveCampaignTerminalState({
        explicitTerminalState: input.terminalState,
        checkpointTerminalState: input.checkpoint?.replayTerminalState ?? null,
        campaignRunning: input.terminalState === "RUNNING",
      }),
      terminalReason: input.terminalReason ?? null,
    },
    host: {
      cpuPct: input.hostTelemetry?.cpuPct ?? null,
      loadAvg1: input.hostTelemetry?.loadAvg1 ?? null,
      loadAvg5: input.hostTelemetry?.loadAvg5 ?? null,
      loadAvg15: input.hostTelemetry?.loadAvg15 ?? null,
      ramUsedPct: input.hostTelemetry?.ramUsedPct ?? null,
      swapUsedPct: input.hostTelemetry?.swapUsedPct ?? null,
      diskFreeBytes: input.hostTelemetry?.diskFreeBytes ?? null,
      diskTotalBytes: input.hostTelemetry?.diskTotalBytes ?? null,
      artifactDirBytes: input.hostTelemetry?.artifactDirBytes ?? null,
      artifactGrowthBytesPerHour: input.hostTelemetry?.artifactGrowthBytesPerHour ?? null,
      inodeUsedPct: input.hostTelemetry?.inodeUsedPct ?? null,
      processStatus: resolveFhvProducerString(
        produceFhvHostStringStatus(input.hostTelemetry?.processStatus),
      ),
      serviceStatus: resolveFhvProducerString(
        produceFhvHostStringStatus(input.hostTelemetry?.serviceStatus),
      ),
      postgresConnectivity: input.hostTelemetry?.postgresConnectivity ?? "unknown",
      datasetReadable:
        input.hostTelemetry?.datasetReadable === undefined
          ? null
          : input.hostTelemetry.datasetReadable,
      openFiles: input.hostTelemetry?.openFiles ?? null,
      ntpHealthy: input.hostTelemetry?.ntpHealthy ?? null,
    },
    marketIntelligence: {
      regime: null,
      dataQualityScore: null,
      activeHypothesesSummary: truncateSummaries([], FHV_STATUS_MAX_HYPOTHESES),
      competingHypothesesSummary: truncateSummaries([], FHV_STATUS_MAX_HYPOTHESES),
      conviction: null,
      cdePermission: null,
      allowedStrategyFamilies: [],
      vetoesSummary: truncateSummaries([], FHV_STATUS_MAX_VETOES),
      terminalReasonCodes: input.terminalReason ? [input.terminalReason] : [],
      marketStateConfidence: null,
    },
    strategies: {
      activeVersions: [],
      eligibility: null,
      signalsCreated: null,
      signalsRejected: null,
      candidateStrategiesSummary: truncateSummaries([], FHV_STATUS_MAX_CANDIDATES),
      validationStatus: null,
      promotionStatus: null,
    },
    tradingSimulation: {
      ordersCount: resolveFhvProducerNumber(tradingCounts.ordersCount),
      fillsCount: resolveFhvProducerNumber(tradingCounts.fillsCount),
      openPositionsCount: resolveFhvProducerNumber(tradingCounts.openPositionsCount),
      closedPositionsCount: resolveFhvProducerNumber(tradingCounts.closedPositionsCount),
      cash: accounting?.cash ?? null,
      equity: accounting?.equity ?? null,
      grossPnl: accounting?.grossRealizedPnl ?? null,
      netPnl: accounting?.netRealizedPnl ?? null,
      realizedPnl: accounting?.netRealizedPnl ?? null,
      unrealizedPnl: null,
      accountDrawdownBps: accounting?.accountDrawdownBps ?? null,
      monthlyDrawdownBps: accounting?.monthlyDrawdownBps ?? null,
      exposure: null,
      guardianState: input.checkpoint?.drawdownHwmState?.breachState ?? null,
      reconciliationState: null,
      accountingFrontierSequence: accounting?.accountingSequence ?? null,
      recentOrdersSummary: truncateSummaries([], FHV_STATUS_MAX_RECENT_ORDERS),
      recentFillsSummary: truncateSummaries([], FHV_STATUS_MAX_RECENT_FILLS),
      openPositionsSummary: truncateSummaries([], FHV_STATUS_MAX_OPEN_POSITIONS),
    },
    evidence: {
      lastSemanticEventId: null,
      eventSequence,
      eventStreamLagMs: null,
      lastSealedArtifactRef: input.checkpoint?.evidenceChainDigest
        ? `fhv-artifact/v1/evidence-chunk/${input.runId}/manifest#0`
        : null,
      artifactWriteHealth: evidenceHealthValue,
      evidenceHealth: evidenceHealthValue,
      digestState: input.checkpoint?.checkpointDigest ?? "unknown",
      reportGenerationState: "pending",
      checkpointIntegrity: input.checkpoint ? "ok" : "degraded",
      coverageMatrixState: null,
      recentEvidenceEventIds: truncateSummaries([], FHV_STATUS_MAX_EVIDENCE_EVENT_IDS),
    },
    holdout: buildClosedHoldoutStatus({
      holdoutDatasetDigest: input.holdoutDatasetDigest ?? input.datasetDigest,
    }),
    recentAlerts: truncateSummaries(input.recentAlerts ?? [], FHV_STATUS_MAX_RECENT_ALERTS),
    pagination: {
      alerts: null,
      semanticEvents: null,
      orders: null,
      fills: null,
      commands: null,
    },
  };

  return enforceFhvOperatorStatusSizeCap(status);
}

export function enforceFhvOperatorStatusSizeCap(status: FhvOperatorStatusV1): FhvOperatorStatusV1 {
  let serialized = JSON.stringify(status);
  if (Buffer.byteLength(serialized, "utf8") <= FHV_OPERATOR_STATUS_MAX_BYTES) {
    return status;
  }
  const trimmed: FhvOperatorStatusV1 = {
    ...status,
    recentAlerts: truncateSummaries(status.recentAlerts, 5),
    marketIntelligence: {
      ...status.marketIntelligence,
      activeHypothesesSummary: truncateSummaries(
        status.marketIntelligence.activeHypothesesSummary,
        2,
      ),
      competingHypothesesSummary: truncateSummaries(
        status.marketIntelligence.competingHypothesesSummary,
        2,
      ),
      vetoesSummary: truncateSummaries(status.marketIntelligence.vetoesSummary, 2),
    },
    tradingSimulation: {
      ...status.tradingSimulation,
      recentOrdersSummary: [],
      recentFillsSummary: [],
      openPositionsSummary: [],
    },
    evidence: {
      ...status.evidence,
      recentEvidenceEventIds: [],
    },
  };
  serialized = JSON.stringify(trimmed);
  if (Buffer.byteLength(serialized, "utf8") > FHV_OPERATOR_STATUS_MAX_BYTES) {
    throw new Error("FHV_OPERATOR_STATUS_SIZE_CAP_EXCEEDED");
  }
  return trimmed;
}

export function readFhvOperatorStatusFromFile(filePath: string): FhvOperatorStatusV1 {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as FhvOperatorStatusV1;
}

export function statFhvOperatorStatusFile(filePath: string): { bytes: number; mtimeMs: number } {
  const st = statSync(filePath);
  return { bytes: st.size, mtimeMs: st.mtimeMs };
}
