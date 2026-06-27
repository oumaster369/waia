import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  insertTradeHistorySnapshotRowPostgres,
  listTradeHistorySnapshotRowsPostgres,
} from "@/lib/trader/trade-history/repository-postgres";
import {
  insertTradeHistorySnapshotRowSqlite,
  listTradeHistorySnapshotRowsSqlite,
} from "@/lib/trader/trade-history/repository-sqlite";
import type { TradeHistorySnapshotRepository } from "@/lib/trader/trade-history/types";

type PgTradeHistorySnapshotExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqliteTradeHistorySnapshotRepository(
  db: WaiaDb,
): TradeHistorySnapshotRepository {
  return {
    insertTradeHistorySnapshotRow: (context, input) =>
      insertTradeHistorySnapshotRowSqlite(db, context, input),
    listTradeHistorySnapshotRows: (context, query) =>
      listTradeHistorySnapshotRowsSqlite(db, context, query),
  };
}

export function createPostgresTradeHistorySnapshotRepository(
  ex: PgTradeHistorySnapshotExecutor,
): TradeHistorySnapshotRepository {
  return {
    insertTradeHistorySnapshotRow: (context, input) =>
      insertTradeHistorySnapshotRowPostgres(ex, context, input),
    listTradeHistorySnapshotRows: (context, query) =>
      listTradeHistorySnapshotRowsPostgres(ex, context, query),
  };
}
