import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { HwmLedgerRepository } from "@/lib/trader/billing/hwm-ledger-repository.types";
import {
  findBootstrapHwmLedgerEntryPostgres,
  getCurrentHwmLedgerEntryPostgres,
  getHwmLedgerEntryByIdPostgres,
  insertHwmLedgerEntryPostgres,
  insertHwmLedgerEntryPostgresTx,
  listHwmLedgerEntriesPostgres,
} from "@/lib/trader/billing/hwm-ledger-repository-postgres";
import {
  findBootstrapHwmLedgerEntrySqlite,
  getCurrentHwmLedgerEntrySqlite,
  getHwmLedgerEntryByIdSqlite,
  insertHwmLedgerEntrySqlite,
  insertHwmLedgerEntrySqliteTx,
  listHwmLedgerEntriesSqlite,
} from "@/lib/trader/billing/hwm-ledger-repository-sqlite";

type PgHwmLedgerExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqliteHwmLedgerRepository(db: WaiaDb): HwmLedgerRepository {
  return {
    insertEntry: (context, input) => insertHwmLedgerEntrySqliteTx(db, context, input),
    getCurrentEntry: (context, exchangeAccountId) =>
      getCurrentHwmLedgerEntrySqlite(db, context, exchangeAccountId),
    findBootstrapEntry: (context, exchangeAccountId) =>
      findBootstrapHwmLedgerEntrySqlite(db, context, exchangeAccountId),
    getById: (context, id) => getHwmLedgerEntryByIdSqlite(db, context, id),
    listEntries: (context, query) => listHwmLedgerEntriesSqlite(db, context, query),
  };
}

export function createPostgresHwmLedgerRepository(
  ex: PgHwmLedgerExecutor,
  db?: WaiaPostgresDb,
): HwmLedgerRepository {
  return {
    insertEntry: (context, input) => {
      if (db) {
        return insertHwmLedgerEntryPostgresTx(db, context, input);
      }
      return insertHwmLedgerEntryPostgres(ex, context, input);
    },
    getCurrentEntry: (context, exchangeAccountId) =>
      getCurrentHwmLedgerEntryPostgres(ex, context, exchangeAccountId),
    findBootstrapEntry: (context, exchangeAccountId) =>
      findBootstrapHwmLedgerEntryPostgres(ex, context, exchangeAccountId),
    getById: (context, id) => getHwmLedgerEntryByIdPostgres(ex, context, id),
    listEntries: (context, query) => listHwmLedgerEntriesPostgres(ex, context, query),
  };
}

/** Expose non-transactional sqlite helpers for tests that manage their own transactions. */
export {
  findBootstrapHwmLedgerEntrySqlite,
  getCurrentHwmLedgerEntrySqlite,
  getHwmLedgerEntryByIdSqlite,
  insertHwmLedgerEntrySqlite,
  listHwmLedgerEntriesSqlite,
};
