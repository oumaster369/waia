import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "./cabinet-view";
import type { HtxV5AccountObservation } from "./types";
import type { HtxV5AlgoOrder, HtxV5Position } from "./derivatives/htx-v5-read-contract";

export type StopEvidenceReason =
  | "READ_FAILED"
  | "INVALID_READ_TIME"
  | "STALE_DATA"
  | "POSITION_UNBOUND"
  | "POSITION_AMBIGUOUS"
  | "SOURCE_INCOMPLETE"
  | "NO_MATCHING_SL"
  | "DUPLICATE_ORDER_IDENTITY"
  | "MULTIPLE_SL_CANDIDATES"
  | "UNSUPPORTED_QUANTITY"
  | "UNQUALIFIED_CLOSING_SEMANTICS";

export type ReceivedQuantityComparison = Readonly<{
  relation: "LESS" | "EQUAL" | "GREATER";
  stopVolume: string;
  positionVolume: string;
}>;

export type PositionOrderDisplay = Readonly<{
  status: "CURRENT" | "STALE" | "UNAVAILABLE";
  stops: readonly HtxV5AlgoOrder[];
  targets: readonly HtxV5AlgoOrder[];
  /** Matching or equal received quantities never establishes complete protection. */
  protection: "UNCONFIRMED";
  reasons: readonly StopEvidenceReason[];
  receivedQuantityComparison: ReceivedQuantityComparison | null;
}>;

function positive(value: string | null): boolean {
  if (value === null || !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return false;
  return /[1-9]/.test(value.split(/[eE]/, 1)[0]!);
}

// Bounded display-only arithmetic. Only the small exponent passes through Number;
// received amounts remain exact integers and scales, never rounded quantities.
function exactPositiveQuantity(value: string): { coefficient: bigint; scale: number } | null {
  if (value.length === 0 || value.length > 80) return null;
  const match = /^\+?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d{1,3}))?$/.exec(value);
  if (!match) return null;
  const exponent = match[4] === undefined ? 0 : Number(match[4]);
  if (Math.abs(exponent) > 128) return null;
  const fraction = match[2] ?? match[3] ?? "";
  const coefficient = BigInt(`${match[1] ?? "0"}${fraction}`);
  if (coefficient <= 0n) return null;
  return { coefficient, scale: fraction.length - exponent };
}

function compareQuantity(stopVolume: string, positionVolume: string): ReceivedQuantityComparison | null {
  const stop = exactPositiveQuantity(stopVolume);
  const position = exactPositiveQuantity(positionVolume);
  if (!stop || !position) return null;
  const scale = Math.max(stop.scale, position.scale);
  const left = stop.coefficient * 10n ** BigInt(scale - stop.scale);
  const right = position.coefficient * 10n ** BigInt(scale - position.scale);
  return { relation: left < right ? "LESS" : left > right ? "GREATER" : "EQUAL", stopVolume, positionVolume };
}

/** Display-only correlation within one validated, authorized stored snapshot.
 * No venue calls, executable coverage verdict, journal fallback or trading authority. */
