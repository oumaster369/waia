import type { NextResponse } from "next/server";

import { WAIA_SESSION_COOKIE, authSessionMaxAgeSeconds } from "@/lib/auth/constants";
import { resolveWaiaCookieDomain } from "@/lib/hosts/cookie-domain";

export function applySessionCookie(response: NextResponse, sessionId: string): void {
  const domain = resolveWaiaCookieDomain();
  response.cookies.set(WAIA_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: authSessionMaxAgeSeconds(),
    ...(domain ? { domain } : {}),
  });
}

export function clearSessionCookie(response: NextResponse): void {
  const domain = resolveWaiaCookieDomain();
  response.cookies.set(WAIA_SESSION_COOKIE, "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    ...(domain ? { domain } : {}),
  });
}
