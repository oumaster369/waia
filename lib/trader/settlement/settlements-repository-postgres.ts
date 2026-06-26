import "server-only";

import { eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { verifySettlementRecordDigest } from "@/lib/trader/settlement/serialize-settlement";
import type { SettlementsRepository } from "@/lib/trader/settlement/settlements-repository.types";
import type {
  SettlementRecordPayload,
  SettlementRecordView,
} from "@/lib/trader/settlement/settlement.types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapRow(row: typeof pgSchema.traderSettlements.$inferSelect): SettlementRecordView {
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

export async function findSettlementByPaymentIdPostgres(
  ex: PgExecutor,
  paymentId: string,
): Promise<SettlementRecordView | null> {
  const rows = await ex
    .select()
    .from(pgSchema.traderSettlements)
    .where(eq(pgSchema.traderSettlements.paymentId, paymentId))
    .limit(1);
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function insertSettlementPostgres(
  ex: PgExecutor,
  context: OrgContext,
  payload: SettlementRecordPayload,
): Promise<SettlementRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  verifySettlementRecordDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  await ex.insert(pgSchema.traderSettlements).values({
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
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderSettlements)
    .where(eq(pgSchema.traderSettlements.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("[trader/settlement] settlement insert failed");
  }
  return mapRow(row);
}

export function createPostgresSettlementsRepository(ex: PgExecutor): SettlementsRepository {
  return {
    findByPaymentId(paymentId) {
      return findSettlementByPaymentIdPostgres(ex, paymentId);
    },
    insertSettlement(context, payload) {
      return insertSettlementPostgres(ex, context, payload);
    },
  };
}
