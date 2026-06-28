import "server-only";

import { and, asc, count, eq, isNotNull, lt } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { OverdueInvoicesReader } from "@/lib/trader/settlement/overdue-invoices-reader.port";

type PgReaderExecutor = Pick<WaiaPostgresDb, "select">;

const DEFAULT_LIMIT = 50;

function overdueThreshold(asOf: Date, gracePeriodMs: number): Date {
  return new Date(asOf.getTime() - gracePeriodMs);
}

export async function listOverdueIssuedInvoicesPostgres(
  ex: PgReaderExecutor,
  asOf: Date,
  gracePeriodMs: number,
  limit: number = DEFAULT_LIMIT,
) {
  const threshold = overdueThreshold(asOf, gracePeriodMs);
  const rows = await ex
    .select({
      id: pgSchema.traderInvoices.id,
      organizationId: pgSchema.traderInvoices.organizationId,
      exchangeAccountId: pgSchema.traderInvoices.exchangeAccountId,
      issuedAt: pgSchema.traderInvoices.issuedAt,
    })
    .from(pgSchema.traderInvoices)
    .where(
      and(
        eq(pgSchema.traderInvoices.status, "ISSUED"),
        isNotNull(pgSchema.traderInvoices.issuedAt),
        lt(pgSchema.traderInvoices.issuedAt, threshold),
      ),
    )
    .orderBy(asc(pgSchema.traderInvoices.issuedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    exchangeAccountId: row.exchangeAccountId,
    issuedAt: row.issuedAt!,
  }));
}

export async function countOverdueIssuedInvoicesPostgres(
  ex: PgReaderExecutor,
  asOf: Date,
  gracePeriodMs: number,
): Promise<number> {
  const threshold = overdueThreshold(asOf, gracePeriodMs);
  const rows = await ex
    .select({ value: count() })
    .from(pgSchema.traderInvoices)
    .where(
      and(
        eq(pgSchema.traderInvoices.status, "ISSUED"),
        isNotNull(pgSchema.traderInvoices.issuedAt),
        lt(pgSchema.traderInvoices.issuedAt, threshold),
      ),
    );
  return Number(rows[0]?.value ?? 0);
}

export function createPostgresOverdueInvoicesReader(ex: PgReaderExecutor): OverdueInvoicesReader {
  return {
    listOverdueIssuedInvoices(asOf, gracePeriodMs, limit) {
      return listOverdueIssuedInvoicesPostgres(ex, asOf, gracePeriodMs, limit ?? DEFAULT_LIMIT);
    },
    countOverdueIssuedInvoices(asOf, gracePeriodMs) {
      return countOverdueIssuedInvoicesPostgres(ex, asOf, gracePeriodMs);
    },
  };
}
