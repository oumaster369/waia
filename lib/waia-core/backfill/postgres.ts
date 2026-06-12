import "server-only";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";

type PgBackfillExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

/**
 * One-shot idempotent backfill for all existing users (Postgres).
 *
 * Mirrors `backfillCoreForAllUsersSqlite`. Safe to re-run: provisioning is idempotent
 * per user (existence checks before each insert). Returns the number of users processed.
 */
export async function backfillCoreForAllUsersPostgres(ex: PgBackfillExecutor): Promise<number> {
  const allUsers = await ex
    .select({ id: pgSchema.users.id, identityLabel: pgSchema.users.identityLabel })
    .from(pgSchema.users);

  let count = 0;
  for (const user of allUsers) {
    await ensureUserCoreSeedPostgres(ex, {
      userId: user.id,
      displayName: user.identityLabel ?? undefined,
    });
    count += 1;
  }
  return count;
}
