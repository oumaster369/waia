import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type { Order, Trade } from "@/lib/trader/connectors/types";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { mapConnectorStatusToOrderState } from "@/lib/trader/execution/connector-status-map";
import { createDefaultConnectorForMode } from "@/lib/trader/execution/execution-service";
import { OrderVersionConflictError } from "@/lib/trader/execution/order-repository.errors";
import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";
import { ORDER_TRANSITIONS, isTerminal } from "@/lib/trader/execution/order-state-machine";
import {
  classifyReconciliation,
  classifyReconciliationForOrder,
  type ConnectorView,
} from "@/lib/trader/execution/reconciliation-classification";
import type {
  OrderReconciliationOutcome,
  ReconciliationClassification,
  ReconciliationReport,
  ReconciliationService,
  ReconciliationServiceDeps,
  ReconcileTarget,
} from "@/lib/trader/execution/reconciliation.types";
import {
  emptyReconciliationCounts as buildEmptyCounts,
  isPostDispatchReconcilable as isPostDispatch,
} from "@/lib/trader/execution/reconciliation.types";
import type { OrderState } from "@/lib/trader/execution/types";
import {
  createPostgresOrderRepository,
  createPostgresOrderRepositoryFromExecutor,
  createSqliteOrderRepository,
} from "@/lib/trader/execution/repository-adapters";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type PgReconciliationExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

type WorkItem = {
  order?: OrderRow;
  connectorOrder?: Order;
};

function shortestLegalPath(from: OrderState, to: OrderState): OrderState[] {
  if (from === to) {
    return [];
  }

  const queue: { state: OrderState; path: OrderState[] }[] = [{ state: from, path: [] }];
  const visited = new Set<OrderState>([from]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of ORDER_TRANSITIONS[current.state]) {
      if (next === to) {
        return [...current.path, next];
      }
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ state: next, path: [...current.path, next] });
      }
    }
  }

  throw new Error(`No legal transition path from ${from} to ${to}`);
}

function reconciliationPayload(
  classification: ReconciliationClassification,
  connectorOrder: Order | null,
  dbState: OrderState,
  discoveredTradeIds: string[],
): string {
  return JSON.stringify({
    classification,
    connectorStatus: connectorOrder?.status ?? null,
    dbState,
    discoveredTradeIds,
  });
}

function missingTrades(trades: Trade[], recordedTradeIds: readonly string[]): Trade[] {
  const recorded = new Set(recordedTradeIds);
  return trades.filter((trade) => !recorded.has(trade.tradeId));
}

function avgFillPriceFromTrades(trades: Trade[]): string | null {
  if (trades.length === 0) {
    return null;
  }
  return trades[trades.length - 1]?.price ?? null;
}

function markedReconciliationRequired(classification: ReconciliationClassification): boolean {
  return classification === "NOT_FOUND_AT_VENUE" || classification === "AMBIGUOUS_STALE";
}

