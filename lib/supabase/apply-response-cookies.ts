import type { NextResponse } from "next/server";
import type { CookieOptions } from "@supabase/ssr";

export function applySupabaseCookiePatches(
  response: NextResponse,
  pending: { name: string; value: string; options: CookieOptions }[],
): void {
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options);
  }
}
