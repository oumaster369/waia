import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { PaymentEventsRepository } from "@/lib/waia-core/payments/payment-events-repository.types";
import {
  findPaymentEventByIdempotencyKeyPostgres,
  findPaymentEventBySettlementAttributionPostgres,
  insertPaymentEventPostgres,
  listPaymentEventsForPaymentPostgres,
  listPaymentEventsPostgres,
} from "@/lib/waia-core/payments/payment-events-repository-postgres";
import {
  findPaymentEventByIdempotencyKeySqlite,
  findPaymentEventBySettlementAttributionSqlite,
  insertPaymentEventSqlite,
  listPaymentEventsForPaymentSqlite,
  listPaymentEventsSqlite,
} from "@/lib/waia-core/payments/payment-events-repository-sqlite";
import type { PaymentsProjectionRepository } from "@/lib/waia-core/payments/payments-projection-repository.types";
import {
  deleteAllPaymentProjectionsForOrgPostgres,
  deletePaymentProjectionByIdPostgres,
  getPaymentProjectionByIdPostgres,
  listPaymentProjectionsPostgres,
  upsertPaymentProjectionPostgres,
} from "@/lib/waia-core/payments/payments-projection-repository-postgres";
import {
  deleteAllPaymentProjectionsForOrgSqlite,
  deletePaymentProjectionByIdSqlite,
  getPaymentProjectionByIdSqlite,
  listPaymentProjectionsSqlite,
  upsertPaymentProjectionSqlite,
} from "@/lib/waia-core/payments/payments-projection-repository-sqlite";

type PgPaymentEventsExecutor = Pick<WaiaPostgresDb, "select" | "insert">;
type PgPaymentsProjectionExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "delete">;

export function createSqlitePaymentEventsRepository(db: WaiaDb): PaymentEventsRepository {
  return {
    insertEvent: (context, input) => Promise.resolve(insertPaymentEventSqlite(db, context, input)),
    listEvents: (context, query) => Promise.resolve(listPaymentEventsSqlite(db, context, query)),
    findByIdempotencyKey: (context, idempotencyKey) =>
      Promise.resolve(findPaymentEventByIdempotencyKeySqlite(db, context, idempotencyKey)),
    findBySettlementAttribution: (settlementNetwork, settlementTxHash, transferIndex) =>
      Promise.resolve(
        findPaymentEventBySettlementAttributionSqlite(
          db,
          settlementNetwork,
          settlementTxHash,
          transferIndex,
        ),
      ),
    listEventsForPayment: (context, paymentId) =>
      Promise.resolve(listPaymentEventsForPaymentSqlite(db, context, paymentId)),
  };
}

export function createPostgresPaymentEventsRepository(
  ex: PgPaymentEventsExecutor,
): PaymentEventsRepository {
  return {
    insertEvent: (context, input) => insertPaymentEventPostgres(ex, context, input),
    listEvents: (context, query) => listPaymentEventsPostgres(ex, context, query),
    findByIdempotencyKey: (context, idempotencyKey) =>
      findPaymentEventByIdempotencyKeyPostgres(ex, context, idempotencyKey),
    findBySettlementAttribution: (settlementNetwork, settlementTxHash, transferIndex) =>
      findPaymentEventBySettlementAttributionPostgres(
        ex,
        settlementNetwork,
        settlementTxHash,
        transferIndex,
      ),
    listEventsForPayment: (context, paymentId) =>
      listPaymentEventsForPaymentPostgres(ex, context, paymentId),
  };
}

export function createSqlitePaymentsProjectionRepository(db: WaiaDb): PaymentsProjectionRepository {
  return {
    upsertProjection: (context, projection) =>
      Promise.resolve(upsertPaymentProjectionSqlite(db, context, projection)),
    getByPaymentId: (context, paymentId) =>
      Promise.resolve(getPaymentProjectionByIdSqlite(db, context, paymentId)),
    listPayments: (context, query) =>
      Promise.resolve(listPaymentProjectionsSqlite(db, context, query)),
    deleteAllForOrg: (context) =>
      Promise.resolve(deleteAllPaymentProjectionsForOrgSqlite(db, context)),
    deleteByPaymentId: (context, paymentId) =>
      Promise.resolve(deletePaymentProjectionByIdSqlite(db, context, paymentId)),
  };
}

export function createPostgresPaymentsProjectionRepository(
  ex: PgPaymentsProjectionExecutor,
): PaymentsProjectionRepository {
  return {
    upsertProjection: (context, projection) =>
      upsertPaymentProjectionPostgres(ex, context, projection),
    getByPaymentId: (context, paymentId) =>
      getPaymentProjectionByIdPostgres(ex, context, paymentId),
    listPayments: (context, query) => listPaymentProjectionsPostgres(ex, context, query),
    deleteAllForOrg: (context) => deleteAllPaymentProjectionsForOrgPostgres(ex, context),
    deleteByPaymentId: (context, paymentId) =>
      deletePaymentProjectionByIdPostgres(ex, context, paymentId),
  };
}

export {
  findPaymentEventByIdempotencyKeySqlite,
  findPaymentEventBySettlementAttributionSqlite,
  insertPaymentEventSqlite,
  listPaymentEventsForPaymentSqlite,
  listPaymentEventsSqlite,
  deleteAllPaymentProjectionsForOrgSqlite,
  deletePaymentProjectionByIdSqlite,
  getPaymentProjectionByIdSqlite,
  listPaymentProjectionsSqlite,
  upsertPaymentProjectionSqlite,
};
