import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

import type {
  PairingKey,
  PositionLotRow,
  PositionSide,
  TradeLegKind,
  TradeLegRow,
  TradeLineageAtOpen,
  TradeRow,
  TradeState,
} from "@/lib/trader/lifecycle/trade-lifecycle.types";
import {
  buildPairingKey,
  isTerminalTradeState,
} from "@/lib/trader/lifecycle/trade-lifecycle.types";
import { TRADE_LIFECYCLE_SEMANTICS_VERSION_V2 } from "@/lib/trader/lifecycle/trade-lifecycle-semantics";

export type PairingFillEvent = {
  fill: FillRow;
  order: OrderRow;
  accountKey: string;
  lineage: TradeLineageAtOpen;
};

export type ForcedFlatSyntheticInput = {
  organizationId: string;
  symbol: string;
  strategySignalId: string;
  accountKey: string;
  boundaryClosePrice: string;
  adjustedSellPrice: string;
  sellFee: string;
  tradePnl: string;
  boundaryTimestamp: Date;
  syntheticId: string;
  lineage: TradeLineageAtOpen;
};

type MutableLot = PositionLotRow;

type PairingBucket = {
  openLots: MutableLot[];
};

export type PairingSnapshot = {
  lots: PositionLotRow[];
  trades: TradeRow[];
  legs: TradeLegRow[];
};

