import type { ReplayCheckpointRecord } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";

export type FhvOperatorStatusProducerValue<T> =
  | Readonly<{ available: true; value: T }>
  | Readonly<{ available: false; reason: "UNAVAILABLE" }>;

export function fhvProducerUnavailable<T>(): FhvOperatorStatusProducerValue<T> {
  return { available: false, reason: "UNAVAILABLE" };
}

export function fhvProducerValue<T>(value: T): FhvOperatorStatusProducerValue<T> {
  return { available: true, value };
}

export function resolveFhvProducerNumber(
  producer: FhvOperatorStatusProducerValue<number> | undefined,
): number | null {
  return producer?.available ? producer.value : null;
}

export function resolveFhvProducerString(
  producer: FhvOperatorStatusProducerValue<string> | undefined,
): string | null {
  return producer?.available ? producer.value : null;
}

export function produceFhvBarsProcessed(input: {
  explicitBarsProcessed?: number;
  checkpoint?: ReplayCheckpointRecord | null;
}): FhvOperatorStatusProducerValue<number> {
  if (typeof input.explicitBarsProcessed === "number") {
    return fhvProducerValue(input.explicitBarsProcessed);
  }
  if (input.checkpoint?.evidenceDurableThroughCycleIndex !== undefined) {
    return fhvProducerValue(input.checkpoint.evidenceDurableThroughCycleIndex);
  }
  return fhvProducerUnavailable();
}

export function produceFhvThroughputCyclesPerMinute(input: {
  barsProcessed: number | null;
  elapsedMs: number;
}): FhvOperatorStatusProducerValue<number> {
  if (input.barsProcessed === null || input.elapsedMs <= 0) {
    return fhvProducerUnavailable();
  }
  return fhvProducerValue(Math.round((input.barsProcessed / input.elapsedMs) * 1000 * 60));
}

export function produceFhvTradingSimulationCounts(input: {
  checkpoint?: ReplayCheckpointRecord | null;
}): Readonly<{
  ordersCount: FhvOperatorStatusProducerValue<number>;
  fillsCount: FhvOperatorStatusProducerValue<number>;
  openPositionsCount: FhvOperatorStatusProducerValue<number>;
  closedPositionsCount: FhvOperatorStatusProducerValue<number>;
}> {
  if (!input.checkpoint) {
    return {
      ordersCount: fhvProducerUnavailable(),
      fillsCount: fhvProducerUnavailable(),
      openPositionsCount: fhvProducerUnavailable(),
      closedPositionsCount: fhvProducerUnavailable(),
    };
  }
  const accounting = input.checkpoint.accountingFrontierState;
  return {
    ordersCount: fhvProducerValue(input.checkpoint.executionState?.openOrders?.length ?? 0),
    fillsCount: fhvProducerValue(accounting?.consumedFillIds?.length ?? 0),
    openPositionsCount: fhvProducerValue(
      accounting?.positionsJson ? Object.keys(accounting.positionsJson).length : 0,
    ),
    closedPositionsCount: fhvProducerUnavailable(),
  };
}

export function produceFhvEvidenceEventSequence(input: {
  checkpoint?: ReplayCheckpointRecord | null;
}): FhvOperatorStatusProducerValue<number> {
  if (!input.checkpoint) {
    return fhvProducerUnavailable();
  }
  return fhvProducerValue(0);
}

export function produceFhvHostStringStatus(
  value: string | null | undefined,
): FhvOperatorStatusProducerValue<string> {
  if (!value || value === "unknown") {
    return fhvProducerUnavailable();
  }
  return fhvProducerValue(value);
}
