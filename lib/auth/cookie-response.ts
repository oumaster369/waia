import type { NextResponse } from "next/server";

import { WAIA_SESSION_COOKIE, authSessionMaxAgeSeconds } from "@/lib/auth/constants";

export function applySessionCookie(response: NextResponse, sessionId: string): void {
  response.cookies.set(WAIA_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: authSessionMaxAgeSeconds(),
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.delete(WAIA_SESSION_COOKIE);
}
