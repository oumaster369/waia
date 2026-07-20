import type {
  QualificationAttemptResult,
  QualificationDatasetResult,
  QualificationDiagnosticGrowth,
  QualificationRunObservation,
} from "@/lib/trader/backtest/replay-qualification-harness";
import { D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS } from "@/lib/trader/backtest/replay-qualification-harness";

export const HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA =
  "htr-wp22-completed-runtime-qualification/v1" as const;

export const HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SEMANTIC_SCHEMA_V1 =
  "htr-wp22-completed-runtime-qualification-semantic/v1" as const;

export const HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE = "completed-runtime-d11b" as const;

export type HtrWp22CompletedRuntimeQualificationPhase =
  typeof HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE;

export type HtrWp22CompletedRuntimeQualificationTerminalState =
  | "HTR_WP22_COMPLETED_RUNTIME_D11B_PASS"
  | "HTR_WP22_COMPLETED_RUNTIME_D11B_THRESHOLDS_NOT_MET"
  | "HTR_WP22_COMPLETED_RUNTIME_D11B_ATTEMPT_INVALIDATED";

/** Frozen D-11B threshold numbers bound into the semantic digest (not amended here). */
export type HtrWp22D11bThresholdSnapshotV1 = {
  contract: typeof D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS.activeQualificationContract;
  qualificationBarCountN2: number;
  canvasAdvanceCountN2: number;
  integratedReplayCycleCountN2: number;
  maxTotalWallMs: number;
  maxMeanReplayCycleMs: number;
  maxP95ReplayCycleMs: number;
  max2xTimeGrowth: number;
  maxRssDeltaBytes: number;
  maxHeapDeltaBytes: number;
  max2xMemoryGrowthBytes: number;
  maxSerializedCanvasBytes: number;
  measuredWarmRunsPerN: number;
  maxFullDatasetRuntimeRangePct: number;
  maxN2P95PostGcLiveHeapDeltaBytes: number;
  maxBufferedProjections: number;
};

export type HtrWp22QualificationRunObservationSemanticV1 = {
  runLabel: string;
  isCold: boolean;
  runWallTimeMs: number;
  meanPaperCycleMs: number;
  p95PaperCycleMs: number;
  maxPaperCycleMs: number;
  rssDeltaBytes: number;
  heapUsedDeltaBytes: number;
  retainedCycleResults: number;
  serializedCanvasBytes: number;
  cycleCount: number;
  barCount: number;
  fullHistoryRescans: number;
  semanticReproDigest: string;
  evidenceDigest: string;
  baselineRssBytes?: number;
  peakRssBytes?: number;
  baselineHeapUsedBytes?: number;
  peakHeapUsedBytes?: number;
  preRunPostGcHeapUsedBytes?: number;
  postRunPostGcHeapUsedBytes?: number;
  postGcLiveHeapDeltaBytes?: number;
  peakBufferedProjections?: number;
  bars1mPrefixLength?: number;
  bars1mPrefixEstimatedReferenceBytes?: number;
};

export type HtrWp22QualificationDatasetAggregateSemanticV1 = {
  medianWallMs: number;
  maxWallMs: number;
  runtimeRangePct: number;
  meanPaperCycleMs: number;
  p95PaperCycleMs: number;
  maxPaperCycleMs: number;
  medianRssDeltaBytes: number;
  p95RssDeltaBytes: number;
  medianHeapDeltaBytes: number;
  p95HeapDeltaBytes: number;
  maxSerializedCanvasBytes: number;
  maxRetainedCycleResults: number;
  maxFullHistoryRescans: number;
  p95PostGcLiveHeapDeltaBytes?: number;
  maxPeakBufferedProjections?: number;
};

export type HtrWp22QualificationDatasetSemanticV1 = {
  size: QualificationDatasetResult["size"];
  barCount: number;
  canvasAdvanceCount: number;
  integratedReplayCycleCount: number;
  barSetDigest: string;
  warmRuns: HtrWp22QualificationRunObservationSemanticV1[];
  coldRun: HtrWp22QualificationRunObservationSemanticV1;
  aggregate: HtrWp22QualificationDatasetAggregateSemanticV1;
  n1ToN2WallTimeRatio?: number;
};

