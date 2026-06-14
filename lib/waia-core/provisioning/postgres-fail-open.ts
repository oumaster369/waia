import "server-only";

import { sql } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import type { CoreProvisioningInput } from "@/lib/waia-core/types";

type PgTx = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];

const CORE_SEED_SAVEPOINT = "waia_core_seed";

function logCoreSeedFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[waia] ensureUserCoreSeedPostgres failed (fail-open for AI-TWIN):", message);
}

/**
 * Best-effort Core provisioning inside an outer Postgres transaction (DEE-232 / DEE-225 R1).
 *
 * Postgres aborts the whole transaction on SQL errors; a JS try/catch alone cannot recover.
 * SAVEPOINT + ROLLBACK TO SAVEPOINT keeps twin seed commits intact when Core seed fails.
 */
export async function ensureUserCoreSeedPostgresFailOpenInTx(
  tx: PgTx,
  input: CoreProvisioningInput,
): Promise<void> {
  await tx.execute(sql.raw(`SAVEPOINT ${CORE_SEED_SAVEPOINT}`));
  try {
    await ensureUserCoreSeedPostgres(tx, input);
  } catch (err) {
    await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${CORE_SEED_SAVEPOINT}`));
    logCoreSeedFailure(err);
  }
}
