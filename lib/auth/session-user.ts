import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getDb } from "@/db/client";
import { WAIA_SESSION_COOKIE } from "@/lib/auth/constants";
import { resolveUserIdFromSessionId } from "@/lib/auth/session-service";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerReadOnly } from "@/lib/supabase/server";

async function resolveOptionalSessionUserId(): Promise<string | null> {
  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerReadOnly();
    if (supabase) {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (!error && user?.id) {
        return user.id;
      }
    }
  }

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
