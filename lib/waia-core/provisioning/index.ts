import "server-only";

import type { WaiaDb } from "@/db/types";
import type { CoreProvisioningInput } from "@/lib/waia-core/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";

function logCoreSeedFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[waia] ensureUserCoreSeed failed (fail-open for AI-TWIN):", message);
}

/**
 * Best-effort Core provisioning for SQLite runtime.
 * Failures are logged but do not block AI-TWIN flows.
 */
export function ensureUserCoreSeed(db: WaiaDb, input: CoreProvisioningInput): string | null {
  try {
    return ensureUserCoreSeedSqlite(db, input);
  } catch (err) {
    logCoreSeedFailure(err);
    return null;
  }
}
