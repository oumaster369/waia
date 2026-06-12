import "server-only";

import { eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { profiles } from "@/db/schema";

export type ProfileRow = {
  id: string;
  userId: string;
  displayName: string;
  locale: string;
  avatarRef: string | null;
  settings: Record<string, unknown> | null;
};

export function getProfileForUserSqlite(db: WaiaDb, userId: string): ProfileRow | null {
  const row = db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1).all()[0];

  if (!row) return null;

  return {
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    locale: row.locale,
    avatarRef: row.avatarRef ?? null,
    settings: row.settingsJson ? (JSON.parse(row.settingsJson) as Record<string, unknown>) : null,
  };
}

export function updateProfileForUserSqlite(
  db: WaiaDb,
  userId: string,
  patch: { displayName?: string; locale?: string; avatarRef?: string | null },
): ProfileRow | null {
  const existing = getProfileForUserSqlite(db, userId);
  if (!existing) return null;

  db.update(profiles)
    .set({
      displayName: patch.displayName ?? existing.displayName,
      locale: patch.locale ?? existing.locale,
      avatarRef: patch.avatarRef === undefined ? existing.avatarRef : patch.avatarRef,
      updatedAt: new Date(),
    })
    .where(eq(profiles.userId, userId))
    .run();

  return getProfileForUserSqlite(db, userId);
}