function createEmptyTrade(input: {
  id: string;
  organizationId: string;
  symbol: string;
  venue: string;
  accountKey: string;
  positionSide: PositionSide;
  openedAt: Date;
  lineage: TradeLineageAtOpen;
  now: Date;
}): TradeRow {
  return {
    id: input.id,
    organizationId: input.organizationId,
    symbol: input.symbol,
    venue: input.venue,
    accountKey: input.accountKey,
    positionSide: input.positionSide,
    instrumentKind: "SPOT",
    strategySignalId: input.lineage.strategySignalId,
    strategyId: input.lineage.strategyId,
    strategyVersion: input.lineage.strategyVersion,
    state: "OPEN",
    semanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
    openedAt: input.openedAt,
    closedAt: null,
    realizedPnl: "0",
    markedPnl: "0",
    hypothesisId: input.lineage.hypothesisId ?? null,
    patternId: input.lineage.patternId ?? null,
    riskDecisionId: input.lineage.riskDecisionId,
    allocationDecisionId: input.lineage.allocationDecisionId ?? null,
    reasoningSessionId: input.lineage.reasoningSessionId ?? null,
    signalConfidence: input.lineage.signalConfidence ?? null,
    openingRegime: input.lineage.openingRegime ?? null,
    openingMsvId: input.lineage.openingMsvId ?? null,
    openingFeatureSetId: input.lineage.openingFeatureSetId ?? null,
    openingCausalLineageJson: input.lineage.openingCausalLineageJson ?? null,
    openingCausalLineageDigest: input.lineage.openingCausalLineageDigest ?? null,
    closingMsvId: null,
    closingFeatureSetId: null,
    closingRegime: null,
    frozenAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function freezeTrade(
  trade: TradeRow,
  state: TradeState,
  closedAt: Date,
  realizedPnl: string,
  markedPnl: string,
  now: Date,
): TradeRow {
  return {
    ...trade,
    state,
    closedAt,
    realizedPnl,
    markedPnl,
    frozenAt: now,
    updatedAt: now,
  };
}

function applyBuyFill(
  snapshot: PairingSnapshot,
  buckets: Map<string, PairingBucket>,
  event: PairingFillEvent,
  ids: { tradeId: string; lotId: string; legId: string },
  now: Date,
): void {
  const { fill, order, accountKey, lineage } = event;
  if (order.side !== "buy") {
    throw new Error("[trader/lifecycle/pairing] applyBuyFill called for non-buy order");
  }

  const key = buildPairingKey({
    organizationId: order.organizationId,
    symbol: order.symbol,
    strategySignalId: lineage.strategySignalId,
    accountKey,
  });

  const trade = createEmptyTrade({
    id: ids.tradeId,
    organizationId: order.organizationId,
    symbol: order.symbol,
    venue: order.venue,
    accountKey,
    positionSide: "LONG",
    openedAt: fill.executedAt,
    lineage,
    now,
  });
  snapshot.trades.push(trade);

  const lot: MutableLot = {
    id: ids.lotId,
    organizationId: order.organizationId,
    symbol: order.symbol,
    venue: order.venue,
    accountKey,
    positionSide: "LONG",
    instrumentKind: "SPOT",
    strategySignalId: lineage.strategySignalId,
    openingCausalLineageJson: lineage.openingCausalLineageJson ?? null,
    openingCausalLineageDigest: lineage.openingCausalLineageDigest ?? null,
    state: "OPEN",
    openQty: fill.quantity,
    remainingQty: fill.quantity,
    avgCost: fill.price,
    openedAt: fill.executedAt,
    closedAt: null,
    tradeId: trade.id,
    hedgeGroupId: null,
    targetLotId: null,
    createdAt: now,
    updatedAt: now,
  };
  snapshot.lots.push(lot);

  const bucket = buckets.get(key) ?? { openLots: [] };
  bucket.openLots.push(lot);
  buckets.set(key, bucket);

  snapshot.legs.push({
    id: ids.legId,
    organizationId: order.organizationId,
    tradeId: trade.id,
    positionLotId: lot.id,
    kind: "OPEN_FILL",
    orderId: order.id,
    fillId: fill.id,
    syntheticId: null,
    quantity: fill.quantity,
    price: fill.price,
    fee: fill.fee,
    executedAt: fill.executedAt,
    legPnl: "0",
    createdAt: now,
  });
}

function applySellFill(
  snapshot: PairingSnapshot,
  buckets: Map<string, PairingBucket>,
  event: PairingFillEvent,
  ids: { legId: string },
  now: Date,
): void {
  const { fill, order, accountKey, lineage } = event;
  if (order.side !== "sell") {
    throw new Error("[trader/lifecycle/pairing] applySellFill called for non-sell order");
  }

  const key = buildPairingKey({
    organizationId: order.organizationId,
    symbol: order.symbol,
    strategySignalId: lineage.strategySignalId,
    accountKey,
  });

  const bucket = buckets.get(key);
  if (!bucket || bucket.openLots.length === 0) {
    throw new Error(
      `[trader/lifecycle/pairing] sell fill ${fill.id} has no open lot for key ${key}`,
    );
  }

  let remainingSellQty = fill.quantity;
  const quoteFeePerUnit =
    compareDecimal(fill.quantity, "0") > 0 ? divideDecimal(fill.fee, fill.quantity) : "0";

  while (compareDecimal(remainingSellQty, "0") > 0) {
    const lot = bucket.openLots[0];
    if (!lot) {
      throw new Error(`[trader/lifecycle/pairing] insufficient open qty for sell fill ${fill.id}`);
    }

    const closeQty =
      compareDecimal(remainingSellQty, lot.remainingQty) <= 0 ? remainingSellQty : lot.remainingQty;

    const proceeds = multiplyDecimal(fill.price, closeQty);
    const cost = multiplyDecimal(closeQty, lot.avgCost);
    const legFee = multiplyDecimal(quoteFeePerUnit, closeQty);
    const legPnl = subtractDecimal(subtractDecimal(proceeds, cost), legFee);

    snapshot.legs.push({
      id: `${ids.legId}:${snapshot.legs.length}`,
      organizationId: order.organizationId,
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
      createdAt: now,
    });

    lot.remainingQty = subtractDecimal(lot.remainingQty, closeQty);
    lot.updatedAt = now;

    const tradeIndex = snapshot.trades.findIndex((entry) => entry.id === lot.tradeId);
    const trade = tradeIndex >= 0 ? snapshot.trades[tradeIndex]! : null;
    if (!trade || isTerminalTradeState(trade.state)) {
      throw new Error(`[trader/lifecycle/pairing] missing open trade for lot ${lot.id}`);
    }

    const nextRealized = addDecimal(trade.realizedPnl, legPnl);
    if (compareDecimal(lot.remainingQty, "0") <= 0) {
      lot.state = "CLOSED";
      lot.closedAt = fill.executedAt;
      bucket.openLots.shift();
      snapshot.trades[tradeIndex] = freezeTrade(
        { ...trade, realizedPnl: nextRealized },
        "CLOSED",
        fill.executedAt,
        nextRealized,
        "0",
        now,
      );
    } else {
      snapshot.trades[tradeIndex] = {
        ...trade,
        realizedPnl: nextRealized,
        updatedAt: now,
      };
    }

    remainingSellQty = subtractDecimal(remainingSellQty, closeQty);
  }
}

export function applyForcedFlatSynthetic(
  snapshot: PairingSnapshot,
  buckets: Map<string, PairingBucket>,
  input: ForcedFlatSyntheticInput,
  ids: { legId: string },
  now: Date,
): void {
  const matchingLots = snapshot.lots.filter(
    (lot) =>
      lot.organizationId === input.organizationId &&
      lot.symbol === input.symbol &&
      lot.strategySignalId === input.lineage.strategySignalId &&
      lot.accountKey === input.accountKey &&
      lot.state === "OPEN",
  );

  for (const lot of matchingLots) {
    if (compareDecimal(lot.remainingQty, "0") <= 0) {
      continue;
    }

    const bucketKey = buildPairingKey({
      organizationId: lot.organizationId,
      symbol: lot.symbol,
      strategySignalId: lot.strategySignalId,
      accountKey: lot.accountKey,
    });
    const bucket = buckets.get(bucketKey);
    if (bucket) {
      bucket.openLots = bucket.openLots.filter((entry) => entry.id !== lot.id);
    }

    snapshot.legs.push({
      id: `${ids.legId}:${lot.id}`,
      organizationId: lot.organizationId,
      tradeId: lot.tradeId,
      positionLotId: lot.id,
      kind: "FORCED_FLAT",
      orderId: null,
      fillId: null,
      syntheticId: input.syntheticId,
      quantity: lot.remainingQty,
      price: input.adjustedSellPrice,
      fee: input.sellFee,
      executedAt: input.boundaryTimestamp,
      legPnl: input.tradePnl,
      createdAt: now,
    });

    lot.remainingQty = "0";
    lot.state = "CLOSED";
    lot.closedAt = input.boundaryTimestamp;
    lot.updatedAt = now;

    const tradeIndex = snapshot.trades.findIndex((entry) => entry.id === lot.tradeId);
    const trade = tradeIndex >= 0 ? snapshot.trades[tradeIndex]! : null;
    if (!trade) {
      continue;
    }

    snapshot.trades[tradeIndex] = freezeTrade(
      trade,
      "FORCED_FLAT",
      input.boundaryTimestamp,
      trade.realizedPnl,
      input.tradePnl,
      now,
    );
  }
}

export function pairFillsFifo(input: {
  events: readonly PairingFillEvent[];
  newId?: () => string;
  now?: Date;
}): PairingSnapshot {
  const newId = input.newId ?? (() => crypto.randomUUID());
  const now = input.now ?? new Date();
  const snapshot: PairingSnapshot = { lots: [], trades: [], legs: [] };
  const buckets = new Map<string, PairingBucket>();

  const sorted = [...input.events].sort((a, b) => {
    const delta = a.fill.executedAt.getTime() - b.fill.executedAt.getTime();
    if (delta !== 0) {
      return delta;
    }
    return a.fill.id.localeCompare(b.fill.id);
  });

  for (const event of sorted) {
    if (event.order.side === "buy") {
      applyBuyFill(
        snapshot,
        buckets,
        event,
        {
          tradeId: newId(),
          lotId: newId(),
          legId: newId(),
        },
        now,
      );
      continue;
    }

    if (event.order.side === "sell") {
      applySellFill(snapshot, buckets, event, { legId: newId() }, now);
    }
  }

  return snapshot;
}

export function countOpenLotsForKey(snapshot: PairingSnapshot, key: PairingKey): number {
  const pairingKey = buildPairingKey(key);
  return snapshot.lots.filter(
    (lot) =>
      lot.state === "OPEN" &&
      buildPairingKey({
        organizationId: lot.organizationId,
        symbol: lot.symbol,
        strategySignalId: lot.strategySignalId,
        positionSide: lot.positionSide,
        accountKey: lot.accountKey,
      }) === pairingKey,
  ).length;
}
