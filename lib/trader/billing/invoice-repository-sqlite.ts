import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { traderInvoices } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { runSqliteTransaction } from "@/db/types";
import type {
  InsertInvoiceRepoInput,
  SetIssuanceApprovalMetadataInput,
  ClearIssuanceApprovalMetadataInput,
} from "@/lib/trader/billing/invoice-repository.types";
import {
  invoicePayloadToInsertValues,
  mapInvoiceRow,
} from "@/lib/trader/billing/invoice-row-mapper";
import type { InvoiceRecordView } from "@/lib/trader/billing/invoice.types";
import { isUniqueConstraintError } from "@/lib/trader/execution/order-repository.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapSelectRow(row: typeof traderInvoices.$inferSelect): InvoiceRecordView {
  return mapInvoiceRow(row);
}

export function insertInvoiceSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: InsertInvoiceRepoInput,
): InvoiceRecordView {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();
  const { payload } = input;

  db.insert(traderInvoices)
    .values(invoicePayloadToInsertValues(id, scoped.organizationId, payload, now, now))
    .run();

  const row = db
    .select()
    .from(traderInvoices)
    .where(and(eq(traderInvoices.id, id), orgScopedWhere(traderInvoices.organizationId, scoped)))
    .limit(1)
    .all()[0];

  if (!row) {
    throw new Error("[trader] invoice insert failed");
  }
  return mapSelectRow(row);
}

export function findInvoiceByReportingPeriodSqlite(
  db: WaiaDb,
  context: OrgContext,
  exchangeAccountId: string,
  reportingPeriodId: string,
): InvoiceRecordView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(traderInvoices)
    .where(
      and(
        orgScopedWhere(traderInvoices.organizationId, scoped),
        eq(traderInvoices.exchangeAccountId, exchangeAccountId),
        eq(traderInvoices.reportingPeriodId, reportingPeriodId),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function getInvoiceByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  id: string,
): InvoiceRecordView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(traderInvoices)
    .where(and(eq(traderInvoices.id, id), orgScopedWhere(traderInvoices.organizationId, scoped)))
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function setIssuanceApprovalMetadataSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: SetIssuanceApprovalMetadataInput,
): InvoiceRecordView {
  const scoped = requireOrgContext(context.organizationId);
  const now = new Date();

  const updated = db
    .update(traderInvoices)
    .set({
      issuanceApprovedAt: input.issuanceApprovedAt,
      issuanceApprovedBy: input.issuanceApprovedBy,
      coolingOffUntil: input.coolingOffUntil,
      updatedAt: now,
    })
    .where(
      and(
        eq(traderInvoices.id, input.invoiceId),
        orgScopedWhere(traderInvoices.organizationId, scoped),
        eq(traderInvoices.status, "DRAFT"),
      ),
    )
    .run();

  if (updated.changes === 0) {
    const existing = getInvoiceByIdSqlite(db, context, input.invoiceId);
    if (!existing) {
      throw new Error("[trader] invoice not found for approval metadata update");
    }
    if (existing.status === "ISSUED") {
      throw new Error("[trader] cannot approve issuance for an already-issued invoice");
    }
    throw new Error("[trader] invoice approval metadata update failed");
  }

  const row = getInvoiceByIdSqlite(db, context, input.invoiceId);
  if (!row) {
    throw new Error("[trader] invoice not found after approval metadata update");
  }
  return row;
}

export function clearIssuanceApprovalMetadataSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: ClearIssuanceApprovalMetadataInput,
): InvoiceRecordView {
  const scoped = requireOrgContext(context.organizationId);
  const now = new Date();

  db.update(traderInvoices)
    .set({
      issuanceApprovedAt: null,
      issuanceApprovedBy: null,
      coolingOffUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(traderInvoices.id, input.invoiceId),
        orgScopedWhere(traderInvoices.organizationId, scoped),
      ),
    )
    .run();

  const row = getInvoiceByIdSqlite(db, context, input.invoiceId);
  if (!row) {
    throw new Error("[trader] invoice not found after clearing approval metadata");
  }
  return row;
}

export function insertInvoiceSqliteTx(
  db: WaiaDb,
  context: OrgContext,
  input: InsertInvoiceRepoInput,
): Promise<InvoiceRecordView> {
  return runSqliteTransaction(db, (tx) => insertInvoiceSqlite(tx, context, input));
}

export function isInvoiceUniqueConstraintError(error: unknown): boolean {
  return isUniqueConstraintError(error);
}

export function listInvoicesByAccountSqlite(
  db: WaiaDb,
  context: OrgContext,
  exchangeAccountId: string,
): InvoiceRecordView[] {
  const scoped = requireOrgContext(context.organizationId);

  return db
    .select()
    .from(traderInvoices)
    .where(
      and(
        orgScopedWhere(traderInvoices.organizationId, scoped),
        eq(traderInvoices.exchangeAccountId, exchangeAccountId),
      ),
    )
    .orderBy(desc(traderInvoices.createdAt), desc(traderInvoices.id))
    .all()
    .map(mapSelectRow);
}
