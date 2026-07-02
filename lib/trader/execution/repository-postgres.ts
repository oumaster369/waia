import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, max, notInArray } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
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

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;
type PgDeleteExecutor = Pick<WaiaPostgresDb, "delete">;

function mapOrderRow(row: typeof pgSchema.traderOrders.$inferSelect): OrderRow {
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

function mapEventRow(row: typeof pgSchema.traderOrderEvents.$inferSelect): OrderEventRow {
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

function mapFillRow(row: typeof pgSchema.traderFills.$inferSelect): FillRow {
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
  return orgScopedWhere(pgSchema.traderOrders.organizationId, scoped);
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

export async function getOrderByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  id: string,
): Promise<OrderRow | null> {
  const rows = await ex
    .select()
    .from(pgSchema.traderOrders)
    .where(and(eq(pgSchema.traderOrders.id, id), orgOrderConditions(context)))
    .limit(1);

  return rows[0] ? mapOrderRow(rows[0]) : null;
}

export async function findOrderByClientOrderIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  clientOrderId: string,
): Promise<OrderRow | null> {
  const rows = await ex
    .select()
    .from(pgSchema.traderOrders)
    .where(and(eq(pgSchema.traderOrders.clientOrderId, clientOrderId), orgOrderConditions(context)))
    .limit(1);

  return rows[0] ? mapOrderRow(rows[0]) : null;
}

export async function findOrderByIdempotencyKeyPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  idempotencyKey: string,
): Promise<OrderRow | null> {
  const rows = await ex
    .select()
    .from(pgSchema.traderOrders)
    .where(
      and(eq(pgSchema.traderOrders.idempotencyKey, idempotencyKey), orgOrderConditions(context)),
    )
    .limit(1);

  return rows[0] ? mapOrderRow(rows[0]) : null;
}

export async function listOpenOrdersPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  filter?: OpenOrdersFilter,
): Promise<OrderRow[]> {
  const conditions = [
    orgOrderConditions(context),
    notInArray(pgSchema.traderOrders.state, [...TERMINAL_ORDER_STATES]),
  ];

  if (filter?.executionMode) {
    conditions.push(eq(pgSchema.traderOrders.executionMode, filter.executionMode));
  }
  if (filter?.venue) {
    conditions.push(eq(pgSchema.traderOrders.venue, filter.venue));
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderOrders)
    .where(and(...conditions));

  return rows.map(mapOrderRow);
}

export async function listOrdersPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  filter?: OpenOrdersFilter,
): Promise<OrderRow[]> {
  const conditions = [orgOrderConditions(context)];

  if (filter?.executionMode) {
    conditions.push(eq(pgSchema.traderOrders.executionMode, filter.executionMode));
  }
  if (filter?.venue) {
    conditions.push(eq(pgSchema.traderOrders.venue, filter.venue));
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderOrders)
    .where(and(...conditions));

  return rows.map(mapOrderRow);
}

export async function listEventsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  orderId: string,
): Promise<OrderEventRow[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderOrderEvents)
    .where(
      and(
        eq(pgSchema.traderOrderEvents.orderId, orderId),
        orgScopedWhere(pgSchema.traderOrderEvents.organizationId, scoped),
      ),
    )
    .orderBy(pgSchema.traderOrderEvents.seq);

  return rows.map(mapEventRow);
}

export async function listFillsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  orderId: string,
): Promise<FillRow[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderFills)
    .where(
      and(
        eq(pgSchema.traderFills.orderId, orderId),
        orgScopedWhere(pgSchema.traderFills.organizationId, scoped),
      ),
    );

  return rows.map(mapFillRow);
}

