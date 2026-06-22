import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  findEvidenceByIdPostgres,
  getLatestEvidencePostgres,
  insertEvidencePostgres,
  listEvidenceByDirectionPostgres,
  listEvidencePostgres,
} from "@/lib/trader/mi/evidence-repository-postgres";
import {
  findEvidenceByIdSqlite,
  getLatestEvidenceSqlite,
  insertEvidenceSqlite,
  listEvidenceByDirectionSqlite,
  listEvidenceSqlite,
} from "@/lib/trader/mi/evidence-repository-sqlite";
import type { MiEvidenceRepository } from "@/lib/trader/mi/types";

type PgMiEvidenceExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqliteMiEvidenceRepository(db: WaiaDb): MiEvidenceRepository {
  return {
    getLatestEvidence: (context, hypothesisKey) =>
      getLatestEvidenceSqlite(db, context, hypothesisKey),
    listEvidence: (context, hypothesisKey) => listEvidenceSqlite(db, context, hypothesisKey),
    listEvidenceByDirection: (context, hypothesisKey, direction) =>
      listEvidenceByDirectionSqlite(db, context, hypothesisKey, direction),
    findEvidenceById: (context, evidenceId) => findEvidenceByIdSqlite(db, context, evidenceId),
    insertEvidence: (context, row) => insertEvidenceSqlite(db, context, row),
  };
}

export function createPostgresMiEvidenceRepository(ex: PgMiEvidenceExecutor): MiEvidenceRepository {
  return {
    getLatestEvidence: (context, hypothesisKey) =>
      getLatestEvidencePostgres(ex, context, hypothesisKey),
    listEvidence: (context, hypothesisKey) => listEvidencePostgres(ex, context, hypothesisKey),
    listEvidenceByDirection: (context, hypothesisKey, direction) =>
      listEvidenceByDirectionPostgres(ex, context, hypothesisKey, direction),
    findEvidenceById: (context, evidenceId) => findEvidenceByIdPostgres(ex, context, evidenceId),
    insertEvidence: (context, row) => insertEvidencePostgres(ex, context, row),
  };
}
