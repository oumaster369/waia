import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, eq, isNotNull, lt, notExists } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import * as sqliteSchema from "@/db/schema";
import type { OverdueInvoicesReader } from "@/lib/trader/settlement/overdue-invoices-reader.port";

const DEFAULT_LIMIT = 50;

type SqliteReaderDb = Pick<WaiaDb, "select">;

function overdueThreshold(asOf: Date, gracePeriodMs: number): Date {
  return new Date(asOf.getTime() - gracePeriodMs);
}

export function listOverdueIssuedInvoicesSqlite(
  db: SqliteReaderDb,
  asOf: Date,
  gracePeriodMs: number,
  limit: number = DEFAULT_LIMIT,
) {
  const threshold = overdueThreshold(asOf, gracePeriodMs);
  return db
    .select({
      id: sqliteSchema.traderInvoices.id,
      organizationId: sqliteSchema.traderInvoices.organizationId,
      exchangeAccountId: sqliteSchema.traderInvoices.exchangeAccountId,
      issuedAt: sqliteSchema.traderInvoices.issuedAt,
    })
    .from(sqliteSchema.traderInvoices)
    .where(
      and(
        eq(sqliteSchema.traderInvoices.status, "ISSUED"),
        isNotNull(sqliteSchema.traderInvoices.issuedAt),
        lt(sqliteSchema.traderInvoices.issuedAt, threshold),
        notExists(
          db
            .select({ id: sqliteSchema.traderInvoiceDisputes.id })
            .from(sqliteSchema.traderInvoiceDisputes)
            .where(
              and(
                eq(sqliteSchema.traderInvoiceDisputes.invoiceId, sqliteSchema.traderInvoices.id),
                eq(
                  sqliteSchema.traderInvoiceDisputes.organizationId,
                  sqliteSchema.traderInvoices.organizationId,
                ),
                eq(sqliteSchema.traderInvoiceDisputes.status, "OPEN"),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(sqliteSchema.traderInvoices.issuedAt))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      exchangeAccountId: row.exchangeAccountId,
      issuedAt: row.issuedAt!,
    }));
}

export function countOverdueIssuedInvoicesSqlite(
  db: SqliteReaderDb,
  asOf: Date,
  gracePeriodMs: number,
): number {
  const threshold = overdueThreshold(asOf, gracePeriodMs);
  const rows = db
    .select({ id: sqliteSchema.traderInvoices.id })
    .from(sqliteSchema.traderInvoices)
    .where(
      and(
        eq(sqliteSchema.traderInvoices.status, "ISSUED"),
        isNotNull(sqliteSchema.traderInvoices.issuedAt),
        lt(sqliteSchema.traderInvoices.issuedAt, threshold),
        notExists(
          db
            .select({ id: sqliteSchema.traderInvoiceDisputes.id })
            .from(sqliteSchema.traderInvoiceDisputes)
            .where(
              and(
                eq(sqliteSchema.traderInvoiceDisputes.invoiceId, sqliteSchema.traderInvoices.id),
                eq(
                  sqliteSchema.traderInvoiceDisputes.organizationId,
                  sqliteSchema.traderInvoices.organizationId,
                ),
                eq(sqliteSchema.traderInvoiceDisputes.status, "OPEN"),
              ),
            ),
        ),
      ),
    )
    .all();
  return rows.length;
}

export function createSqliteOverdueInvoicesReader(db: SqliteReaderDb): OverdueInvoicesReader {
  return {
    listOverdueIssuedInvoices(asOf, gracePeriodMs, limit) {
      return Promise.resolve(
        listOverdueIssuedInvoicesSqlite(db, asOf, gracePeriodMs, limit ?? DEFAULT_LIMIT),
      );
    },
    countOverdueIssuedInvoices(asOf, gracePeriodMs) {
      return Promise.resolve(countOverdueIssuedInvoicesSqlite(db, asOf, gracePeriodMs));
    },
  };
}