function createReconciliationService(deps: ReconciliationServiceDeps): ReconciliationService {
  const { orderRepository, connectorForMode, writeAudit, nowMs } = deps;

  async function transitionOrConflict(
    context: OrgContext,
    order: OrderRow,
    toState: OrderState,
    extras?: {
      filledQuantity?: string;
      avgFillPrice?: string | null;
      exchangeOrderId?: string | null;
      eventPayload?: string | null;
    },
  ): Promise<{ order: OrderRow } | { conflict: true; orderId: string }> {
    try {
      const updated = await orderRepository.transitionOrder(context, {
        orderId: order.id,
        expectedStateVersion: order.stateVersion,
        toState,
        filledQuantity: extras?.filledQuantity,
        avgFillPrice: extras?.avgFillPrice,
        exchangeOrderId: extras?.exchangeOrderId,
        eventType: "reconciliation",
        eventPayload: extras?.eventPayload,
        occurredAt: new Date(nowMs()),
      });
      return { order: updated };
    } catch (error) {
      if (error instanceof OrderVersionConflictError) {
        return { conflict: true, orderId: order.id };
      }
      throw error;
    }
  }

  async function writeReconciliationAudit(
    context: OrgContext,
    orderId: string | undefined,
    classification: ReconciliationClassification,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    let action: TraderAuditInput["action"];
    switch (classification) {
      case "VENUE_ACKED":
      case "FILL_PROGRESS":
      case "VENUE_TERMINALIZED":
        action = traderAuditActions.orderReconciliationMismatch;
        break;
      case "NOT_FOUND_AT_VENUE":
      case "AMBIGUOUS_STALE":
        action = traderAuditActions.orderReconciliationRequired;
        break;
      case "UNKNOWN_POSITION":
        action = traderAuditActions.orderReconciliationUnknownPosition;
        break;
      case "TERMINAL_DRIFT":
        action = traderAuditActions.orderReconciliationTerminalDrift;
        break;
      default:
        return;
    }

    await writeAudit({
      actorType: "service",
      actorId: null,
      action,
      entityType: traderEntityTypes.order,
      entityId: orderId ?? null,
      organizationId: context.organizationId,
      metadata: { classification, ...metadata },
    });
  }

  async function buildConnectorView(
    connector: ExchangeConnector,
    order: OrderRow,
    dbFills: FillRow[],
    hintedConnectorOrder?: Order | null,
  ): Promise<ConnectorView> {
    let connectorOrder = hintedConnectorOrder ?? null;

    if (order.exchangeOrderId) {
      try {
        const byExchangeId = await connector.getOrder(order.exchangeOrderId);
        if (byExchangeId) {
          connectorOrder = byExchangeId;
        }
      } catch {
        return {
          order: null,
          trades: [],
          dbFillTradeIds: dbFills.map((fill) => fill.exchangeTradeId),
        };
      }
    }

    if (!connectorOrder) {
      const openOrders = await connector.getOpenOrders({ symbol: order.symbol });
      connectorOrder =
        openOrders.find((candidate) => candidate.clientOrderId === order.clientOrderId) ?? null;
    }

    let trades: Trade[] = [];
    try {
      const history = await connector.getTradeHistory({ symbol: order.symbol, limit: 100 });
      trades = history.filter((trade) => trade.clientOrderId === order.clientOrderId);
    } catch {
      trades = [];
    }

    return {
      order: connectorOrder,
      trades,
      dbFillTradeIds: dbFills.map((fill) => fill.exchangeTradeId),
    };
  }

  async function recordMissingFills(
    context: OrgContext,
    order: OrderRow,
    connectorView: ConnectorView,
  ): Promise<string[]> {
    const recorded: string[] = [];
    const toRecord = missingTrades(connectorView.trades, connectorView.dbFillTradeIds);

    for (const trade of toRecord) {
      await orderRepository.recordFill(context, {
        orderId: order.id,
        exchangeTradeId: trade.tradeId,
        price: trade.price,
        quantity: trade.quantity,
        fee: trade.fee,
        feeAsset: trade.feeAsset,
        executedAt: new Date(trade.executedAt),
      });
      recorded.push(trade.tradeId);
    }

    return recorded;
  }

  async function applyTransitionPath(
    context: OrgContext,
    order: OrderRow,
    targetState: OrderState,
    classification: ReconciliationClassification,
    connectorOrder: Order | null,
    discoveredTradeIds: string[],
    extras?: {
      filledQuantity?: string;
      avgFillPrice?: string | null;
      exchangeOrderId?: string | null;
    },
  ): Promise<{ order: OrderRow } | { conflict: true; orderId: string }> {
    let current = order;
    const path = shortestLegalPath(current.state, targetState);

    for (const hop of path) {
      const hopExtras: {
        filledQuantity?: string;
        avgFillPrice?: string | null;
        exchangeOrderId?: string | null;
        eventPayload?: string | null;
      } = {
        eventPayload: reconciliationPayload(
          classification,
          connectorOrder,
          order.state,
          discoveredTradeIds,
        ),
      };

      if (hop === "ACCEPTED" && connectorOrder?.orderId) {
        hopExtras.exchangeOrderId = connectorOrder.orderId;
      }

      if (
        (hop === "FILLED" || hop === "PARTIALLY_FILLED") &&
        extras?.filledQuantity !== undefined
      ) {
        hopExtras.filledQuantity = extras.filledQuantity;
        hopExtras.avgFillPrice = extras.avgFillPrice ?? null;
      }

      if (extras?.exchangeOrderId && hop === "ACCEPTED" && !hopExtras.exchangeOrderId) {
        hopExtras.exchangeOrderId = extras.exchangeOrderId;
      }

      const result = await transitionOrConflict(context, current, hop, hopExtras);
      if ("conflict" in result) {
        return result;
      }

      current = result.order;
      const refreshed = await orderRepository.getOrderById(context, current.id);
      if (!refreshed) {
        throw new Error(`Order disappeared during reconciliation: ${current.id}`);
      }
      current = refreshed;
    }

    return { order: current };
  }

  async function convergeOrder(
    context: OrgContext,
    order: OrderRow,
    classification: ReconciliationClassification,
    connectorView: ConnectorView,
  ): Promise<OrderReconciliationOutcome> {
    const fromState = order.state;
    let current = order;
    let recordedFills: string[] = [];
    let finalClassification = classification;

    if (classification === "IN_SYNC") {
      return {
        orderId: order.id,
        clientOrderId: order.clientOrderId,
        classification,
        fromState,
        toState: order.state,
        recordedFills,
        markedReconciliationRequired: false,
      };
    }

    if (classification === "TERMINAL_DRIFT" || classification === "UNKNOWN_POSITION") {
      await writeReconciliationAudit(context, order.id, classification, {
        clientOrderId: order.clientOrderId,
        dbState: order.state,
        connectorStatus: connectorView.order?.status ?? null,
      });
      return {
        orderId: order.id,
        clientOrderId: order.clientOrderId,
        classification,
        fromState,
        toState: order.state,
        recordedFills,
        markedReconciliationRequired: false,
      };
    }

    if (classification === "NOT_FOUND_AT_VENUE" || classification === "AMBIGUOUS_STALE") {
      if (order.state !== "RECONCILIATION_REQUIRED") {
        const marked = await transitionOrConflict(context, order, "RECONCILIATION_REQUIRED", {
          eventPayload: reconciliationPayload(classification, null, order.state, []),
        });
        if ("conflict" in marked) {
          return {
            orderId: order.id,
            clientOrderId: order.clientOrderId,
            classification: "SKIPPED_CONFLICT",
            fromState,
            toState: order.state,
            recordedFills,
            markedReconciliationRequired: false,
          };
        }
        current = marked.order;
      }

      await writeReconciliationAudit(context, order.id, classification, {
        clientOrderId: order.clientOrderId,
      });

      return {
        orderId: order.id,
        clientOrderId: order.clientOrderId,
        classification,
        fromState,
        toState: current.state,
        recordedFills,
        markedReconciliationRequired: true,
      };
    }

    const connectorOrder = connectorView.order;
    if (!connectorOrder) {
      finalClassification = "AMBIGUOUS_STALE";
      return await convergeOrder(context, order, "AMBIGUOUS_STALE", connectorView);
    }

    if (classification === "VENUE_ACKED") {
      const adopted = await applyTransitionPath(
        context,
        current,
        "ACCEPTED",
        classification,
        connectorOrder,
        [],
        { exchangeOrderId: connectorOrder?.orderId ?? null },
      );
      if ("conflict" in adopted) {
        return {
          orderId: order.id,
          clientOrderId: order.clientOrderId,
          classification: "SKIPPED_CONFLICT",
          fromState,
          toState: current.state,
          recordedFills,
          markedReconciliationRequired: false,
        };
      }
      current = adopted.order;
      await writeReconciliationAudit(context, order.id, classification, {
        exchangeOrderId: connectorOrder?.orderId ?? null,
      });
      return {
        orderId: order.id,
        clientOrderId: order.clientOrderId,
        classification,
        fromState,
        toState: current.state,
        recordedFills,
        markedReconciliationRequired: false,
      };
    }

    if (classification === "FILL_PROGRESS" || classification === "VENUE_TERMINALIZED") {
      recordedFills = await recordMissingFills(context, current, connectorView);
      const refreshed = await orderRepository.getOrderById(context, order.id);
      if (!refreshed) {
        throw new Error(`Order not found after fill recording: ${order.id}`);
      }
      current = refreshed;

      const targetState =
        classification === "VENUE_TERMINALIZED"
          ? mapConnectorStatusToOrderState(connectorOrder!.status)
          : mapConnectorStatusToOrderState(connectorOrder!.status);

      const transitioned = await applyTransitionPath(
        context,
        current,
        targetState,
        classification,
        connectorOrder,
        recordedFills,
        {
          filledQuantity: connectorOrder!.filledQuantity,
          avgFillPrice:
            avgFillPriceFromTrades(connectorView.trades) ?? connectorOrder!.price ?? null,
          exchangeOrderId: connectorOrder!.orderId,
        },
      );

      if ("conflict" in transitioned) {
        return {
          orderId: order.id,
          clientOrderId: order.clientOrderId,
          classification: "SKIPPED_CONFLICT",
          fromState,
          toState: current.state,
          recordedFills,
          markedReconciliationRequired: false,
        };
      }

      current = transitioned.order;
      await writeReconciliationAudit(context, order.id, classification, {
        connectorStatus: connectorOrder?.status ?? null,
        recordedFills,
      });

      return {
        orderId: order.id,
        clientOrderId: order.clientOrderId,
        classification,
        fromState,
        toState: current.state,
        recordedFills,
        markedReconciliationRequired: false,
      };
    }

    return {
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      classification: finalClassification,
      fromState,
      toState: current.state,
      recordedFills,
      markedReconciliationRequired: markedReconciliationRequired(finalClassification),
    };
  }

  async function reconcileOrderRow(
    context: OrgContext,
    connector: ExchangeConnector,
    order: OrderRow,
    hintedConnectorOrder?: Order | null,
  ): Promise<OrderReconciliationOutcome | null> {
    if (isTerminal(order.state)) {
      let connectorView: ConnectorView;
      try {
        const dbFills = await orderRepository.listFills(context, order.id);
        connectorView = await buildConnectorView(connector, order, dbFills, hintedConnectorOrder);
      } catch {
        return {
          orderId: order.id,
          clientOrderId: order.clientOrderId,
          classification: "AMBIGUOUS_STALE",
          fromState: order.state,
          toState: order.state,
          recordedFills: [],
          markedReconciliationRequired: false,
        };
      }

      const classification = classifyReconciliation(order, connectorView);
      if (classification === "IN_SYNC") {
        return {
          orderId: order.id,
          clientOrderId: order.clientOrderId,
          classification,
          fromState: order.state,
          toState: order.state,
          recordedFills: [],
          markedReconciliationRequired: false,
        };
      }

      await writeReconciliationAudit(context, order.id, classification, {
        clientOrderId: order.clientOrderId,
        connectorStatus: connectorView.order?.status ?? null,
      });

      return {
        orderId: order.id,
        clientOrderId: order.clientOrderId,
        classification,
        fromState: order.state,
        toState: order.state,
        recordedFills: [],
        markedReconciliationRequired: false,
      };
    }

    if (!isPostDispatch(order.state)) {
      return null;
    }

    let connectorView: ConnectorView;
    try {
      const dbFills = await orderRepository.listFills(context, order.id);
      connectorView = await buildConnectorView(connector, order, dbFills, hintedConnectorOrder);
    } catch {
      const ambiguous = await convergeOrder(context, order, "AMBIGUOUS_STALE", {
        order: null,
        trades: [],
        dbFillTradeIds: [],
      });
      return ambiguous;
    }

    const classification = classifyReconciliationForOrder(order, connectorView);
    if (classification === null) {
      return null;
    }

    return await convergeOrder(context, order, classification, connectorView);
  }

  async function reconcileUnknownConnectorOrder(
    context: OrgContext,
    connector: ExchangeConnector,
    connectorOrder: Order,
  ): Promise<OrderReconciliationOutcome | null> {
    const dbOrder = await orderRepository.findOrderByClientOrderId(
      context,
      connectorOrder.clientOrderId,
    );

    if (dbOrder && (dbOrder.state === "CREATED" || dbOrder.state === "RISK_APPROVED")) {
      return null;
    }

    if (dbOrder && isTerminal(dbOrder.state)) {
      const connectorView: ConnectorView = {
        order: connectorOrder,
        trades: [],
        dbFillTradeIds: [],
      };
      const classification = classifyReconciliation(dbOrder, connectorView);
      await writeReconciliationAudit(context, dbOrder.id, classification, {
        clientOrderId: connectorOrder.clientOrderId,
        connectorStatus: connectorOrder.status,
      });
      return {
        orderId: dbOrder.id,
        clientOrderId: connectorOrder.clientOrderId,
        classification,
        fromState: dbOrder.state,
        toState: dbOrder.state,
        recordedFills: [],
        markedReconciliationRequired: false,
      };
    }

    if (dbOrder) {
      return (
        (await reconcileOrderRow(context, connector, dbOrder, connectorOrder)) ?? {
          orderId: dbOrder.id,
          clientOrderId: dbOrder.clientOrderId,
          classification: "IN_SYNC",
          fromState: dbOrder.state,
          toState: dbOrder.state,
          recordedFills: [],
          markedReconciliationRequired: false,
        }
      );
    }

    const classification = classifyReconciliation(null, {
      order: connectorOrder,
      trades: [],
      dbFillTradeIds: [],
    });

    await writeReconciliationAudit(context, undefined, classification, {
      clientOrderId: connectorOrder.clientOrderId,
      connectorStatus: connectorOrder.status,
    });

    return {
      clientOrderId: connectorOrder.clientOrderId,
      classification,
      recordedFills: [],
      markedReconciliationRequired: false,
    };
  }

  async function reconcileOpen(
    context: OrgContext,
    executionMode: "mock" | "paper",
  ): Promise<OrderReconciliationOutcome[]> {
    const connector = connectorForMode(executionMode);
    const allOpenOrders = await orderRepository.listOpenOrders(context, { executionMode });
    const postDispatchOrders = allOpenOrders.filter((order) => isPostDispatch(order.state));

    const workItems = new Map<string, WorkItem>();
    const symbols = new Set<string>();

    for (const order of allOpenOrders) {
      symbols.add(order.symbol);
    }

    for (const order of postDispatchOrders) {
      workItems.set(order.clientOrderId, { order, connectorOrder: undefined });
    }

    for (const symbol of symbols) {
      try {
        const connectorOpen = await connector.getOpenOrders({ symbol });
        for (const connectorOrder of connectorOpen) {
          symbols.add(connectorOrder.symbol);
          const existing = workItems.get(connectorOrder.clientOrderId);
          if (existing) {
            existing.connectorOrder = connectorOrder;
          } else {
            workItems.set(connectorOrder.clientOrderId, { connectorOrder });
          }
        }
      } catch {
        // Per-order reconcile may classify AMBIGUOUS_STALE when connector read fails.
      }
    }

    const outcomes: OrderReconciliationOutcome[] = [];

    for (const item of workItems.values()) {
      if (item.order) {
        const outcome = await reconcileOrderRow(
          context,
          connector,
          item.order,
          item.connectorOrder,
        );
        if (outcome) {
          outcomes.push(outcome);
        }
      } else if (item.connectorOrder) {
        const unknownOutcome = await reconcileUnknownConnectorOrder(
          context,
          connector,
          item.connectorOrder,
        );
        if (unknownOutcome) {
          outcomes.push(unknownOutcome);
        }
      }
    }

    return outcomes;
  }

  async function reconcileSingleOrder(
    context: OrgContext,
    orderId: string,
  ): Promise<OrderReconciliationOutcome[]> {
    const order = await orderRepository.getOrderById(context, orderId);
    if (!order) {
      return [];
    }

    const connector = connectorForMode(order.executionMode);
    const outcome = await reconcileOrderRow(context, connector, order);
    return outcome ? [outcome] : [];
  }

  function buildReport(
    organizationId: string,
    outcomes: OrderReconciliationOutcome[],
    runStartedAt: Date,
  ): ReconciliationReport {
    const counts = buildEmptyCounts();
    for (const outcome of outcomes) {
      counts[outcome.classification] += 1;
    }

    return {
      organizationId,
      runStartedAt,
      outcomes,
      counts,
    };
  }

  return {
    async reconcile(context: OrgContext, target: ReconcileTarget): Promise<ReconciliationReport> {
      const orgContext = requireOrgContext(context.organizationId);
      const runStartedAt = new Date(nowMs());

      let outcomes: OrderReconciliationOutcome[];
      if (target.kind === "open") {
        outcomes = await reconcileOpen(orgContext, target.executionMode);
      } else {
        outcomes = await reconcileSingleOrder(orgContext, target.orderId);
      }

      return buildReport(orgContext.organizationId, outcomes, runStartedAt);
    },
  };
}

