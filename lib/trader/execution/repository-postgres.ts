import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, exists, max, notInArray } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  DuplicateOrderError,
  FillConflictError,
  OrderNotFoundError,
  OrderVersionConflictError,
} from "@/lib/trader/execution/order-repository.errors";
import { DeterministicExecutionIdCollisionError } from "@/lib/trader/execution/deterministic-execution-id";
import { EXECUTION_FACT_KIND_HISTORICAL_SIMULATED } from "@/lib/trader/execution/historical-execution-model.types";
import { assertCompleteHistoricalFillEconomics } from "@/lib/trader/execution/fill-economics";
import { addDecimal, compareDecimal, divideDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";
import { historicalInstrumentsMatch } from "@/lib/trader/symbols/historical-instrument";
import {
  fillPayloadMatches,
  isUniqueConstraintError,
  orderPayloadMatches,
  assertOrderOpeningCausalLineage,
  type CreateOrderInput,
  type FillRow,
  type OrderEventRow,
  type OrderRow,
  type OpenOrdersFilter,
  type RecordFillInput,
  type RecordFillProgressInput,
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

import {
  assertHistoricalMockLedgerContext,
  bindHistoricalMockOrderInput,
  type HistoricalMockLedgerScope,
} from "@/lib/trader/execution/historical-mock-ledger-scope";

/** Explicit replay-owned identity/clock. Ordinary repositories retain their defaults. */
export type HistoricalMockWriteRuntime = Readonly<{
  newId(): string;
  now(): Date;
}>;

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
    historicalRunId: row.historicalRunId,
    historicalAccountKey: row.historicalAccountKey,
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
    riskAllowanceId: row.riskAllowanceId,
    riskAllowanceBindingDigest: row.riskAllowanceBindingDigest,
    openingCausalLineageJson: row.openingCausalLineageJson,
    openingCausalLineageDigest: row.openingCausalLineageDigest,
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

function orgOrderConditions(context: OrgContext, ledgerScope?: HistoricalMockLedgerScope) {
  const scoped = requireOrgContext(context.organizationId);
  if (ledgerScope) assertHistoricalMockLedgerContext(scoped, ledgerScope);
  return and(
    orgScopedWhere(pgSchema.traderOrders.organizationId, scoped),
    ledgerScope ? eq(pgSchema.traderOrders.executionMode, "mock") : undefined,
    ledgerScope ? eq(pgSchema.traderOrders.historicalRunId, ledgerScope.historicalRunId) : undefined,
    ledgerScope ? eq(pgSchema.traderOrders.historicalAccountKey, ledgerScope.historicalAccountKey) : undefined,
  );
}

function scopedParentExists(ex: PgReadExecutor, context: OrgContext, orderId: string,
  ledgerScope?: HistoricalMockLedgerScope) {
  return ledgerScope ? exists(ex.select({ id: pgSchema.traderOrders.id }).from(pgSchema.traderOrders)
    .where(and(eq(pgSchema.traderOrders.id, orderId), orgOrderConditions(context, ledgerScope)))) : undefined;
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
  ledgerScope?: HistoricalMockLedgerScope,
): Promise<OrderRow | null> {
  const rows = await ex
    .select()
    .from(pgSchema.traderOrders)
    .where(and(eq(pgSchema.traderOrders.id, id), orgOrderConditions(context, ledgerScope)))
    .limit(1);

  return rows[0] ? mapOrderRow(rows[0]) : null;
}

export async function findOrderByClientOrderIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  clientOrderId: string,
  ledgerScope?: HistoricalMockLedgerScope,
): Promise<OrderRow | null> {
  const rows = await ex
    .select()
    .from(pgSchema.traderOrders)
    .where(and(eq(pgSchema.traderOrders.clientOrderId, clientOrderId), orgOrderConditions(context, ledgerScope)))
    .limit(1);

  return rows[0] ? mapOrderRow(rows[0]) : null;
}

export async function findOrderByIdempotencyKeyPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  idempotencyKey: string,
  ledgerScope?: HistoricalMockLedgerScope,
): Promise<OrderRow | null> {
  const rows = await ex
    .select()
    .from(pgSchema.traderOrders)
    .where(
      and(eq(pgSchema.traderOrders.idempotencyKey, idempotencyKey), orgOrderConditions(context, ledgerScope)),
    )
    .limit(1);

  return rows[0] ? mapOrderRow(rows[0]) : null;
}

