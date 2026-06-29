import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, max, notInArray } from "drizzle-orm";

import { traderFills, traderOrderEvents, traderOrders } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import {
  DuplicateOrderError,
  FillConflictError,
  OrderNotFoundError,
  OrderVersionConflictError,
} from "@/lib/trader/execution/order-repository.errors";
import {
  fillPayloadMatches,
  isUniqueConstraintError,
  orderPayloadMatches,
  type CreateOrderInput,
  type FillRow,
  type OrderEventRow,
  type OrderRow,
  type OpenOrdersFilter,
  type RecordFillInput,
  type TransitionOrderInput,
} from "@/lib/trader/execution/order-repository.types";
import {
  assertTransition,
  TERMINAL_ORDER_STATES,
} from "@/lib/trader/execution/order-state-machine";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapOrderRow(row: typeof traderOrders.$inferSelect): OrderRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    credentialId: row.credentialId,
    venue: row.venue,
    executionMode: row.executionMode,
    symbol: row.symbol,
    side: row.side,
    type: row.type,
    price: row.price,
    quantity: row.quantity,
    filledQuantity: row.filledQuantity,
    avgFillPrice: row.avgFillPrice,
    state: row.state,
    stateVersion: row.stateVersion,
    exchangeOrderId: row.exchangeOrderId,
    clientOrderId: row.clientOrderId,
    idempotencyKey: row.idempotencyKey,
    riskDecisionId: row.riskDecisionId,
    strategySignalId: row.strategySignalId,
    allocationDecisionId: row.allocationDecisionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapEventRow(row: typeof traderOrderEvents.$inferSelect): OrderEventRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    orderId: row.orderId,
    seq: row.seq,
    fromState: row.fromState,
    toState: row.toState,
    eventType: row.eventType,
    payload: row.payload,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

function mapFillRow(row: typeof traderFills.$inferSelect): FillRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    orderId: row.orderId,
    exchangeTradeId: row.exchangeTradeId,
    price: row.price,
    quantity: row.quantity,
    fee: row.fee,
    feeAsset: row.feeAsset,
    executedAt: row.executedAt,
    createdAt: row.createdAt,
  };
}

function orgOrderConditions(context: OrgContext) {
  const scoped = requireOrgContext(context.organizationId);
  return orgScopedWhere(traderOrders.organizationId, scoped);
}

