import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  findMeasurementByDigestPostgres,
  getLatestMeasurementPostgres,
  insertMeasurementVersionPostgres,
  listMeasurementHistoryPostgres,
  listMeasurementsPostgres,
} from "@/lib/trader/mi/measurement-repository-postgres";
import {
  findMeasurementByDigestSqlite,
  getLatestMeasurementSqlite,
  insertMeasurementVersionSqlite,
  listMeasurementHistorySqlite,
  listMeasurementsSqlite,
} from "@/lib/trader/mi/measurement-repository-sqlite";
import type { MiMeasurementRepository } from "@/lib/trader/mi/types";

type PgMiMeasurementExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqliteMiMeasurementRepository(db: WaiaDb): MiMeasurementRepository {
  return {
    getLatestMeasurement: (context, measurementKey) =>
      getLatestMeasurementSqlite(db, context, measurementKey),
    listMeasurementHistory: (context, measurementKey) =>
      listMeasurementHistorySqlite(db, context, measurementKey),
    listMeasurements: (context, measurementKind) =>
      listMeasurementsSqlite(db, context, measurementKind),
    findMeasurementByDigest: (context, definitionDigest) =>
      findMeasurementByDigestSqlite(db, context, definitionDigest),
    insertMeasurementVersion: (context, row) => insertMeasurementVersionSqlite(db, context, row),
  };
}

export function createPostgresMiMeasurementRepository(
  ex: PgMiMeasurementExecutor,
): MiMeasurementRepository {
  return {
    getLatestMeasurement: (context, measurementKey) =>
      getLatestMeasurementPostgres(ex, context, measurementKey),
    listMeasurementHistory: (context, measurementKey) =>
      listMeasurementHistoryPostgres(ex, context, measurementKey),
    listMeasurements: (context, measurementKind) =>
      listMeasurementsPostgres(ex, context, measurementKind),
    findMeasurementByDigest: (context, definitionDigest) =>
      findMeasurementByDigestPostgres(ex, context, definitionDigest),
    insertMeasurementVersion: (context, row) => insertMeasurementVersionPostgres(ex, context, row),
  };
}
