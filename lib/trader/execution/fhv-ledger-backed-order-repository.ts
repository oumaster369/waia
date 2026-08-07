import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type {
  FillRow,
  OpenOrdersFilter,
  OrderEventRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import {
  mapSealedEventRow,
  mapSealedFillRow,
  mapSealedOrderRow,
  openFhvVerifiedEconomicLedgerSnapshot,
  SealedLedgerRowContractError,
  type FhvSealedLedgerIndex,
} from "@/lib/trader/observability/fhv-economic-ledger";
import {
  openFhvSealedOrderRegistry,
  type FhvSealedOrderRegistry,
} from "@/lib/trader/observability/fhv-economic-seal";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

/**
 * Ledger-backed read decorator (ADR-0025 OPTION_E, WP-6A).
 *
 * Terminal export reads economic history through the `OrderRepository` interface
 * (`build-backtest-evaluation-export.ts` listOrders/listEvents, `load-paper-fill-events.ts`
 * listOrders/listFills). Once economically sealed rows are pruned from `session.sqlite`, those
 * reads must be served from the verified ledger instead.
 *
 * Authority is decided exclusively by the economic-seal registry — never by terminal OrderState,
 * never by last-write-wins, never by an implicit epoch comparison, and never by silently
 * falling back to incomplete SQLite history.
 *
 * Writes pass straight through: this introduces no second economic write path.
 */

export type FhvLedgerBackedOrderRepositoryDeps = Readonly<{
  inner: OrderRepository;
  runDir: string;
  organizationId: string;
  runId: string;
}>;

/**
 * Canonical order-collection ordering.
 *
 * Every economic projection downstream re-sorts into its own canonical sequence — fill events by
 * `(executedAt, fill.id)` in `sortFillEvents`, cost provenance by `(fillSequence,
 * economicsContentDigest)`, strategy evaluations by `strategySignalId`. The `listOrders` array is
 * therefore consumed as a set, and the legacy SQLite rowid iteration order is an artifact of a
 * query with no ORDER BY rather than a domain contract.
 *
 * `(createdAt, id)` is used here because it is deterministic, replay-stable, backend-independent
 * and totally ordered by the stable order id, unlike an implicit rowid which SQLite reuses after
 * pruning.
 */
function compareCanonicalOrder(a: OrderRow, b: OrderRow): number {
  const created = a.createdAt.getTime() - b.createdAt.getTime();
  return created !== 0 ? created : a.id.localeCompare(b.id);
}

function assertCanonicallyIdentical<T extends Record<string, unknown>>(
  sealed: T,
  live: T,
  classification: string,
  detail: string,
): void {
  const canonical = (value: T): string =>
    JSON.stringify(value, (_key, inner: unknown) =>
      inner instanceof Date ? inner.toISOString() : inner,
    );
  if (canonical(sealed) !== canonical(live)) {
    throw new SealedLedgerRowContractError(classification, detail);
  }
}

export function createFhvLedgerBackedOrderRepository(
  deps: FhvLedgerBackedOrderRepositoryDeps,
): OrderRepository & {
  readonly ledgerVerificationCount: number;
  readonly sealRegistry: FhvSealedOrderRegistry;
} {
  // Verified once. Every later read is an indexed lookup bounded by output size.
  const snapshot: FhvSealedLedgerIndex = openFhvVerifiedEconomicLedgerSnapshot(deps.runDir);
  const registry = openFhvSealedOrderRegistry({
    runDir: deps.runDir,
    organizationId: deps.organizationId,
    runId: deps.runId,
  });
  const verificationCount = 1;

  const sealedOrderRows = snapshot.orders.map((entry) => ({
    order: mapSealedOrderRow(entry.row),
  }));

  const assertScope = (context: OrgContext): void => {
    registry.assertScope(context.organizationId);
  };

  const matchesFilter = (order: OrderRow, filter?: OpenOrdersFilter): boolean => {
    if (filter?.executionMode && order.executionMode !== filter.executionMode) {
      return false;
    }
    if (filter?.venue && order.venue !== filter.venue) {
      return false;
    }
    return true;
  };

  return {
    ledgerVerificationCount: verificationCount,
    sealRegistry: registry,

    // ---- reads served by seal authority -------------------------------------------------
    async listOrders(context, filter) {
      assertScope(context);
      const live = await deps.inner.listOrders(context, filter);
      const merged: OrderRow[] = [];
      const seenId = new Set<string>();

      for (const entry of sealedOrderRows) {
        if (entry.order.organizationId !== context.organizationId) {
          throw new SealedLedgerRowContractError(
            "FHV_SEALED_LEDGER_SCOPE_VIOLATION",
            `sealed order ${entry.order.id} belongs to org ${entry.order.organizationId}`,
          );
        }
        if (matchesFilter(entry.order as OrderRow, filter)) {
          merged.push(entry.order as OrderRow);
          seenId.add(entry.order.id);
        }
      }

      for (const order of live) {
        const sealed = snapshot.ordersById.get(order.id);
        if (sealed) {
          // An overlap is acceptable only when both representations are canonically identical.
          assertCanonicallyIdentical(
            mapSealedOrderRow(sealed) as unknown as Record<string, unknown>,
            order as unknown as Record<string, unknown>,
            "FHV_SEALED_LEDGER_CONFLICTING_OVERLAP",
            `order ${order.id} differs between sealed ledger and SQLite`,
          );
          continue;
        }
        if (seenId.has(order.id)) {
          throw new SealedLedgerRowContractError(
            "FHV_SEALED_LEDGER_CONFLICTING_OVERLAP",
            `duplicate order id ${order.id} across sealed ledger and SQLite`,
          );
        }
        merged.push(order);
        seenId.add(order.id);
      }

      merged.sort(compareCanonicalOrder);
      return merged;
    },

    async listEvents(context, orderId) {
      assertScope(context);
      const sealed = snapshot.eventsByOrderId.get(orderId);
      const live = await deps.inner.listEvents(context, orderId);
      if (!sealed || sealed.length === 0) {
        return live;
      }
      const sealedRows = sealed.map((row) => mapSealedEventRow(row) as OrderEventRow);
      if (live.length === 0) {
        return sealedRows;
      }
      // Both present: only an identical overlap is acceptable.
      if (live.length !== sealedRows.length) {
        throw new SealedLedgerRowContractError(
          "FHV_SEALED_LEDGER_CONFLICTING_OVERLAP",
          `order ${orderId} has ${live.length} live events and ${sealedRows.length} sealed events`,
        );
      }
      for (let index = 0; index < live.length; index += 1) {
        assertCanonicallyIdentical(
          sealedRows[index] as unknown as Record<string, unknown>,
          live[index] as unknown as Record<string, unknown>,
          "FHV_SEALED_LEDGER_CONFLICTING_OVERLAP",
          `event ${index} of order ${orderId} differs between sealed ledger and SQLite`,
        );
      }
      return sealedRows;
    },

    async listFills(context, orderId) {
      assertScope(context);
      const sealed = snapshot.fillsByOrderId.get(orderId);
      const live = await deps.inner.listFills(context, orderId);
      if (!sealed || sealed.length === 0) {
        return live;
      }
      const sealedRows = sealed.map((row) => mapSealedFillRow(row) as FillRow);
      if (live.length === 0) {
        return sealedRows;
      }
      if (live.length !== sealedRows.length) {
        throw new SealedLedgerRowContractError(
          "FHV_SEALED_LEDGER_CONFLICTING_OVERLAP",
          `order ${orderId} has ${live.length} live fills and ${sealedRows.length} sealed fills`,
        );
      }
      for (let index = 0; index < live.length; index += 1) {
        assertCanonicallyIdentical(
          sealedRows[index] as unknown as Record<string, unknown>,
          live[index] as unknown as Record<string, unknown>,
          "FHV_SEALED_LEDGER_CONFLICTING_OVERLAP",
          `fill ${index} of order ${orderId} differs between sealed ledger and SQLite`,
        );
      }
      return sealedRows;
    },

    async getOrderById(context, id) {
      assertScope(context);
      const live = await deps.inner.getOrderById(context, id);
      if (live) {
        return live;
      }
      const sealed = snapshot.ordersById.get(id);
      return sealed ? (mapSealedOrderRow(sealed) as OrderRow) : null;
    },

    // `listOpenOrders` is bounded live state by definition: sealed orders are economically
    // complete and can never be open, so the sealed ledger must not contribute here.
    listOpenOrders: (context, filter) => deps.inner.listOpenOrders(context, filter),

    findOrderByClientOrderId: (context, clientOrderId) =>
      deps.inner.findOrderByClientOrderId(context, clientOrderId),
    findOrderByIdempotencyKey: (context, idempotencyKey) =>
      deps.inner.findOrderByIdempotencyKey(context, idempotencyKey),

    // ---- writes pass through unchanged ---------------------------------------------------
    createOrder: (context, input) => deps.inner.createOrder(context, input),
    transitionOrder: (context, input) => deps.inner.transitionOrder(context, input),
    recordFill: (context, input) => deps.inner.recordFill(context, input),
    recordFillProgress: (context, input) => deps.inner.recordFillProgress(context, input),
  };
}
