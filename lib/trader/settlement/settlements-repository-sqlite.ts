import "server-only";

import { eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import * as sqliteSchema from "@/db/schema";
import { verifySettlementRecordDigest } from "@/lib/trader/settlement/serialize-settlement";
import type { SettlementsRepository } from "@/lib/trader/settlement/settlements-repository.types";
import type {
  SettlementRecordPayload,
  SettlementRecordView,
} from "@/lib/trader/settlement/settlement.types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type SqliteDb = Pick<WaiaDb, "select" | "insert">;

function mapRow(row: typeof sqliteSchema.traderSettlements.$inferSelect): SettlementRecordView {
  const view: SettlementRecordView = {
    id: row.id,
    schemaVersion: row.schemaVersion as SettlementRecordView["schemaVersion"],
    organizationId: row.organizationId,
    exchangeAccountId: row.exchangeAccountId,
    paymentId: row.paymentId,
    settlementNetwork: row.settlementNetwork,
    settlementTxHash: row.settlementTxHash,
    transferIndex: row.transferIndex,
    blockHeight: row.blockHeight,
    asset: row.asset,
    onChainAmount: row.onChainAmount,
    valuedAmount: row.valuedAmount,
    valuationCurrency: row.valuationCurrency,
    valuationBasis: row.valuationBasis,
    outcome: row.outcome,
    exceptionReason: row.exceptionReason,
    prevEventDigest: row.prevEventDigest,
    recordContentDigest: row.recordContentDigest,
    createdAt: row.createdAt,
  };
  verifySettlementRecordDigest(view);
  return view;
}

export function findSettlementByPaymentIdSqlite(
  db: SqliteDb,
  paymentId: string,
): SettlementRecordView | null {
  const row = db
    .select()
    .from(sqliteSchema.traderSettlements)
    .where(eq(sqliteSchema.traderSettlements.paymentId, paymentId))
    .get();
  return row ? mapRow(row) : null;
}

export function insertSettlementSqlite(
  db: SqliteDb,
  context: OrgContext,
  payload: SettlementRecordPayload,
): SettlementRecordView {
  const scoped = requireOrgContext(context.organizationId);
  verifySettlementRecordDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(sqliteSchema.traderSettlements)
    .values({
      id,
      organizationId: scoped.organizationId,
      exchangeAccountId: payload.exchangeAccountId,
      paymentId: payload.paymentId,
      settlementNetwork: payload.settlementNetwork,
      settlementTxHash: payload.settlementTxHash,
      transferIndex: payload.transferIndex,
      blockHeight: payload.blockHeight,
      asset: payload.asset,
      onChainAmount: payload.onChainAmount,
      valuedAmount: payload.valuedAmount,
      valuationCurrency: payload.valuationCurrency,
      valuationBasis: payload.valuationBasis,
      outcome: payload.outcome,
      exceptionReason: payload.exceptionReason,
      schemaVersion: payload.schemaVersion,
      recordContentDigest: payload.recordContentDigest,
      prevEventDigest: payload.prevEventDigest,
      createdAt: now,
    })
    .run();

  const row = db
    .select()
    .from(sqliteSchema.traderSettlements)
    .where(eq(sqliteSchema.traderSettlements.id, id))
    .get();
  if (!row) {
    throw new Error("[trader/settlement] settlement insert failed");
  }
  return mapRow(row);
}

export function createSqliteSettlementsRepository(db: SqliteDb): SettlementsRepository {
  return {
    findByPaymentId(paymentId) {
      return Promise.resolve(findSettlementByPaymentIdSqlite(db, paymentId));
    },
    insertSettlement(context, payload) {
      return (async () => insertSettlementSqlite(db, context, payload))();
    },
  };
}
