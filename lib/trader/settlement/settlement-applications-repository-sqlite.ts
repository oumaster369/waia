import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import * as sqliteSchema from "@/db/schema";
import { ReconciliationApplicationAlreadyExistsError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import { isUniqueConstraintError } from "@/lib/trader/execution/order-repository.types";
import { verifySettlementApplicationDigest } from "@/lib/trader/settlement/serialize-settlement";
import type { InsertSettlementApplicationInput } from "@/lib/trader/settlement/settlements-repository.types";
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

function isApplicationUniqueViolation(error: unknown): boolean {
  if (error instanceof ReconciliationApplicationAlreadyExistsError) {
    return true;
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: string }).code;
    if (code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE") {
      return true;
    }
  }
  if (isUniqueConstraintError(error)) {
    return true;
  }
  if (error && typeof error === "object" && "message" in error) {
    return /UNIQUE constraint failed/i.test(String((error as { message: unknown }).message));
  }
  return false;
}

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
  input: InsertSettlementApplicationInput,
): SettlementApplicationRecordView {
  const scoped = requireOrgContext(context.organizationId);
  const payload = input.payload;
  verifySettlementApplicationDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  try {
    db.insert(sqliteSchema.traderSettlementApplications)
      .values({
        id,
        settlementId: payload.settlementId,
        organizationId: scoped.organizationId,
        invoiceId: payload.invoiceId,
        appliedAmount: payload.appliedAmount,
        invoiceStatusAfter: payload.invoiceStatusAfter,
        applicationSource: input.applicationSource ?? "AUTO",
        reconciliationCaseId: input.reconciliationCaseId ?? null,
        decisionId: input.decisionId ?? null,
        schemaVersion: payload.schemaVersion,
        recordContentDigest: payload.recordContentDigest,
        createdAt: now,
      })
      .run();
  } catch (error) {
    if (isApplicationUniqueViolation(error)) {
      throw new ReconciliationApplicationAlreadyExistsError(payload.settlementId);
    }
    throw error;
  }

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
    insertApplication(context, input) {
      return Promise.resolve(insertSettlementApplicationSqlite(db, context, input));
    },
    listBySettlementId(context, settlementId) {
      return Promise.resolve(
        listSettlementApplicationsBySettlementIdSqlite(db, context, settlementId),
      );
    },
  };
}

/** @deprecated use InsertSettlementApplicationInput */
export type LegacySettlementApplicationInsert = SettlementApplicationRecordPayload;
