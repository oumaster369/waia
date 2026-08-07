import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type Database from "better-sqlite3";

import type { FhvEconomicLedgerRow } from "@/lib/trader/observability/fhv-economic-ledger";
import type { FhvSealCandidateOrder } from "@/lib/trader/observability/fhv-economic-seal-eligibility";

/**
 * Bounded hot state (ADR-0025 AD-1, OPTION_E).
 *
 * `session.sqlite` is copied and hashed in full at every epoch checkpoint, so anything growing
 * monotonically inside it makes cumulative checkpoint I/O quadratic in run length. Measured on a
 * 4,509-cycle segment the growth is entirely four tables: trader_order_events 61.7%,
 * trader_orders 16.9%, trader_lifecycle_events 13.8%, trader_fills 9.3%.
 *
 * Rows become prunable only when the epoch-commit lifecycle has issued an explicit economic seal
 * for their order. Terminal `OrderState` is deliberately NOT the frontier: `recordFillSqlite` and
 * `recordFillProgressSqlite` guard only on parent existence, so a terminal order can still
 * receive fills and quantity corrections.
 *
 * Disabled by default. The legacy path stays canonical until dual-path parity is proven.
 */

export const FHV_BOUNDED_HOT_STATE_ENV = "FHV_BOUNDED_HOT_STATE";

export function isFhvBoundedHotStateEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[FHV_BOUNDED_HOT_STATE_ENV] === "1";
}

type OrderRecord = Record<string, unknown>;

/**
 * Build seal candidates from bounded SQLite state.
 *
 * `hasPendingExecutionIntent` is derived conservatively: when the highest-sequence order event
 * disagrees with the order row's current state, the order's outcome is still in flight and it
 * must not be sealed.
 */
export function collectFhvSealCandidates(sqlite: Database.Database): {
  candidates: FhvSealCandidateOrder[];
  ordersById: Map<string, OrderRecord>;
} {
  const orders = sqlite.prepare("SELECT * FROM trader_orders").all() as OrderRecord[];
  const ordersById = new Map<string, OrderRecord>();
  if (orders.length === 0) {
    return { candidates: [], ordersById };
  }

  const fillAggregate = new Map<string, { sum: string; count: number }>();
  for (const row of sqlite.prepare("SELECT order_id, quantity FROM trader_fills").all() as {
    order_id: string;
    quantity: string;
  }[]) {
    const current = fillAggregate.get(row.order_id) ?? { sum: "0", count: 0 };
    fillAggregate.set(row.order_id, {
      sum: addDecimalStrings(current.sum, row.quantity),
      count: current.count + 1,
    });
  }

  const lastEventState = new Map<string, string>();
  for (const row of sqlite
    .prepare(
      `SELECT order_id, to_state FROM trader_order_events
       WHERE (order_id, seq) IN (SELECT order_id, MAX(seq) FROM trader_order_events GROUP BY order_id)`,
    )
    .all() as { order_id: string; to_state: string }[]) {
    lastEventState.set(row.order_id, row.to_state);
  }

  const candidates: FhvSealCandidateOrder[] = [];
  for (const row of orders) {
    const orderId = String(row.id);
    ordersById.set(orderId, row);
    const aggregate = fillAggregate.get(orderId) ?? { sum: "0", count: 0 };
    const lastState = lastEventState.get(orderId);
    candidates.push({
      orderId,
      state: String(row.state),
      quantity: String(row.quantity),
      filledQuantity: String(row.filled_quantity),
      avgFillPrice: row.avg_fill_price == null ? null : String(row.avg_fill_price),
      fillQuantitySum: aggregate.sum,
      fillCount: aggregate.count,
      hasPendingExecutionIntent: lastState != null && lastState !== String(row.state),
    });
  }
  return { candidates, ordersById };
}