export async function listOpenOrdersPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  filter?: OpenOrdersFilter,
  ledgerScope?: HistoricalMockLedgerScope,
): Promise<OrderRow[]> {
  const conditions = [
    orgOrderConditions(context, ledgerScope),
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
  ledgerScope?: HistoricalMockLedgerScope,
): Promise<OrderRow[]> {
  const conditions = [orgOrderConditions(context, ledgerScope)];

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
  ledgerScope?: HistoricalMockLedgerScope,
): Promise<OrderEventRow[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderOrderEvents)
    .where(
      and(
        eq(pgSchema.traderOrderEvents.orderId, orderId),
        scopedParentExists(ex, context, orderId, ledgerScope),
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
  ledgerScope?: HistoricalMockLedgerScope,
): Promise<FillRow[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderFills)
    .where(
      and(
        eq(pgSchema.traderFills.orderId, orderId),
        scopedParentExists(ex, context, orderId, ledgerScope),
        orgScopedWhere(pgSchema.traderFills.organizationId, scoped),
      ),
    );

  return rows.map(mapFillRow);
}

export async function createOrderPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: CreateOrderInput,
  ledgerScope?: HistoricalMockLedgerScope,
  runtime?: HistoricalMockWriteRuntime,
): Promise<OrderRow> {
  const scoped = requireOrgContext(context.organizationId);
  if (ledgerScope) {
    assertHistoricalMockLedgerContext(scoped, ledgerScope);
    input = bindHistoricalMockOrderInput(input, ledgerScope);
  }
  assertOrderOpeningCausalLineage(scoped.organizationId, input);

  const byClientOrderId = await findOrderByClientOrderIdPostgres(ex, context, input.clientOrderId, ledgerScope);
  if (byClientOrderId) {
    return resolveExistingOrderForCreate(byClientOrderId, input);
  }

  const byIdempotencyKey = await findOrderByIdempotencyKeyPostgres(
    ex,
    context,
    input.idempotencyKey,
    ledgerScope,
  );
  if (byIdempotencyKey) {
    return resolveExistingOrderForCreate(byIdempotencyKey, input);
  }

  const id = input.id ?? runtime?.newId() ?? crypto.randomUUID();
  const now = runtime?.now() ?? new Date();

  try {
    await ex.insert(pgSchema.traderOrders).values({
      id,
      organizationId: scoped.organizationId,
      credentialId: input.credentialId ?? null,
      venue: input.venue,
      executionMode: input.executionMode,
      historicalRunId: input.historicalRunId ?? null,
      historicalAccountKey: input.historicalAccountKey ?? null,
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
      riskAllowanceId: input.riskAllowanceId ?? null,
      riskAllowanceBindingDigest: input.riskAllowanceBindingDigest ?? null,
      openingCausalLineageJson: input.openingCausalLineageJson ?? null,
      openingCausalLineageDigest: input.openingCausalLineageDigest ?? null,
      strategySignalId: input.strategySignalId ?? null,
      allocationDecisionId: input.allocationDecisionId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    await ex.insert(pgSchema.traderOrderEvents).values({
      id: runtime?.newId() ?? crypto.randomUUID(),
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
      (await findOrderByClientOrderIdPostgres(ex, context, input.clientOrderId, ledgerScope)) ??
      (await findOrderByIdempotencyKeyPostgres(ex, context, input.idempotencyKey, ledgerScope));

    if (!raced) {
      throw error;
    }

    return resolveExistingOrderForCreate(raced, input);
  }

  const created = await getOrderByIdPostgres(ex, context, id, ledgerScope);
  if (!created) {
    throw new Error("[trader] order insert failed");
  }
  return created;
}

export async function transitionOrderPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: TransitionOrderInput,
  ledgerScope?: HistoricalMockLedgerScope,
  runtime?: HistoricalMockWriteRuntime,
): Promise<OrderRow> {
  const existing = await getOrderByIdPostgres(ex, context, input.orderId, ledgerScope);
  if (!existing) {
    throw new OrderNotFoundError(input.orderId);
  }

  assertTransition(existing.state, input.toState);

  const now = runtime?.now() ?? new Date();
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
        orgOrderConditions(context, ledgerScope),
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
    id: runtime?.newId() ?? crypto.randomUUID(),
    organizationId: scoped.organizationId,
    orderId: input.orderId,
    seq: nextSeq,
    fromState: existing.state,
    toState: input.toState,
    eventType: input.eventType ?? "transition",
    payload: input.eventPayload ?? null,
    occurredAt,
  });

  const updated = await getOrderByIdPostgres(ex, context, input.orderId, ledgerScope);
  if (!updated) {
    throw new OrderNotFoundError(input.orderId);
  }
  return updated;
}

async function insertHistoricalEconomicsIfPresent(
  ex: PgWriteExecutor,
  scoped: ReturnType<typeof requireOrgContext>,
  input: RecordFillInput,
  fillId: string,
  ledgerScope?: HistoricalMockLedgerScope,
): Promise<void> {
  if (input.executionFactKind !== EXECUTION_FACT_KIND_HISTORICAL_SIMULATED || !input.economicsRow) {
    return;
  }
  const row = input.economicsRow;
  const existingEconomics = await ex
    .select()
    .from(pgSchema.traderFillExecutionEconomics)
    .where(
      and(
        eq(pgSchema.traderFillExecutionEconomics.organizationId, scoped.organizationId),
        eq(pgSchema.traderFillExecutionEconomics.fillId, fillId),
      ),
    )
    .limit(1);

  if (existingEconomics[0]) {
    const existing = existingEconomics[0];
    const scopedRowMismatch = ledgerScope && Object.entries(row).some(([key, value]) => {
      const stored = (existing as unknown as Record<string, unknown>)[key];
      return value instanceof Date
        ? !(stored instanceof Date) || stored.getTime() !== value.getTime()
        : stored !== value;
    });
    if (existing.economicsContentDigest !== row.economicsContentDigest || scopedRowMismatch) {
      throw new DeterministicExecutionIdCollisionError(
        `[trader] economics content conflict for fill ${fillId}`,
      );
    }
    return;
  }

  await ex.insert(pgSchema.traderFillExecutionEconomics).values({
    id: row.id,
    organizationId: scoped.organizationId,
    fillId,
    orderId: row.orderId,
    exchangeTradeId: row.exchangeTradeId,
    fillSequence: row.fillSequence,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    grossFillPrice: row.grossFillPrice,
    grossNotional: row.grossNotional,
    feeAmount: row.feeAmount,
    feeAsset: row.feeAsset,
    spreadCost: row.spreadCost,
    impactSlippageCost: row.impactSlippageCost,
    totalExecutionCost: row.totalExecutionCost,
    netFillPrice: row.netFillPrice,
    netCashEffect: row.netCashEffect,
    remainingQuantityAfter: row.remainingQuantityAfter,
    executionModelId: row.executionModelId,
    executionModelSchemaVersion: row.executionModelSchemaVersion,
    simulatorId: row.simulatorId,
    simulatorVersion: row.simulatorVersion,
    sourceBarTimestamp: row.sourceBarTimestamp,
    sourceBarIndex: row.sourceBarIndex,
    acceptedAt: row.acceptedAt,
    fillTimestamp: row.fillTimestamp,
    submitLatencyMs: row.submitLatencyMs,
    cancelLatencyMs: row.cancelLatencyMs,
    executionFactKind: row.executionFactKind,
    economicsContentDigest: row.economicsContentDigest,
    schemaVersion: row.schemaVersion,
  });
}

export async function recordFillPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: RecordFillInput,
  ledgerScope?: HistoricalMockLedgerScope,
  runtime?: HistoricalMockWriteRuntime,
): Promise<FillRow> {
  const scoped = requireOrgContext(context.organizationId);
  if (ledgerScope) {
    assertHistoricalMockLedgerContext(scoped, ledgerScope);
    const parent = await getOrderByIdPostgres(ex, context, input.orderId, ledgerScope);
    if (!parent) throw new OrderNotFoundError(input.orderId);
    if ((input.economics || input.economicsRow) &&
        input.executionFactKind !== EXECUTION_FACT_KIND_HISTORICAL_SIMULATED) {
      throw new DeterministicExecutionIdCollisionError("Historical mock economics requires historical fact kind");
    }
    if (input.executionFactKind === EXECUTION_FACT_KIND_HISTORICAL_SIMULATED &&
        (!input.fillId || !input.economicsRow || !input.economics)) {
      throw new DeterministicExecutionIdCollisionError("Historical mock fill requires durable economics");
    }
    if (input.economicsRow) {
      const row = input.economicsRow;
      const economics = input.economics;
      const fieldsMismatch = !economics || Object.entries(economics).some(([key, value]) => {
        const stored = (row as unknown as Record<string, unknown>)[key];
        return value instanceof Date
          ? !(stored instanceof Date) || stored.getTime() !== value.getTime()
          : stored !== value;
      });
      if (fieldsMismatch || row.organizationId !== scoped.organizationId ||
          row.orderId !== input.orderId || row.exchangeTradeId !== input.exchangeTradeId ||
          row.fillId !== input.fillId || !historicalInstrumentsMatch(row.symbol, parent.symbol) || row.side !== parent.side ||
          row.quantity !== input.quantity || row.netFillPrice !== input.price ||
          row.feeAmount !== (input.fee ?? "0") || row.feeAsset !== (input.feeAsset ?? "") ||
          row.fillTimestamp.getTime() !== input.executedAt.getTime()) {
        throw new DeterministicExecutionIdCollisionError("Historical mock fill economics parent or payload mismatch");
      }
    }
  }

  if (input.executionFactKind === EXECUTION_FACT_KIND_HISTORICAL_SIMULATED) {
    assertCompleteHistoricalFillEconomics(input);
  }

  const fillId = input.fillId;
  if (fillId) {
    const existingByFillId = await ex
      .select()
      .from(pgSchema.traderFills)
      .where(
        and(
          eq(pgSchema.traderFills.id, fillId),
          ledgerScope ? eq(pgSchema.traderFills.orderId, input.orderId) : undefined,
          orgScopedWhere(pgSchema.traderFills.organizationId, scoped),
        ),
      )
      .limit(1);
    if (existingByFillId[0]) {
      const mapped = mapFillRow(existingByFillId[0]);
      if (!fillPayloadMatches(mapped, input) || (ledgerScope &&
          (mapped.orderId !== input.orderId || mapped.exchangeTradeId !== input.exchangeTradeId ||
            (input.fillId !== undefined && mapped.id !== input.fillId)))) {
        throw new DeterministicExecutionIdCollisionError(
          `[trader] fill id content conflict for ${fillId}`,
        );
      }
      await insertHistoricalEconomicsIfPresent(ex, scoped, input, fillId, ledgerScope);
      return mapped;
    }
  }

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
    if (!fillPayloadMatches(mapped, input) || (ledgerScope &&
          (mapped.orderId !== input.orderId || mapped.exchangeTradeId !== input.exchangeTradeId ||
            (input.fillId !== undefined && mapped.id !== input.fillId)))) {
      throw new FillConflictError(input.orderId, input.exchangeTradeId);
    }
    if (ledgerScope) await insertHistoricalEconomicsIfPresent(ex, scoped, input, mapped.id, ledgerScope);
    return mapped;
  }

  const parent = await getOrderByIdPostgres(ex, context, input.orderId, ledgerScope);
  if (!parent) {
    throw new OrderNotFoundError(input.orderId);
  }

  const id = fillId ?? runtime?.newId() ?? crypto.randomUUID();
  const now = runtime?.now() ?? new Date();
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
    await insertHistoricalEconomicsIfPresent(ex, scoped, input, id, ledgerScope);
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
    if (!fillPayloadMatches(mapped, input) || (ledgerScope &&
          (mapped.orderId !== input.orderId || mapped.exchangeTradeId !== input.exchangeTradeId ||
            (input.fillId !== undefined && mapped.id !== input.fillId)))) {
      throw new FillConflictError(input.orderId, input.exchangeTradeId);
    }
    if (ledgerScope) await insertHistoricalEconomicsIfPresent(ex, scoped, input, mapped.id, ledgerScope);
    return mapped;
  }

  const insertedRows = await ex
    .select()
    .from(pgSchema.traderFills)
    .where(and(eq(pgSchema.traderFills.id, id),
      ledgerScope ? eq(pgSchema.traderFills.orderId, input.orderId) : undefined,
      ledgerScope ? orgScopedWhere(pgSchema.traderFills.organizationId, scoped) : undefined))
    .limit(1);

  if (!insertedRows[0]) {
    throw new Error("[trader] fill insert failed");
  }
  return mapFillRow(insertedRows[0]);
}

