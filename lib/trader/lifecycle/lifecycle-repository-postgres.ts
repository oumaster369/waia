import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { Regime } from "@/lib/trader/intelligence/types";
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

function mapTradeRow(row: typeof pgSchema.traderTrades.$inferSelect): TradeRow {
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
    closingMsvId: row.closingMsvId,
    closingFeatureSetId: row.closingFeatureSetId,
    closingRegime: (row.closingRegime as Regime | null) ?? null,
    frozenAt: row.frozenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapLotRow(row: typeof pgSchema.traderPositionLots.$inferSelect): PositionLotRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    symbol: row.symbol,
    venue: row.venue,
    accountKey: row.accountKey,
    positionSide: row.positionSide,
    instrumentKind: row.instrumentKind,
    strategySignalId: row.strategySignalId,
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

function mapLegRow(row: typeof pgSchema.traderTradeLegs.$inferSelect): TradeLegRow {
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

function mapEventRow(row: typeof pgSchema.traderLifecycleEvents.$inferSelect): LifecycleEventRow {
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

export function createPostgresLifecycleRepositoryFromExecutor(
  ex: Pick<WaiaPostgresDb, "select" | "insert" | "update">,
): LifecycleRepository {
  return createPostgresLifecycleRepositoryImpl(ex);
}

export function createPostgresLifecycleRepository(db: WaiaPostgresDb): LifecycleRepository {
  return createPostgresLifecycleRepositoryImpl(db);
}

function createPostgresLifecycleRepositoryImpl(
  db: Pick<WaiaPostgresDb, "select" | "insert" | "update">,
): LifecycleRepository {
  return {
    async insertTrade(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const now = new Date();
      const row = {
        ...input.trade,
        organizationId: scoped.organizationId,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(pgSchema.traderTrades).values(row);
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
        .update(pgSchema.traderTrades)
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
            orgScopedWhere(pgSchema.traderTrades.organizationId, scoped),
            eq(pgSchema.traderTrades.id, input.tradeId),
          ),
        );

      return next;
    },

    async getTradeById(context, tradeId) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await db
        .select()
        .from(pgSchema.traderTrades)
        .where(
          and(
            orgScopedWhere(pgSchema.traderTrades.organizationId, scoped),
            eq(pgSchema.traderTrades.id, tradeId),
          ),
        )
        .limit(1);
      return rows[0] ? mapTradeRow(rows[0]) : null;
    },

    async listTrades(context, filter) {
      const scoped = requireOrgContext(context.organizationId);
      const conditions = [orgScopedWhere(pgSchema.traderTrades.organizationId, scoped)];
      if (filter?.strategySignalId) {
        conditions.push(eq(pgSchema.traderTrades.strategySignalId, filter.strategySignalId));
      }
      const rows = await db
        .select()
        .from(pgSchema.traderTrades)
        .where(and(...conditions));
      return rows.map(mapTradeRow);
    },

    async insertPositionLot(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const now = new Date();
      const row = {
        ...input.lot,
        organizationId: scoped.organizationId,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(pgSchema.traderPositionLots).values(row);
      return mapLotRow(row);
    },

    async updatePositionLot(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await db
        .select()
        .from(pgSchema.traderPositionLots)
        .where(
          and(
            orgScopedWhere(pgSchema.traderPositionLots.organizationId, scoped),
            eq(pgSchema.traderPositionLots.id, input.lotId),
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
        .update(pgSchema.traderPositionLots)
        .set(next)
        .where(
          and(
            orgScopedWhere(pgSchema.traderPositionLots.organizationId, scoped),
            eq(pgSchema.traderPositionLots.id, input.lotId),
          ),
        );

      return mapLotRow({ ...existing, ...next });
    },

    async listOpenPositionLots(context, filter) {
      const scoped = requireOrgContext(context.organizationId);
      const conditions = [
        orgScopedWhere(pgSchema.traderPositionLots.organizationId, scoped),
        eq(pgSchema.traderPositionLots.state, "OPEN"),
      ];
      if (filter?.symbol) {
        conditions.push(eq(pgSchema.traderPositionLots.symbol, filter.symbol));
      }
      if (filter?.strategySignalId) {
        conditions.push(eq(pgSchema.traderPositionLots.strategySignalId, filter.strategySignalId));
      }
      if (filter?.accountKey) {
        conditions.push(eq(pgSchema.traderPositionLots.accountKey, filter.accountKey));
      }
      const rows = await db
        .select()
        .from(pgSchema.traderPositionLots)
        .where(and(...conditions))
        .orderBy(pgSchema.traderPositionLots.openedAt);
      return rows.map(mapLotRow);
    },

    async insertTradeLeg(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const row = {
        ...input.leg,
        organizationId: scoped.organizationId,
        createdAt: new Date(),
      };
      await db.insert(pgSchema.traderTradeLegs).values(row);
      return mapLegRow(row);
    },

    async listTradeLegs(context, tradeId) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await db
        .select()
        .from(pgSchema.traderTradeLegs)
        .where(
          and(
            orgScopedWhere(pgSchema.traderTradeLegs.organizationId, scoped),
            eq(pgSchema.traderTradeLegs.tradeId, tradeId),
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
      await db.insert(pgSchema.traderLifecycleEvents).values(row);
      return mapEventRow(row);
    },

    async listLifecycleEvents(context, filter) {
      const scoped = requireOrgContext(context.organizationId);
      const conditions = [orgScopedWhere(pgSchema.traderLifecycleEvents.organizationId, scoped)];
      if (filter?.entityType) {
        conditions.push(eq(pgSchema.traderLifecycleEvents.entityType, filter.entityType));
      }
      if (filter?.entityId) {
        conditions.push(eq(pgSchema.traderLifecycleEvents.entityId, filter.entityId));
      }
      if (filter?.phase) {
        conditions.push(eq(pgSchema.traderLifecycleEvents.phase, filter.phase));
      }
      const rows = await db
        .select()
        .from(pgSchema.traderLifecycleEvents)
        .where(and(...conditions));
      return rows.map(mapEventRow);
    },
  };
}
