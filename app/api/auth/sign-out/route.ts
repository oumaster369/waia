import { NextResponse } from "next/server";

import { cookies } from "next/headers";

import { getDb } from "@/db/client";
import { WAIA_SESSION_COOKIE } from "@/lib/auth/constants";
import { clearSessionCookie } from "@/lib/auth/cookie-response";
import { deleteSessionById } from "@/lib/auth/session-service";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import type { SupabaseCookiePatch } from "@/lib/supabase/server";
import { applySupabaseCookiePatches } from "@/lib/supabase/apply-response-cookies";

export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(WAIA_SESSION_COOKIE)?.value;

  const pendingCookies: SupabaseCookiePatch[] = [];
  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseRouteHandlerClient(pendingCookies);
    if (supabase) {
      await supabase.auth.signOut();
    }
  }

  const res = NextResponse.json({ ok: true as const });
  applySupabaseCookiePatches(res, pendingCookies);

  if (token != null && token !== "") {
    const db = getDb();
    await deleteSessionById(db, token);
  }

  clearSessionCookie(res);
  return res;
}