export type HtrWp22HostPreflightSemanticV1 = {
  nodeVersion: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMemBytes: number;
};

export type HtrWp22QualificationDiagnosticGrowthSemanticV1 = {
  rssGrowthFor2xN: number;
  heapGrowthFor2xN: number;
  rssGrowthGateResult: QualificationDiagnosticGrowth["rssGrowthGateResult"];
  heapGrowthGateResult: QualificationDiagnosticGrowth["heapGrowthGateResult"];
};

export type HtrWp22QualificationAttemptSemanticV1 = {
  schemaVersion: QualificationAttemptResult["schemaVersion"];
  terminalState: QualificationAttemptResult["terminalState"];
  gitSha: string;
  dirtyTree: boolean;
  hostFingerprintSha256: string;
  datasetSha256: string;
  n1: HtrWp22QualificationDatasetSemanticV1;
  n2: HtrWp22QualificationDatasetSemanticV1;
  hostPreflight: HtrWp22HostPreflightSemanticV1;
  activeQualificationContract?: NonNullable<
    QualificationAttemptResult["activeQualificationContract"]
  >;
  invalidationReason?: string;
  thresholdFailures?: string[];
  diagnosticGrowth?: HtrWp22QualificationDiagnosticGrowthSemanticV1;
};

export type HtrWp22CompletedRuntimeQualificationSemanticPayloadV1 = {
  semanticSchemaVersion: typeof HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SEMANTIC_SCHEMA_V1;
  schemaVersion: typeof HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA;
  phase: HtrWp22CompletedRuntimeQualificationPhase;
  terminalState: HtrWp22CompletedRuntimeQualificationTerminalState;
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  hostFingerprintSha256: string;
  d11bThresholdsBinding: "D11B_THRESHOLDS_UNCHANGED";
  d11bThresholdSnapshot: HtrWp22D11bThresholdSnapshotV1;
  qualificationHarnessSha256: string;
  qualificationAttempt: HtrWp22QualificationAttemptSemanticV1;
  invalidationReason?: string;
};

export type HtrWp22CompletedRuntimeQualificationResult = {
  schemaVersion: typeof HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA;
  phase: HtrWp22CompletedRuntimeQualificationPhase;
  terminalState: HtrWp22CompletedRuntimeQualificationTerminalState;
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  hostFingerprintSha256: string;
  d11bThresholdsBinding: "D11B_THRESHOLDS_UNCHANGED";
  qualificationHarnessSha256: string;
  qualificationAttempt: QualificationAttemptResult;
  invalidationReason?: string;
  payloadSha256?: string;
};

export function buildHtrWp22D11bThresholdSnapshotV1(): HtrWp22D11bThresholdSnapshotV1 {
  const t = D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS;
  return {
    contract: t.activeQualificationContract,
    qualificationBarCountN2: t.qualificationBarCountN2,
    canvasAdvanceCountN2: t.canvasAdvanceCountN2,
    integratedReplayCycleCountN2: t.integratedReplayCycleCountN2,
    maxTotalWallMs: t.maxTotalWallMs,
    maxMeanReplayCycleMs: t.maxMeanReplayCycleMs,
    maxP95ReplayCycleMs: t.maxP95ReplayCycleMs,
    max2xTimeGrowth: t.max2xTimeGrowth,
    maxRssDeltaBytes: t.maxRssDeltaBytes,
    maxHeapDeltaBytes: t.maxHeapDeltaBytes,
    max2xMemoryGrowthBytes: t.max2xMemoryGrowthBytes,
    maxSerializedCanvasBytes: t.maxSerializedCanvasBytes,
    measuredWarmRunsPerN: t.measuredWarmRunsPerN,
    maxFullDatasetRuntimeRangePct: t.maxFullDatasetRuntimeRangePct,
    maxN2P95PostGcLiveHeapDeltaBytes: t.maxN2P95PostGcLiveHeapDeltaBytes,
    maxBufferedProjections: t.maxBufferedProjections,
  };
}

