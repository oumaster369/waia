import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  findHypothesisByDigestPostgres,
  findHypothesisByIdPostgres,
  getLatestHypothesisPostgres,
  getLatestLifecycleEventPostgres,
  insertHypothesisVersionPostgres,
  insertLifecycleEventPostgres,
  listHypothesisHistoryPostgres,
  listHypothesesPostgres,
  listLifecycleEventsPostgres,
} from "@/lib/trader/mi/hypothesis-repository-postgres";
import {
  findHypothesisByDigestSqlite,
  findHypothesisByIdSqlite,
  getLatestHypothesisSqlite,
  getLatestLifecycleEventSqlite,
  insertHypothesisVersionSqlite,
  insertLifecycleEventSqlite,
  listHypothesisHistorySqlite,
  listHypothesesSqlite,
  listLifecycleEventsSqlite,
} from "@/lib/trader/mi/hypothesis-repository-sqlite";
import type { MiHypothesisRepository } from "@/lib/trader/mi/types";

type PgMiHypothesisExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqliteMiHypothesisRepository(db: WaiaDb): MiHypothesisRepository {
  return {
    getLatestHypothesis: (context, hypothesisKey) =>
      getLatestHypothesisSqlite(db, context, hypothesisKey),
    listHypothesisHistory: (context, hypothesisKey) =>
      listHypothesisHistorySqlite(db, context, hypothesisKey),
    listHypotheses: (context, hypothesisKind) => listHypothesesSqlite(db, context, hypothesisKind),
    findHypothesisByDigest: (context, definitionDigest) =>
      findHypothesisByDigestSqlite(db, context, definitionDigest),
    findHypothesisById: (context, hypothesisId) =>
      findHypothesisByIdSqlite(db, context, hypothesisId),
    insertHypothesisVersion: (context, row) => insertHypothesisVersionSqlite(db, context, row),
    getLatestLifecycleEvent: (context, hypothesisKey) =>
      getLatestLifecycleEventSqlite(db, context, hypothesisKey),
    listLifecycleEvents: (context, hypothesisKey) =>
      listLifecycleEventsSqlite(db, context, hypothesisKey),
    insertLifecycleEvent: (context, row) => insertLifecycleEventSqlite(db, context, row),
  };
}

export function createPostgresMiHypothesisRepository(
  ex: PgMiHypothesisExecutor,
): MiHypothesisRepository {
  return {
    getLatestHypothesis: (context, hypothesisKey) =>
      getLatestHypothesisPostgres(ex, context, hypothesisKey),
    listHypothesisHistory: (context, hypothesisKey) =>
      listHypothesisHistoryPostgres(ex, context, hypothesisKey),
    listHypotheses: (context, hypothesisKind) =>
      listHypothesesPostgres(ex, context, hypothesisKind),
    findHypothesisByDigest: (context, definitionDigest) =>
      findHypothesisByDigestPostgres(ex, context, definitionDigest),
    findHypothesisById: (context, hypothesisId) =>
      findHypothesisByIdPostgres(ex, context, hypothesisId),
    insertHypothesisVersion: (context, row) => insertHypothesisVersionPostgres(ex, context, row),
    getLatestLifecycleEvent: (context, hypothesisKey) =>
      getLatestLifecycleEventPostgres(ex, context, hypothesisKey),
    listLifecycleEvents: (context, hypothesisKey) =>
      listLifecycleEventsPostgres(ex, context, hypothesisKey),
    insertLifecycleEvent: (context, row) => insertLifecycleEventPostgres(ex, context, row),
  };
}
