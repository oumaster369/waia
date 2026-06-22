import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  getLatestTrialIntegrityEventPostgres,
  insertTrialIntegrityEventPostgres,
  listTrialIntegrityEventsPostgres,
} from "@/lib/trader/mi/trial-integrity-repository-postgres";
import {
  getLatestTrialIntegrityEventSqlite,
  insertTrialIntegrityEventSqlite,
  listTrialIntegrityEventsSqlite,
} from "@/lib/trader/mi/trial-integrity-repository-sqlite";
import type { MiTrialIntegrityRepository } from "@/lib/trader/mi/types";

type PgMiTrialIntegrityExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqliteMiTrialIntegrityRepository(db: WaiaDb): MiTrialIntegrityRepository {
  return {
    getLatestEvent: (context, trialId) => getLatestTrialIntegrityEventSqlite(db, context, trialId),
    listEvents: (context, trialId) => listTrialIntegrityEventsSqlite(db, context, trialId),
    insertEvent: (context, row) => insertTrialIntegrityEventSqlite(db, context, row),
  };
}

export function createPostgresMiTrialIntegrityRepository(
  ex: PgMiTrialIntegrityExecutor,
): MiTrialIntegrityRepository {
  return {
    getLatestEvent: (context, trialId) =>
      getLatestTrialIntegrityEventPostgres(ex, context, trialId),
    listEvents: (context, trialId) => listTrialIntegrityEventsPostgres(ex, context, trialId),
    insertEvent: (context, row) => insertTrialIntegrityEventPostgres(ex, context, row),
  };
}
