import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { applySupabaseCookiePatches } from "@/lib/supabase/apply-response-cookies";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

const UNAVAILABLE = {
  code: "AUTH_TEMPORARILY_UNAVAILABLE",
  message: "Сервис авторизации временно недоступен. Повторите загрузку.",
};

/** Refresh identity cookies only; protected routes still verify identity and permissions. */
export async function refreshAdminSession(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  const adminPath =
    /^\/admin(?:\/|$)/.test(path) || /^\/api\/trader\/admin\/console(?:\/|$)/.test(path);
  if (
    !adminPath ||
    !isSupabaseAuthConfigured() ||
    !request.cookies.getAll().some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name))
  ) {
    return NextResponse.next();
  }
  const pending: { name: string; value: string; options: CookieOptions }[] = [];
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(patches) {
          for (const { name, value } of patches) request.cookies.set(name, value);
          pending.push(...patches);
        },
      },
    },
  );
  try {
    // getUser verifies the session with Auth; decoded claims never grant access.
    const { error } = await supabase.auth.getUser();
    if (
      error &&
      (error.status === undefined ||
        error.status === 0 ||
        error.status === 429 ||
        error.status >= 500)
    ) {
      return unavailable(path);
    }
  } catch {
    return unavailable(path);
  }
  const response = NextResponse.next({ request: { headers: new Headers(request.headers) } });
  applySupabaseCookiePatches(response, pending);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function unavailable(path: string): NextResponse {
  const headers = { "Cache-Control": "private, no-store", "Retry-After": "5" };
  return path.startsWith("/api/")
    ? NextResponse.json({ error: UNAVAILABLE }, { status: 503, headers })
    : new NextResponse(UNAVAILABLE.message, {
        status: 503,
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
      });
}
