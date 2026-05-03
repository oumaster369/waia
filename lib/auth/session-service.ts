import "server-only";

import { and, eq, gt } from "drizzle-orm";

import type { WaiaSqliteDb } from "@/lib/twin-persistence/loader";
import { sessions } from "@/db/schema";

export function createSessionRow(
  db: WaiaSqliteDb,
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

export function deleteSessionById(db: WaiaSqliteDb, sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

export function resolveUserIdFromSessionId(
  db: WaiaSqliteDb,
  sessionId: string,
): string | null {
  const now = Date.now();
  const row = db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date(now))))
    .get();
  return row?.userId ?? null;
}
