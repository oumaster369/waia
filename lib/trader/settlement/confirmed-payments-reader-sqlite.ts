import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import * as sqliteSchema from "@/db/schema";
import type { ConfirmedPaymentsReader } from "@/lib/trader/settlement/confirmed-payments-reader.port";
import type { ConfirmedPaymentForSettlement } from "@/lib/trader/settlement/settlement.types";

const DEFAULT_LIMIT = 50;

type SqliteReaderDb = Pick<WaiaDb, "select">;

function enrichPayment(db: SqliteReaderDb, payment: typeof sqliteSchema.payments.$inferSelect) {
  const genesis = db
    .select()
    .from(sqliteSchema.paymentEvents)
    .where(
      and(
        eq(sqliteSchema.paymentEvents.paymentId, payment.paymentId),
        eq(sqliteSchema.paymentEvents.seq, 1),
      ),
    )
    .get();

  const confirmed = db
    .select()
    .from(sqliteSchema.paymentEvents)
    .where(
      and(
        eq(sqliteSchema.paymentEvents.paymentId, payment.paymentId),
        eq(sqliteSchema.paymentEvents.eventType, "CONFIRMED"),
      ),
    )
    .get();

  const address = genesis?.paymentAddressId
    ? db
        .select()
        .from(sqliteSchema.paymentAddresses)
        .where(eq(sqliteSchema.paymentAddresses.addressId, genesis.paymentAddressId))
        .get()
    : null;

  return {
    paymentId: payment.paymentId,
    organizationId: payment.organizationId,
    subjectModule: payment.subjectModule,
    settlementNetwork: payment.settlementNetwork,
    settlementAsset: payment.settlementAsset,
    settlementAmount: payment.settlementAmount,
    settlementTxHash: payment.settlementTxHash,
    transferIndex: payment.transferIndex,
    blockHeight: confirmed?.blockHeight ?? null,
    paymentAddressId: genesis?.paymentAddressId ?? null,
    exchangeAccountId: address?.subjectRef ?? null,
    updatedAt: payment.updatedAt,
  } satisfies ConfirmedPaymentForSettlement;
}

export function listUnsettledConfirmedTraderPaymentsSqlite(
  db: SqliteReaderDb,
  limit: number = DEFAULT_LIMIT,
): ConfirmedPaymentForSettlement[] {
  const payments = db
    .select()
    .from(sqliteSchema.payments)
    .leftJoin(
      sqliteSchema.traderSettlements,
      eq(sqliteSchema.traderSettlements.paymentId, sqliteSchema.payments.paymentId),
    )
    .where(
      and(
        eq(sqliteSchema.payments.status, "CONFIRMED"),
        eq(sqliteSchema.payments.subjectModule, "trader"),
        isNull(sqliteSchema.traderSettlements.id),
      ),
    )
    .orderBy(asc(sqliteSchema.payments.updatedAt))
    .limit(limit)
    .all();

  return payments.map((row) => enrichPayment(db, row.payments));
}

export function countUnsettledConfirmedTraderPaymentsSqlite(db: SqliteReaderDb): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(sqliteSchema.payments)
    .leftJoin(
      sqliteSchema.traderSettlements,
      eq(sqliteSchema.traderSettlements.paymentId, sqliteSchema.payments.paymentId),
    )
    .where(
      and(
        eq(sqliteSchema.payments.status, "CONFIRMED"),
        eq(sqliteSchema.payments.subjectModule, "trader"),
        isNull(sqliteSchema.traderSettlements.id),
      ),
    )
    .get();
  return row?.count ?? 0;
}

export function countExceptionSettlementsSqlite(db: SqliteReaderDb): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(sqliteSchema.traderSettlements)
    .where(eq(sqliteSchema.traderSettlements.outcome, "EXCEPTION"))
    .get();
  return row?.count ?? 0;
}

export function createSqliteConfirmedPaymentsReader(db: SqliteReaderDb): ConfirmedPaymentsReader {
  return {
    listUnsettledConfirmedTraderPayments(limit) {
      return Promise.resolve(listUnsettledConfirmedTraderPaymentsSqlite(db, limit));
    },
    countUnsettledConfirmedTraderPayments() {
      return Promise.resolve(countUnsettledConfirmedTraderPaymentsSqlite(db));
    },
    countExceptionSettlements() {
      return Promise.resolve(countExceptionSettlementsSqlite(db));
    },
  };
}
