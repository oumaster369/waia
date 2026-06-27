import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  getLatestConfidenceJudgmentByKeySqlite,
  insertConfidenceJudgmentSqlite,
  listConfidenceJudgmentsForHypothesisIdSqlite,
  listConfidenceJudgmentsForHypothesisKeySqlite,
} from "@/lib/trader/mi/confidence-judgment-repository-sqlite";
import {
  getLatestConfidenceJudgmentByKeyPostgres,
  insertConfidenceJudgmentPostgres,
  listConfidenceJudgmentsForHypothesisIdPostgres,
  listConfidenceJudgmentsForHypothesisKeyPostgres,
} from "@/lib/trader/mi/confidence-judgment-repository-postgres";
import type { MiConfidenceJudgmentRepository } from "@/lib/trader/mi/types";

type PgConfidenceJudgmentExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqliteMiConfidenceJudgmentRepository(
  db: WaiaDb,
): MiConfidenceJudgmentRepository {
  return {
    getLatestJudgmentByKey: (context, hypothesisKey) =>
      getLatestConfidenceJudgmentByKeySqlite(db, context, hypothesisKey),
    listJudgmentsForHypothesisId: (context, hypothesisId) =>
      listConfidenceJudgmentsForHypothesisIdSqlite(db, context, hypothesisId),
    listJudgmentsForHypothesisKey: (context, hypothesisKey) =>
      listConfidenceJudgmentsForHypothesisKeySqlite(db, context, hypothesisKey),
    insertJudgment: (context, row) => insertConfidenceJudgmentSqlite(db, context, row),
  };
}

export function createPostgresMiConfidenceJudgmentRepository(
  ex: PgConfidenceJudgmentExecutor,
): MiConfidenceJudgmentRepository {
  return {
    getLatestJudgmentByKey: (context, hypothesisKey) =>
      getLatestConfidenceJudgmentByKeyPostgres(ex, context, hypothesisKey),
    listJudgmentsForHypothesisId: (context, hypothesisId) =>
      listConfidenceJudgmentsForHypothesisIdPostgres(ex, context, hypothesisId),
    listJudgmentsForHypothesisKey: (context, hypothesisKey) =>
      listConfidenceJudgmentsForHypothesisKeyPostgres(ex, context, hypothesisKey),
    insertJudgment: (context, row) => insertConfidenceJudgmentPostgres(ex, context, row),
  };
}
