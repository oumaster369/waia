import "server-only";

import { eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { twinProfiles, twinReadinessState, users } from "@/db/schema";
import { DEFAULT_READINESS_INPUT } from "@/lib/dashboard/readiness-snapshot-default";
import { ensureUserCoreSeed } from "@/lib/waia-core/provisioning";

/**
 * Idempotent: ensures one twin profile + readiness projection for an existing user row.
 * Does not create the user (sign-up / fixtures own that).
 *
 * Synchronous so it can run inside `db.transaction` (better-sqlite3 is sync-only there).
 * Uses `.all()` / `.run()` only where the sync driver requires it (see DEE-64B2 for Postgres).
 */
export function ensureUserTwinSeed(db: WaiaDb, userId: string): string {
  const existingTwinRows = db
    .select({ id: twinProfiles.id })
    .from(twinProfiles)
    .where(eq(twinProfiles.userId, userId))
    .limit(1)
    .all();
  const existingTwin = existingTwinRows[0];

  const twinId =
    existingTwin?.id ??
    (() => {
      const id = crypto.randomUUID();
      db.insert(twinProfiles).values({ id, userId }).run();
      return id;
    })();

  const stateRows = db
    .select({ twinProfileId: twinReadinessState.twinProfileId })
    .from(twinReadinessState)
    .where(eq(twinReadinessState.twinProfileId, twinId))
    .limit(1)
    .all();
  const stateRow = stateRows[0];

  if (!stateRow) {
    db.insert(twinReadinessState)
      .values({
        twinProfileId: twinId,
        indicatorsJson: JSON.stringify(DEFAULT_READINESS_INPUT.indicators),
        socializationCompleted: DEFAULT_READINESS_INPUT.socializationCompleted,
        finalStateMessageShown: DEFAULT_READINESS_INPUT.finalStateMessageShown,
      })
      .run();
  }

  const userRow = db
    .select({ identityLabel: users.identityLabel })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .all()[0];

  ensureUserCoreSeed(db, {
    userId,
    displayName: userRow?.identityLabel ?? "User",
  });

  return twinId;
}
