import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  insertPositionSnapshotRowPostgres,
  listPositionSnapshotRowsPostgres,
} from "@/lib/trader/positions/repository-postgres";
import {
  insertPositionSnapshotRowSqlite,
  listPositionSnapshotRowsSqlite,
} from "@/lib/trader/positions/repository-sqlite";
import type { PositionSnapshotRepository } from "@/lib/trader/positions/types";

type PgPositionSnapshotExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqlitePositionSnapshotRepository(db: WaiaDb): PositionSnapshotRepository {
  return {
    insertPositionSnapshotRow: (context, input) =>
      insertPositionSnapshotRowSqlite(db, context, input),
    listPositionSnapshotRows: (context, query) =>
      listPositionSnapshotRowsSqlite(db, context, query),
  };
}

export function createPostgresPositionSnapshotRepository(
  ex: PgPositionSnapshotExecutor,
): PositionSnapshotRepository {
  return {
    insertPositionSnapshotRow: (context, input) =>
      insertPositionSnapshotRowPostgres(ex, context, input),
    listPositionSnapshotRows: (context, query) =>
      listPositionSnapshotRowsPostgres(ex, context, query),
  };
}