function resolveExistingOrderForCreate(existing: OrderRow, input: CreateOrderInput): OrderRow {
  if (
    existing.clientOrderId !== input.clientOrderId ||
    existing.idempotencyKey !== input.idempotencyKey
  ) {
    throw new DuplicateOrderError("Conflicting order idempotency keys", {
      clientOrderId: input.clientOrderId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  if (!orderPayloadMatches(existing, input)) {
    throw new DuplicateOrderError("Duplicate order key with mismatched payload", {
      clientOrderId: input.clientOrderId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  return existing;
}

export function getOrderByIdSqlite(db: WaiaDb, context: OrgContext, id: string): OrderRow | null {
  const row = db
    .select()
    .from(traderOrders)
    .where(and(eq(traderOrders.id, id), orgOrderConditions(context)))
    .limit(1)
    .all()[0];

  return row ? mapOrderRow(row) : null;
}

export function findOrderByClientOrderIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  clientOrderId: string,
): OrderRow | null {
  const row = db
    .select()
    .from(traderOrders)
    .where(and(eq(traderOrders.clientOrderId, clientOrderId), orgOrderConditions(context)))
    .limit(1)
    .all()[0];

  return row ? mapOrderRow(row) : null;
}

export function findOrderByIdempotencyKeySqlite(
  db: WaiaDb,
  context: OrgContext,
  idempotencyKey: string,
): OrderRow | null {
  const row = db
    .select()
    .from(traderOrders)
    .where(and(eq(traderOrders.idempotencyKey, idempotencyKey), orgOrderConditions(context)))
    .limit(1)
    .all()[0];

  return row ? mapOrderRow(row) : null;
}

export function listOpenOrdersSqlite(
  db: WaiaDb,
  context: OrgContext,
  filter?: OpenOrdersFilter,
): OrderRow[] {
  const conditions = [
    orgOrderConditions(context),
    notInArray(traderOrders.state, [...TERMINAL_ORDER_STATES]),
  ];

  if (filter?.executionMode) {
    conditions.push(eq(traderOrders.executionMode, filter.executionMode));
  }
  if (filter?.venue) {
    conditions.push(eq(traderOrders.venue, filter.venue));
  }

  return db
    .select()
    .from(traderOrders)
    .where(and(...conditions))
    .all()
    .map(mapOrderRow);
}

export function listOrdersSqlite(
  db: WaiaDb,
  context: OrgContext,
  filter?: OpenOrdersFilter,
): OrderRow[] {
  const conditions = [orgOrderConditions(context)];

  if (filter?.executionMode) {
    conditions.push(eq(traderOrders.executionMode, filter.executionMode));
  }
  if (filter?.venue) {
    conditions.push(eq(traderOrders.venue, filter.venue));
  }

  return db
    .select()
    .from(traderOrders)
    .where(and(...conditions))
    .all()
    .map(mapOrderRow);
}

export function listEventsSqlite(
  db: WaiaDb,
  context: OrgContext,
  orderId: string,
): OrderEventRow[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderOrderEvents)
    .where(
      and(
        eq(traderOrderEvents.orderId, orderId),
        orgScopedWhere(traderOrderEvents.organizationId, scoped),
      ),
    )
    .orderBy(traderOrderEvents.seq)
    .all()
    .map(mapEventRow);
}

export function listFillsSqlite(db: WaiaDb, context: OrgContext, orderId: string): FillRow[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderFills)
    .where(
      and(eq(traderFills.orderId, orderId), orgScopedWhere(traderFills.organizationId, scoped)),
    )
    .all()
    .map(mapFillRow);
}

export function createOrderSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: CreateOrderInput,
): OrderRow {
  const scoped = requireOrgContext(context.organizationId);

  const byClientOrderId = findOrderByClientOrderIdSqlite(db, context, input.clientOrderId);
  if (byClientOrderId) {
    return resolveExistingOrderForCreate(byClientOrderId, input);
  }

  const byIdempotencyKey = findOrderByIdempotencyKeySqlite(db, context, input.idempotencyKey);
  if (byIdempotencyKey) {
    return resolveExistingOrderForCreate(byIdempotencyKey, input);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  try {
    db.insert(traderOrders)
      .values({
        id,
        organizationId: scoped.organizationId,
        credentialId: input.credentialId ?? null,
        venue: input.venue,
        executionMode: input.executionMode,
        symbol: input.symbol,
        side: input.side,
        type: input.type,
        price: input.price ?? null,
        quantity: input.quantity,
        state: "CREATED",
        stateVersion: 1,
        clientOrderId: input.clientOrderId,
        idempotencyKey: input.idempotencyKey,
        riskDecisionId: input.riskDecisionId,
        strategySignalId: input.strategySignalId ?? null,
        allocationDecisionId: input.allocationDecisionId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(traderOrderEvents)
      .values({
        id: crypto.randomUUID(),
        organizationId: scoped.organizationId,
        orderId: id,
        seq: 0,
        fromState: null,
        toState: "CREATED",
        eventType: "transition",
        occurredAt: now,
      })
      .run();
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const raced =
      findOrderByClientOrderIdSqlite(db, context, input.clientOrderId) ??
      findOrderByIdempotencyKeySqlite(db, context, input.idempotencyKey);

    if (!raced) {
      throw error;
    }

    return resolveExistingOrderForCreate(raced, input);
  }

  const created = getOrderByIdSqlite(db, context, id);
  if (!created) {
    throw new Error("[trader] order insert failed");
  }
  return created;
}

export function transitionOrderSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: TransitionOrderInput,
): OrderRow {
  const existing = getOrderByIdSqlite(db, context, input.orderId);
  if (!existing) {
    throw new OrderNotFoundError(input.orderId);
  }

  assertTransition(existing.state, input.toState);

  const now = new Date();
  const result = db
    .update(traderOrders)
    .set({
      state: input.toState,
      stateVersion: existing.stateVersion + 1,
      filledQuantity: input.filledQuantity ?? existing.filledQuantity,
      avgFillPrice: input.avgFillPrice !== undefined ? input.avgFillPrice : existing.avgFillPrice,
      exchangeOrderId:
        input.exchangeOrderId !== undefined ? input.exchangeOrderId : existing.exchangeOrderId,
      updatedAt: now,
    })
    .where(
      and(
        eq(traderOrders.id, input.orderId),
        eq(traderOrders.stateVersion, input.expectedStateVersion),
        orgOrderConditions(context),
      ),
    )
    .run();

  if (result.changes === 0) {
    throw new OrderVersionConflictError(input.orderId, input.expectedStateVersion);
  }

  const scoped = requireOrgContext(context.organizationId);
  const maxSeqRow = db
    .select({ maxSeq: max(traderOrderEvents.seq) })
    .from(traderOrderEvents)
    .where(
      and(
        eq(traderOrderEvents.orderId, input.orderId),
        orgScopedWhere(traderOrderEvents.organizationId, scoped),
      ),
    )
    .all()[0];

  const nextSeq = (maxSeqRow?.maxSeq ?? 0) + 1;
  const occurredAt = input.occurredAt ?? now;

  db.insert(traderOrderEvents)
    .values({
      id: crypto.randomUUID(),
      organizationId: scoped.organizationId,
      orderId: input.orderId,
      seq: nextSeq,
      fromState: existing.state,
      toState: input.toState,
      eventType: input.eventType ?? "transition",
      payload: input.eventPayload ?? null,
      occurredAt,
    })
    .run();

  const updated = getOrderByIdSqlite(db, context, input.orderId);
  if (!updated) {
    throw new OrderNotFoundError(input.orderId);
  }
  return updated;
}

export function recordFillSqlite(db: WaiaDb, context: OrgContext, input: RecordFillInput): FillRow {
  const scoped = requireOrgContext(context.organizationId);
  const existingFill = db
    .select()
    .from(traderFills)
    .where(
      and(
        eq(traderFills.orderId, input.orderId),
        eq(traderFills.exchangeTradeId, input.exchangeTradeId),
        orgScopedWhere(traderFills.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (existingFill) {
    const mapped = mapFillRow(existingFill);
    if (!fillPayloadMatches(mapped, input)) {
      throw new FillConflictError(input.orderId, input.exchangeTradeId);
    }
    return mapped;
  }

  const parent = getOrderByIdSqlite(db, context, input.orderId);
  if (!parent) {
    throw new OrderNotFoundError(input.orderId);
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const fee = input.fee ?? "0";
  const feeAsset = input.feeAsset ?? "";

  try {
    db.insert(traderFills)
      .values({
        id,
        organizationId: scoped.organizationId,
        orderId: input.orderId,
        exchangeTradeId: input.exchangeTradeId,
        price: input.price,
        quantity: input.quantity,
        fee,
        feeAsset,
        executedAt: input.executedAt,
        createdAt: now,
      })
      .run();
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const raced = db
      .select()
      .from(traderFills)
      .where(
        and(
          eq(traderFills.orderId, input.orderId),
          eq(traderFills.exchangeTradeId, input.exchangeTradeId),
          orgScopedWhere(traderFills.organizationId, scoped),
        ),
      )
      .limit(1)
      .all()[0];

    if (!raced) {
      throw error;
    }

    const mapped = mapFillRow(raced);
    if (!fillPayloadMatches(mapped, input)) {
      throw new FillConflictError(input.orderId, input.exchangeTradeId);
    }
    return mapped;
  }

  const inserted = db.select().from(traderFills).where(eq(traderFills.id, id)).limit(1).all()[0];

  if (!inserted) {
    throw new Error("[trader] fill insert failed");
  }
  return mapFillRow(inserted);
}
