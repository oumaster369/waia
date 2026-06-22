import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  getLatestObservationPostgres,
  insertObservationPostgres,
  listObservationHistoryPostgres,
  listObservationsPostgres,
} from "@/lib/trader/mi/observation-repository-postgres";
import {
  getLatestObservationSqlite,
  insertObservationSqlite,
  listObservationHistorySqlite,
  listObservationsSqlite,
} from "@/lib/trader/mi/observation-repository-sqlite";
import type { MiObservationRepository } from "@/lib/trader/mi/types";

type PgMiObservationExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqliteMiObservationRepository(db: WaiaDb): MiObservationRepository {
  return {
    getLatestObservation: (context, observationKey) =>
      getLatestObservationSqlite(db, context, observationKey),
    listObservationHistory: (context, observationKey) =>
      listObservationHistorySqlite(db, context, observationKey),
    listObservations: (context, observationKind) =>
      listObservationsSqlite(db, context, observationKind),
    insertObservation: (context, row) => insertObservationSqlite(db, context, row),
  };
}

export function createPostgresMiObservationRepository(
  ex: PgMiObservationExecutor,
): MiObservationRepository {
  return {
    getLatestObservation: (context, observationKey) =>
      getLatestObservationPostgres(ex, context, observationKey),
    listObservationHistory: (context, observationKey) =>
      listObservationHistoryPostgres(ex, context, observationKey),
    listObservations: (context, observationKind) =>
      listObservationsPostgres(ex, context, observationKind),
    insertObservation: (context, row) => insertObservationPostgres(ex, context, row),
  };
}
