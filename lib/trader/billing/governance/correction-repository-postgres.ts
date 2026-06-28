import "server-only";

import { and, asc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
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

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapCorrectionRow(
  row: typeof pgSchema.traderInvoiceCorrections.$inferSelect,
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

export async function insertInvoiceCorrectionPostgres(
  ex: PgExecutor,
  context: OrgContext,
  payload: InvoiceCorrectionRecordPayload,
): Promise<InvoiceCorrectionRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  verifyInvoiceCorrectionDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  await ex.insert(pgSchema.traderInvoiceCorrections).values({
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
    actorType: payload.actorType as typeof pgSchema.traderInvoiceCorrections.$inferInsert.actorType,
    actorId: payload.actorId,
    schemaVersion: payload.schemaVersion,
    recordContentDigest: payload.recordContentDigest,
    createdAt: now,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderInvoiceCorrections)
    .where(eq(pgSchema.traderInvoiceCorrections.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("[trader/billing] invoice correction insert failed");
  }
  return mapCorrectionRow(row);
}

export async function listInvoiceCorrectionsForInvoicePostgres(
  ex: PgExecutor,
  context: OrgContext,
  invoiceId: string,
): Promise<InvoiceCorrectionRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderInvoiceCorrections)
    .where(
      and(
        orgScopedWhere(pgSchema.traderInvoiceCorrections.organizationId, scoped),
        eq(pgSchema.traderInvoiceCorrections.invoiceId, invoiceId),
      ),
    )
    .orderBy(asc(pgSchema.traderInvoiceCorrections.createdAt));
  return rows.map(mapCorrectionRow);
}

export function createPostgresInvoiceCorrectionRepository(
  ex: PgExecutor,
): InvoiceCorrectionRepository {
  return {
    insertCorrection(context, payload) {
      return insertInvoiceCorrectionPostgres(ex, context, payload);
    },
    listCorrectionsForInvoice(context, invoiceId) {
      return listInvoiceCorrectionsForInvoicePostgres(ex, context, invoiceId);
    },
  };
}
