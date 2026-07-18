import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { Bar } from "@/lib/trader/intelligence/types";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { OrderSide } from "@/lib/trader/execution/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  canonicalExchangeTradeId,
  historicalFillId,
} from "@/lib/trader/execution/deterministic-execution-id";
import {
  applyHistoricalExecutionEconomics,
  assertCompleteHistoricalFillEconomics,
} from "@/lib/trader/execution/fill-economics";
import {
  EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
  type HistoricalExecutionCheckpointSlice,
  type HistoricalExecutionEventClass,
  type HistoricalExecutionModelV1,
  type SimulatedFillEvent,
} from "@/lib/trader/execution/historical-execution-model.types";
import { fillExecutionEconomicsRowId } from "@/lib/trader/execution/deterministic-execution-id";
import {
  addDecimal,
  compareDecimal,
  formatDecimal,
  minDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export class UnsupportedHistoricalOrderTypeError extends Error {
  constructor(type: string) {
    super(`[trader] unsupported historical order type: ${type}`);
    this.name = "UnsupportedHistoricalOrderTypeError";
  }
}

export class FillOverfillError extends Error {
  constructor(orderId: string) {
    super(`[trader] fill overfill for order ${orderId}`);
    this.name = "FillOverfillError";
  }
}

export class InvalidBarVolumeError extends Error {
  constructor(symbol: string, volume: string) {
    super(`[trader] invalid bar volume for ${symbol}: ${volume}`);
    this.name = "InvalidBarVolumeError";
  }
}

export type HistoricalExecutionPersistencePort = {
  recordSimulatedFill(
    context: OrgContext,
    order: OrderRow,
    event: SimulatedFillEvent,
    isFirstSlice: boolean,
  ): Promise<void>;
  transitionOrderExpired(context: OrgContext, order: OrderRow): Promise<OrderRow>;
  transitionOrderCancelled(context: OrgContext, order: OrderRow): Promise<OrderRow>;
};

export type AdvanceHistoricalExecutionInput = {
  context: OrgContext;
  closedBar: Bar;
  barIndex: number;
  model: HistoricalExecutionModelV1;
  persistence: HistoricalExecutionPersistencePort;
  replayNowMs: number;
  refreshAccountState: () => Promise<AccountRiskState>;
  reconcileOrder: (orderId: string) => Promise<void>;
};

export type AdvanceHistoricalExecutionResult = {
  fillEvents: SimulatedFillEvent[];
  accountState: AccountRiskState;
};

type PendingCancel = {
  requestedAtTs: number;
  cancelEffectiveTs: number;
};

type OpenHistoricalOrder = {
  order: OrderRow;
  acceptedAtTs: number;
  decisionBarIndex: number;
  firstEligibleBarIndex: number;
  windowEndBarIndex: number;
  remainingQty: string;
  filledQty: string;
  fillSequence: number;
  pendingCancel?: PendingCancel;
};

export type HistoricalSimulatedExchange = {
  registerOrder(order: OrderRow, decisionBarIndex: number, acceptedAtTs: number): void;
  requestCancel(orderId: string, requestedAtTs: number, cancelLatencyMs: number): void;
  advanceOnClosedBar(
    input: AdvanceHistoricalExecutionInput,
  ): Promise<AdvanceHistoricalExecutionResult>;
  buildCheckpointSlice(): HistoricalExecutionCheckpointSlice;
  restoreFromCheckpointSlice(
    slice: HistoricalExecutionCheckpointSlice,
    ordersById: Map<string, OrderRow>,
  ): void;
  listOpenOrders(): ReadonlyArray<OpenHistoricalOrder>;
  hasOpenOrder?(orderId: string): boolean;
};

function requireFiniteNonNegativeVolume(volume: string, symbol: string): string {
  const trimmed = volume.trim();
  if (trimmed === "" || !Number.isFinite(Number(trimmed)) || Number(trimmed) < 0) {
    throw new InvalidBarVolumeError(symbol, volume);
  }
  return trimmed;
}

function floorToQuantityStep(quantity: string, step: string): string {
  const qtyScaled = parseDecimal(quantity);
  const stepScaled = parseDecimal(step);
  if (stepScaled === 0n) {
    return quantity;
  }
  const floored = (qtyScaled / stepScaled) * stepScaled;
  return formatDecimal(floored);
}

function eventClassPriority(eventClass: HistoricalExecutionEventClass): number {
  if (eventClass === "CANCEL_EFFECTIVE") return 0;
  if (eventClass === "FILL") return 1;
  return 2;
}

type ScheduledEvent = {
  replayTs: number;
  eventClass: HistoricalExecutionEventClass;
  orderId: string;
  fillSequence: number;
  run: () => Promise<void>;
};

export function createHistoricalSimulatedExchange(
  model: HistoricalExecutionModelV1,
): HistoricalSimulatedExchange {
  const openOrders = new Map<string, OpenHistoricalOrder>();

  function registerOrder(order: OrderRow, decisionBarIndex: number, acceptedAtTs: number): void {
    if (order.type !== "market") {
      throw new UnsupportedHistoricalOrderTypeError(order.type);
    }
    if (!model.symbols.includes(order.symbol as "BTCUSDT" | "ETHUSDT")) {
      throw new UnsupportedHistoricalOrderTypeError(`symbol:${order.symbol}`);
    }
    const firstEligibleBarIndex = decisionBarIndex + 1;
    const windowEndBarIndex = decisionBarIndex + model.maxEligibleClosedBars;
    openOrders.set(order.id, {
      order,
      acceptedAtTs,
      decisionBarIndex,
      firstEligibleBarIndex,
      windowEndBarIndex,
      remainingQty: order.quantity,
      filledQty: "0",
      fillSequence: 0,
    });
  }

  function requestCancel(orderId: string, requestedAtTs: number, cancelLatencyMs: number): void {
    const entry = openOrders.get(orderId);
    if (!entry || entry.pendingCancel) {
      return;
    }
    entry.pendingCancel = {
      requestedAtTs,
      cancelEffectiveTs: requestedAtTs + cancelLatencyMs,
    };
  }

  function hasOpenOrder(orderId: string): boolean {
    return openOrders.has(orderId);
  }

  function buildCheckpointSlice(): HistoricalExecutionCheckpointSlice {
    return {
      schemaVersion: "htr-wp17-execution-checkpoint/v1",
      openOrders: [...openOrders.values()].map((entry) => ({
        orderId: entry.order.id,
        acceptedAtTs: entry.acceptedAtTs,
        firstEligibleTs: entry.acceptedAtTs,
        windowEndBarIndex: entry.windowEndBarIndex,
        remainingQty: entry.remainingQty,
        filledQty: entry.filledQty,
        fillSequence: entry.fillSequence,
        pendingCancel: entry.pendingCancel,
      })),
      executionModelSchemaVersion: model.schemaVersion,
    };
  }

  function restoreFromCheckpointSlice(
    slice: HistoricalExecutionCheckpointSlice,
    ordersById: Map<string, OrderRow>,
  ): void {
    openOrders.clear();
    for (const row of slice.openOrders) {
      const order = ordersById.get(row.orderId);
      if (!order) continue;
      openOrders.set(row.orderId, {
        order,
        acceptedAtTs: row.acceptedAtTs,
        decisionBarIndex: row.windowEndBarIndex - model.maxEligibleClosedBars,
        firstEligibleBarIndex: row.windowEndBarIndex - model.maxEligibleClosedBars + 1,
        windowEndBarIndex: row.windowEndBarIndex,
        remainingQty: row.remainingQty,
        filledQty: row.filledQty,
        fillSequence: row.fillSequence,
        pendingCancel: row.pendingCancel,
      });
    }
  }

  async function advanceOnClosedBar(
    input: AdvanceHistoricalExecutionInput,
  ): Promise<AdvanceHistoricalExecutionResult> {
    const { closedBar, barIndex, context, persistence, replayNowMs } = input;
    const fillEvents: SimulatedFillEvent[] = [];
    const scheduled: ScheduledEvent[] = [];

    for (const entry of openOrders.values()) {
      if (entry.pendingCancel && entry.pendingCancel.cancelEffectiveTs <= replayNowMs) {
        scheduled.push({
          replayTs: entry.pendingCancel.cancelEffectiveTs,
          eventClass: "CANCEL_EFFECTIVE",
          orderId: entry.order.id,
          fillSequence: entry.fillSequence,
          run: async () => {
            const updated = await persistence.transitionOrderCancelled(context, entry.order);
            entry.order = updated;
            openOrders.delete(entry.order.id);
            await input.reconcileOrder(entry.order.id);
          },
        });
      }

      const eligible =
        barIndex >= entry.firstEligibleBarIndex &&
        barIndex <= entry.windowEndBarIndex &&
        barIndex > entry.decisionBarIndex &&
        !entry.pendingCancel;

      if (eligible && compareDecimal(entry.remainingQty, "0") > 0) {
        const volume = requireFiniteNonNegativeVolume(closedBar.volume, closedBar.symbol);
        const rawCapacity = multiplyDecimal(volume, model.participationCapFraction);
        const roundedCapacity = floorToQuantityStep(rawCapacity, model.quantityStep);
        const candidateSlice = minDecimal(entry.remainingQty, roundedCapacity);

        if (compareDecimal(candidateSlice, model.minimumExecutableSliceQty) >= 0) {
          const nextSequence = entry.fillSequence + 1;
          scheduled.push({
            replayTs: replayNowMs,
            eventClass: "FILL",
            orderId: entry.order.id,
            fillSequence: nextSequence,
            run: async () => {
              const remainingAfter = subtractDecimal(entry.remainingQty, candidateSlice);
              const event: SimulatedFillEvent = {
                orderId: entry.order.id,
                organizationId: context.organizationId,
                symbol: entry.order.symbol,
                side: entry.order.side,
                fillSequence: nextSequence,
                sourceBarIndex: barIndex,
                sourceBar: closedBar,
                grossFillPrice: closedBar.close,
                sliceQuantity: candidateSlice,
                remainingQuantityAfter: remainingAfter,
                acceptedAt: new Date(entry.acceptedAtTs),
                fillTimestamp: new Date(replayNowMs),
                submitLatencyMs: model.submitLatencyMs,
                cancelLatencyMs: null,
              };
              fillEvents.push(event);
              const isFirstSlice = entry.fillSequence === 0;
              await persistence.recordSimulatedFill(context, entry.order, event, isFirstSlice);
              entry.fillSequence = nextSequence;
              entry.filledQty = addDecimal(entry.filledQty, candidateSlice);
              entry.remainingQty = remainingAfter;
              if (compareDecimal(entry.remainingQty, "0") === 0) {
                openOrders.delete(entry.order.id);
              }
              await input.reconcileOrder(entry.order.id);
            },
          });
        }
      }

      if (
        barIndex === entry.windowEndBarIndex &&
        compareDecimal(entry.remainingQty, "0") > 0 &&
        !entry.pendingCancel
      ) {
        scheduled.push({
          replayTs: replayNowMs,
          eventClass: "EXPIRY",
          orderId: entry.order.id,
          fillSequence: entry.fillSequence,
          run: async () => {
            const updated = await persistence.transitionOrderExpired(context, entry.order);
            entry.order = updated;
            openOrders.delete(entry.order.id);
            await input.reconcileOrder(entry.order.id);
          },
        });
      }
    }

    scheduled.sort((a, b) => {
      if (a.replayTs !== b.replayTs) return a.replayTs - b.replayTs;
      const pc = eventClassPriority(a.eventClass) - eventClassPriority(b.eventClass);
      if (pc !== 0) return pc;
      if (a.orderId !== b.orderId) return a.orderId.localeCompare(b.orderId);
      return a.fillSequence - b.fillSequence;
    });

    for (const event of scheduled) {
      await event.run();
    }

    const accountState = await input.refreshAccountState();
    return { fillEvents, accountState };
  }

  return {
    registerOrder,
    requestCancel,
    advanceOnClosedBar,
    buildCheckpointSlice,
    restoreFromCheckpointSlice,
    listOpenOrders: () => [...openOrders.values()],
    hasOpenOrder,
  };
}

export function requestHistoricalBreachCancelIfOpen(
  exchange: HistoricalSimulatedExchange,
  orderId: string,
  requestedAtTs: number,
  cancelLatencyMs: number,
): boolean {
  const isOpen =
    typeof exchange.hasOpenOrder === "function"
      ? exchange.hasOpenOrder(orderId)
      : exchange.listOpenOrders().some((entry) => entry.order.id === orderId);
  if (!isOpen) {
    return false;
  }
  exchange.requestCancel(orderId, requestedAtTs, cancelLatencyMs);
  return true;
}

export async function advanceHistoricalExecutionOnClosedBar(
  exchange: HistoricalSimulatedExchange,
  input: AdvanceHistoricalExecutionInput,
): Promise<AdvanceHistoricalExecutionResult> {
  return exchange.advanceOnClosedBar(input);
}

/** Bound exchange instance used by backtest runner. */
export function bindHistoricalSimulatedExchange(
  model: HistoricalExecutionModelV1,
): HistoricalSimulatedExchange {
  return createHistoricalSimulatedExchange(model);
}

export function buildEconomicsRowFromEvent(
  event: SimulatedFillEvent,
  economics: ReturnType<typeof applyHistoricalExecutionEconomics>,
  fillId: string,
  organizationId: string,
  orderId: string,
): import("@/lib/trader/execution/historical-execution-model.types").FillExecutionEconomicsRow {
  return {
    id: fillExecutionEconomicsRowId(fillId),
    organizationId,
    fillId,
    orderId,
    exchangeTradeId: canonicalExchangeTradeId(orderId, event.fillSequence),
    fillSequence: event.fillSequence,
    symbol: event.symbol,
    side: event.side,
    quantity: event.sliceQuantity,
    grossFillPrice: economics.grossFillPrice,
    grossNotional: economics.grossNotional,
    feeAmount: economics.feeAmount,
    feeAsset: economics.feeAsset,
    spreadCost: economics.spreadCost,
    impactSlippageCost: economics.impactSlippageCost,
    totalExecutionCost: economics.totalExecutionCost,
    netFillPrice: economics.netFillPrice,
    netCashEffect: economics.netCashEffect,
    remainingQuantityAfter: economics.remainingQuantityAfter,
    executionModelId: economics.executionModelId,
    executionModelSchemaVersion: economics.executionModelSchemaVersion,
    simulatorId: economics.simulatorId,
    simulatorVersion: economics.simulatorVersion,
    sourceBarTimestamp: economics.sourceBarTimestamp,
    sourceBarIndex: economics.sourceBarIndex,
    acceptedAt: economics.acceptedAt,
    fillTimestamp: economics.fillTimestamp,
    submitLatencyMs: economics.submitLatencyMs,
    cancelLatencyMs: economics.cancelLatencyMs,
    executionFactKind: EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
    economicsContentDigest: economics.economicsContentDigest,
    schemaVersion: "htr-fill-execution-economics/v1",
  };
}

export function buildRecordFillPayload(
  event: SimulatedFillEvent,
  economics: ReturnType<typeof applyHistoricalExecutionEconomics>,
  organizationId: string,
  orderId: string,
  orderSide: OrderSide,
  avgFillPrice: string,
  filledQuantity: string,
  isProgress: boolean,
):
  | import("@/lib/trader/execution/order-repository.types").RecordFillInput
  | import("@/lib/trader/execution/order-repository.types").RecordFillProgressInput {
  const fillId = historicalFillId({
    organizationId,
    orderId,
    fillSequence: event.fillSequence,
    sourceBarIndex: event.sourceBarIndex,
  });
  const economicsRow = buildEconomicsRowFromEvent(
    event,
    economics,
    fillId,
    organizationId,
    orderId,
  );
  const base = {
    orderId,
    exchangeTradeId: canonicalExchangeTradeId(orderId, event.fillSequence),
    price: economics.netFillPrice,
    quantity: event.sliceQuantity,
    fee: economics.feeAmount,
    feeAsset: economics.feeAsset,
    executedAt: event.fillTimestamp,
    executionFactKind: EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
    economics,
    fillId,
    economicsRow,
  };
  if (isProgress) {
    return { ...base, filledQuantity, avgFillPrice };
  }
  return base;
}

export { applyHistoricalExecutionEconomics, assertCompleteHistoricalFillEconomics };
