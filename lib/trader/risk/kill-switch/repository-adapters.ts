import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  getKillSwitchRowForScopePostgres,
  insertKillSwitchRowPostgres,
  listEnforcingKillSwitchRowsForResolutionPostgres,
  listKillSwitchRowsForOrgPostgres,
  updateKillSwitchRowWithVersionPostgres,
} from "@/lib/trader/risk/kill-switch/repository-postgres";
import {
  getKillSwitchRowForScopeSqlite,
  insertKillSwitchRowSqlite,
  listEnforcingKillSwitchRowsForResolutionSqlite,
  listKillSwitchRowsForOrgSqlite,
  updateKillSwitchRowWithVersionSqlite,
} from "@/lib/trader/risk/kill-switch/repository-sqlite";
import type { KillSwitchRepository } from "@/lib/trader/risk/kill-switch/types";

type PgKillSwitchExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export function createSqliteKillSwitchRepository(db: WaiaDb): KillSwitchRepository {
  return {
    getRowForScope: (target, key) => getKillSwitchRowForScopeSqlite(db, target, key),
    listRowsForOrg: (context, filter) => listKillSwitchRowsForOrgSqlite(db, context, filter),
    listEnforcingRowsForResolution: (context) =>
      listEnforcingKillSwitchRowsForResolutionSqlite(db, context),
    insertRow: (target, key, input) => insertKillSwitchRowSqlite(db, target, key, input),
    updateRowWithVersion: (target, rowId, expectedStateVersion, patch) =>
      updateKillSwitchRowWithVersionSqlite(db, target, rowId, expectedStateVersion, patch),
  };
}

export function createPostgresKillSwitchRepository(ex: PgKillSwitchExecutor): KillSwitchRepository {
  return {
    getRowForScope: (target, key) => getKillSwitchRowForScopePostgres(ex, target, key),
    listRowsForOrg: (context, filter) => listKillSwitchRowsForOrgPostgres(ex, context, filter),
    listEnforcingRowsForResolution: (context) =>
      listEnforcingKillSwitchRowsForResolutionPostgres(ex, context),
    insertRow: (target, key, input) => insertKillSwitchRowPostgres(ex, target, key, input),
    updateRowWithVersion: (target, rowId, expectedStateVersion, patch) =>
      updateKillSwitchRowWithVersionPostgres(ex, target, rowId, expectedStateVersion, patch),
  };
}
