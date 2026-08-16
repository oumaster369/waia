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
  const ordersCount =
    accounting?.cumulativeOrdersCount ?? input.checkpoint.executionState?.openOrders?.length;
  const fillsCount = accounting?.cumulativeFillsCount ?? accounting?.consumedFillIds?.length;
  if (ordersCount === undefined || fillsCount === undefined) {
    return {
      ordersCount: fhvProducerUnavailable(),
      fillsCount: fhvProducerUnavailable(),
      openPositionsCount: accounting?.positionsJson
        ? fhvProducerValue(Object.keys(accounting.positionsJson).length)
        : fhvProducerUnavailable(),
      closedPositionsCount: fhvProducerUnavailable(),
    };
  }
  return {
    ordersCount: fhvProducerValue(ordersCount),
    fillsCount: fhvProducerValue(fillsCount),
    openPositionsCount: fhvProducerValue(
      accounting?.positionsJson ? Object.keys(accounting.positionsJson).length : 0,
    ),
    closedPositionsCount: fhvProducerUnavailable(),
  };
}

export function produceFhvEvidenceEventSequence(input: {
  checkpoint?: ReplayCheckpointRecord | null;
  /** Authoritative measured sequence when a real evidence-stream producer exists. */
  authoritativeEventSequence?: number;
}): FhvOperatorStatusProducerValue<number> {
  if (typeof input.authoritativeEventSequence === "number") {
    return fhvProducerValue(input.authoritativeEventSequence);
  }
  // Checkpoint presence alone is not an evidence-event sequence producer.
  // Fabricating 0 is forbidden (DEE-525): missing producer => UNAVAILABLE.
  void input.checkpoint;
  return fhvProducerUnavailable();
}

export function produceFhvEvidenceHealth(input: {
  evidenceHealth?: "ok" | "degraded" | "failed" | "UNAVAILABLE";
}): FhvOperatorStatusProducerValue<"ok" | "degraded" | "failed"> {
  if (
    input.evidenceHealth === "ok" ||
    input.evidenceHealth === "degraded" ||
    input.evidenceHealth === "failed"
  ) {
    return fhvProducerValue(input.evidenceHealth);
  }
  return fhvProducerUnavailable();
}

export function produceFhvHostStringStatus(
  value: string | null | undefined,
): FhvOperatorStatusProducerValue<string> {
  if (!value || value === "unknown") {
    return fhvProducerUnavailable();
  }
  return fhvProducerValue(value);
}
