import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import { runSqliteTransaction } from "@/db/types";
import { getDb } from "@/db/client";
import { applySessionCookie, clearSessionCookie } from "@/lib/auth/cookie-response";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { isLikelyEmail, normalizeEmail } from "@/lib/auth/email";
import { verifyPassword } from "@/lib/auth/password";
import { authSessionMaxAgeSeconds } from "@/lib/auth/constants";
import { createSessionRow } from "@/lib/auth/session-service";
import { ensureUserTwinSeed } from "@/lib/twin-persistence/loader";

export const dynamic = "force-dynamic";

type SignInBody = {
  email?: string;
  password?: string;
};

function invalidCredentials() {
  const body: ApiErrorEnvelope = {
    error: {
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
    },
  };
  const res = NextResponse.json(body, { status: 401 });
  clearSessionCookie(res);
  return res;
}

export async function POST(request: Request) {
  let parsed: SignInBody;
  try {
    parsed = (await request.json()) as SignInBody;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "Expected JSON body." } } satisfies ApiErrorEnvelope,
      { status: 400 },
    );
  }

  const rawEmail = parsed.email;
  const password = parsed.password;
  if (typeof rawEmail !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "email and password are required." } } satisfies ApiErrorEnvelope,
      { status: 400 },
    );
  }

  const email = normalizeEmail(rawEmail);
  if (!isLikelyEmail(email)) {
    return invalidCredentials();
  }

  const db = getDb();
  const rows = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const userRow = rows[0];

  if (!userRow) {
    verifyPassword(password, undefined);
    return invalidCredentials();
  }

  const ok = verifyPassword(password, userRow.passwordHash);
  if (!ok) {
    return invalidCredentials();
  }

  const sessionId = crypto.randomUUID();
  const maxAgeSec = authSessionMaxAgeSeconds();
  const expiresAtMs = Date.now() + maxAgeSec * 1000;

  await runSqliteTransaction(db, (tx) => {
    ensureUserTwinSeed(tx, userRow.id);
    createSessionRow(tx, { sessionId, userId: userRow.id, expiresAtMs });
  });

  const res = NextResponse.json({ ok: true as const, redirect: "/dashboard" }, { status: 200 });
  applySessionCookie(res, sessionId);
  return res;
}
