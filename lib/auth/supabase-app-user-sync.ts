import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  disposeWaiaRuntimeDb,
  getWaiaRuntimeDb,
  type WaiaRuntimeDb,
} from "@/db/waia-runtime-db";
import { users } from "@/db/schema";
import { runWaiaSqliteLegacyTransaction } from "@/db/waia-transaction";
import { syncAppUserRowFromSupabaseAuthPostgres } from "@/lib/persistence/postgres/twin-persistence";
import { ensureUserTwinSeed } from "@/lib/twin-persistence/loader";

function logSqliteSyncFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[waia] syncAppUserRowFromSupabaseAuth SQLite path failed:", message);
}

/**
 * Ensures a `users` row exists for the Supabase Auth user id (DEE-70 alignment: `users.id` = `auth.users.id`).
 *
 * DEE-75: When `WAIA_DB_BACKEND=postgres`, upserts `public.users` and runs Postgres twin seed; SQLite path unchanged for local dev.
 */
export async function syncAppUserRowFromSupabaseAuth(params: {
  supabaseUserId: string;
  email: string;
  identityLabel: string;
}): Promise<void> {
  let runtime: WaiaRuntimeDb | undefined;
  try {
    runtime = await getWaiaRuntimeDb();
    if (runtime.kind === "postgres") {
      await syncAppUserRowFromSupabaseAuthPostgres(runtime.db, params);
      return;
    }

    try {
      const db = getDb();

      const byId = await db.select({ id: users.id }).from(users).where(eq(users.id, params.supabaseUserId)).limit(1);
      if (byId[0]) {
        await runWaiaSqliteLegacyTransaction(db, (tx) => {
          ensureUserTwinSeed(tx, params.supabaseUserId);
        });
        return;
      }

      const byEmail = await db.select({ id: users.id }).from(users).where(eq(users.email, params.email)).limit(1);
      if (byEmail[0]) {
        /** Legacy SQLite user with same email but different id — do not auto-link in MVP slice. */
        return;
      }

      await runWaiaSqliteLegacyTransaction(db, (tx) => {
        tx
          .insert(users)
          .values({
            id: params.supabaseUserId,
            identityLabel: params.identityLabel,
            email: params.email,
            passwordHash: null,
          })
          .run();
        ensureUserTwinSeed(tx, params.supabaseUserId);
      });
    } catch (err) {
      logSqliteSyncFailure(err);
      throw err;
    }
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}
