import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { runSqliteTransaction, type WaiaDb } from "@/db/types";
import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import {
  createOrderPostgres,
  findOrderByClientOrderIdPostgres,
  findOrderByIdempotencyKeyPostgres,
  getOrderByIdPostgres,
  listEventsPostgres,
  listFillsPostgres,
  listOpenOrdersPostgres,
  recordFillPostgres,
  transitionOrderPostgres,
} from "@/lib/trader/execution/repository-postgres";
import {
  createOrderSqlite,
  findOrderByClientOrderIdSqlite,
  findOrderByIdempotencyKeySqlite,
  getOrderByIdSqlite,
  listEventsSqlite,
  listFillsSqlite,
  listOpenOrdersSqlite,
  recordFillSqlite,
  transitionOrderSqlite,
} from "@/lib/trader/execution/repository-sqlite";

type PgOrderExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function toPromise<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function createSqliteOrderRepository(db: WaiaDb): OrderRepository {
  return {
    createOrder: (context, input) =>
      runSqliteTransaction(db, (tx) => createOrderSqlite(tx, context, input)),
    getOrderById: (context, id) => toPromise(() => getOrderByIdSqlite(db, context, id)),
    findOrderByClientOrderId: (context, clientOrderId) =>
      toPromise(() => findOrderByClientOrderIdSqlite(db, context, clientOrderId)),
    findOrderByIdempotencyKey: (context, idempotencyKey) =>
      toPromise(() => findOrderByIdempotencyKeySqlite(db, context, idempotencyKey)),
    listOpenOrders: (context, filter) => toPromise(() => listOpenOrdersSqlite(db, context, filter)),
    transitionOrder: (context, input) =>
      runSqliteTransaction(db, (tx) => transitionOrderSqlite(tx, context, input)),
    recordFill: (context, input) => toPromise(() => recordFillSqlite(db, context, input)),
    listEvents: (context, orderId) => toPromise(() => listEventsSqlite(db, context, orderId)),
    listFills: (context, orderId) => toPromise(() => listFillsSqlite(db, context, orderId)),
  };
}

export function createPostgresOrderRepository(db: WaiaPostgresDb): OrderRepository {
  return {
    createOrder: (context, input) =>
      runWaiaPostgresTransaction(db, (tx) => createOrderPostgres(tx, context, input)),
    getOrderById: (context, id) => getOrderByIdPostgres(db, context, id),
    findOrderByClientOrderId: (context, clientOrderId) =>
      findOrderByClientOrderIdPostgres(db, context, clientOrderId),
    findOrderByIdempotencyKey: (context, idempotencyKey) =>
      findOrderByIdempotencyKeyPostgres(db, context, idempotencyKey),
    listOpenOrders: (context, filter) => listOpenOrdersPostgres(db, context, filter),
    transitionOrder: (context, input) =>
      runWaiaPostgresTransaction(db, (tx) => transitionOrderPostgres(tx, context, input)),
    recordFill: (context, input) => recordFillPostgres(db, context, input),
    listEvents: (context, orderId) => listEventsPostgres(db, context, orderId),
    listFills: (context, orderId) => listFillsPostgres(db, context, orderId),
  };
}

export function createPostgresOrderRepositoryFromExecutor(ex: PgOrderExecutor): OrderRepository {
  return {
    createOrder: (context, input) => createOrderPostgres(ex, context, input),
    getOrderById: (context, id) => getOrderByIdPostgres(ex, context, id),
    findOrderByClientOrderId: (context, clientOrderId) =>
      findOrderByClientOrderIdPostgres(ex, context, clientOrderId),
    findOrderByIdempotencyKey: (context, idempotencyKey) =>
      findOrderByIdempotencyKeyPostgres(ex, context, idempotencyKey),
    listOpenOrders: (context, filter) => listOpenOrdersPostgres(ex, context, filter),
    transitionOrder: (context, input) => transitionOrderPostgres(ex, context, input),
    recordFill: (context, input) => recordFillPostgres(ex, context, input),
    listEvents: (context, orderId) => listEventsPostgres(ex, context, orderId),
    listFills: (context, orderId) => listFillsPostgres(ex, context, orderId),
  };
}
