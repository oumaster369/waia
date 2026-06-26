import "server-only";

import { and, eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import * as sqliteSchema from "@/db/schema";
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

type SqliteDb = Pick<WaiaDb, "select" | "insert">;

function mapRow(
  row: typeof sqliteSchema.traderSettlementApplications.$inferSelect,
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

export function insertSettlementApplicationSqlite(
  db: SqliteDb,
  context: OrgContext,
  payload: SettlementApplicationRecordPayload,
): SettlementApplicationRecordView {
  const scoped = requireOrgContext(context.organizationId);
  verifySettlementApplicationDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(sqliteSchema.traderSettlementApplications)
    .values({
      id,
      settlementId: payload.settlementId,
      organizationId: scoped.organizationId,
      invoiceId: payload.invoiceId,
      appliedAmount: payload.appliedAmount,
      invoiceStatusAfter: payload.invoiceStatusAfter,
      schemaVersion: payload.schemaVersion,
      recordContentDigest: payload.recordContentDigest,
      createdAt: now,
    })
    .run();

  const row = db
    .select()
    .from(sqliteSchema.traderSettlementApplications)
    .where(eq(sqliteSchema.traderSettlementApplications.id, id))
    .get();
  if (!row) {
    throw new Error("[trader/settlement] settlement application insert failed");
  }
  return mapRow(row);
}

export function listSettlementApplicationsBySettlementIdSqlite(
  db: SqliteDb,
  context: OrgContext,
  settlementId: string,
): SettlementApplicationRecordView[] {
  const scoped = requireOrgContext(context.organizationId);
  const rows = db
    .select()
    .from(sqliteSchema.traderSettlementApplications)
    .where(
      and(
        eq(sqliteSchema.traderSettlementApplications.settlementId, settlementId),
        orgScopedWhere(sqliteSchema.traderSettlementApplications.organizationId, scoped),
      ),
    )
    .all();
  return rows.map(mapRow);
}

export function createSqliteSettlementApplicationsRepository(
  db: SqliteDb,
): SettlementApplicationsRepository {
  return {
    insertApplication(context, payload) {
      return Promise.resolve(insertSettlementApplicationSqlite(db, context, payload));
    },
    listBySettlementId(context, settlementId) {
      return Promise.resolve(
        listSettlementApplicationsBySettlementIdSqlite(db, context, settlementId),
      );
    },
  };
}
