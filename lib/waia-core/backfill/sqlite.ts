import "server-only";

import type { WaiaDb } from "@/db/types";
import { users } from "@/db/schema";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";

/** One-shot idempotent backfill for all existing users (SQLite). */
export function backfillCoreForAllUsersSqlite(db: WaiaDb): number {
  const allUsers = db
    .select({ id: users.id, identityLabel: users.identityLabel })
    .from(users)
    .all();
  let count = 0;
  for (const user of allUsers) {
    ensureUserCoreSeedSqlite(db, {
      userId: user.id,
      displayName: user.identityLabel,
    });
    count += 1;
  }
  return count;
}
