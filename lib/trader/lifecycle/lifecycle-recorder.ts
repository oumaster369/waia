import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { LifecycleRepository } from "@/lib/trader/lifecycle/lifecycle-repository.types";
import { TRADE_LIFECYCLE_SEMANTICS_VERSION_V2 } from "@/lib/trader/lifecycle/trade-lifecycle-semantics";
import type { TradeLineageAtOpen } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import type { PaperMarkToCloseTrade } from "@/lib/trader/paper/derive-paper-pnl";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type LifecycleRecorderDeps = {
  repository: LifecycleRepository;
  newId?: () => string;
};

export type RecordFillLifecycleInput = {
  context: OrgContext;
  order: OrderRow;
  fill: FillRow;
  accountKey: string;
  lineage: TradeLineageAtOpen;
};

export type RecordSignalAcceptedInput = {
  context: OrgContext;
  strategySignalId: string;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
  researchRunId?: string | null;
};

export type RecordForcedFlatLifecycleInput = {
  context: OrgContext;
  accountKey: string;
  strategySignalId: string;
  markToClose: PaperMarkToCloseTrade;
};

export async function recordSignalAcceptedLifecycleEvent(
  deps: LifecycleRecorderDeps,
  input: RecordSignalAcceptedInput,
): Promise<void> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  await deps.repository.insertLifecycleEvent(input.context, {
    event: {
      id: newId(),
      organizationId: input.context.organizationId,
      entityType: "STRATEGY_SIGNAL",
      entityId: input.strategySignalId,
      phase: "SIGNAL_ACCEPTED",
      payload: input.payload ? JSON.stringify(input.payload) : null,
      occurredAt: input.occurredAt ?? new Date(),
      researchRunId: input.researchRunId ?? null,
    },
  });
}

async function recordLifecyclePhase(
  deps: LifecycleRecorderDeps,
  input: {
    context: OrgContext;
    entityType: "ORDER" | "FILL" | "TRADE" | "POSITION_LOT";
    entityId: string;
    phase: "ORDER_FILLED" | "TRADE_OPENED" | "TRADE_CLOSED" | "FORCED_FLAT";
    occurredAt: Date;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  await deps.repository.insertLifecycleEvent(input.context, {
    event: {
      id: newId(),
      organizationId: input.context.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      phase: input.phase,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      occurredAt: input.occurredAt,
      researchRunId: null,
    },
  });
}

async function recordBuyFill(
  deps: LifecycleRecorderDeps,
  input: RecordFillLifecycleInput,
): Promise<void> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const { context, order, fill, accountKey, lineage } = input;
  const tradeId = newId();
  const lotId = newId();
  const legId = newId();
  const now = new Date();

  await deps.repository.insertTrade(context, {
    trade: {
      id: tradeId,
      organizationId: context.organizationId,
      symbol: order.symbol,
      venue: order.venue,
      accountKey,
      positionSide: "LONG",
      instrumentKind: "SPOT",
      strategySignalId: lineage.strategySignalId,
      strategyId: lineage.strategyId,
      strategyVersion: lineage.strategyVersion,
      state: "OPEN",
      semanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
      openedAt: fill.executedAt,
      closedAt: null,
      realizedPnl: "0",
      markedPnl: "0",
      hypothesisId: lineage.hypothesisId ?? null,
      patternId: lineage.patternId ?? null,
      riskDecisionId: lineage.riskDecisionId,
      allocationDecisionId: lineage.allocationDecisionId ?? null,
      reasoningSessionId: lineage.reasoningSessionId ?? null,
      signalConfidence: lineage.signalConfidence ?? null,
      openingRegime: lineage.openingRegime ?? null,
      openingMsvId: lineage.openingMsvId ?? null,
      openingFeatureSetId: lineage.openingFeatureSetId ?? null,
      closingMsvId: null,
      closingFeatureSetId: null,
      closingRegime: null,
      frozenAt: null,
    },
  });

  await deps.repository.insertPositionLot(context, {
    lot: {
      id: lotId,
      organizationId: context.organizationId,
      symbol: order.symbol,
      venue: order.venue,
      accountKey,
      positionSide: "LONG",
      instrumentKind: "SPOT",
      strategySignalId: lineage.strategySignalId,
      state: "OPEN",
      openQty: fill.quantity,
      remainingQty: fill.quantity,
      avgCost: fill.price,
      openedAt: fill.executedAt,
      closedAt: null,
      tradeId,
      hedgeGroupId: null,
      targetLotId: null,
    },
  });

  await deps.repository.insertTradeLeg(context, {
    leg: {
      id: legId,
      organizationId: context.organizationId,
      tradeId,
      positionLotId: lotId,
      kind: "OPEN_FILL",
      orderId: order.id,
      fillId: fill.id,
      syntheticId: null,
      quantity: fill.quantity,
      price: fill.price,
      fee: fill.fee,
      executedAt: fill.executedAt,
      legPnl: "0",
    },
  });

  await recordLifecyclePhase(deps, {
    context,
    entityType: "FILL",
    entityId: fill.id,
    phase: "ORDER_FILLED",
    occurredAt: fill.executedAt,
    payload: { orderId: order.id },
  });
  await recordLifecyclePhase(deps, {
    context,
    entityType: "TRADE",
    entityId: tradeId,
    phase: "TRADE_OPENED",
    occurredAt: fill.executedAt,
    payload: { positionLotId: lotId },
  });
}

