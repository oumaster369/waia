import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { InvoiceRepository } from "@/lib/trader/billing/invoice-repository.types";
import {
  findInvoiceByReportingPeriodPostgres,
  getInvoiceByIdPostgres,
  insertInvoicePostgres,
  insertInvoicePostgresTx,
} from "@/lib/trader/billing/invoice-repository-postgres";
import {
  findInvoiceByReportingPeriodSqlite,
  getInvoiceByIdSqlite,
  insertInvoiceSqlite,
  insertInvoiceSqliteTx,
  listInvoicesByAccountSqlite,
} from "@/lib/trader/billing/invoice-repository-sqlite";

type PgInvoiceExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqliteInvoiceRepository(db: WaiaDb): InvoiceRepository {
  return {
    insertInvoice: (context, input) => insertInvoiceSqliteTx(db, context, input),
    findByReportingPeriod: (context, exchangeAccountId, reportingPeriodId) =>
      findInvoiceByReportingPeriodSqlite(db, context, exchangeAccountId, reportingPeriodId),
    getById: (context, id) => getInvoiceByIdSqlite(db, context, id),
  };
}

export function createPostgresInvoiceRepository(
  ex: PgInvoiceExecutor,
  db?: WaiaPostgresDb,
): InvoiceRepository {
  return {
    insertInvoice: (context, input) => {
      if (db) {
        return insertInvoicePostgresTx(db, context, input);
      }
      return insertInvoicePostgres(ex, context, input);
    },
    findByReportingPeriod: (context, exchangeAccountId, reportingPeriodId) =>
      findInvoiceByReportingPeriodPostgres(ex, context, exchangeAccountId, reportingPeriodId),
    getById: (context, id) => getInvoiceByIdPostgres(ex, context, id),
  };
}

/** Expose non-transactional sqlite helpers for tests that manage their own transactions. */
export {
  findInvoiceByReportingPeriodSqlite,
  getInvoiceByIdSqlite,
  insertInvoiceSqlite,
  listInvoicesByAccountSqlite,
};
