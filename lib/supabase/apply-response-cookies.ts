import type { NextResponse } from "next/server";
import type { CookieOptions } from "@supabase/ssr";

import { resolveWaiaCookieDomain } from "@/lib/hosts/cookie-domain";

export function applySupabaseCookiePatches(
  response: NextResponse,
  pending: { name: string; value: string; options: CookieOptions }[],
): void {
  const domain = resolveWaiaCookieDomain();
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, {
      ...options,
      ...(domain ? { domain } : {}),
    });
  }
}
