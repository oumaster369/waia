import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, is, isNull } from "drizzle-orm";
import { PostgresJsTransaction } from "drizzle-orm/postgres-js/session";

import * as pgSchema from "@/db/schema.postgres";
import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { DuplicateOrderError, OrderNotFoundError } from "@/lib/trader/execution/order-repository.errors";
import type {
  CreateOrderInput, OpenOrdersFilter, OrderRepository, OrderRow, RecordFillInput,
  TransitionOrderInput,
} from "@/lib/trader/execution/order-repository.types";
import { EXECUTION_FACT_KIND_HISTORICAL_SIMULATED } from "@/lib/trader/execution/historical-execution-model.types";
import {
  createOrderPostgres,
  findOrderByClientOrderIdPostgres,
  findOrderByIdempotencyKeyPostgres,
  getOrderByIdPostgres,
  listEventsPostgres,
  listFillsPostgres,
  listOpenOrdersPostgres,
  listOrdersPostgres,
  recordFillPostgres,
  transitionOrderPostgres,
} from "@/lib/trader/execution/repository-postgres";
import type { PostgresOrderReadScope } from "@/lib/trader/execution/repository-postgres";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type OrdinaryWorkerMode = "mock" | "paper";
type WaiaPostgresTx = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];
type OrdinaryExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;
type RunOrdinaryMutation = <T>(operation: (tx: OrdinaryExecutor) => Promise<T>) => Promise<T>;

function ordinaryPaperRow(row: OrderRow, executionMode: OrdinaryWorkerMode): boolean {
  return row.venue === (executionMode === "mock" ? "mock" : "HTX") &&
    row.executionMode === executionMode &&
    row.historicalRunId == null && row.historicalAccountKey == null;
}

function refuseForeignOrderKey(clientOrderId: string, idempotencyKey: string): never {
  throw new DuplicateOrderError("Ordinary paper order key belongs to another domain", {
    clientOrderId,
    idempotencyKey,
  });
}

/** Private fixed scope for the scheduled worker; historical and generic repositories stay unchanged. */
export function createOrdinaryPaperOrderRepositoryPostgres(
  db: WaiaPostgresDb,
  organizationId: string | null,
  executionMode: OrdinaryWorkerMode,
): OrderRepository {
  return createOrdinaryPaperOrderRepositoryCore(
    db,
    (operation) => runWaiaPostgresTransaction(db, async (tx) => operation(tx)),
    organizationId,
    executionMode,
  );
}

/** Scheduled owner only: reads and mutations use its already-held root transaction. */
export function createOrdinaryPaperOrderRepositoryFromExecutorPostgres(
  tx: WaiaPostgresTx,
  organizationId: string,
  executionMode: OrdinaryWorkerMode,
): OrderRepository {
  if (!is(tx, PostgresJsTransaction)) {
    throw new Error("ORDINARY_PAPER_HELD_TRANSACTION_REQUIRED");
  }
  return createOrdinaryPaperOrderRepositoryCore(tx, (operation) => operation(tx), organizationId, executionMode);
}

