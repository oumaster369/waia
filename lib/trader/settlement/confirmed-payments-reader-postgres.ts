import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { ConfirmedPaymentsReader } from "@/lib/trader/settlement/confirmed-payments-reader.port";
import type { ConfirmedPaymentForSettlement } from "@/lib/trader/settlement/settlement.types";

type PgReaderExecutor = Pick<WaiaPostgresDb, "select">;

const DEFAULT_LIMIT = 50;

function mapRow(row: {
  paymentId: string;
  organizationId: string;
  subjectModule: ConfirmedPaymentForSettlement["subjectModule"];
  settlementNetwork: string | null;
  settlementAsset: string | null;
  settlementAmount: string | null;
  settlementTxHash: string | null;
  transferIndex: number | null;
  blockHeight: string | null;
  paymentAddressId: string | null;
  exchangeAccountId: string | null;
  updatedAt: Date;
}): ConfirmedPaymentForSettlement {
  return {
    paymentId: row.paymentId,
    organizationId: row.organizationId,
    subjectModule: row.subjectModule,
    settlementNetwork: row.settlementNetwork,
    settlementAsset: row.settlementAsset,
    settlementAmount: row.settlementAmount,
    settlementTxHash: row.settlementTxHash,
    transferIndex: row.transferIndex,
    blockHeight: row.blockHeight,
    paymentAddressId: row.paymentAddressId,
    exchangeAccountId: row.exchangeAccountId,
    updatedAt: row.updatedAt,
  };
}

export async function listUnsettledConfirmedTraderPaymentsPostgres(
  ex: PgReaderExecutor,
  limit: number = DEFAULT_LIMIT,
): Promise<ConfirmedPaymentForSettlement[]> {
  const genesis = pgSchema.paymentEvents;
  const confirmedEvent = alias(pgSchema.paymentEvents, "confirmed_event");
  const rows = await ex
    .select({
      paymentId: pgSchema.payments.paymentId,
      organizationId: pgSchema.payments.organizationId,
      subjectModule: pgSchema.payments.subjectModule,
      settlementNetwork: pgSchema.payments.settlementNetwork,
      settlementAsset: pgSchema.payments.settlementAsset,
      settlementAmount: pgSchema.payments.settlementAmount,
      settlementTxHash: pgSchema.payments.settlementTxHash,
      transferIndex: pgSchema.payments.transferIndex,
      blockHeight: confirmedEvent.blockHeight,
      paymentAddressId: genesis.paymentAddressId,
      exchangeAccountId: pgSchema.paymentAddresses.subjectRef,
      updatedAt: pgSchema.payments.updatedAt,
    })
    .from(pgSchema.payments)
    .leftJoin(
      pgSchema.traderSettlements,
      eq(pgSchema.traderSettlements.paymentId, pgSchema.payments.paymentId),
    )
    .innerJoin(genesis, and(eq(genesis.paymentId, pgSchema.payments.paymentId), eq(genesis.seq, 1)))
    .leftJoin(
      confirmedEvent,
      and(
        eq(confirmedEvent.paymentId, pgSchema.payments.paymentId),
        eq(confirmedEvent.eventType, "CONFIRMED"),
      ),
    )
    .leftJoin(
      pgSchema.paymentAddresses,
      eq(pgSchema.paymentAddresses.addressId, genesis.paymentAddressId),
    )
    .where(
      and(
        eq(pgSchema.payments.status, "CONFIRMED"),
        eq(pgSchema.payments.subjectModule, "trader"),
        isNull(pgSchema.traderSettlements.id),
      ),
    )
    .orderBy(asc(pgSchema.payments.updatedAt))
    .limit(limit);

  return rows.map(mapRow);
}

export async function countUnsettledConfirmedTraderPaymentsPostgres(
  ex: PgReaderExecutor,
): Promise<number> {
  const rows = await ex
    .select({ count: sql<number>`count(*)::int` })
    .from(pgSchema.payments)
    .leftJoin(
      pgSchema.traderSettlements,
      eq(pgSchema.traderSettlements.paymentId, pgSchema.payments.paymentId),
    )
    .where(
      and(
        eq(pgSchema.payments.status, "CONFIRMED"),
        eq(pgSchema.payments.subjectModule, "trader"),
        isNull(pgSchema.traderSettlements.id),
      ),
    );
  return rows[0]?.count ?? 0;
}

export async function countExceptionSettlementsPostgres(ex: PgReaderExecutor): Promise<number> {
  const rows = await ex
    .select({ count: sql<number>`count(*)::int` })
    .from(pgSchema.traderSettlements)
    .where(eq(pgSchema.traderSettlements.outcome, "EXCEPTION"));
  return rows[0]?.count ?? 0;
}

export function createPostgresConfirmedPaymentsReader(
  ex: PgReaderExecutor,
): ConfirmedPaymentsReader {
  return {
    listUnsettledConfirmedTraderPayments(limit) {
      return listUnsettledConfirmedTraderPaymentsPostgres(ex, limit);
    },
    countUnsettledConfirmedTraderPayments() {
      return countUnsettledConfirmedTraderPaymentsPostgres(ex);
    },
    countExceptionSettlements() {
      return countExceptionSettlementsPostgres(ex);
    },
  };
}
