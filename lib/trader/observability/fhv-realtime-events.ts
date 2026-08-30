import type { FhvOperatorStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";

export const FHV_REALTIME_EVENT_SCHEMA_VERSION = "fhv-realtime-event/v1" as const;

export type FhvRealtimeEventKind =
  | "campaign.progress"
  | "account.balance"
  | "position.snapshot"
  | "trade.snapshot"
  | "decision.snapshot"
  | "checkpoint"
  | "risk"
  | "gate"
  | "error";

export type FhvRealtimeEventV1 = Readonly<{
  schemaVersion: typeof FHV_REALTIME_EVENT_SCHEMA_VERSION;
  eventId: string;
  kind: FhvRealtimeEventKind;
  observedAt: string;
  organizationId: string;
  campaignRunId: string;
  source: "HISTORICAL_SIMULATION";
  payload: Readonly<Record<string, unknown>>;
}>;

function event(
  status: FhvOperatorStatusV1,
  kind: FhvRealtimeEventKind,
  ordinal: number,
  payload: Readonly<Record<string, unknown>>,
): FhvRealtimeEventV1 {
  const sequence = status.evidence.eventSequence ?? status.campaign.barsProcessed ?? 0;
  const observationSequence = Number.isFinite(Date.parse(status.observedAt))
    ? Date.parse(status.observedAt)
    : 0;
  return {
    schemaVersion: FHV_REALTIME_EVENT_SCHEMA_VERSION,
    eventId: `${status.campaign.runId}:${sequence}:${observationSequence}:${ordinal}`,
    kind,
    observedAt: status.observedAt,
    organizationId: status.campaign.organizationId,
    campaignRunId: status.campaign.runId,
    source: "HISTORICAL_SIMULATION",
    payload,
  };
}

/**
 * Converts the bounded, verified observer status into a browser-safe event batch.
 * Values absent from sealed evidence remain null; this function never consults HTX
 * credentials, real balances, or blind-holdout data.
 */
export function projectFhvRealtimeEvents(status: FhvOperatorStatusV1): readonly FhvRealtimeEventV1[] {
  const simulation = status.tradingSimulation;
  const virtualAccountId = `historical:${status.campaign.organizationId}`;
  return [
    event(status, "campaign.progress", 0, {
      phase: status.campaign.phase,
      partition: status.campaign.partition,
      currentSymbol: status.campaign.currentSymbol,
      historicalCursor: status.campaign.historicalCursor,
      barsProcessed: status.campaign.barsProcessed,
      barsTotal: status.campaign.barsTotal,
      completionPct: status.campaign.completionPct,
      throughputCurrent: status.campaign.throughputCurrent,
      throughputRolling: status.campaign.throughputRolling,
      etaUtc: status.campaign.etaUtc,
      terminalState: status.campaign.terminalState,
      terminalReason: status.campaign.terminalReason,
    }),
    event(status, "account.balance", 1, {
      accountId: virtualAccountId,
      accountKind: "HISTORICAL_VIRTUAL",
      currency: "USDT",
      cash: simulation.cash,
      equity: simulation.equity,
      delta24h: null,
      delta24hPct: null,
      realizedPnl: simulation.realizedPnl,
      unrealizedPnl: simulation.unrealizedPnl,
      grossPnl: simulation.grossPnl,
      netPnl: simulation.netPnl,
      exposure: simulation.exposure,
      openPositionsCount: simulation.openPositionsCount,
    }),
    event(status, "position.snapshot", 2, {
      accountId: virtualAccountId,
      openCount: simulation.openPositionsCount,
      closedCount: simulation.closedPositionsCount,
      openPositions: simulation.openPositionsSummary,
    }),
    event(status, "trade.snapshot", 3, {
      accountId: virtualAccountId,
      ordersCount: simulation.ordersCount,
      fillsCount: simulation.fillsCount,
      recentOrders: simulation.recentOrdersSummary,
      recentFills: simulation.recentFillsSummary,
    }),
    event(status, "decision.snapshot", 4, {
      regime: status.marketIntelligence.regime,
      conviction: status.marketIntelligence.conviction,
      cdePermission: status.marketIntelligence.cdePermission,
      allowedStrategyFamilies: status.marketIntelligence.allowedStrategyFamilies,
      vetoes: status.marketIntelligence.vetoesSummary,
      signalsCreated: status.strategies.signalsCreated,
      signalsRejected: status.strategies.signalsRejected,
      activeStrategyVersions: status.strategies.activeVersions,
    }),
    event(status, "checkpoint", 5, {
      lastCheckpointAt: status.campaign.lastCheckpointAt,
      checkpointAgeMs: status.campaign.checkpointAgeMs,
      integrity: status.evidence.checkpointIntegrity,
      lastSemanticEventId: status.evidence.lastSemanticEventId,
      eventSequence: status.evidence.eventSequence,
      eventStreamLagMs: status.evidence.eventStreamLagMs,
      artifactWriteHealth: status.evidence.artifactWriteHealth,
      evidenceHealth: status.evidence.evidenceHealth,
    }),
    event(status, "risk", 6, {
      guardianState: simulation.guardianState,
      accountDrawdownBps: simulation.accountDrawdownBps,
      monthlyDrawdownBps: simulation.monthlyDrawdownBps,
      reconciliationState: simulation.reconciliationState,
      alerts: status.recentAlerts,
    }),
    event(status, "gate", 7, {
      validationStatus: status.strategies.validationStatus,
      promotionStatus: status.strategies.promotionStatus,
      heartbeatState: status.campaign.heartbeatState,
      datasetDigest: status.campaign.datasetDigest,
      configurationDigest: status.campaign.configurationDigest,
      holdout: {
        state: "SEALED_NOT_ACCESSED",
        gate: "CLOSED",
        access: "PROHIBITED_UNTIL_OPERATOR_PROCEDURE",
      },
    }),
  ];
}

export function encodeFhvSseEvent(eventValue: FhvRealtimeEventV1): string {
  return `id: ${eventValue.eventId}\nevent: ${eventValue.kind}\ndata: ${JSON.stringify(eventValue)}\n\n`;
}

export function encodeFhvSseHeartbeat(observedAt: string): string {
  return `: heartbeat ${observedAt}\n\n`;
}

/** Bounded newest-snapshot queue used to cap memory for slow stream consumers. */
export class FhvSseFrameBuffer {
  readonly #maxFrames: number;
  readonly #frames: string[] = [];

  constructor(maxFrames = 64) {
    if (!Number.isInteger(maxFrames) || maxFrames < 1) throw new Error("INVALID_MAX_FRAMES");
    this.#maxFrames = maxFrames;
  }

  enqueueSnapshot(frames: readonly string[]): void {
    if (frames.length > this.#maxFrames) throw new Error("SSE_SNAPSHOT_TOO_LARGE");
    if (this.#frames.length + frames.length > this.#maxFrames) this.#frames.splice(0);
    this.#frames.push(...frames);
  }

  shift(): string | undefined {
    return this.#frames.shift();
  }

  get length(): number {
    return this.#frames.length;
  }
}
