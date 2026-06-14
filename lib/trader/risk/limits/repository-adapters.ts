import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  getLimitsRowForScopePostgres,
  insertLimitsRowForScopePostgres,
  updateLimitsRowForScopePostgres,
} from "@/lib/trader/risk/limits/repository-postgres";
import {
  getLimitsRowForScopeSqlite,
  insertLimitsRowForScopeSqlite,
  updateLimitsRowForScopeSqlite,
} from "@/lib/trader/risk/limits/repository-sqlite";
import type { RiskLimitsRepository } from "@/lib/trader/risk/limits/types";

type PgRiskLimitsExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export function createSqliteRiskLimitsRepository(db: WaiaDb): RiskLimitsRepository {
  return {
    getLimitsRowForScope: (context, scope) => getLimitsRowForScopeSqlite(db, context, scope),
    insertLimitsRowForScope: (context, scope, input) =>
      insertLimitsRowForScopeSqlite(db, context, scope, input),
    updateLimitsRowForScope: (context, scope, rowId, input) =>
      updateLimitsRowForScopeSqlite(db, context, scope, rowId, input),
  };
}

export function createPostgresRiskLimitsRepository(ex: PgRiskLimitsExecutor): RiskLimitsRepository {
  return {
    getLimitsRowForScope: (context, scope) => getLimitsRowForScopePostgres(ex, context, scope),
    insertLimitsRowForScope: (context, scope, input) =>
      insertLimitsRowForScopePostgres(ex, context, scope, input),
    updateLimitsRowForScope: (context, scope, rowId, input) =>
      updateLimitsRowForScopePostgres(ex, context, scope, rowId, input),
  };
}
