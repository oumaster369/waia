import "server-only";

import { and, asc, eq } from "drizzle-orm";

import * as sqliteSchema from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type { InvoiceCorrectionRepository } from "@/lib/trader/billing/governance/correction-repository.types";
import type {
  InvoiceCorrectionRecordPayload,
  InvoiceCorrectionRecordView,
} from "@/lib/trader/billing/governance/billing-governance.types";
import { verifyInvoiceCorrectionDigest } from "@/lib/trader/billing/governance/serialize-invoice-correction";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type SqliteDb = Pick<WaiaDb, "select" | "insert">;

function mapCorrectionRow(
  row: typeof sqliteSchema.traderInvoiceCorrections.$inferSelect,
): InvoiceCorrectionRecordView {
  const view: InvoiceCorrectionRecordView = {
    id: row.id,
    schemaVersion: row.schemaVersion as InvoiceCorrectionRecordView["schemaVersion"],
    organizationId: row.organizationId,
    invoiceId: row.invoiceId,
    disputeId: row.disputeId,
    exchangeAccountId: row.exchangeAccountId,
    reportingPeriodId: row.reportingPeriodId,
    correctionType: row.correctionType,
    amount: row.amount,
    currency: row.currency,
    restoredHwm: row.restoredHwm,
    hwmLedgerEntryId: row.hwmLedgerEntryId,
    reason: row.reason,
    actorType: row.actorType,
    actorId: row.actorId,
    recordContentDigest: row.recordContentDigest,
    createdAt: row.createdAt,
  };
  verifyInvoiceCorrectionDigest(view);
  return view;
}

export function insertInvoiceCorrectionSqlite(
  db: SqliteDb,
  context: OrgContext,
  payload: InvoiceCorrectionRecordPayload,
): InvoiceCorrectionRecordView {
  const scoped = requireOrgContext(context.organizationId);
  verifyInvoiceCorrectionDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(sqliteSchema.traderInvoiceCorrections)
    .values({
      id,
      organizationId: scoped.organizationId,
      invoiceId: payload.invoiceId,
      disputeId: payload.disputeId,
      exchangeAccountId: payload.exchangeAccountId,
      reportingPeriodId: payload.reportingPeriodId,
      correctionType: payload.correctionType,
      amount: payload.amount,
      currency: payload.currency,
      restoredHwm: payload.restoredHwm,
      hwmLedgerEntryId: payload.hwmLedgerEntryId,
      reason: payload.reason,
      actorType:
        payload.actorType as typeof sqliteSchema.traderInvoiceCorrections.$inferInsert.actorType,
      actorId: payload.actorId,
      schemaVersion: payload.schemaVersion,
      recordContentDigest: payload.recordContentDigest,
      createdAt: now,
    })
    .run();

  const row = db
    .select()
    .from(sqliteSchema.traderInvoiceCorrections)
    .where(eq(sqliteSchema.traderInvoiceCorrections.id, id))
    .get();
  if (!row) {
    throw new Error("[trader/billing] invoice correction insert failed");
  }
  return mapCorrectionRow(row);
}

export function listInvoiceCorrectionsForInvoiceSqlite(
  db: SqliteDb,
  context: OrgContext,
  invoiceId: string,
): InvoiceCorrectionRecordView[] {
  const scoped = requireOrgContext(context.organizationId);
  const rows = db
    .select()
    .from(sqliteSchema.traderInvoiceCorrections)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderInvoiceCorrections.organizationId, scoped),
        eq(sqliteSchema.traderInvoiceCorrections.invoiceId, invoiceId),
      ),
    )
    .orderBy(asc(sqliteSchema.traderInvoiceCorrections.createdAt))
    .all();
  return rows.map(mapCorrectionRow);
}

export function createSqliteInvoiceCorrectionRepository(db: SqliteDb): InvoiceCorrectionRepository {
  return {
    insertCorrection(context, payload) {
      return Promise.resolve(insertInvoiceCorrectionSqlite(db, context, payload));
    },
    listCorrectionsForInvoice(context, invoiceId) {
      return Promise.resolve(listInvoiceCorrectionsForInvoiceSqlite(db, context, invoiceId));
    },
  };
}
