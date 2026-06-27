import { LIQUIDITY_SWEEP_REVERSAL_V0, MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";

/** Canonical P5 two-strategy soak targets (NEW-10 / DEE-337). */
export const P5_TWO_STRATEGY_SOAK_IDS = [LIQUIDITY_SWEEP_REVERSAL_V0, MEAN_REVERSION_V0] as const;

export type PaperSoakLogAnalysisInput = {
  logContent: string;
  /** Strategy IDs that must appear in telemetry at least once. Defaults to P5 pair. */
  expectedStrategyIds?: readonly string[];
  /** Bar-close cadence used during soak (default 60_000 ms). */
  barIntervalMs?: number;
  /** Minimum soak duration in hours (default 48). */
  minDurationHours?: number;
};

export type PaperSoakLogAnalysis = {
  totalLines: number;
  parsedJsonLines: number;
  paperLoopCycleCompleteCount: number;
  paperLoopCriticalCount: number;
  paperLoopCriticalCycleIds: string[];
  paperLoopWorkerErrorCount: number;
  distinctStrategyIdsObserved: string[];
  strategyIdCycleHits: Record<string, number>;
  rollupCount: number;
  estimatedDurationHours: number | null;
  minCyclesRequired: number;
  meetsCycleDurationThreshold: boolean;
  meetsBothStrategiesObserved: boolean;
  meetsCriticalZero: boolean;
  /** True only when duration, strategies, and critical=0 gates pass. Closed-trade proof is DB-side. */
  logEvidenceReadyForClosure: boolean;
  blockingReasons: string[];
};

type ParsedTelemetry = {
  kind?: unknown;
  outcome?: unknown;
  severity?: unknown;
  cycle_id?: unknown;
  strategy_ids?: unknown;
};

function parseJsonLine(line: string): unknown | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function asTelemetryRecord(parsed: unknown): ParsedTelemetry | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.event !== "waia_trader_event" && record.event !== "waia_paper_loop") {
    return null;
  }
  return record;
}

function splitStrategyIds(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") {
    return [];
  }
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function analyzePaperSoakLog(input: PaperSoakLogAnalysisInput): PaperSoakLogAnalysis {
  const expectedStrategyIds = input.expectedStrategyIds ?? P5_TWO_STRATEGY_SOAK_IDS;
  const barIntervalMs = input.barIntervalMs ?? 60_000;
  const minDurationHours = input.minDurationHours ?? 48;
  const minCyclesRequired = Math.ceil((minDurationHours * 3_600_000) / barIntervalMs);

  const lines = input.logContent.split(/\r?\n/);
  let parsedJsonLines = 0;
  let paperLoopCycleCompleteCount = 0;
  let paperLoopCriticalCount = 0;
  const paperLoopCriticalCycleIds: string[] = [];
  let paperLoopWorkerErrorCount = 0;
  let rollupCount = 0;
  const strategyIdCycleHits: Record<string, number> = {};
  const distinctStrategyIds = new Set<string>();

  for (const line of lines) {
    const parsed = parseJsonLine(line);
    if (parsed === null) {
      continue;
    }
    parsedJsonLines += 1;

    const record = asTelemetryRecord(parsed);
    if (record === null) {
      continue;
    }

    if ((parsed as Record<string, unknown>).event === "waia_paper_loop") {
      if ((parsed as Record<string, unknown>).phase === "cycle_error") {
        paperLoopWorkerErrorCount += 1;
      }
      continue;
    }

    if (record.kind !== "paper_loop") {
      continue;
    }

    if (record.severity === "critical") {
      paperLoopCriticalCount += 1;
      if (typeof record.cycle_id === "string") {
        paperLoopCriticalCycleIds.push(record.cycle_id);
      }
    }

    if (record.outcome === "rollup") {
      rollupCount += 1;
      continue;
    }

    if (record.outcome !== "cycle_complete") {
      continue;
    }

    paperLoopCycleCompleteCount += 1;
    for (const strategyId of splitStrategyIds(record.strategy_ids)) {
      distinctStrategyIds.add(strategyId);
      strategyIdCycleHits[strategyId] = (strategyIdCycleHits[strategyId] ?? 0) + 1;
    }
  }

  const estimatedDurationHours =
    paperLoopCycleCompleteCount > 0
      ? (paperLoopCycleCompleteCount * barIntervalMs) / 3_600_000
      : null;

  const meetsCycleDurationThreshold = paperLoopCycleCompleteCount >= minCyclesRequired;
  const meetsBothStrategiesObserved = expectedStrategyIds.every((id) =>
    distinctStrategyIds.has(id),
  );
  const meetsCriticalZero = paperLoopCriticalCount === 0 && paperLoopWorkerErrorCount === 0;

  const blockingReasons: string[] = [];
  if (!meetsCycleDurationThreshold) {
    blockingReasons.push(
      `cycle_complete count ${paperLoopCycleCompleteCount} < required ${minCyclesRequired} (~${minDurationHours}h at ${barIntervalMs}ms cadence)`,
    );
  }
  if (!meetsBothStrategiesObserved) {
    const missing = expectedStrategyIds.filter((id) => !distinctStrategyIds.has(id));
    blockingReasons.push(`strategy_ids missing from telemetry: ${missing.join(", ")}`);
  }
  if (!meetsCriticalZero) {
    blockingReasons.push(
      `critical telemetry=${paperLoopCriticalCount}, worker cycle_error=${paperLoopWorkerErrorCount}`,
    );
  }

  return {
    totalLines: lines.length,
    parsedJsonLines,
    paperLoopCycleCompleteCount,
    paperLoopCriticalCount,
    paperLoopCriticalCycleIds,
    paperLoopWorkerErrorCount,
    distinctStrategyIdsObserved: [...distinctStrategyIds].sort((a, b) => a.localeCompare(b)),
    strategyIdCycleHits,
    rollupCount,
    estimatedDurationHours,
    minCyclesRequired,
    meetsCycleDurationThreshold,
    meetsBothStrategiesObserved,
    meetsCriticalZero,
    logEvidenceReadyForClosure:
      meetsCycleDurationThreshold && meetsBothStrategiesObserved && meetsCriticalZero,
    blockingReasons,
  };
}
