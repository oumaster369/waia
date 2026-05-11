import "server-only";

import { and, eq, gt } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { sessions } from "@/db/schema";

/** Inserts one session row. Synchronous so it stays valid inside `better-sqlite3` transactions (OAuth + auth routes). */
export function createSessionRow(
  db: WaiaDb,
  params: { sessionId: string; userId: string; expiresAtMs: number },
): void {
  db.insert(sessions)
    .values({
      id: params.sessionId,
      userId: params.userId,
      expiresAt: new Date(params.expiresAtMs),
    })
    .run();
}

export async function deleteSessionById(db: WaiaDb, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function resolveUserIdFromSessionId(
  db: WaiaDb,
  sessionId: string,
): Promise<string | null> {
  const now = Date.now();
  const rows = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date(now))))
    .limit(1);

  const row = rows[0];
  return row?.userId ?? null;
}