function createOrdinaryPaperOrderRepositoryCore(
  ex: OrdinaryExecutor,
  runMutation: RunOrdinaryMutation,
  organizationId: string | null,
  executionMode: OrdinaryWorkerMode,
): OrderRepository {
  const readScope: PostgresOrderReadScope = executionMode === "mock" ? "ordinary-mock" : "ordinary-paper";
  const venue = executionMode === "mock" ? "mock" : "HTX";
  // A disabled/incomplete worker may still build and dispose its dependencies.
  // Its repository has no usable scope and cannot read or write any order.
  const expectedOrg = organizationId === null ? null : requireOrgContext(organizationId).organizationId;
  const scope = (context: OrgContext): OrgContext => {
    if (expectedOrg === null) throw new Error("ORDINARY_PAPER_WORKER_DISABLED");
    const scoped = requireOrgContext(context.organizationId);
    if (scoped.organizationId !== expectedOrg) throw new Error("ORDINARY_PAPER_ORG_MISMATCH");
    return scoped;
  };

  const withLockedParent = <T>(
    scoped: OrgContext,
    orderId: string,
    operation: (tx: OrdinaryExecutor) => Promise<T>,
  ): Promise<T> => runMutation(async (tx) => {
    const rows = await tx.select({ id: pgSchema.traderOrders.id })
      .from(pgSchema.traderOrders)
      .where(and(
        eq(pgSchema.traderOrders.id, orderId),
        eq(pgSchema.traderOrders.organizationId, scoped.organizationId),
        eq(pgSchema.traderOrders.venue, venue),
        eq(pgSchema.traderOrders.executionMode, executionMode),
        isNull(pgSchema.traderOrders.historicalRunId),
        isNull(pgSchema.traderOrders.historicalAccountKey),
      ))
      .for("update")
      .limit(1);
    if (rows.length !== 1) throw new OrderNotFoundError(orderId);
    return operation(tx);
  });

  // Capture caller-owned objects before the first await (including the lock wait).
  // A Date is copied because freezing its wrapper does not freeze its timestamp.
  const captureCreate = (input: CreateOrderInput): CreateOrderInput => Object.freeze({ ...input });
  const captureTransition = (input: TransitionOrderInput): TransitionOrderInput =>
    Object.freeze({ ...input, occurredAt: input.occurredAt && new Date(input.occurredAt.getTime()) });
  const captureFill = (input: RecordFillInput): RecordFillInput =>
    Object.freeze({ ...input, executedAt: new Date(input.executedAt.getTime()) });
  const captureFilter = (filter?: OpenOrdersFilter): OpenOrdersFilter | undefined =>
    filter && Object.freeze({ executionMode: filter.executionMode, venue: filter.venue });

  const repository: OrderRepository = {
    async createOrder(context, input) {
      const scoped = scope(context);
      const captured = captureCreate(input);
      if (captured.venue !== venue || captured.executionMode !== executionMode ||
          captured.historicalRunId != null || captured.historicalAccountKey != null) {
        throw new Error("ORDINARY_PAPER_ORDER_DOMAIN_FORBIDDEN");
      }
      return runMutation(async (tx) => {
        const existingByClient = await findOrderByClientOrderIdPostgres(tx, scoped, captured.clientOrderId);
        const existingByIdempotency = await findOrderByIdempotencyKeyPostgres(tx, scoped, captured.idempotencyKey);
        if ((existingByClient && !ordinaryPaperRow(existingByClient, executionMode)) ||
            (existingByIdempotency && !ordinaryPaperRow(existingByIdempotency, executionMode))) {
          refuseForeignOrderKey(captured.clientOrderId, captured.idempotencyKey);
        }
        const created = await createOrderPostgres(tx, scoped, captured);
        if (!ordinaryPaperRow(created, executionMode)) {
          refuseForeignOrderKey(captured.clientOrderId, captured.idempotencyKey);
        }
        return created;
      });
    },
    getOrderById: async (context, id) => getOrderByIdPostgres(ex, scope(context), id, undefined, readScope),
    findOrderByClientOrderId: async (context, clientOrderId) =>
      findOrderByClientOrderIdPostgres(ex, scope(context), clientOrderId, undefined, readScope),
    findOrderByIdempotencyKey: async (context, idempotencyKey) =>
      findOrderByIdempotencyKeyPostgres(ex, scope(context), idempotencyKey, undefined, readScope),
    listOpenOrders: async (context, filter) =>
      listOpenOrdersPostgres(ex, scope(context), captureFilter(filter), undefined, readScope),
    listOrders: async (context, filter) => listOrdersPostgres(ex, scope(context), captureFilter(filter), undefined, readScope),
    transitionOrder: async (context, input) => {
      const scoped = scope(context);
      const captured = captureTransition(input);
      return withLockedParent(scoped, captured.orderId,
        tx => transitionOrderPostgres(tx, scoped, captured));
    },
    recordFill: async (context, input) => {
      const scoped = scope(context);
      const captured = captureFill(input);
      if (captured.executionFactKind === EXECUTION_FACT_KIND_HISTORICAL_SIMULATED ||
          captured.economics != null || captured.economicsRow != null) {
        throw new Error("ORDINARY_PAPER_HISTORICAL_FILL_FORBIDDEN");
      }
      return withLockedParent(scoped, captured.orderId, async tx => {
        const fill = await recordFillPostgres(tx, scoped, captured);
        if (fill.orderId !== captured.orderId || fill.organizationId !== scoped.organizationId) {
          throw new Error("ORDINARY_PAPER_FILL_ID_FOREIGN_ORDER");
        }
        return fill;
      });
    },
    recordFillProgress: async () => {
      throw new Error("ORDINARY_PAPER_HISTORICAL_PROGRESS_FORBIDDEN");
    },
    listEvents: async (context, orderId) => listEventsPostgres(ex, scope(context), orderId, undefined, readScope),
    listFills: async (context, orderId) => listFillsPostgres(ex, scope(context), orderId, undefined, readScope),
  };
  return Object.freeze(repository);
}
