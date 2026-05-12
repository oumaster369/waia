import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { runWaiaSqliteLegacyTransaction } from "@/db/waia-transaction";
import { ensureUserTwinSeed } from "@/lib/twin-persistence/loader";

/**
 * Ensures a `users` row exists for the Supabase Auth user id (DEE-70 alignment: `users.id` = `auth.users.id`).
 * Best-effort: on Cloudflare Workers without SQLite, this no-ops (Supabase session still valid; twin data needs Postgres/D1 later).
 */
export async function syncAppUserRowFromSupabaseAuth(params: {
  supabaseUserId: string;
  email: string;
  identityLabel: string;
}): Promise<void> {
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
  } catch {
    /* Workers / no SQLite: deferred to Postgres runtime slice */
  }
}
