import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import {
  assertHistoricalMockLedgerContext,
  captureHistoricalMockLedgerScope,
  type HistoricalMockLedgerScope,
} from "@/lib/trader/execution/historical-mock-ledger-scope";
import {
  type HistoricalMockWriteRuntime, createOrderPostgres, findOrderByClientOrderIdPostgres, findOrderByIdempotencyKeyPostgres,
  getOrderByIdPostgres, listEventsPostgres, listFillsPostgres, listOpenOrdersPostgres,
  listOrdersPostgres, recordFillPostgres, recordFillProgressPostgres, transitionOrderPostgres,
} from "@/lib/trader/execution/repository-postgres";

export type { HistoricalMockLedgerScope } from "@/lib/trader/execution/historical-mock-ledger-scope";
type Executor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;
type Write = <T>(callback: (executor: Executor) => Promise<T>) => Promise<T>;
const repositoryScopes = new WeakMap<OrderRepository, HistoricalMockLedgerScope>();

function createRepository(ex: Executor, requested: HistoricalMockLedgerScope, write: Write,
  requestedRuntime?: HistoricalMockWriteRuntime): OrderRepository {
  const runtime = requestedRuntime ? Object.freeze({
    newId: requestedRuntime.newId.bind(requestedRuntime),
    now: requestedRuntime.now.bind(requestedRuntime),
  }) : undefined;
  const scope = captureHistoricalMockLedgerScope(requested);
  const contextFor = (context: OrgContext) => {
    const captured = requireOrgContext(context.organizationId);
    assertHistoricalMockLedgerContext(captured, scope);
    return captured;
  };
  const repository: OrderRepository = {
    async createOrder(context, input) {
      const bound = contextFor(context);
      const command = structuredClone(input);
      return write(tx => createOrderPostgres(tx, bound, command, scope, runtime));
    },
    async getOrderById(context, id) { return getOrderByIdPostgres(ex, contextFor(context), id, scope); },
    async findOrderByClientOrderId(context, id) {
      return findOrderByClientOrderIdPostgres(ex, contextFor(context), id, scope);
    },
    async findOrderByIdempotencyKey(context, id) {
      return findOrderByIdempotencyKeyPostgres(ex, contextFor(context), id, scope);
    },
    async listOpenOrders(context, filter) {
      return listOpenOrdersPostgres(ex, contextFor(context), filter ? { ...filter } : undefined, scope);
    },
    async listOrders(context, filter) {
      return listOrdersPostgres(ex, contextFor(context), filter ? { ...filter } : undefined, scope);
    },
    async transitionOrder(context, input) {
      const bound = contextFor(context);
      const command = structuredClone(input);
      return write(tx => transitionOrderPostgres(tx, bound, command, scope, runtime));
    },
    async recordFill(context, input) {
      const bound = contextFor(context);
      const command = structuredClone(input);
      return write(tx => recordFillPostgres(tx, bound, command, scope, runtime));
    },
    async recordFillProgress(context, input) {
      const bound = contextFor(context);
      const command = structuredClone(input);
      return write(tx => recordFillProgressPostgres(tx, bound, command, scope, runtime));
    },
    async listEvents(context, id) { return listEventsPostgres(ex, contextFor(context), id, scope); },
    async listFills(context, id) { return listFillsPostgres(ex, contextFor(context), id, scope); },
  };
  repositoryScopes.set(repository, scope);
  return Object.freeze(repository);
}

/** Each mutation is atomic; reads and writes share the exact mock ledger tuple.
 * Client/order/fill IDs must be namespaced by the replay owner. Collisions with
 * another ledger refuse instead of borrowing the other ledger's idempotent row. */
export function createHistoricalMockOrderRepositoryPostgres(
  db: WaiaPostgresDb, scope: HistoricalMockLedgerScope, runtime?: HistoricalMockWriteRuntime,
): OrderRepository {
  return createRepository(db, scope, callback => db.transaction(callback), runtime);
}

/** The caller owns the transaction, including rollback after a failed mutation.
 * Intended for an already-bound blind outcome executor, never a hidden pool. */
export function createHistoricalMockOrderRepositoryFromExecutor(
  ex: Executor, scope: HistoricalMockLedgerScope, runtime?: HistoricalMockWriteRuntime,
): OrderRepository {
  return createRepository(ex, scope, callback => callback(ex), runtime);
}

export function assertHistoricalMockOrderRepositoryScope(
  repository: OrderRepository, requested: HistoricalMockLedgerScope,
): void {
  const expected = captureHistoricalMockLedgerScope(requested);
  const observed = repositoryScopes.get(repository);
  if (!observed || observed.organizationId !== expected.organizationId ||
      observed.historicalRunId !== expected.historicalRunId ||
      observed.historicalAccountKey !== expected.historicalAccountKey) {
    throw new Error("HISTORICAL_MOCK_LEDGER_REPOSITORY_SCOPE_MISMATCH");
  }
}

/** Exact-ledger cleanup; it cannot fall back to organization-wide deletion. */
export async function deleteHistoricalMockExecutionArtifactsPostgres(
  ex: Pick<WaiaPostgresDb, "delete">, requested: HistoricalMockLedgerScope,
): Promise<void> {
  const scope = captureHistoricalMockLedgerScope(requested);
  await ex.delete(pgSchema.traderOrders).where(and(
    eq(pgSchema.traderOrders.organizationId, scope.organizationId),
    eq(pgSchema.traderOrders.executionMode, "mock"),
    eq(pgSchema.traderOrders.historicalRunId, scope.historicalRunId),
    eq(pgSchema.traderOrders.historicalAccountKey, scope.historicalAccountKey),
  ));
}
