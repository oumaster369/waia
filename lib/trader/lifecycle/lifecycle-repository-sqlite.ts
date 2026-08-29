import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import {
  traderLifecycleEvents,
  traderPositionLots,
  traderTradeLegs,
  traderTrades,
} from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";
import {
  TradeFrozenError,
  assertTradeLineageImmutable,
  type InsertLifecycleEventInput,
  type InsertPositionLotInput,
  type InsertTradeInput,
  type InsertTradeLegInput,
  type LifecycleRepository,
  type UpdatePositionLotInput,
  type UpdateTradeOperationalInput,
} from "@/lib/trader/lifecycle/lifecycle-repository.types";
import type { Regime } from "@/lib/trader/intelligence/types";
import type {
  LifecycleEntityType,
  LifecycleEventPhase,
  LifecycleEventRow,
  PositionLotRow,
  TradeLegRow,
  TradeRow,
} from "@/lib/trader/lifecycle/trade-lifecycle.types";
import { isTerminalTradeState } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapTradeRow(row: typeof traderTrades.$inferSelect): TradeRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    symbol: row.symbol,
    venue: row.venue,
    accountKey: row.accountKey,
    positionSide: row.positionSide,
    instrumentKind: row.instrumentKind,
    strategySignalId: row.strategySignalId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    state: row.state,
    semanticsVersion: row.semanticsVersion,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    realizedPnl: row.realizedPnl,
    markedPnl: row.markedPnl,
    hypothesisId: row.hypothesisId,
    patternId: row.patternId,
    riskDecisionId: row.riskDecisionId,
    allocationDecisionId: row.allocationDecisionId,
    reasoningSessionId: row.reasoningSessionId,
    signalConfidence: row.signalConfidence,
    openingRegime: (row.openingRegime as Regime | null) ?? null,
    openingMsvId: row.openingMsvId,
    openingFeatureSetId: row.openingFeatureSetId,
    openingCausalLineageJson: row.openingCausalLineageJson,
    openingCausalLineageDigest: row.openingCausalLineageDigest,
    closingMsvId: row.closingMsvId,
    closingFeatureSetId: row.closingFeatureSetId,
    closingRegime: (row.closingRegime as Regime | null) ?? null,
    frozenAt: row.frozenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapLotRow(row: typeof traderPositionLots.$inferSelect): PositionLotRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    symbol: row.symbol,
    venue: row.venue,
    accountKey: row.accountKey,
    positionSide: row.positionSide,
    instrumentKind: row.instrumentKind,
    strategySignalId: row.strategySignalId,
    openingCausalLineageJson: row.openingCausalLineageJson,
    openingCausalLineageDigest: row.openingCausalLineageDigest,
    state: row.state,
    openQty: row.openQty,
    remainingQty: row.remainingQty,
    avgCost: row.avgCost,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    tradeId: row.tradeId,
    hedgeGroupId: row.hedgeGroupId,
    targetLotId: row.targetLotId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapLegRow(row: typeof traderTradeLegs.$inferSelect): TradeLegRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    tradeId: row.tradeId,
    positionLotId: row.positionLotId,
    kind: row.kind,
    orderId: row.orderId,
    fillId: row.fillId,
    syntheticId: row.syntheticId,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    executedAt: row.executedAt,
    legPnl: row.legPnl,
    createdAt: row.createdAt,
  };
}

function mapEventRow(row: typeof traderLifecycleEvents.$inferSelect): LifecycleEventRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    entityType: row.entityType,
    entityId: row.entityId,
    phase: row.phase,
    payload: row.payload,
    occurredAt: row.occurredAt,
    researchRunId: row.researchRunId,
    createdAt: row.createdAt,
  };
}

