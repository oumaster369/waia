import { NextResponse } from "next/server";

import { cookies } from "next/headers";

import { getDb } from "@/db/client";
import { WAIA_SESSION_COOKIE } from "@/lib/auth/constants";
import { clearSessionCookie } from "@/lib/auth/cookie-response";
import { deleteSessionById } from "@/lib/auth/session-service";

export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(WAIA_SESSION_COOKIE)?.value;
  const res = NextResponse.json({ ok: true as const });

  if (token != null && token !== "") {
    const db = getDb();
    deleteSessionById(db, token);
  }

  clearSessionCookie(res);
  return res;
}
