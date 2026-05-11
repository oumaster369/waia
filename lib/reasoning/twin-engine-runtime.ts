import "server-only";

/**
 * DEE-95a: Runtime dispatch facade for Twin Engine — async boundary per DEE-94 / DEE-95.
 * SQLite delegates to sync {@link runTwinEngine}; Postgres to {@link runTwinEnginePostgresAsync}.
 * Production HTTP route uses this facade via `getWaiaRuntimeDb` + `runTwinEngineForRuntimeAsync` (DEE-95c).
 */

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { TwinEngineApiResponse, TwinEngineRunInput } from "@/lib/dashboard/twin-engine-api.types";
import { resolveTwinPersistence } from "@/lib/persistence/runtime";
import { runTwinEngine } from "@/lib/reasoning/twin-engine";
import { runTwinEnginePostgresAsync } from "@/lib/reasoning/twin-engine-postgres";

export async function runTwinEngineForRuntimeAsync(
  handle: WaiaRuntimeDb,
  input: TwinEngineRunInput,
): Promise<TwinEngineApiResponse> {
  if (handle.kind === "sqlite") {
    return runTwinEngine(handle.db, input);
  }
  const persistence = resolveTwinPersistence(handle);
  return runTwinEnginePostgresAsync(persistence, input);
}
