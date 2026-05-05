import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getDb } from "@/db/client";
import { WAIA_SESSION_COOKIE } from "@/lib/auth/constants";
import { resolveUserIdFromSessionId } from "@/lib/auth/session-service";

async function resolveOptionalSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(WAIA_SESSION_COOKIE)?.value;
  if (token == null || token === "") {
    return null;
  }
  const db = getDb();
  return await resolveUserIdFromSessionId(db, token);
}

/** Dedup session lookup within one RSC / handler tree. */
export const getOptionalSessionUserId = cache(resolveOptionalSessionUserId);
