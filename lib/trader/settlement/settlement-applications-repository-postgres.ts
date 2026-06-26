import "server-only";

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { verifySettlementApplicationDigest } from "@/lib/trader/settlement/serialize-settlement";
import type { SettlementApplicationsRepository } from "@/lib/trader/settlement/settlements-repository.types";
import type {
  SettlementApplicationRecordPayload,
  SettlementApplicationRecordView,
} from "@/lib/trader/settlement/settlement.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapRow(
  row: typeof pgSchema.traderSettlementApplications.$inferSelect,
): SettlementApplicationRecordView {
  const view: SettlementApplicationRecordView = {
    id: row.id,
    schemaVersion: row.schemaVersion as SettlementApplicationRecordView["schemaVersion"],
    settlementId: row.settlementId,
    organizationId: row.organizationId,
    invoiceId: row.invoiceId,
    appliedAmount: row.appliedAmount,
    invoiceStatusAfter:
      row.invoiceStatusAfter as SettlementApplicationRecordView["invoiceStatusAfter"],
    recordContentDigest: row.recordContentDigest,
    createdAt: row.createdAt,
  };
  verifySettlementApplicationDigest(view);
  return view;
}

export async function insertSettlementApplicationPostgres(
  ex: PgExecutor,
  context: OrgContext,
  payload: SettlementApplicationRecordPayload,
): Promise<SettlementApplicationRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  verifySettlementApplicationDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  await ex.insert(pgSchema.traderSettlementApplications).values({
    id,
    settlementId: payload.settlementId,
    organizationId: scoped.organizationId,
    invoiceId: payload.invoiceId,
    appliedAmount: payload.appliedAmount,
    invoiceStatusAfter: payload.invoiceStatusAfter,
    schemaVersion: payload.schemaVersion,
    recordContentDigest: payload.recordContentDigest,
    createdAt: now,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderSettlementApplications)
    .where(eq(pgSchema.traderSettlementApplications.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("[trader/settlement] settlement application insert failed");
  }
  return mapRow(row);
}

export async function listSettlementApplicationsBySettlementIdPostgres(
  ex: PgExecutor,
  context: OrgContext,
  settlementId: string,
): Promise<SettlementApplicationRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderSettlementApplications)
    .where(
      and(
        eq(pgSchema.traderSettlementApplications.settlementId, settlementId),
        orgScopedWhere(pgSchema.traderSettlementApplications.organizationId, scoped),
      ),
    );
  return rows.map(mapRow);
}

export function createPostgresSettlementApplicationsRepository(
  ex: PgExecutor,
): SettlementApplicationsRepository {
  return {
    insertApplication(context, payload) {
      return insertSettlementApplicationPostgres(ex, context, payload);
    },
    listBySettlementId(context, settlementId) {
      return listSettlementApplicationsBySettlementIdPostgres(ex, context, settlementId);
    },
  };
}
