import { NextResponse } from "next/server";

import { users } from "@/db/schema";
import { runWaiaSqliteLegacyTransaction } from "@/db/waia-transaction";
import { getDb } from "@/db/client";
import { applySessionCookie, clearSessionCookie } from "@/lib/auth/cookie-response";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { deriveIdentityLabelFromEmail, isLikelyEmail, normalizeEmail } from "@/lib/auth/email";
import { hashPassword, validatePasswordPolicy } from "@/lib/auth/password";
import { createSessionRow } from "@/lib/auth/session-service";
import { authSessionMaxAgeSeconds } from "@/lib/auth/constants";
import { ensureUserTwinSeed } from "@/lib/twin-persistence/loader";
import { syncAppUserRowFromSupabaseAuth } from "@/lib/auth/supabase-app-user-sync";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import type { SupabaseCookiePatch } from "@/lib/supabase/server";
import { applySupabaseCookiePatches } from "@/lib/supabase/apply-response-cookies";
import { eq } from "drizzle-orm";

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

  if (isSupabaseAuthConfigured()) {
    const pendingCookies: SupabaseCookiePatch[] = [];
    const supabase = await createSupabaseRouteHandlerClient(pendingCookies);
    if (supabase) {
      const identityLabel = deriveIdentityLabelFromEmail(email);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { identity_label: identityLabel },
        },
      });

      if (error) {
        if (error.message.toLowerCase().includes("already") || error.code === "user_already_exists") {
          return jsonError(409, {
            error: { code: "EMAIL_TAKEN", message: "Email already registered." },
          });
        }
        return jsonError(400, {
          error: { code: "SIGN_UP_FAILED", message: error.message },
        });
      }

      if (!data.user) {
        return jsonError(400, {
          error: { code: "SIGN_UP_FAILED", message: "Could not create user." },
        });
      }

      await syncAppUserRowFromSupabaseAuth({
        supabaseUserId: data.user.id,
        email,
        identityLabel,
      });

      if (!data.session) {
        const res = NextResponse.json(
          {
            ok: true as const,
            needsEmailConfirmation: true as const,
            redirect: "/dashboard",
          },
          { status: 201 },
        );
        applySupabaseCookiePatches(res, pendingCookies);
        clearSessionCookie(res);
        return res;
      }

      const res = NextResponse.json({ ok: true as const, redirect: "/dashboard" }, { status: 201 });
      applySupabaseCookiePatches(res, pendingCookies);
      clearSessionCookie(res);
      return res;
    }
  }

  const db = getDb();
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const existing = rows[0];

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

  await runWaiaSqliteLegacyTransaction(db, (tx) => {
    tx.insert(users).values({ id: userId, identityLabel, email, passwordHash }).run();
    ensureUserTwinSeed(tx, userId);
    createSessionRow(tx, { sessionId, userId, expiresAtMs });
  });

  const res = NextResponse.json({ ok: true as const, redirect: "/dashboard" }, { status: 201 });
  applySessionCookie(res, sessionId);
  return res;
}
