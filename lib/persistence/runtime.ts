import "server-only";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";

import {
  createSqliteTwinPersistence,
  type SqliteTwinPersistence,
} from "./sqlite/twin-persistence";

const WAIA_POSTGRES_TWIN_PERSISTENCE_UNSUPPORTED =
  "[waia] Postgres twin/diary persistence is not supported yet (DEE-64 D5+ / DEE-72). Use WAIA_DB_BACKEND=sqlite or pass a SQLite WaiaDb handle until Postgres persistence ships.";

/**
 * Resolves twin/diary persistence for an explicit {@link WaiaRuntimeDb} handle (DEE-64 D5a).
 * Does not resolve runtime implicitly (callers must not rely on `getWaiaRuntimeDb()` here).
 * Postgres rejects before any SQLite persistence runs.
 */
export function resolveTwinPersistence(handle: WaiaRuntimeDb): SqliteTwinPersistence {
  if (handle.kind === "sqlite") {
    return createSqliteTwinPersistence(handle.db);
  }

  throw new Error(WAIA_POSTGRES_TWIN_PERSISTENCE_UNSUPPORTED);
}