export function htxV5PositionOrderDisplay(input: {
  position: HtxV5Position;
  projection: Pick<HtxV5AccountObservation, "positions" | "algoOrders">;
  stale: boolean;
  nowMs: number;
}): PositionOrderDisplay {
  const { position, projection, nowMs } = input;
  const empty = (status: PositionOrderDisplay["status"], reason: StopEvidenceReason): PositionOrderDisplay =>
    ({ status, stops: [], targets: [], protection: "UNCONFIRMED", reasons: [reason], receivedQuantityComparison: null });
  const observations = [projection.positions, projection.algoOrders];
  if (observations.some(value => value.status === "ERROR" || value.error !== null || value.values === null)) {
    return empty("UNAVAILABLE", "READ_FAILED");
  }
  if (!Number.isFinite(nowMs) || observations.some(value =>
    value.readStartedAtMs === null || value.readCompletedAtMs === null ||
    !Number.isFinite(value.readStartedAtMs) || !Number.isFinite(value.readCompletedAtMs) ||
    value.readStartedAtMs < 0 || value.readCompletedAtMs < value.readStartedAtMs ||
    value.readCompletedAtMs > nowMs || value.readCompletedAtMs > 8.64e15)) {
    return empty("UNAVAILABLE", "INVALID_READ_TIME");
  }
  if (input.stale || observations.some(value =>
    nowMs - value.readCompletedAtMs! >= ACCOUNT_OBSERVATION_STALE_AFTER_MS)) return empty("STALE", "STALE_DATA");
  const boundRows = projection.positions.values!.filter(row => row.contractCode === position.contractCode &&
    row.positionSide === position.positionSide && row.marginMode === position.marginMode);
  // The renderer must pass the actual, unique row from this snapshot, not a local-book copy.
  if (boundRows.length > 1) return empty("UNAVAILABLE", "POSITION_AMBIGUOUS");
  if (boundRows.length !== 1 || boundRows[0] !== position) return empty("UNAVAILABLE", "POSITION_UNBOUND");
  if (!positive(position.volume)) return empty("UNAVAILABLE", "UNSUPPORTED_QUANTITY");
  if ((position.positionSide === "long" && position.direction !== "buy") ||
    (position.positionSide === "short" && position.direction !== "sell")) {
    return empty("UNAVAILABLE", "UNQUALIFIED_CLOSING_SEMANTICS");
  }

  const closingSide = position.direction === "buy" ? "sell" : "buy";
  const scoped = projection.algoOrders.values!.filter(order =>
    order.state === "active" && order.contractCode === position.contractCode &&
    order.positionSide === position.positionSide && order.marginMode === position.marginMode &&
    order.side === closingSide && (position.positionSide !== "both" || order.reduceOnly === true));
  const candidates = scoped.filter(order => positive(order.volume));
  const isStop = (order: HtxV5AlgoOrder) => (order.type === "sl" || order.type === "tpsl") && positive(order.slTriggerPrice);
  const stops = candidates.filter(isStop);
  // Invalid quantities remain excluded from the original listing, but cannot turn
  // another received stop into an apparently unique comparable order.
  const scopedStops = scoped.filter(isStop);
  const algoIdentityCounts = new Map<string, number>();
  const displayIdentityCounts = new Map<string, number>();
  for (const order of projection.algoOrders.values!) {
    algoIdentityCounts.set(order.algoId, (algoIdentityCounts.get(order.algoId) ?? 0) + 1);
    displayIdentityCounts.set(order.id, (displayIdentityCounts.get(order.id) ?? 0) + 1);
  }
  const duplicate = scoped.some(order =>
    algoIdentityCounts.get(order.algoId)! > 1 || displayIdentityCounts.get(order.id)! > 1);
  const reasons: StopEvidenceReason[] = [];
  if (observations.some(value => value.status !== "COMPLETE" || value.pageScope !== null)) reasons.push("SOURCE_INCOMPLETE");
  if (scopedStops.length === 0) reasons.push("NO_MATCHING_SL");
  if (duplicate) reasons.push("DUPLICATE_ORDER_IDENTITY");
  if (scopedStops.length > 1) reasons.push("MULTIPLE_SL_CANDIDATES");
  if (!exactPositiveQuantity(position.volume) || scopedStops.some(order => !exactPositiveQuantity(order.volume))) {
    reasons.push("UNSUPPORTED_QUANTITY");
  }
  const receivedQuantityComparison = scopedStops.length === 1 && !duplicate
    ? compareQuantity(scopedStops[0]!.volume, position.volume) : null;
  // V5 closing/remaining-volume semantics have not been qualified, even if equal.
  reasons.push("UNQUALIFIED_CLOSING_SEMANTICS");
  return {
    status: "CURRENT",
    stops,
    targets: candidates.filter(order => (order.type === "tp" || order.type === "tpsl") && positive(order.tpTriggerPrice)),
    protection: "UNCONFIRMED",
    reasons,
    receivedQuantityComparison,
  };
}
