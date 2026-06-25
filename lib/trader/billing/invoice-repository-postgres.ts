import "server-only";

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import type { InsertInvoiceRepoInput } from "@/lib/trader/billing/invoice-repository.types";
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

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapSelectRow(row: typeof pgSchema.traderInvoices.$inferSelect): InvoiceRecordView {
  return mapInvoiceRow(row);
}

function isPgUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "23505";
  }
  return isUniqueConstraintError(error);
}

export async function insertInvoicePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: InsertInvoiceRepoInput,
): Promise<InvoiceRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();
  const { payload } = input;

  await ex
    .insert(pgSchema.traderInvoices)
    .values(invoicePayloadToInsertValues(id, scoped.organizationId, payload, now, now));

  const rows = await ex
    .select()
    .from(pgSchema.traderInvoices)
    .where(
      and(
        eq(pgSchema.traderInvoices.id, id),
        orgScopedWhere(pgSchema.traderInvoices.organizationId, scoped),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error("[trader] invoice insert failed");
  }
  return mapSelectRow(row);
}

export async function findInvoiceByReportingPeriodPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  exchangeAccountId: string,
  reportingPeriodId: string,
): Promise<InvoiceRecordView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.traderInvoices)
    .where(
      and(
        orgScopedWhere(pgSchema.traderInvoices.organizationId, scoped),
        eq(pgSchema.traderInvoices.exchangeAccountId, exchangeAccountId),
        eq(pgSchema.traderInvoices.reportingPeriodId, reportingPeriodId),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? mapSelectRow(row) : null;
}

export async function getInvoiceByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  id: string,
): Promise<InvoiceRecordView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.traderInvoices)
    .where(
      and(
        eq(pgSchema.traderInvoices.id, id),
        orgScopedWhere(pgSchema.traderInvoices.organizationId, scoped),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? mapSelectRow(row) : null;
}

export function insertInvoicePostgresTx(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: InsertInvoiceRepoInput,
): Promise<InvoiceRecordView> {
  return runWaiaPostgresTransaction(db, (tx) => insertInvoicePostgres(tx, context, input));
}

export function isInvoicePgUniqueViolation(error: unknown): boolean {
  return isPgUniqueViolation(error);
}

export async function listInvoicesByAccountPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  exchangeAccountId: string,
): Promise<InvoiceRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.traderInvoices)
    .where(
      and(
        orgScopedWhere(pgSchema.traderInvoices.organizationId, scoped),
        eq(pgSchema.traderInvoices.exchangeAccountId, exchangeAccountId),
      ),
    )
    .orderBy(desc(pgSchema.traderInvoices.createdAt), desc(pgSchema.traderInvoices.id));

  return rows.map(mapSelectRow);
}