export function createReconciliationServiceFromDeps(
  deps: ReconciliationServiceDeps,
): ReconciliationService {
  return createReconciliationService(deps);
}

export function createSqliteReconciliationService(
  db: WaiaDb,
  overrides: Partial<ReconciliationServiceDeps> = {},
): ReconciliationService {
  const nowMs = overrides.nowMs ?? (() => Date.now());
  return createReconciliationService({
    orderRepository: overrides.orderRepository ?? createSqliteOrderRepository(db),
    connectorForMode: overrides.connectorForMode ?? createDefaultConnectorForMode(),
    writeAudit:
      overrides.writeAudit ?? ((input: TraderAuditInput) => writeTraderAuditLogSqlite(db, input)),
    nowMs,
  });
}

export function createPostgresReconciliationService(
  db: WaiaPostgresDb,
  overrides: Partial<ReconciliationServiceDeps> = {},
): ReconciliationService {
  const nowMs = overrides.nowMs ?? (() => Date.now());
  return createReconciliationService({
    orderRepository: overrides.orderRepository ?? createPostgresOrderRepository(db),
    connectorForMode: overrides.connectorForMode ?? createDefaultConnectorForMode(),
    writeAudit:
      overrides.writeAudit ?? ((input: TraderAuditInput) => writeTraderAuditLogPostgres(db, input)),
    nowMs,
  });
}

export function createPostgresReconciliationServiceFromExecutor(
  ex: PgReconciliationExecutor,
  overrides: Partial<ReconciliationServiceDeps> = {},
): ReconciliationService {
  const nowMs = overrides.nowMs ?? (() => Date.now());
  return createReconciliationService({
    orderRepository: overrides.orderRepository ?? createPostgresOrderRepositoryFromExecutor(ex),
    connectorForMode: overrides.connectorForMode ?? createDefaultConnectorForMode(),
    writeAudit:
      overrides.writeAudit ?? ((input: TraderAuditInput) => writeTraderAuditLogPostgres(ex, input)),
    nowMs,
  });
}