/** Exact decimal-string addition. Economic decimals never round-trip through Number. */
export function addDecimalStrings(a: string, b: string): string {
  const split = (value: string): [bigint, number] => {
    const negative = value.startsWith("-");
    const raw = negative ? value.slice(1) : value;
    const [whole, fraction = ""] = raw.split(".");
    const scale = fraction.length;
    const digits = BigInt(`${whole}${fraction}` || "0");
    return [negative ? -digits : digits, scale];
  };
  const [aDigits, aScale] = split(a);
  const [bDigits, bScale] = split(b);
  const scale = Math.max(aScale, bScale);
  const lift = (digits: bigint, from: number): bigint => digits * 10n ** BigInt(scale - from);
  const total = lift(aDigits, aScale) + lift(bDigits, bScale);
  if (scale === 0) {
    return total.toString();
  }
  const negative = total < 0n;
  const absolute = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const whole = absolute.slice(0, absolute.length - scale);
  const fraction = absolute.slice(absolute.length - scale);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export type FhvSealedRowCollection = Readonly<{
  orderIds: readonly string[];
  rows: readonly FhvEconomicLedgerRow[];
  countsByKind: Readonly<Record<string, number>>;
  /** Fill identity per order, for the seal record and the post-prune idempotency registry. */
  fillIdentityByOrderId: ReadonlyMap<string, { fillIds: string[]; exchangeTradeIds: string[] }>;
  lastEventSeqByOrderId: ReadonlyMap<string, number>;
}>;

/**
 * Collect every economic row belonging to the supplied sealed orders.
 *
 * `rowid` is captured so the ledger-backed repository can replicate the legacy SQL ordering
 * exactly rather than inventing a new one.
 */
export function collectFhvSealedEconomicRows(
  sqlite: Database.Database,
  sealedOrderIds: readonly string[],
): FhvSealedRowCollection {
  if (sealedOrderIds.length === 0) {
    return {
      orderIds: [],
      rows: [],
      countsByKind: {},
      fillIdentityByOrderId: new Map(),
      lastEventSeqByOrderId: new Map(),
    };
  }
  const placeholders = sealedOrderIds.map(() => "?").join(",");

  const orders = sqlite
    .prepare(`SELECT rowid AS __rowid, * FROM trader_orders WHERE id IN (${placeholders})`)
    .all(...sealedOrderIds) as OrderRecord[];
  const events = sqlite
    .prepare(
      `SELECT rowid AS __rowid, * FROM trader_order_events WHERE order_id IN (${placeholders})`,
    )
    .all(...sealedOrderIds) as OrderRecord[];
  const fills = sqlite
    .prepare(`SELECT rowid AS __rowid, * FROM trader_fills WHERE order_id IN (${placeholders})`)
    .all(...sealedOrderIds) as OrderRecord[];

  const fillIdentityByOrderId = new Map<
    string,
    { fillIds: string[]; exchangeTradeIds: string[] }
  >();
  for (const fill of fills) {
    const orderId = String(fill.order_id);
    const entry = fillIdentityByOrderId.get(orderId) ?? { fillIds: [], exchangeTradeIds: [] };
    entry.fillIds.push(String(fill.id));
    entry.exchangeTradeIds.push(String(fill.exchange_trade_id));
    fillIdentityByOrderId.set(orderId, entry);
  }
  for (const orderId of sealedOrderIds) {
    if (!fillIdentityByOrderId.has(orderId)) {
      fillIdentityByOrderId.set(orderId, { fillIds: [], exchangeTradeIds: [] });
    }
  }

  const lastEventSeqByOrderId = new Map<string, number>();
  for (const event of events) {
    const orderId = String(event.order_id);
    const seq = Number(event.seq);
    if (seq > (lastEventSeqByOrderId.get(orderId) ?? -1)) {
      lastEventSeqByOrderId.set(orderId, seq);
    }
  }

  const rows: FhvEconomicLedgerRow[] = [
    ...orders.map((row) => ({ kind: "trader_orders" as const, row })),
    ...events.map((row) => ({ kind: "trader_order_events" as const, row })),
    ...fills.map((row) => ({ kind: "trader_fills" as const, row })),
  ];
  const countsByKind: Record<string, number> = {};
  for (const entry of rows) {
    countsByKind[entry.kind] = (countsByKind[entry.kind] ?? 0) + 1;
  }

  return {
    orderIds: sealedOrderIds,
    rows,
    countsByKind,
    fillIdentityByOrderId,
    lastEventSeqByOrderId,
  };
}

/**
 * Delete the collected rows.
 *
 * MUST run only after the ledger segment is durably sealed AND the economic seal is published.
 * A crash before either leaves the rows in place, which is recoverable; the reverse order would
 * leave pruned rows with no committed seal.
 */
export function pruneFhvSealedEconomicRows(
  sqlite: Database.Database,
  orderIds: readonly string[],
): { deletedOrders: number; deletedEvents: number; deletedFills: number } {
  if (orderIds.length === 0) {
    return { deletedOrders: 0, deletedEvents: 0, deletedFills: 0 };
  }
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
  const run = sqlite.transaction((ids: readonly string[]) => {
    deletedEvents = deleteEvents.run(...ids).changes;
    deletedFills = deleteFills.run(...ids).changes;
    deletedOrders = deleteOrders.run(...ids).changes;
  });
  run(orderIds);
  return { deletedOrders, deletedEvents, deletedFills };
}
