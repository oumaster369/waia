import "server-only";

import { eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { ProfileRow } from "@/lib/waia-core/profiles/sqlite";

type PgProfileExecutor = Pick<WaiaPostgresDb, "select" | "update">;

/** Postgres parity for `getProfileForUserSqlite`. `settings_json` is jsonb. */
export async function getProfileForUserPostgres(
  ex: Pick<WaiaPostgresDb, "select">,
  userId: string,
): Promise<ProfileRow | null> {
  const rows = await ex
    .select()
    .from(pgSchema.profiles)
    .where(eq(pgSchema.profiles.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    locale: row.locale,
    avatarRef: row.avatarRef ?? null,
    settings: (row.settingsJson as Record<string, unknown> | null) ?? null,
  };
}

/** Postgres parity for `updateProfileForUserSqlite`. */
export async function updateProfileForUserPostgres(
  ex: PgProfileExecutor,
  userId: string,
  patch: { displayName?: string; locale?: string; avatarRef?: string | null },
): Promise<ProfileRow | null> {
  const existing = await getProfileForUserPostgres(ex, userId);
  if (!existing) return null;

  await ex
    .update(pgSchema.profiles)
    .set({
      displayName: patch.displayName ?? existing.displayName,
      locale: patch.locale ?? existing.locale,
      avatarRef: patch.avatarRef === undefined ? existing.avatarRef : patch.avatarRef,
      updatedAt: new Date(),
    })
    .where(eq(pgSchema.profiles.userId, userId));

  return getProfileForUserPostgres(ex, userId);
}
