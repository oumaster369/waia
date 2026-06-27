import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  findSourceByLogicalKeyPostgres,
  getLatestTrustRevisionPostgres,
  getSourceByIdPostgres,
  insertSourcePostgres,
  insertTrustRevisionPostgres,
  listSourcesPostgres,
  listTrustHistoryPostgres,
  updateSourceStatusPostgres,
} from "@/lib/trader/mi/repository-postgres";
import {
  findSourceByLogicalKeySqlite,
  getLatestTrustRevisionSqlite,
  getSourceByIdSqlite,
  insertSourceSqlite,
  insertTrustRevisionSqlite,
  listSourcesSqlite,
  listTrustHistorySqlite,
  updateSourceStatusSqlite,
} from "@/lib/trader/mi/repository-sqlite";
import type { MiSourceProvenanceRepository } from "@/lib/trader/mi/types";

type PgMiExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export function createSqliteMiSourceProvenanceRepository(db: WaiaDb): MiSourceProvenanceRepository {
  return {
    findSourceByLogicalKey: (context, venue, feedKind, symbol) =>
      findSourceByLogicalKeySqlite(db, context, venue, feedKind, symbol),
    getSourceById: (context, sourceId) => getSourceByIdSqlite(db, context, sourceId),
    insertSource: (context, input, id, now) =>
      insertSourceSqlite(
        db,
        context,
        {
          venue: input.venue,
          feedKind: input.feedKind,
          symbol: input.symbol ?? null,
          description: input.description ?? null,
          status: input.status ?? "active",
        },
        id,
        now,
      ),
    updateSourceStatus: (context, sourceId, status, now) =>
      updateSourceStatusSqlite(db, context, sourceId, status, now),
    listSources: (context) => listSourcesSqlite(db, context),
    getLatestTrustRevision: (context, sourceId) =>
      getLatestTrustRevisionSqlite(db, context, sourceId),
    listTrustHistory: (context, sourceId) => listTrustHistorySqlite(db, context, sourceId),
    insertTrustRevision: (context, row) => insertTrustRevisionSqlite(db, context, row),
  };
}

export function createPostgresMiSourceProvenanceRepository(
  ex: PgMiExecutor,
): MiSourceProvenanceRepository {
  return {
    findSourceByLogicalKey: (context, venue, feedKind, symbol) =>
      findSourceByLogicalKeyPostgres(ex, context, venue, feedKind, symbol),
    getSourceById: (context, sourceId) => getSourceByIdPostgres(ex, context, sourceId),
    insertSource: (context, input, id, now) =>
      insertSourcePostgres(
        ex,
        context,
        {
          venue: input.venue,
          feedKind: input.feedKind,
          symbol: input.symbol ?? null,
          description: input.description ?? null,
          status: input.status ?? "active",
        },
        id,
        now,
      ),
    updateSourceStatus: (context, sourceId, status, now) =>
      updateSourceStatusPostgres(ex, context, sourceId, status, now),
    listSources: (context) => listSourcesPostgres(ex, context),
    getLatestTrustRevision: (context, sourceId) =>
      getLatestTrustRevisionPostgres(ex, context, sourceId),
    listTrustHistory: (context, sourceId) => listTrustHistoryPostgres(ex, context, sourceId),
    insertTrustRevision: (context, row) => insertTrustRevisionPostgres(ex, context, row),
  };
}