export function createSqliteLifecycleRepository(db: WaiaDb): LifecycleRepository {
  return {
    async insertTrade(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const now = new Date();
      const row = {
        ...input.trade,
        openingCausalLineageJson: input.trade.openingCausalLineageJson ?? null,
        openingCausalLineageDigest: input.trade.openingCausalLineageDigest ?? null,
        organizationId: scoped.organizationId,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(traderTrades).values(row);
      return mapTradeRow(row);
    },

    async updateTradeOperational(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await this.getTradeById(context, input.tradeId);
      if (!existing) {
        throw new Error(`Trade not found: ${input.tradeId}`);
      }
      if (existing.frozenAt) {
        throw new TradeFrozenError(existing.id);
      }

      const next: TradeRow = {
        ...existing,
        state: input.state ?? existing.state,
        closedAt: input.closedAt === undefined ? existing.closedAt : input.closedAt,
        realizedPnl: input.realizedPnl ?? existing.realizedPnl,
        markedPnl: input.markedPnl ?? existing.markedPnl,
        closingMsvId: input.closing?.closingMsvId ?? existing.closingMsvId,
        closingFeatureSetId: input.closing?.closingFeatureSetId ?? existing.closingFeatureSetId,
        closingRegime: input.closing?.closingRegime ?? existing.closingRegime,
        frozenAt: input.frozenAt === undefined ? existing.frozenAt : input.frozenAt,
        updatedAt: new Date(),
      };

      if (next.frozenAt && !isTerminalTradeState(next.state)) {
        throw new Error("Cannot freeze trade in non-terminal state");
      }

      assertTradeLineageImmutable(existing, next);

      await db
        .update(traderTrades)
        .set({
          state: next.state,
          closedAt: next.closedAt,
          realizedPnl: next.realizedPnl,
          markedPnl: next.markedPnl,
          closingMsvId: next.closingMsvId,
          closingFeatureSetId: next.closingFeatureSetId,
          closingRegime: next.closingRegime,
          frozenAt: next.frozenAt,
          updatedAt: next.updatedAt,
        })
        .where(
          and(
            orgScopedWhere(traderTrades.organizationId, scoped),
            eq(traderTrades.id, input.tradeId),
          ),
        );

      return next;
    },

    async getTradeById(context, tradeId) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await db
        .select()
        .from(traderTrades)
        .where(
          and(orgScopedWhere(traderTrades.organizationId, scoped), eq(traderTrades.id, tradeId)),
        )
        .limit(1);
      return rows[0] ? mapTradeRow(rows[0]) : null;
    },

    async listTrades(context, filter) {
      const scoped = requireOrgContext(context.organizationId);
      const conditions = [orgScopedWhere(traderTrades.organizationId, scoped)];
      if (filter?.strategySignalId) {
        conditions.push(eq(traderTrades.strategySignalId, filter.strategySignalId));
      }
      const rows = await db
        .select()
        .from(traderTrades)
        .where(and(...conditions));
      return rows.map(mapTradeRow);
    },

    async insertPositionLot(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const now = new Date();
      const row = {
        ...input.lot,
        openingCausalLineageJson: input.lot.openingCausalLineageJson ?? null,
        openingCausalLineageDigest: input.lot.openingCausalLineageDigest ?? null,
        organizationId: scoped.organizationId,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(traderPositionLots).values(row);
      return mapLotRow(row);
    },

    async updatePositionLot(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await db
        .select()
        .from(traderPositionLots)
        .where(
          and(
            orgScopedWhere(traderPositionLots.organizationId, scoped),
            eq(traderPositionLots.id, input.lotId),
          ),
        )
        .limit(1);
      const existing = rows[0];
      if (!existing) {
        throw new Error(`Position lot not found: ${input.lotId}`);
      }

      const next = {
        remainingQty: input.remainingQty ?? existing.remainingQty,
        state: input.state ?? existing.state,
        closedAt: input.closedAt === undefined ? existing.closedAt : input.closedAt,
        updatedAt: new Date(),
      };

      await db
        .update(traderPositionLots)
        .set(next)
        .where(
          and(
            orgScopedWhere(traderPositionLots.organizationId, scoped),
            eq(traderPositionLots.id, input.lotId),
          ),
        );

      return mapLotRow({ ...existing, ...next });
    },

    async listOpenPositionLots(context, filter) {
      const scoped = requireOrgContext(context.organizationId);
      const conditions = [
        orgScopedWhere(traderPositionLots.organizationId, scoped),
        eq(traderPositionLots.state, "OPEN"),
      ];
      if (filter?.symbol) {
        conditions.push(eq(traderPositionLots.symbol, filter.symbol));
      }
      if (filter?.strategySignalId) {
        conditions.push(eq(traderPositionLots.strategySignalId, filter.strategySignalId));
      }
      if (filter?.accountKey) {
        conditions.push(eq(traderPositionLots.accountKey, filter.accountKey));
      }
      const rows = await db
        .select()
        .from(traderPositionLots)
        .where(and(...conditions))
        .orderBy(traderPositionLots.openedAt);
      return rows.map(mapLotRow);
    },

    async insertTradeLeg(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const row = {
        ...input.leg,
        organizationId: scoped.organizationId,
        createdAt: new Date(),
      };
      await db.insert(traderTradeLegs).values(row);
      return mapLegRow(row);
    },

    async listTradeLegs(context, tradeId) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await db
        .select()
        .from(traderTradeLegs)
        .where(
          and(
            orgScopedWhere(traderTradeLegs.organizationId, scoped),
            eq(traderTradeLegs.tradeId, tradeId),
          ),
        );
      return rows.map(mapLegRow);
    },

    async insertLifecycleEvent(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const row = {
        ...input.event,
        organizationId: scoped.organizationId,
        createdAt: new Date(),
      };
      await db.insert(traderLifecycleEvents).values(row);
      return mapEventRow(row);
    },

    async listLifecycleEvents(context, filter) {
      const scoped = requireOrgContext(context.organizationId);
      const conditions = [orgScopedWhere(traderLifecycleEvents.organizationId, scoped)];
      if (filter?.entityType) {
        conditions.push(eq(traderLifecycleEvents.entityType, filter.entityType));
      }
      if (filter?.entityId) {
        conditions.push(eq(traderLifecycleEvents.entityId, filter.entityId));
      }
      if (filter?.phase) {
        conditions.push(eq(traderLifecycleEvents.phase, filter.phase));
      }
      const rows = await db
        .select()
        .from(traderLifecycleEvents)
        .where(and(...conditions));
      return rows.map(mapEventRow);
    },
  };
}
