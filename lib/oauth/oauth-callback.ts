import "server-only";

import { NextResponse } from "next/server";

import { applySessionCookie } from "@/lib/auth/cookie-response";
import { getDb } from "@/db/client";
import { runWaiaSqliteLegacyTransaction } from "@/db/waia-transaction";
import type { OauthProvider } from "@/db/schema";
import { exchangeAppleAuthCodeAndProfile } from "@/lib/oauth/apple-oauth";
import {
  exchangeGoogleAuthCode,
  fetchGoogleOAuthProfile,
} from "@/lib/oauth/google-oauth";
import { consumeOauthStateStrict, findValidOauthState } from "@/lib/oauth/oauth-state";
import { persistOauthLoginInTransaction } from "@/lib/oauth/oauth-user-session";
import { oauthFailureRedirect, oauthSuccessDashboardRedirect } from "@/lib/oauth/redirect-response";
import { oauthPlaceholderEmail } from "@/lib/oauth/synthetic-email";
import { telegramIdentityLabel, verifyTelegramLoginWidgetHash } from "@/lib/oauth/telegram-hash";

export async function oauthCallbackResponse(
  provider: OauthProvider,
  requestUrl: string,
): Promise<NextResponse> {
  switch (provider) {
    case "google":
      return await googleCallback(requestUrl);
    case "apple":
      return await appleCallback(requestUrl);
    case "telegram":
      return await telegramCallback(requestUrl);
  }
}

async function googleCallback(requestUrl: string): Promise<NextResponse> {
  const url = new URL(requestUrl);
  const sp = url.searchParams;
  if (sp.get("error") === "access_denied") {
    return oauthFailureRedirect("OAUTH_DENIED");
  }
  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state) {
    return oauthFailureRedirect("OAUTH_TOKEN");
  }

  const db = getDb();
  const pending = await findValidOauthState(db, state, "google");
  if (!pending?.codeVerifier) {
    return oauthFailureRedirect("OAUTH_INVALID_STATE");
  }

  let profile: { sub: string; email: string; identityLabel: string };
  try {
    const token = await exchangeGoogleAuthCode({ code, codeVerifier: pending.codeVerifier });
    profile = await fetchGoogleOAuthProfile(token.access_token);
  } catch {
    return oauthFailureRedirect("OAUTH_TOKEN");
  }

  try {
    return await runWaiaSqliteLegacyTransaction(db, (tx) => {
      if (!consumeOauthStateStrict(tx, state, "google")) {
        return oauthFailureRedirect("OAUTH_INVALID_STATE");
      }
      const r = persistOauthLoginInTransaction(tx, {
        provider: "google",
        providerUserId: profile.sub,
        email: profile.email,
        identityLabel: profile.identityLabel,
      });
      if (!r.ok) {
        return oauthFailureRedirect("OAUTH_DENIED");
      }
      const res = oauthSuccessDashboardRedirect();
      applySessionCookie(res, r.sessionId);
      return res;
    });
  } catch {
    return oauthFailureRedirect("OAUTH_TOKEN");
  }
}

async function appleCallback(requestUrl: string): Promise<NextResponse> {
  const url = new URL(requestUrl);
  const sp = url.searchParams;
  if (sp.get("error") === "access_denied") {
    return oauthFailureRedirect("OAUTH_DENIED");
  }
  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state) {
    return oauthFailureRedirect("OAUTH_TOKEN");
  }

  const db = getDb();
  const pending = await findValidOauthState(db, state, "apple");
  if (!pending?.codeVerifier) {
    return oauthFailureRedirect("OAUTH_INVALID_STATE");
  }

  let profile: { sub: string; email: string; identityLabel: string };
  try {
    profile = await exchangeAppleAuthCodeAndProfile(code, pending.codeVerifier);
  } catch {
    return oauthFailureRedirect("OAUTH_TOKEN");
  }

  try {
    return await runWaiaSqliteLegacyTransaction(db, (tx) => {
      if (!consumeOauthStateStrict(tx, state, "apple")) {
        return oauthFailureRedirect("OAUTH_INVALID_STATE");
      }
      const r = persistOauthLoginInTransaction(tx, {
        provider: "apple",
        providerUserId: profile.sub,
        email: profile.email,
        identityLabel: profile.identityLabel,
      });
      if (!r.ok) {
        return oauthFailureRedirect("OAUTH_DENIED");
      }
      const res = oauthSuccessDashboardRedirect();
      applySessionCookie(res, r.sessionId);
      return res;
    });
  } catch {
    return oauthFailureRedirect("OAUTH_TOKEN");
  }
}

async function telegramCallback(requestUrl: string): Promise<NextResponse> {
  const url = new URL(requestUrl);
  const sp = url.searchParams;
  const state = sp.get("state");
  if (!state) {
    return oauthFailureRedirect("OAUTH_TOKEN");
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    return oauthFailureRedirect("OAUTH_CONFIG");
  }

  const record: Record<string, string> = {};
  for (const [k, v] of sp.entries()) {
    record[k] = v;
  }

  if (!verifyTelegramLoginWidgetHash(botToken, record)) {
    return oauthFailureRedirect("OAUTH_TOKEN");
  }

  const id = record.id;
  if (!id) {
    return oauthFailureRedirect("OAUTH_TOKEN");
  }

  const db = getDb();
  const pending = await findValidOauthState(db, state, "telegram");
  if (!pending) {
    return oauthFailureRedirect("OAUTH_INVALID_STATE");
  }

  const email = oauthPlaceholderEmail("telegram", id);
  const identityLabel = telegramIdentityLabel(record);

  try {
    return await runWaiaSqliteLegacyTransaction(db, (tx) => {
      if (!consumeOauthStateStrict(tx, state, "telegram")) {
        return oauthFailureRedirect("OAUTH_INVALID_STATE");
      }
      const r = persistOauthLoginInTransaction(tx, {
        provider: "telegram",
        providerUserId: id,
        email,
        identityLabel,
      });
      if (!r.ok) {
        return oauthFailureRedirect("OAUTH_DENIED");
      }
      const res = oauthSuccessDashboardRedirect();
      applySessionCookie(res, r.sessionId);
      return res;
    });
  } catch {
    return oauthFailureRedirect("OAUTH_TOKEN");
  }
}