export async function recordFillProgressPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: RecordFillProgressInput,
  ledgerScope?: HistoricalMockLedgerScope,
  runtime?: HistoricalMockWriteRuntime,
): Promise<FillRow> {
  assertCompleteHistoricalFillEconomics(input);
  // Serialize progress on the owning order. The caller must hold this transaction
  // through the fill, cumulative update and event; the scoped root adapter does so.
  const locked = ledgerScope
    ? await ex.select().from(pgSchema.traderOrders).where(and(
        eq(pgSchema.traderOrders.id, input.orderId), orgOrderConditions(context, ledgerScope),
      )).limit(1).for("update")
    : undefined;
  const existing = locked
    ? (locked[0] ? mapOrderRow(locked[0]) : null)
    : await getOrderByIdPostgres(ex, context, input.orderId);
  if (!existing) {
    throw new OrderNotFoundError(input.orderId);
  }

  const progress = ledgerScope ? {
    schema: "historical-mock-fill-progress/v1", fillId: input.fillId,
    exchangeTradeId: input.exchangeTradeId, filledQuantity: input.filledQuantity,
    avgFillPrice: input.avgFillPrice,
  } : undefined;
  if (progress) {
    const priorFills = await listFillsPostgres(ex, context, input.orderId, ledgerScope);
    const priorFill = priorFills.find(fill => fill.id === input.fillId ||
      fill.exchangeTradeId === input.exchangeTradeId);
    const events = await listEventsPostgres(ex, context, input.orderId, ledgerScope);
    for (const event of events) {
      if (event.eventType !== "fill_recorded" || event.payload === null) continue;
      const recorded = JSON.parse(event.payload) as Record<string, unknown>;
      if (recorded.schema !== progress.schema ||
          (recorded.fillId !== progress.fillId && recorded.exchangeTradeId !== progress.exchangeTradeId)) continue;
      if (Object.entries(progress).some(([key, value]) => recorded[key] !== value)) {
        throw new DeterministicExecutionIdCollisionError("Historical mock fill progress command conflict");
      }
      if (!priorFill) {
        throw new DeterministicExecutionIdCollisionError("Historical mock fill progress evidence missing");
      }
      // Verify even an old exact retry against its durable fill and economics,
      // but never regress newer cumulative progress or append another event.
      return recordFillPostgres(ex, context, input, ledgerScope, runtime);
    }
    if (priorFill) {
      throw new DeterministicExecutionIdCollisionError("Historical mock fill progress identity unavailable");
    }
    // The canonical historical exchange suppresses eligibility as soon as a
    // cancellation is pending. Only an open partial order accepts a new slice.
    if (existing.state !== "PARTIALLY_FILLED") {
      throw new DeterministicExecutionIdCollisionError("Historical mock fill progress state invalid");
    }
    const expectedQuantity = addDecimal(existing.filledQuantity, input.quantity);
    const expectedAverage = compareDecimal(existing.filledQuantity, "0") === 0
      ? input.price
      : divideDecimal(addDecimal(
          multiplyDecimal(existing.avgFillPrice ?? "0", existing.filledQuantity),
          multiplyDecimal(input.price, input.quantity),
        ), expectedQuantity);
    if (compareDecimal(input.quantity, "0") <= 0 ||
        compareDecimal(expectedQuantity, existing.quantity) > 0 ||
        compareDecimal(input.filledQuantity, expectedQuantity) !== 0 ||
        compareDecimal(input.avgFillPrice, expectedAverage) !== 0) {
      throw new DeterministicExecutionIdCollisionError("Historical mock fill cumulative progress mismatch");
    }
  }

  const fillRow = await recordFillPostgres(ex, context, input, ledgerScope, runtime);
  const scoped = requireOrgContext(context.organizationId);
  const now = runtime?.now() ?? new Date();

  const updateResult = await ex
    .update(pgSchema.traderOrders)
    .set({
      filledQuantity: input.filledQuantity,
      avgFillPrice: input.avgFillPrice,
      updatedAt: now,
    })
    .where(
      and(
        eq(pgSchema.traderOrders.id, input.orderId),
        orgOrderConditions(context, ledgerScope),
      ),
    )
    .returning();

  if (updateResult.length === 0) {
    throw new OrderNotFoundError(input.orderId);
  }

  const maxSeqRows = await ex
    .select({ maxSeq: max(pgSchema.traderOrderEvents.seq) })
    .from(pgSchema.traderOrderEvents)
    .where(
      and(
        eq(pgSchema.traderOrderEvents.orderId, input.orderId),
        orgScopedWhere(pgSchema.traderOrderEvents.organizationId, scoped),
      ),
    )
    .limit(1);

  const nextSeq = (maxSeqRows[0]?.maxSeq ?? 0) + 1;
  await ex.insert(pgSchema.traderOrderEvents).values({
    id: runtime?.newId() ?? crypto.randomUUID(),
    organizationId: scoped.organizationId,
    orderId: input.orderId,
    seq: nextSeq,
    fromState: existing.state,
    toState: existing.state,
    eventType: "fill_recorded",
    payload: progress ? JSON.stringify(progress) : null,
    occurredAt: input.executedAt,
  });

  return fillRow;
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
