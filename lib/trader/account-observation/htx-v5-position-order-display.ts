import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "./cabinet-view";
import type { HtxV5AccountObservation } from "./types";
import type { HtxV5AlgoOrder, HtxV5Position } from "./derivatives/htx-v5-read-contract";

export type PositionOrderDisplay = Readonly<{
  status: "CURRENT" | "STALE" | "UNAVAILABLE";
  stops: readonly HtxV5AlgoOrder[];
  targets: readonly HtxV5AlgoOrder[];
  /** Matching an observed order does not establish complete position protection. */
  protection: "UNCONFIRMED";
}>;

function positive(value: string | null): boolean {
  if (value === null || !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return false;
  return /[1-9]/.test(value.split(/[eE]/, 1)[0]!);
}

/** Display-only correlation within one validated, authorized stored snapshot.
 * No venue calls, quantity-coverage verdict, local journal fallback or trading authority. */
export function htxV5PositionOrderDisplay(input: {
  position: HtxV5Position;
  projection: Pick<HtxV5AccountObservation, "positions" | "algoOrders">;
  stale: boolean;
  nowMs: number;
}): PositionOrderDisplay {
  const { position, projection, nowMs } = input;
  const empty = (status: PositionOrderDisplay["status"]): PositionOrderDisplay =>
    ({ status, stops: [], targets: [], protection: "UNCONFIRMED" });
  const observations = [projection.positions, projection.algoOrders];
  if (!Number.isFinite(nowMs) || observations.some(value => value.status === "ERROR" ||
    value.error !== null || value.values === null || value.readCompletedAtMs === null ||
    !Number.isFinite(value.readCompletedAtMs) || value.readCompletedAtMs > nowMs)) return empty("UNAVAILABLE");
  if (input.stale || observations.some(value =>
    nowMs - value.readCompletedAtMs! >= ACCOUNT_OBSERVATION_STALE_AFTER_MS)) return empty("STALE");
  const boundRows = projection.positions.values!.filter(row => row.contractCode === position.contractCode &&
    row.positionSide === position.positionSide && row.marginMode === position.marginMode);
  // The renderer must pass the actual, unique row from this snapshot, not a local-book copy.
  if (boundRows.length !== 1 || boundRows[0] !== position) return empty("UNAVAILABLE");
  if (!positive(position.volume) ||
    (position.positionSide === "long" && position.direction !== "buy") ||
    (position.positionSide === "short" && position.direction !== "sell")) return empty("UNAVAILABLE");

  const closingSide = position.direction === "buy" ? "sell" : "buy";
  const candidates = projection.algoOrders.values!.filter(order =>
    order.state === "active" && order.contractCode === position.contractCode &&
    order.positionSide === position.positionSide && order.marginMode === position.marginMode &&
    order.side === closingSide && positive(order.volume) &&
    (position.positionSide !== "both" || order.reduceOnly === true));
  return {
    status: "CURRENT",
    stops: candidates.filter(order => (order.type === "sl" || order.type === "tpsl") && positive(order.slTriggerPrice)),
    targets: candidates.filter(order => (order.type === "tp" || order.type === "tpsl") && positive(order.tpTriggerPrice)),
    protection: "UNCONFIRMED",
  };
}