export async function createOrderPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: CreateOrderInput,
): Promise<OrderRow> {
  const scoped = requireOrgContext(context.organizationId);

  const byClientOrderId = await findOrderByClientOrderIdPostgres(ex, context, input.clientOrderId);
  if (byClientOrderId) {
    return resolveExistingOrderForCreate(byClientOrderId, input);
  }

  const byIdempotencyKey = await findOrderByIdempotencyKeyPostgres(
    ex,
    context,
    input.idempotencyKey,
  );
  if (byIdempotencyKey) {
    return resolveExistingOrderForCreate(byIdempotencyKey, input);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  try {
    await ex.insert(pgSchema.traderOrders).values({
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
    });

    await ex.insert(pgSchema.traderOrderEvents).values({
      id: crypto.randomUUID(),
      organizationId: scoped.organizationId,
      orderId: id,
      seq: 0,
      fromState: null,
      toState: "CREATED",
      eventType: "transition",
      occurredAt: now,
    });
  } catch (error) {
    if (!isPgUniqueViolation(error)) {
      throw error;
    }

    const raced =
      (await findOrderByClientOrderIdPostgres(ex, context, input.clientOrderId)) ??
      (await findOrderByIdempotencyKeyPostgres(ex, context, input.idempotencyKey));

    if (!raced) {
      throw error;
    }

    return resolveExistingOrderForCreate(raced, input);
  }

  const created = await getOrderByIdPostgres(ex, context, id);
  if (!created) {
    throw new Error("[trader] order insert failed");
  }
  return created;
}

export async function transitionOrderPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: TransitionOrderInput,
): Promise<OrderRow> {
  const existing = await getOrderByIdPostgres(ex, context, input.orderId);
  if (!existing) {
    throw new OrderNotFoundError(input.orderId);
  }

  assertTransition(existing.state, input.toState);

  const now = new Date();
  const updatedRows = await ex
    .update(pgSchema.traderOrders)
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
        eq(pgSchema.traderOrders.id, input.orderId),
        eq(pgSchema.traderOrders.stateVersion, input.expectedStateVersion),
        orgOrderConditions(context),
      ),
    )
    .returning();

  if (updatedRows.length === 0) {
    throw new OrderVersionConflictError(input.orderId, input.expectedStateVersion);
  }

  const scoped = requireOrgContext(context.organizationId);
  const maxSeqRows = await ex
    .select({ maxSeq: max(pgSchema.traderOrderEvents.seq) })
    .from(pgSchema.traderOrderEvents)
    .where(
      and(
        eq(pgSchema.traderOrderEvents.orderId, input.orderId),
        orgScopedWhere(pgSchema.traderOrderEvents.organizationId, scoped),
      ),
    );

  const nextSeq = (maxSeqRows[0]?.maxSeq ?? 0) + 1;
  const occurredAt = input.occurredAt ?? now;

  await ex.insert(pgSchema.traderOrderEvents).values({
    id: crypto.randomUUID(),
    organizationId: scoped.organizationId,
    orderId: input.orderId,
    seq: nextSeq,
    fromState: existing.state,
    toState: input.toState,
    eventType: input.eventType ?? "transition",
    payload: input.eventPayload ?? null,
    occurredAt,
  });

  const updated = await getOrderByIdPostgres(ex, context, input.orderId);
  if (!updated) {
    throw new OrderNotFoundError(input.orderId);
  }
  return updated;
}

export async function recordFillPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: RecordFillInput,
): Promise<FillRow> {
  const scoped = requireOrgContext(context.organizationId);
  const existingRows = await ex
    .select()
    .from(pgSchema.traderFills)
    .where(
      and(
        eq(pgSchema.traderFills.orderId, input.orderId),
        eq(pgSchema.traderFills.exchangeTradeId, input.exchangeTradeId),
        orgScopedWhere(pgSchema.traderFills.organizationId, scoped),
      ),
    )
    .limit(1);

  if (existingRows[0]) {
    const mapped = mapFillRow(existingRows[0]);
    if (!fillPayloadMatches(mapped, input)) {
      throw new FillConflictError(input.orderId, input.exchangeTradeId);
    }
    return mapped;
  }

  const parent = await getOrderByIdPostgres(ex, context, input.orderId);
  if (!parent) {
    throw new OrderNotFoundError(input.orderId);
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const fee = input.fee ?? "0";
  const feeAsset = input.feeAsset ?? "";

  try {
    await ex.insert(pgSchema.traderFills).values({
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
    });
  } catch (error) {
    if (!isPgUniqueViolation(error)) {
      throw error;
    }

    const racedRows = await ex
      .select()
      .from(pgSchema.traderFills)
      .where(
        and(
          eq(pgSchema.traderFills.orderId, input.orderId),
          eq(pgSchema.traderFills.exchangeTradeId, input.exchangeTradeId),
          orgScopedWhere(pgSchema.traderFills.organizationId, scoped),
        ),
      )
      .limit(1);

    if (!racedRows[0]) {
      throw error;
    }

    const mapped = mapFillRow(racedRows[0]);
    if (!fillPayloadMatches(mapped, input)) {
      throw new FillConflictError(input.orderId, input.exchangeTradeId);
    }
    return mapped;
  }

  const insertedRows = await ex
    .select()
    .from(pgSchema.traderFills)
    .where(eq(pgSchema.traderFills.id, id))
    .limit(1);

  if (!insertedRows[0]) {
    throw new Error("[trader] fill insert failed");
  }
  return mapFillRow(insertedRows[0]);
}

function isPgUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "23505";
  }
  return isUniqueConstraintError(error);
}

/**
 * Removes org-scoped mock execution orders for research backtest isolation.
 *
 * `trader_fills` and `trader_order_events` cascade via FK on `trader_orders`.
 * Live and paper orders are never deleted.
 */
export async function deleteMockExecutionArtifactsForOrgPostgres(
  ex: PgDeleteExecutor,
  context: OrgContext,
): Promise<void> {
  const scoped = requireOrgContext(context.organizationId);

  await ex
    .delete(pgSchema.traderOrders)
    .where(
      and(
        eq(pgSchema.traderOrders.organizationId, scoped.organizationId),
        eq(pgSchema.traderOrders.executionMode, "mock"),
      ),
    );
}
