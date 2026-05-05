import "server-only";

import { and, eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { oauthAccounts, users, type OauthProvider } from "@/db/schema";
import { authSessionMaxAgeSeconds } from "@/lib/auth/constants";
import { createSessionRow } from "@/lib/auth/session-service";
import { ensureUserTwinSeed } from "@/lib/twin-persistence/loader";

export type OauthLoginIdentity = {
  provider: OauthProvider;
  providerUserId: string;
  email: string;
  identityLabel: string;
};

export type PersistOauthLoginResult =
  | { ok: true; sessionId: string }
  | { ok: false; denied: true };

export function persistOauthLoginInTransaction(
  tx: WaiaDb,
  identity: OauthLoginIdentity,
): PersistOauthLoginResult {
  const linkRows = tx
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, identity.provider),
        eq(oauthAccounts.providerUserId, identity.providerUserId),
      ),
    )
    .limit(1)
    .all();
  const link = linkRows[0];

  const sessionId = crypto.randomUUID();
  const expiresAtMs = Date.now() + authSessionMaxAgeSeconds() * 1000;

  if (link) {
    const userId = link.userId;
    ensureUserTwinSeed(tx, userId);
    createSessionRow(tx, { sessionId, userId, expiresAtMs });
    return { ok: true, sessionId };
  }

  const existingByEmailRows = tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, identity.email))
    .limit(1)
    .all();
  const existingByEmail = existingByEmailRows[0];

  if (existingByEmail) {
    return { ok: false, denied: true };
  }

  const userId = crypto.randomUUID();
  tx.insert(users)
    .values({
      id: userId,
      identityLabel: identity.identityLabel,
      email: identity.email,
      passwordHash: null,
    })
    .run();

  tx.insert(oauthAccounts)
    .values({
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      userId,
    })
    .run();

  ensureUserTwinSeed(tx, userId);
  createSessionRow(tx, { sessionId, userId, expiresAtMs });
  return { ok: true, sessionId };
}
