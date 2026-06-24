import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { ReportingPeriodRepository } from "@/lib/trader/billing/reporting-period-repository.types";
import {
  closeReportingPeriodPostgres,
  closeReportingPeriodPostgresTx,
  findOpenReportingPeriodPostgres,
  getReportingPeriodByIdPostgres,
  insertOpenReportingPeriodPostgres,
  insertOpenReportingPeriodPostgresTx,
  listClosedReportingPeriodsPostgres,
} from "@/lib/trader/billing/repository-postgres";
import {
  closeReportingPeriodSqlite,
  closeReportingPeriodSqliteTx,
  findOpenReportingPeriodSqlite,
  getReportingPeriodByIdSqlite,
  insertOpenReportingPeriodSqlite,
  insertOpenReportingPeriodSqliteTx,
  listClosedReportingPeriodsSqlite,
} from "@/lib/trader/billing/repository-sqlite";

type PgReportingPeriodExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export function createSqliteReportingPeriodRepository(db: WaiaDb): ReportingPeriodRepository {
  return {
    insertOpenPeriod: (context, input) => insertOpenReportingPeriodSqliteTx(db, context, input),
    findOpenPeriod: (context, exchangeAccountId) =>
      findOpenReportingPeriodSqlite(db, context, exchangeAccountId),
    getById: (context, id) => getReportingPeriodByIdSqlite(db, context, id),
    closePeriod: (context, input) => closeReportingPeriodSqliteTx(db, context, input),
    listClosedPeriods: (context, query) => listClosedReportingPeriodsSqlite(db, context, query),
  };
}

export function createPostgresReportingPeriodRepository(
  ex: PgReportingPeriodExecutor,
  db?: WaiaPostgresDb,
): ReportingPeriodRepository {
  return {
    insertOpenPeriod: (context, input) => {
      if (db) {
        return insertOpenReportingPeriodPostgresTx(db, context, input);
      }
      return insertOpenReportingPeriodPostgres(ex, context, input);
    },
    findOpenPeriod: (context, exchangeAccountId) =>
      findOpenReportingPeriodPostgres(ex, context, exchangeAccountId),
    getById: (context, id) => getReportingPeriodByIdPostgres(ex, context, id),
    closePeriod: (context, input) => {
      if (db) {
        return closeReportingPeriodPostgresTx(db, context, input);
      }
      return closeReportingPeriodPostgres(ex, context, input);
    },
    listClosedPeriods: (context, query) => listClosedReportingPeriodsPostgres(ex, context, query),
  };
}

/** Expose non-transactional sqlite helpers for tests that manage their own transactions. */
export {
  closeReportingPeriodSqlite,
  findOpenReportingPeriodSqlite,
  getReportingPeriodByIdSqlite,
  insertOpenReportingPeriodSqlite,
  listClosedReportingPeriodsSqlite,
};
