import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getDb } from "@/db/client";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb, type WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { WAIA_SESSION_COOKIE } from "@/lib/auth/constants";
import {
  deriveIdentityLabelFromEmail,
  isLikelyEmail,
  normalizeEmail,
} from "@/lib/auth/email";
import { resolveUserIdFromSessionId } from "@/lib/auth/session-service";
import { syncAppUserRowFromSupabaseAuthPostgres } from "@/lib/persistence/postgres/twin-persistence";
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
        let runtime: WaiaRuntimeDb | undefined;
        try {
          runtime = await getWaiaRuntimeDb();
          if (runtime.kind === "postgres") {
            if (typeof user.email === "string" && user.email.trim() !== "") {
              const email = normalizeEmail(user.email);
              if (isLikelyEmail(email)) {
                await syncAppUserRowFromSupabaseAuthPostgres(runtime.db, {
                  supabaseUserId: user.id,
                  email,
                  identityLabel: deriveIdentityLabelFromEmail(email),
                });
              }
            }
          }
        } finally {
          await disposeWaiaRuntimeDb(runtime);
        }
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