async function recordSellFill(
  deps: LifecycleRecorderDeps,
  input: RecordFillLifecycleInput,
): Promise<void> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const { context, order, fill, lineage } = input;

  const openLots = await deps.repository.listOpenPositionLots(context, {
    symbol: order.symbol,
    strategySignalId: lineage.strategySignalId,
  });

  if (openLots.length === 0) {
    throw new Error(`[trader/lifecycle/recorder] no open lot for sell fill ${fill.id}`);
  }

  const lot = openLots[0]!;
  let remainingSellQty = fill.quantity;
  const quoteFeePerUnit =
    compareDecimal(fill.quantity, "0") > 0 ? divideDecimal(fill.fee, fill.quantity) : "0";

  while (compareDecimal(remainingSellQty, "0") > 0) {
    const closeQty =
      compareDecimal(remainingSellQty, lot.remainingQty) <= 0 ? remainingSellQty : lot.remainingQty;

    const proceeds = multiplyDecimal(fill.price, closeQty);
    const cost = multiplyDecimal(closeQty, lot.avgCost);
    const legFee = multiplyDecimal(quoteFeePerUnit, closeQty);
    const legPnl = subtractDecimal(subtractDecimal(proceeds, cost), legFee);

    await deps.repository.insertTradeLeg(context, {
      leg: {
        id: newId(),
        organizationId: context.organizationId,
        tradeId: lot.tradeId,
        positionLotId: lot.id,
        kind: "CLOSE_FILL",
        orderId: order.id,
        fillId: fill.id,
        syntheticId: null,
        quantity: closeQty,
        price: fill.price,
        fee: legFee,
        executedAt: fill.executedAt,
        legPnl,
      },
    });

    const trade = await deps.repository.getTradeById(context, lot.tradeId);
    if (!trade) {
      throw new Error(`[trader/lifecycle/recorder] trade missing for lot ${lot.id}`);
    }

    const nextRemaining = subtractDecimal(lot.remainingQty, closeQty);
    const nextRealized = addDecimal(trade.realizedPnl, legPnl);

    if (compareDecimal(nextRemaining, "0") <= 0) {
      await deps.repository.updatePositionLot(context, {
        lotId: lot.id,
        remainingQty: "0",
        state: "CLOSED",
        closedAt: fill.executedAt,
      });

      await deps.repository.updateTradeOperational(context, {
        tradeId: trade.id,
        state: "CLOSED",
        closedAt: fill.executedAt,
        realizedPnl: nextRealized,
        frozenAt: new Date(),
      });

      await recordLifecyclePhase(deps, {
        context,
        entityType: "TRADE",
        entityId: trade.id,
        phase: "TRADE_CLOSED",
        occurredAt: fill.executedAt,
      });
    } else {
      await deps.repository.updatePositionLot(context, {
        lotId: lot.id,
        remainingQty: nextRemaining,
      });
      await deps.repository.updateTradeOperational(context, {
        tradeId: trade.id,
        realizedPnl: nextRealized,
      });
      lot.remainingQty = nextRemaining;
    }

    await recordLifecyclePhase(deps, {
      context,
      entityType: "FILL",
      entityId: fill.id,
      phase: "ORDER_FILLED",
      occurredAt: fill.executedAt,
      payload: { orderId: order.id, positionLotId: lot.id },
    });

    remainingSellQty = subtractDecimal(remainingSellQty, closeQty);
    if (compareDecimal(remainingSellQty, "0") > 0) {
      const nextLots = await deps.repository.listOpenPositionLots(context, {
        symbol: order.symbol,
        strategySignalId: lineage.strategySignalId,
      });
      if (nextLots.length === 0) {
        throw new Error(
          `[trader/lifecycle/recorder] insufficient open qty for partial sell ${fill.id}`,
        );
      }
      Object.assign(lot, nextLots[0]!);
    }
  }
}

