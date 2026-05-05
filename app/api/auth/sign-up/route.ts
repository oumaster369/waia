import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import { getDb } from "@/db/client";
import { applySessionCookie, clearSessionCookie } from "@/lib/auth/cookie-response";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { deriveIdentityLabelFromEmail, isLikelyEmail, normalizeEmail } from "@/lib/auth/email";
import { hashPassword, validatePasswordPolicy } from "@/lib/auth/password";
import { createSessionRow } from "@/lib/auth/session-service";
import { authSessionMaxAgeSeconds } from "@/lib/auth/constants";
import { ensureUserTwinSeed } from "@/lib/twin-persistence/loader";
import type { WaiaSqliteDb } from "@/lib/twin-persistence/loader";

export const dynamic = "force-dynamic";

type SignUpBody = {
  email?: string;
  password?: string;
};

function jsonError(status: number, body: ApiErrorEnvelope) {
  const res = NextResponse.json(body, { status });
  clearSessionCookie(res);
  return res;
}

export async function POST(request: Request) {
  let parsed: SignUpBody;
  try {
    parsed = (await request.json()) as SignUpBody;
  } catch {
    return jsonError(400, {
      error: { code: "INVALID_BODY", message: "Expected JSON body." },
    });
  }

  const rawEmail = parsed.email;
  const password = parsed.password;
  if (typeof rawEmail !== "string" || typeof password !== "string") {
    return jsonError(400, {
      error: { code: "INVALID_BODY", message: "email and password are required." },
    });
  }

  const email = normalizeEmail(rawEmail);
  if (!isLikelyEmail(email)) {
    return jsonError(400, {
      error: { code: "INVALID_EMAIL", message: "Invalid email." },
    });
  }

  if (!validatePasswordPolicy(password)) {
    return jsonError(400, {
      error: { code: "WEAK_PASSWORD", message: "Password too short." },
    });
  }

  const db = getDb();
  const existing = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();

  if (existing) {
    return jsonError(409, {
      error: { code: "EMAIL_TAKEN", message: "Email already registered." },
    });
  }

  const userId = crypto.randomUUID();
  const identityLabel = deriveIdentityLabelFromEmail(email);
  const passwordHash = hashPassword(password);

  const sessionId = crypto.randomUUID();
  const maxAgeSec = authSessionMaxAgeSeconds();
  const expiresAtMs = Date.now() + maxAgeSec * 1000;

  db.transaction((tx) => {
    const t = tx as WaiaSqliteDb;
    t.insert(users).values({ id: userId, identityLabel, email, passwordHash }).run();
    ensureUserTwinSeed(t, userId);
    createSessionRow(t, { sessionId, userId, expiresAtMs });
  });

  const res = NextResponse.json({ ok: true as const, redirect: "/dashboard" }, { status: 201 });
  applySessionCookie(res, sessionId);
  return res;
}
