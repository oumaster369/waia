import type {
  LifecycleEntityType,
  LifecycleEventPhase,
  LifecycleEventRow,
  PositionLotRow,
  TradeClosingWorldState,
  TradeLegRow,
  TradeLineageAtOpen,
  TradeRow,
  TradeState,
} from "@/lib/trader/lifecycle/trade-lifecycle.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export class TradeFrozenError extends Error {
  readonly tradeId: string;

  constructor(tradeId: string) {
    super(`Trade ${tradeId} is frozen and cannot be updated`);
    this.name = "TradeFrozenError";
    this.tradeId = tradeId;
  }
}

export type InsertTradeInput = {
  trade: Omit<TradeRow, "createdAt" | "updatedAt">;
};

export type InsertPositionLotInput = {
  lot: Omit<PositionLotRow, "createdAt" | "updatedAt">;
};

export type InsertTradeLegInput = {
  leg: Omit<TradeLegRow, "createdAt">;
};

export type InsertLifecycleEventInput = {
  event: Omit<LifecycleEventRow, "createdAt">;
};

export type UpdateTradeOperationalInput = {
  tradeId: string;
  state?: TradeState;
  closedAt?: Date | null;
  realizedPnl?: string;
  markedPnl?: string;
  closing?: TradeClosingWorldState;
  frozenAt?: Date | null;
};

export type UpdatePositionLotInput = {
  lotId: string;
  remainingQty?: string;
  state?: PositionLotRow["state"];
  closedAt?: Date | null;
};

export interface LifecycleRepository {
  insertTrade(context: OrgContext, input: InsertTradeInput): Promise<TradeRow>;
  updateTradeOperational(
    context: OrgContext,
    input: UpdateTradeOperationalInput,
  ): Promise<TradeRow>;
  getTradeById(context: OrgContext, tradeId: string): Promise<TradeRow | null>;
  listTrades(context: OrgContext, filter?: { strategySignalId?: string }): Promise<TradeRow[]>;

  insertPositionLot(context: OrgContext, input: InsertPositionLotInput): Promise<PositionLotRow>;
  updatePositionLot(context: OrgContext, input: UpdatePositionLotInput): Promise<PositionLotRow>;
  listOpenPositionLots(
    context: OrgContext,
    filter?: { symbol?: string; strategySignalId?: string; accountKey?: string },
  ): Promise<PositionLotRow[]>;

  insertTradeLeg(context: OrgContext, input: InsertTradeLegInput): Promise<TradeLegRow>;
  listTradeLegs(context: OrgContext, tradeId: string): Promise<TradeLegRow[]>;

  insertLifecycleEvent(
    context: OrgContext,
    input: InsertLifecycleEventInput,
  ): Promise<LifecycleEventRow>;
  listLifecycleEvents(
    context: OrgContext,
    filter?: { entityType?: LifecycleEntityType; entityId?: string; phase?: LifecycleEventPhase },
  ): Promise<LifecycleEventRow[]>;
}

export function assertTradeLineageImmutable(existing: TradeRow, next: TradeRow): void {
  const immutableKeys: (keyof TradeLineageAtOpen)[] = [
    "strategySignalId",
    "strategyId",
    "strategyVersion",
    "riskDecisionId",
  ];
  for (const key of immutableKeys) {
    if (existing[key as keyof TradeRow] !== next[key as keyof TradeRow]) {
      throw new Error(`Trade lineage field ${key} is immutable after open`);
    }
  }
}
