import { and, eq, gt } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { oauthStates, type OauthProvider } from "@/db/schema";

/** CSRF OAuth state TTL (SQLite row expiry). */
export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

export async function insertOauthState(
  db: WaiaDb,
  params: { state: string; provider: OauthProvider; codeVerifier: string | null },
): Promise<void> {
  await db.insert(oauthStates).values({
    state: params.state,
    provider: params.provider,
    codeVerifier: params.codeVerifier,
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  });
}

/** Read a valid pending OAuth row without consuming it (used before token exchange over the network). */
export async function findValidOauthState(
  db: WaiaDb,
  state: string | null | undefined,
  expectedProvider: OauthProvider,
): Promise<{ codeVerifier: string | null } | null> {
  if (!state || state.trim() === "") {
    return null;
  }

  const now = new Date();
  const rows = await db
    .select({
      provider: oauthStates.provider,
      codeVerifier: oauthStates.codeVerifier,
    })
    .from(oauthStates)
    .where(and(eq(oauthStates.state, state), gt(oauthStates.expiresAt, now)))
    .limit(1);
  const row = rows[0];

  if (!row || row.provider !== expectedProvider) {
    return null;
  }

  return { codeVerifier: row.codeVerifier ?? null };
}

/** Deletes consumed CSRF row only when state exists, matches provider, and is unexpired. */
export function consumeOauthStateStrict(
  tx: WaiaDb,
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
