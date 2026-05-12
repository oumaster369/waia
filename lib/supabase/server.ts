import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

export type SupabaseCookiePatch = { name: string; value: string; options: CookieOptions };

/**
 * Read-only Supabase client for Server Components / session resolution (e.g. {@link getOptionalSessionUserId}).
 * Does not refresh session cookies (setAll is no-op).
 */
export async function createSupabaseServerReadOnly() {
  if (!isSupabaseAuthConfigured()) {
    return null;
  }
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        /* RSC / parallel route: cannot always set cookies here */
      },
    },
  });
}

/**
 * Supabase client for Route Handlers that perform auth mutations (sign-in, sign-up, sign-out).
 * Accumulates Set-Cookie operations into `pendingCookies` for application to the final {@link NextResponse}.
 */
export async function createSupabaseRouteHandlerClient(pendingCookies: SupabaseCookiePatch[]) {
  if (!isSupabaseAuthConfigured()) {
    return null;
  }
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        pendingCookies.push(...cookiesToSet);
      },
    },
  });
}