export async function recordFillLifecycle(
  deps: LifecycleRecorderDeps,
  input: RecordFillLifecycleInput,
): Promise<void> {
  if (input.order.side === "buy") {
    await recordBuyFill(deps, input);
    return;
  }

  if (input.order.side === "sell") {
    await recordSellFill(deps, input);
  }
}

export async function recordForcedFlatLifecycle(
  deps: LifecycleRecorderDeps,
  input: RecordForcedFlatLifecycleInput,
): Promise<void> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const { context, strategySignalId, markToClose } = input;
  const openLots = await deps.repository.listOpenPositionLots(context, {
    symbol: markToClose.symbol,
    strategySignalId,
  });

  for (const lot of openLots) {
    if (compareDecimal(lot.remainingQty, "0") <= 0) {
      continue;
    }

    const legFee =
      compareDecimal(markToClose.quantity, "0") > 0
        ? multiplyDecimal(
            markToClose.sellFee,
            divideDecimal(lot.remainingQty, markToClose.quantity),
          )
        : "0";
    const proceeds = multiplyDecimal(markToClose.adjustedSellPrice, lot.remainingQty);
    const cost = multiplyDecimal(lot.remainingQty, lot.avgCost);
    const legPnl = subtractDecimal(subtractDecimal(proceeds, cost), legFee);
    const frozenAt = new Date();

    await deps.repository.insertTradeLeg(context, {
      leg: {
        id: newId(),
        organizationId: context.organizationId,
        tradeId: lot.tradeId,
        positionLotId: lot.id,
        kind: "FORCED_FLAT",
        orderId: "",
        fillId: null,
        syntheticId: markToClose.syntheticId,
        quantity: lot.remainingQty,
        price: markToClose.adjustedSellPrice,
        fee: legFee,
        executedAt: markToClose.executedAt,
        legPnl,
      },
    });

    await deps.repository.updatePositionLot(context, {
      lotId: lot.id,
      remainingQty: "0",
      state: "CLOSED",
      closedAt: markToClose.executedAt,
    });

    const trade = await deps.repository.getTradeById(context, lot.tradeId);
    if (!trade) {
      throw new Error(`[trader/lifecycle/recorder] trade missing for forced-flat lot ${lot.id}`);
    }

    await deps.repository.updateTradeOperational(context, {
      tradeId: trade.id,
      state: "FORCED_FLAT",
      closedAt: markToClose.executedAt,
      markedPnl: legPnl,
      frozenAt,
    });

    await recordLifecyclePhase(deps, {
      context,
      entityType: "TRADE",
      entityId: trade.id,
      phase: "FORCED_FLAT",
      occurredAt: markToClose.executedAt,
      payload: { syntheticId: markToClose.syntheticId, positionLotId: lot.id },
    });
  }
}

export function createLifecycleRecorder(deps: LifecycleRecorderDeps) {
  return {
    recordFillLifecycle: (input: RecordFillLifecycleInput) => recordFillLifecycle(deps, input),
    recordSignalAcceptedLifecycleEvent: (input: RecordSignalAcceptedInput) =>
      recordSignalAcceptedLifecycleEvent(deps, input),
    recordForcedFlatLifecycle: (input: RecordForcedFlatLifecycleInput) =>
      recordForcedFlatLifecycle(deps, input),
  };
}

export type LifecycleRecorder = ReturnType<typeof createLifecycleRecorder>;
