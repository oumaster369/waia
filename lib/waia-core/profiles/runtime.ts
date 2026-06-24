import "server-only";

import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { ensureUserCoreSeed } from "@/lib/waia-core/provisioning";
import { ensureUserCoreSeedPostgresFailOpenInTx } from "@/lib/waia-core/provisioning/postgres-fail-open";
import {
  getProfileForUserPostgres,
  updateProfileForUserPostgres,
} from "@/lib/waia-core/profiles/postgres";
import {
  getProfileForUserSqlite,
  updateProfileForUserSqlite,
  type ProfileRow,
} from "@/lib/waia-core/profiles/sqlite";

export type ProfilePublic = {
  displayName: string;
  locale: string;
  avatarRef: string | null;
};

export type ProfileUpdatePatch = {
  displayName?: string;
  locale?: string;
};

function toPublic(row: Pick<ProfileRow, "displayName" | "locale" | "avatarRef">): ProfilePublic {
  return {
    displayName: row.displayName,
    locale: row.locale,
    avatarRef: row.avatarRef,
  };
}

function resolveDisplayNameForSeedSqlite(
  db: Parameters<typeof getProfileForUserSqlite>[0],
  userId: string,
): string {
  const row = db
    .select({ identityLabel: users.identityLabel })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .all()[0];
  return row?.identityLabel ?? "User";
}

async function resolveDisplayNameForSeedPostgres(
  db: Parameters<typeof getProfileForUserPostgres>[0],
  userId: string,
): Promise<string> {
  const rows = await db
    .select({ identityLabel: pgSchema.users.identityLabel })
    .from(pgSchema.users)
    .where(eq(pgSchema.users.id, userId))
    .limit(1);
  return rows[0]?.identityLabel ?? "User";
}

async function ensureProfileSeedForUser(userId: string): Promise<void> {
  let runtime;
  try {
    runtime = await getWaiaRuntimeDb();
    if (runtime.kind === "sqlite") {
      const displayName = resolveDisplayNameForSeedSqlite(runtime.db, userId);
      ensureUserCoreSeed(runtime.db, { userId, displayName });
      return;
    }
    const displayName = await resolveDisplayNameForSeedPostgres(runtime.db, userId);
    await runWaiaPostgresTransaction(runtime.db, async (tx) => {
      await ensureUserCoreSeedPostgresFailOpenInTx(tx, { userId, displayName });
    });
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}

async function readProfileFromRuntime(userId: string): Promise<ProfilePublic | null> {
  let runtime;
  try {
    runtime = await getWaiaRuntimeDb();
    if (runtime.kind === "sqlite") {
      const row = getProfileForUserSqlite(runtime.db, userId);
      return row ? toPublic(row) : null;
    }
    const row = await getProfileForUserPostgres(runtime.db, userId);
    return row ? toPublic(row) : null;
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}

/** Read the session user's profile; ensure-seed-on-missing then re-read. */
export async function readProfileForSessionUser(userId: string): Promise<ProfilePublic | null> {
  const existing = await readProfileFromRuntime(userId);
  if (existing) {
    return existing;
  }
  await ensureProfileSeedForUser(userId);
  return readProfileFromRuntime(userId);
}

/** Update the session user's profile; ensure-seed-on-missing before update. */
export async function updateProfileForSessionUser(
  userId: string,
  patch: ProfileUpdatePatch,
): Promise<ProfilePublic | null> {
  let runtime;
  try {
    runtime = await getWaiaRuntimeDb();
    if (runtime.kind === "sqlite") {
      let row = getProfileForUserSqlite(runtime.db, userId);
      if (!row) {
        await ensureProfileSeedForUser(userId);
        row = getProfileForUserSqlite(runtime.db, userId);
      }
      if (!row) {
        return null;
      }
      const updated = updateProfileForUserSqlite(runtime.db, userId, patch);
      return updated ? toPublic(updated) : null;
    }

    let row = await getProfileForUserPostgres(runtime.db, userId);
    if (!row) {
      await ensureProfileSeedForUser(userId);
      row = await getProfileForUserPostgres(runtime.db, userId);
    }
    if (!row) {
      return null;
    }
    const updated = await updateProfileForUserPostgres(runtime.db, userId, patch);
    return updated ? toPublic(updated) : null;
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}
