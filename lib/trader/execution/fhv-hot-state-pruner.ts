import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type Database from "better-sqlite3";

import { TERMINAL_ORDER_STATES } from "@/lib/trader/execution/order-state-machine";
import type { FhvEconomicLedgerRow } from "@/lib/trader/observability/fhv-economic-ledger";

/**
 * Bounded hot state (ADR-0025 AD-1).
 *
 * `session.sqlite` is copied and hashed in full at every epoch checkpoint, so anything that grows
 * monotonically inside it makes cumulative checkpoint I/O quadratic in run length. Measured on a
 * 4,509-cycle segment, the growth is entirely four tables:
 *
 *   trader_order_events   61.7%
 *   trader_orders         16.9%
 *   trader_lifecycle_events 13.8%
 *   trader_fills           9.3%
 *
 * Rows belonging to TERMINAL orders are pure history: the IDHPS hot path lists only non-terminal
 * orders, and `listOrders` is banned outright. Once sealed into the append-only economic ledger
 * they can leave the snapshotted database without losing any economic record.
 *
 * Disabled by default. The old path stays canonical until dual-path parity is proven.
 */

export const FHV_BOUNDED_HOT_STATE_ENV = "FHV_BOUNDED_HOT_STATE";

export function isFhvBoundedHotStateEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[FHV_BOUNDED_HOT_STATE_ENV] === "1";
}

const TERMINAL_SQL = TERMINAL_ORDER_STATES.map((state) => `'${state}'`).join(",");

export type FhvHotStatePruneResult = Readonly<{
  terminalOrderCount: number;
  rows: readonly FhvEconomicLedgerRow[];
  countsByKind: Readonly<Record<string, number>>;
}>;

/**
 * Collect every economic row belonging to a terminal order, plus lifecycle events that are no
 * longer referenced by a retained order. Read-only: callers seal these rows first, then prune.
 */
export function collectFhvTerminalEconomicRows(sqlite: Database.Database): FhvHotStatePruneResult {
  const terminalOrders = sqlite
    .prepare(`SELECT * FROM trader_orders WHERE state IN (${TERMINAL_SQL})`)
    .all() as Record<string, unknown>[];

  if (terminalOrders.length === 0) {
    return { terminalOrderCount: 0, rows: [], countsByKind: {} };
  }

  const orderIds = terminalOrders.map((row) => String(row.id));
  const placeholders = orderIds.map(() => "?").join(",");

  const events = sqlite
    .prepare(`SELECT * FROM trader_order_events WHERE order_id IN (${placeholders})`)
    .all(...orderIds) as Record<string, unknown>[];
  const fills = sqlite
    .prepare(`SELECT * FROM trader_fills WHERE order_id IN (${placeholders})`)
    .all(...orderIds) as Record<string, unknown>[];

  const rows: FhvEconomicLedgerRow[] = [
    ...terminalOrders.map((row) => ({ kind: "trader_orders" as const, row })),
    ...events.map((row) => ({ kind: "trader_order_events" as const, row })),
    ...fills.map((row) => ({ kind: "trader_fills" as const, row })),
  ];

  const countsByKind: Record<string, number> = {};
  for (const entry of rows) {
    countsByKind[entry.kind] = (countsByKind[entry.kind] ?? 0) + 1;
  }

  return { terminalOrderCount: terminalOrders.length, rows, countsByKind };
}

/**
 * Delete the rows returned by {@link collectFhvTerminalEconomicRows}.
 *
 * MUST be called only after the ledger segment containing them is durably sealed. Runs in a
 * single transaction so a crash cannot leave a partially pruned order.
 */
export function pruneFhvTerminalEconomicRows(
  sqlite: Database.Database,
  collected: FhvHotStatePruneResult,
): { deletedOrders: number; deletedEvents: number; deletedFills: number } {
  if (collected.terminalOrderCount === 0) {
    return { deletedOrders: 0, deletedEvents: 0, deletedFills: 0 };
  }

  const orderIds = collected.rows
    .filter((entry) => entry.kind === "trader_orders")
    .map((entry) => String(entry.row.id));
  const placeholders = orderIds.map(() => "?").join(",");

  const deleteEvents = sqlite.prepare(
    `DELETE FROM trader_order_events WHERE order_id IN (${placeholders})`,
  );
  const deleteFills = sqlite.prepare(
    `DELETE FROM trader_fills WHERE order_id IN (${placeholders})`,
  );
  const deleteOrders = sqlite.prepare(`DELETE FROM trader_orders WHERE id IN (${placeholders})`);

  let deletedEvents = 0;
  let deletedFills = 0;
  let deletedOrders = 0;
  const run = sqlite.transaction((ids: string[]) => {
    deletedEvents = deleteEvents.run(...ids).changes;
    deletedFills = deleteFills.run(...ids).changes;
    deletedOrders = deleteOrders.run(...ids).changes;
  });
  run(orderIds);

  return { deletedOrders, deletedEvents, deletedFills };
}
