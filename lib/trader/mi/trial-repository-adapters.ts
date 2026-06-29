import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  findTrialByIdPostgres,
  getLatestTrialPostgres,
  insertTrialPostgres,
  listTrialsByHypothesisIdPostgres,
  listTrialsPostgres,
} from "@/lib/trader/mi/trial-repository-postgres";
import {
  findTrialByIdSqlite,
  getLatestTrialSqlite,
  insertTrialSqlite,
  listTrialsByHypothesisIdSqlite,
  listTrialsSqlite,
} from "@/lib/trader/mi/trial-repository-sqlite";
import type { MiTrialRepository } from "@/lib/trader/mi/types";

type PgMiTrialExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqliteMiTrialRepository(db: WaiaDb): MiTrialRepository {
  return {
    getLatestTrial: (context, hypothesisKey) => getLatestTrialSqlite(db, context, hypothesisKey),
    listTrials: (context, hypothesisKey) => listTrialsSqlite(db, context, hypothesisKey),
    listTrialsByHypothesisId: (context, hypothesisId) =>
      listTrialsByHypothesisIdSqlite(db, context, hypothesisId),
    findTrialById: (context, trialId) => findTrialByIdSqlite(db, context, trialId),
    insertTrial: (context, row) => insertTrialSqlite(db, context, row),
  };
}

export function createPostgresMiTrialRepository(ex: PgMiTrialExecutor): MiTrialRepository {
  return {
    getLatestTrial: (context, hypothesisKey) => getLatestTrialPostgres(ex, context, hypothesisKey),
    listTrials: (context, hypothesisKey) => listTrialsPostgres(ex, context, hypothesisKey),
    listTrialsByHypothesisId: (context, hypothesisId) =>
      listTrialsByHypothesisIdPostgres(ex, context, hypothesisId),
    findTrialById: (context, trialId) => findTrialByIdPostgres(ex, context, trialId),
    insertTrial: (context, row) => insertTrialPostgres(ex, context, row),
  };
}