export function toQualificationRunObservationSemanticV1(
  observation: QualificationRunObservation,
): HtrWp22QualificationRunObservationSemanticV1 {
  const semantic: HtrWp22QualificationRunObservationSemanticV1 = {
    runLabel: observation.runLabel,
    isCold: observation.isCold,
    runWallTimeMs: observation.runWallTimeMs,
    meanPaperCycleMs: observation.meanPaperCycleMs,
    p95PaperCycleMs: observation.p95PaperCycleMs,
    maxPaperCycleMs: observation.maxPaperCycleMs,
    rssDeltaBytes: observation.rssDeltaBytes,
    heapUsedDeltaBytes: observation.heapUsedDeltaBytes,
    retainedCycleResults: observation.retainedCycleResults,
    serializedCanvasBytes: observation.serializedCanvasBytes,
    cycleCount: observation.cycleCount,
    barCount: observation.barCount,
    fullHistoryRescans: observation.fullHistoryRescans,
    semanticReproDigest: observation.semanticReproDigest,
    evidenceDigest: observation.evidenceDigest,
  };

  if (observation.baselineRssBytes !== undefined) {
    semantic.baselineRssBytes = observation.baselineRssBytes;
  }
  if (observation.peakRssBytes !== undefined) {
    semantic.peakRssBytes = observation.peakRssBytes;
  }
  if (observation.baselineHeapUsedBytes !== undefined) {
    semantic.baselineHeapUsedBytes = observation.baselineHeapUsedBytes;
  }
  if (observation.peakHeapUsedBytes !== undefined) {
    semantic.peakHeapUsedBytes = observation.peakHeapUsedBytes;
  }
  if (observation.preRunPostGcHeapUsedBytes !== undefined) {
    semantic.preRunPostGcHeapUsedBytes = observation.preRunPostGcHeapUsedBytes;
  }
  if (observation.postRunPostGcHeapUsedBytes !== undefined) {
    semantic.postRunPostGcHeapUsedBytes = observation.postRunPostGcHeapUsedBytes;
  }
  if (observation.postGcLiveHeapDeltaBytes !== undefined) {
    semantic.postGcLiveHeapDeltaBytes = observation.postGcLiveHeapDeltaBytes;
  }
  if (observation.peakBufferedProjections !== undefined) {
    semantic.peakBufferedProjections = observation.peakBufferedProjections;
  }
  if (observation.bars1mPrefixLength !== undefined) {
    semantic.bars1mPrefixLength = observation.bars1mPrefixLength;
  }
  if (observation.bars1mPrefixEstimatedReferenceBytes !== undefined) {
    semantic.bars1mPrefixEstimatedReferenceBytes = observation.bars1mPrefixEstimatedReferenceBytes;
  }

  return semantic;
}

export function toQualificationDatasetSemanticV1(
  dataset: QualificationDatasetResult,
): HtrWp22QualificationDatasetSemanticV1 {
  const aggregate: HtrWp22QualificationDatasetAggregateSemanticV1 = {
    medianWallMs: dataset.aggregate.medianWallMs,
    maxWallMs: dataset.aggregate.maxWallMs,
    runtimeRangePct: dataset.aggregate.runtimeRangePct,
    meanPaperCycleMs: dataset.aggregate.meanPaperCycleMs,
    p95PaperCycleMs: dataset.aggregate.p95PaperCycleMs,
    maxPaperCycleMs: dataset.aggregate.maxPaperCycleMs,
    medianRssDeltaBytes: dataset.aggregate.medianRssDeltaBytes,
    p95RssDeltaBytes: dataset.aggregate.p95RssDeltaBytes,
    medianHeapDeltaBytes: dataset.aggregate.medianHeapDeltaBytes,
    p95HeapDeltaBytes: dataset.aggregate.p95HeapDeltaBytes,
    maxSerializedCanvasBytes: dataset.aggregate.maxSerializedCanvasBytes,
    maxRetainedCycleResults: dataset.aggregate.maxRetainedCycleResults,
    maxFullHistoryRescans: dataset.aggregate.maxFullHistoryRescans,
  };

  if (dataset.aggregate.p95PostGcLiveHeapDeltaBytes !== undefined) {
    aggregate.p95PostGcLiveHeapDeltaBytes = dataset.aggregate.p95PostGcLiveHeapDeltaBytes;
  }
  if (dataset.aggregate.maxPeakBufferedProjections !== undefined) {
    aggregate.maxPeakBufferedProjections = dataset.aggregate.maxPeakBufferedProjections;
  }

  const semantic: HtrWp22QualificationDatasetSemanticV1 = {
    size: dataset.size,
    barCount: dataset.barCount,
    canvasAdvanceCount: dataset.canvasAdvanceCount,
    integratedReplayCycleCount: dataset.integratedReplayCycleCount,
    barSetDigest: dataset.barSetDigest,
    warmRuns: dataset.warmRuns.map(toQualificationRunObservationSemanticV1),
    coldRun: toQualificationRunObservationSemanticV1(dataset.coldRun),
    aggregate,
  };

  if (dataset.n1ToN2WallTimeRatio !== undefined) {
    semantic.n1ToN2WallTimeRatio = dataset.n1ToN2WallTimeRatio;
  }

  return semantic;
}

