import "server-only";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";

import {
  createPostgresTwinPersistence,
  type PostgresTwinPersistence,
} from "./postgres/twin-persistence";
import {
  createSqliteTwinPersistence,
  type SqliteTwinPersistence,
} from "./sqlite/twin-persistence";

/**
 * Resolves twin/diary persistence for an explicit {@link WaiaRuntimeDb} handle (DEE-64 D5a / DEE-72.1).
 * Does not resolve runtime implicitly (callers must not rely on `getWaiaRuntimeDb()` here).
 */
export function resolveTwinPersistence(handle: Extract<WaiaRuntimeDb, { kind: "sqlite" }>): SqliteTwinPersistence;
export function resolveTwinPersistence(
  handle: Extract<WaiaRuntimeDb, { kind: "postgres" }>,
): PostgresTwinPersistence;
export function resolveTwinPersistence(handle: WaiaRuntimeDb): SqliteTwinPersistence | PostgresTwinPersistence {
  if (handle.kind === "sqlite") {
    return createSqliteTwinPersistence(handle.db);
  }
  return createPostgresTwinPersistence(handle.db);
}
