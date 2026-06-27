import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  insertBalanceSnapshotRowPostgres,
  listBalanceSnapshotRowsPostgres,
} from "@/lib/trader/balances/repository-postgres";
import {
  insertBalanceSnapshotRowSqlite,
  listBalanceSnapshotRowsSqlite,
} from "@/lib/trader/balances/repository-sqlite";
import type { BalanceSnapshotRepository } from "@/lib/trader/balances/types";

type PgBalanceSnapshotExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqliteBalanceSnapshotRepository(db: WaiaDb): BalanceSnapshotRepository {
  return {
    insertBalanceSnapshotRow: (context, input) =>
      insertBalanceSnapshotRowSqlite(db, context, input),
    listBalanceSnapshotRows: (context, query) => listBalanceSnapshotRowsSqlite(db, context, query),
  };
}

export function createPostgresBalanceSnapshotRepository(
  ex: PgBalanceSnapshotExecutor,
): BalanceSnapshotRepository {
  return {
    insertBalanceSnapshotRow: (context, input) =>
      insertBalanceSnapshotRowPostgres(ex, context, input),
    listBalanceSnapshotRows: (context, query) =>
      listBalanceSnapshotRowsPostgres(ex, context, query),
  };
}
