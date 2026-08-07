import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/research/digest";
import { TERMINAL_ORDER_STATES } from "@/lib/trader/execution/order-state-machine";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { OrderState } from "@/lib/trader/execution/types";
import { addDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

export const IDHPS_INVENTORY_MIRROR_SCHEMA_VERSION = "idhps-inventory-mirror/v1" as const;

export type IdhpsInventoryMirrorV1 = {
  schemaVersion: typeof IDHPS_INVENTORY_MIRROR_SCHEMA_VERSION;
  inventoryBySymbol: Record<string, string>;
  openOrderIdsBySymbol: Record<string, string[]>;
  /** Open orders + terminal orders mutated after last durable EPOCH_COMMIT only. */
  filledQuantityByOrder: Record<string, string>;
  terminalOrderIdsSinceEpoch: string[];
};

export function createEmptyIdhpsInventoryMirror(): IdhpsInventoryMirrorV1 {
  return {
    schemaVersion: IDHPS_INVENTORY_MIRROR_SCHEMA_VERSION,
    inventoryBySymbol: {},
    openOrderIdsBySymbol: {},
    filledQuantityByOrder: {},
    terminalOrderIdsSinceEpoch: [],
  };
}

export function digestIdhpsInventoryMirror(mirror: IdhpsInventoryMirrorV1): string {
  return createHash("sha256").update(canonicalJsonString(mirror), "utf8").digest("hex");
}

/** Open-order cardinality from IDHPS inventory mirror (no SQLite). */
export function countIdhpsOpenOrders(mirror: IdhpsInventoryMirrorV1): number {
  let count = 0;
  for (const ids of Object.values(mirror.openOrderIdsBySymbol)) {
    count += ids.length;
  }
  return count;
}

function isTerminal(state: OrderState): boolean {
  return (TERMINAL_ORDER_STATES as readonly string[]).includes(state);
}

export function applyOrderToIdhpsInventoryMirror(
  mirror: IdhpsInventoryMirrorV1,
  order: OrderRow,
): void {
  const openIds = mirror.openOrderIdsBySymbol[order.symbol] ?? [];
  const without = openIds.filter((id) => id !== order.id);
  if (isTerminal(order.state)) {
    mirror.openOrderIdsBySymbol[order.symbol] = without;
    if (without.length === 0) {
      delete mirror.openOrderIdsBySymbol[order.symbol];
    }
    if (!mirror.terminalOrderIdsSinceEpoch.includes(order.id)) {
      mirror.terminalOrderIdsSinceEpoch.push(order.id);
    }
  } else {
    mirror.openOrderIdsBySymbol[order.symbol] = [...without, order.id].sort();
  }
  mirror.filledQuantityByOrder[order.id] = order.filledQuantity;
}

export function applyFillQtyToIdhpsInventoryMirror(
  mirror: IdhpsInventoryMirrorV1,
  input: { orderId: string; symbol: string; side: "buy" | "sell"; quantity: string },
): void {
  const prior = mirror.inventoryBySymbol[input.symbol] ?? "0";
  mirror.inventoryBySymbol[input.symbol] =
    input.side === "buy"
      ? addDecimal(prior, input.quantity)
      : subtractDecimal(prior, input.quantity);
  const prevFilled = mirror.filledQuantityByOrder[input.orderId] ?? "0";
  mirror.filledQuantityByOrder[input.orderId] = addDecimal(prevFilled, input.quantity);
}

/** Durable authority step 10: drop terminal filledQuantity entries; keep open only. */
export function evictTerminalFilledQuantityAfterEpochCommit(mirror: IdhpsInventoryMirrorV1): void {
  const openIds = new Set(Object.values(mirror.openOrderIdsBySymbol).flat());
  for (const orderId of Object.keys(mirror.filledQuantityByOrder)) {
    if (!openIds.has(orderId)) {
      delete mirror.filledQuantityByOrder[orderId];
    }
  }
  mirror.terminalOrderIdsSinceEpoch = [];
}

export function verifyIdhpsInventoryAgainstOpenOrders(
  mirror: IdhpsInventoryMirrorV1,
  openOrders: readonly OrderRow[],
): void {
  const openIds = new Set(openOrders.map((o) => o.id));
  const mirroredOpen = new Set(Object.values(mirror.openOrderIdsBySymbol).flat());
  if (openIds.size !== mirroredOpen.size || [...openIds].some((id) => !mirroredOpen.has(id))) {
    throw new Error("BLOCKED_BY_H_ARCH_1_IDHPS_SQLITE_MIRROR_MISMATCH: openOrderIdsBySymbol");
  }
  for (const order of openOrders) {
    if (mirror.filledQuantityByOrder[order.id] !== order.filledQuantity) {
      throw new Error(
        `BLOCKED_BY_H_ARCH_1_IDHPS_SQLITE_MIRROR_MISMATCH: filledQuantity order=${order.id}`,
      );
    }
  }
  for (const orderId of Object.keys(mirror.filledQuantityByOrder)) {
    if (!openIds.has(orderId) && !mirror.terminalOrderIdsSinceEpoch.includes(orderId)) {
      throw new Error(
        "BLOCKED_BY_H_ARCH_1_IDHPS_EPOCH_EVICTION_OR_RETENTION_FAIL: stale terminal filledQuantity",
      );
    }
  }
}

export function captureIdhpsInventoryMirror(
  mirror: IdhpsInventoryMirrorV1,
): IdhpsInventoryMirrorV1 {
  return structuredClone(mirror);
}

export function restoreIdhpsInventoryMirror(
  snapshot: IdhpsInventoryMirrorV1,
): IdhpsInventoryMirrorV1 {
  if (snapshot.schemaVersion !== IDHPS_INVENTORY_MIRROR_SCHEMA_VERSION) {
    throw new Error("BLOCKED_BY_H_ARCH_1_IDHPS_SQLITE_MIRROR_MISMATCH: inventory schema");
  }
  return structuredClone(snapshot);
}
