"use client";

import { createBrowserClient } from "@supabase/ssr";

import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

/** Browser Supabase client for future dashboard / client-side auth flows (DEE-66). */
export function createSupabaseBrowserClient() {
  if (typeof window === "undefined" || !isSupabaseAuthConfigured()) {
    return null;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createBrowserClient(url, anon);
}
