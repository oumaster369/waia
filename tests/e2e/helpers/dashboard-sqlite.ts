import path from "node:path";

import Database from "better-sqlite3";

import type { IndicatorVector } from "@/lib/readiness/types";

/** Mirror `resolveSqliteDatabasePath` from `db/client` without importing `server-only`. */
export function resolveE2ESqlitePath(url = process.env.DATABASE_URL): string {
  const raw = url ?? "file:./.data/waia.db";
  if (raw === ":memory:") {
    return ":memory:";
  }
  const stripped = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  if (stripped === ":memory:") {
    return ":memory:";
  }
  return path.isAbsolute(stripped) ? stripped : path.resolve(process.cwd(), stripped);
}

export type ReadinessSqlitePatch = {
  indicators: IndicatorVector;
  socializationCompleted: boolean;
  finalStateMessageShown: boolean;
};

/**
 * PATCH persisted readiness for Playwright matrices (matches server `getDashboardReadinessPayloadForUser` source row).
 */
export function patchReadinessByUserEmail(email: string, patch: ReadinessSqlitePatch): void {
  const fp = resolveE2ESqlitePath();
  if (fp === ":memory:") {
    throw new Error("[e2e] DATABASE_URL is :memory:; Playwright needs a shared on-disk SQLite file.");
  }
  const db = new Database(fp);
  db.pragma("foreign_keys = ON");
  try {
    const info = db
      .prepare(
        `UPDATE twin_readiness_state SET
           indicators_json = @indicators_json,
           socialization_completed = @socialization_completed,
           final_state_message_shown = @final_state_message_shown,
           updated_at = @updated_at
         WHERE twin_profile_id = (
           SELECT twin_profiles.id FROM twin_profiles
           INNER JOIN users ON users.id = twin_profiles.user_id
           WHERE users.email = @email
         )`,
      )
      .run({
        indicators_json: JSON.stringify([...patch.indicators]),
        socialization_completed: patch.socializationCompleted ? 1 : 0,
        final_state_message_shown: patch.finalStateMessageShown ? 1 : 0,
        updated_at: Date.now(),
        email,
      });

    if (info.changes === 0) {
      throw new Error(`[e2e] No twin_readiness_state row updated for email ${email}`);
    }
  } finally {
    db.close();
  }
}
