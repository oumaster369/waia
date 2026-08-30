import type { StrategySignal } from "@/lib/trader/intelligence/types";
import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { PaperMarkToCloseTrade } from "@/lib/trader/paper/derive-paper-pnl";
import {
  applyForcedFlatSynthetic,
  pairFillsFifo,
  type ForcedFlatSyntheticInput,
  type PairingFillEvent,
  type PairingSnapshot,
} from "@/lib/trader/lifecycle/trade-pairing";
import type { TradeLineageAtOpen } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import { buildPairingKey } from "@/lib/trader/lifecycle/trade-lifecycle.types";

export type DeriveTradesFromFillsInput = {
  fillEvents: readonly { fill: FillRow; order: OrderRow }[];
  accountKey?: string;
  strategySignalsById?: Readonly<Record<string, StrategySignal>>;
  forcedFlatTrades?: readonly PaperMarkToCloseTrade[];
  organizationId: string;
  strategySignalId: string;
  newId?: () => string;
  now?: Date;
};

function lineageFromOrder(order: OrderRow, strategySignal?: StrategySignal): TradeLineageAtOpen {
  return {
    strategySignalId: order.strategySignalId ?? strategySignal?.strategySignalId ?? "",
    strategyId: strategySignal?.strategyId ?? "unknown",
    strategyVersion: strategySignal?.strategyVersion ?? "0.0.0",
    riskDecisionId: order.riskDecisionId,
    allocationDecisionId: order.allocationDecisionId,
    signalConfidence: strategySignal?.confidence ?? null,
    openingMsvId: strategySignal?.msvId ?? null,
    openingFeatureSetId: strategySignal?.featureSetId ?? null,
    openingCausalLineageJson: order.openingCausalLineageJson ?? null,
    openingCausalLineageDigest: order.openingCausalLineageDigest ?? null,
  };
}

export function buildPairingEvents(input: DeriveTradesFromFillsInput): PairingFillEvent[] {
  const accountKey = input.accountKey ?? "default";
  return input.fillEvents.map(({ fill, order }) => {
    const signalId = order.strategySignalId ?? input.strategySignalId;
    const strategySignal = input.strategySignalsById?.[signalId];
    return {
      fill,
      order,
      accountKey,
      lineage: lineageFromOrder(order, strategySignal),
    };
  });
}

export function deriveTradesFromFills(input: DeriveTradesFromFillsInput): PairingSnapshot {
  const events = buildPairingEvents(input);
  const snapshot = pairFillsFifo({
    events,
    newId: input.newId,
    now: input.now,
  });

  if (!input.forcedFlatTrades || input.forcedFlatTrades.length === 0) {
    return snapshot;
  }

  const newId = input.newId ?? (() => crypto.randomUUID());
  const now = input.now ?? new Date();
  const buckets = new Map<string, { openLots: typeof snapshot.lots }>();

  for (const lot of snapshot.lots) {
    if (lot.state !== "OPEN") {
      continue;
    }
    const key = buildPairingKey({
      organizationId: lot.organizationId,
      symbol: lot.symbol,
      strategySignalId: lot.strategySignalId,
      positionSide: lot.positionSide,
      accountKey: lot.accountKey,
    });
    const bucket = buckets.get(key) ?? { openLots: [] };
    bucket.openLots.push(lot);
    buckets.set(key, bucket);
  }

  for (const synthetic of input.forcedFlatTrades) {
    const forcedInput: ForcedFlatSyntheticInput = {
      organizationId: input.organizationId,
      symbol: synthetic.symbol,
      strategySignalId: input.strategySignalId,
      accountKey: input.accountKey ?? "default",
      boundaryClosePrice: synthetic.boundaryClosePrice,
      adjustedSellPrice: synthetic.adjustedSellPrice,
      sellFee: synthetic.sellFee,
      tradePnl: synthetic.tradePnl,
      boundaryTimestamp: synthetic.executedAt,
      syntheticId: synthetic.syntheticId,
      lineage: {
        strategySignalId: input.strategySignalId,
        strategyId: input.strategySignalsById?.[input.strategySignalId]?.strategyId ?? "unknown",
        strategyVersion:
          input.strategySignalsById?.[input.strategySignalId]?.strategyVersion ?? "0.0.0",
        riskDecisionId: "forced-flat",
      },
    };
    applyForcedFlatSynthetic(snapshot, buckets as never, forcedInput, { legId: newId() }, now);
  }

  return snapshot;
}