export function toQualificationAttemptSemanticV1(
  attempt: QualificationAttemptResult,
): HtrWp22QualificationAttemptSemanticV1 {
  const semantic: HtrWp22QualificationAttemptSemanticV1 = {
    schemaVersion: attempt.schemaVersion,
    terminalState: attempt.terminalState,
    gitSha: attempt.gitSha,
    dirtyTree: attempt.dirtyTree,
    hostFingerprintSha256: attempt.hostFingerprintSha256,
    datasetSha256: attempt.datasetSha256,
    n1: toQualificationDatasetSemanticV1(attempt.n1),
    n2: toQualificationDatasetSemanticV1(attempt.n2),
    hostPreflight: {
      nodeVersion: attempt.hostPreflight.nodeVersion,
      platform: attempt.hostPreflight.platform,
      arch: attempt.hostPreflight.arch,
      cpuModel: attempt.hostPreflight.cpuModel,
      cpuCount: attempt.hostPreflight.cpuCount,
      totalMemBytes: attempt.hostPreflight.totalMemBytes,
    },
  };

  if (attempt.activeQualificationContract !== undefined) {
    semantic.activeQualificationContract = attempt.activeQualificationContract;
  }
  if (attempt.invalidationReason !== undefined) {
    semantic.invalidationReason = attempt.invalidationReason;
  }
  if (attempt.thresholdFailures !== undefined) {
    semantic.thresholdFailures = [...attempt.thresholdFailures];
  }
  if (attempt.diagnosticGrowth !== undefined) {
    semantic.diagnosticGrowth = {
      rssGrowthFor2xN: attempt.diagnosticGrowth.rssGrowthFor2xN,
      heapGrowthFor2xN: attempt.diagnosticGrowth.heapGrowthFor2xN,
      rssGrowthGateResult: attempt.diagnosticGrowth.rssGrowthGateResult,
      heapGrowthGateResult: attempt.diagnosticGrowth.heapGrowthGateResult,
    };
  }

  return semantic;
}

export function toHtrWp22CompletedRuntimeQualificationSemanticPayloadV1(input: {
  terminalState: HtrWp22CompletedRuntimeQualificationTerminalState;
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  hostFingerprintSha256: string;
  qualificationHarnessSha256: string;
  qualificationAttempt: QualificationAttemptResult;
  invalidationReason?: string;
}): HtrWp22CompletedRuntimeQualificationSemanticPayloadV1 {
  const payload: HtrWp22CompletedRuntimeQualificationSemanticPayloadV1 = {
    semanticSchemaVersion: HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SEMANTIC_SCHEMA_V1,
    schemaVersion: HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA,
    phase: HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE,
    terminalState: input.terminalState,
    sourceGitSha: input.sourceGitSha,
    sourceDirtyTree: input.sourceDirtyTree,
    hostFingerprintSha256: input.hostFingerprintSha256,
    d11bThresholdsBinding: "D11B_THRESHOLDS_UNCHANGED",
    d11bThresholdSnapshot: buildHtrWp22D11bThresholdSnapshotV1(),
    qualificationHarnessSha256: input.qualificationHarnessSha256,
    qualificationAttempt: toQualificationAttemptSemanticV1(input.qualificationAttempt),
  };

  if (input.invalidationReason !== undefined) {
    payload.invalidationReason = input.invalidationReason;
  }

  return payload;
}
