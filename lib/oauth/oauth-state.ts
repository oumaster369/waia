import { and, eq, gt } from "drizzle-orm";

import { oauthStates } from "@/db/schema";
import type { WaiaSqliteDb } from "@/lib/twin-persistence/loader";
import type { OauthProvider } from "@/db/schema";

/** CSRF OAuth state TTL (SQLite row expiry). */
export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

export function insertOauthState(
  tx: WaiaSqliteDb,
  params: { state: string; provider: OauthProvider; codeVerifier: string | null },
): void {
  tx
    .insert(oauthStates)
    .values({
      state: params.state,
      provider: params.provider,
      codeVerifier: params.codeVerifier,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    })
    .run();
}

/** Read a valid pending OAuth row without consuming it (used before token exchange over the network). */
export function findValidOauthState(
  db: WaiaSqliteDb,
  state: string | null | undefined,
  expectedProvider: OauthProvider,
): { codeVerifier: string | null } | null {
  if (!state || state.trim() === "") {
    return null;
  }

  const now = new Date();
  const row = db
    .select({
      provider: oauthStates.provider,
      codeVerifier: oauthStates.codeVerifier,
    })
    .from(oauthStates)
    .where(and(eq(oauthStates.state, state), gt(oauthStates.expiresAt, now)))
    .get();

  if (!row || row.provider !== expectedProvider) {
    return null;
  }

  return { codeVerifier: row.codeVerifier ?? null };
}

/** Deletes consumed CSRF row only when state exists, matches provider, and is unexpired. */
export function consumeOauthStateStrict(
  tx: WaiaSqliteDb,
  state: string,
  expectedProvider: OauthProvider,
): boolean {
  const now = new Date();
  const result = tx
    .delete(oauthStates)
    .where(
      and(
        eq(oauthStates.state, state),
        eq(oauthStates.provider, expectedProvider),
        gt(oauthStates.expiresAt, now),
      ),
    )
    .run();
  return result.changes > 0;
}
