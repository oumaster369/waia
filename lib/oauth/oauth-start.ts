import "server-only";

import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import type { WaiaSqliteDb } from "@/lib/twin-persistence/loader";
import type { OauthProvider } from "@/db/schema";
import { buildAppleAuthorizeUrl, isAppleOauthConfigured } from "@/lib/oauth/apple-oauth";
import { buildGoogleAuthorizeUrl, isGoogleOauthConfigured } from "@/lib/oauth/google-oauth";
import { insertOauthState } from "@/lib/oauth/oauth-state";
import { generatePkcePair } from "@/lib/oauth/pkce";
import { oauthFailureRedirect } from "@/lib/oauth/redirect-response";
import {
  buildTelegramAuthAuthorizeUrl,
  isTelegramOauthConfigured,
  parseTelegramNumericBotId,
  telegramOAuthReturnToWithState,
} from "@/lib/oauth/telegram-oauth";

export function oauthStartRedirect(provider: OauthProvider): NextResponse {
  const db = getDb() as WaiaSqliteDb;
  const state = crypto.randomUUID();

  switch (provider) {
    case "google": {
      if (!isGoogleOauthConfigured()) {
        return oauthFailureRedirect("OAUTH_CONFIG");
      }
      const { verifier, challenge } = generatePkcePair();
      insertOauthState(db, { state, provider, codeVerifier: verifier });
      return NextResponse.redirect(buildGoogleAuthorizeUrl({ state, codeChallenge: challenge }), 302);
    }
    case "apple": {
      if (!isAppleOauthConfigured()) {
        return oauthFailureRedirect("OAUTH_CONFIG");
      }
      const { verifier, challenge } = generatePkcePair();
      insertOauthState(db, { state, provider, codeVerifier: verifier });
      return NextResponse.redirect(buildAppleAuthorizeUrl({ state, codeChallenge: challenge }), 302);
    }
    case "telegram": {
      if (!isTelegramOauthConfigured() || !parseTelegramNumericBotId()) {
        return oauthFailureRedirect("OAUTH_CONFIG");
      }
      insertOauthState(db, { state, provider, codeVerifier: null });
      const returnTo = telegramOAuthReturnToWithState(state);
      return NextResponse.redirect(buildTelegramAuthAuthorizeUrl(returnTo), 302);
    }
  }
}
