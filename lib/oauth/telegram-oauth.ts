import "server-only";

import { oauthCallbackUrl, resolveOAuthPublicBaseUrl } from "@/lib/oauth/public-url";

export function isTelegramOauthConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
}

/** Numeric bot id from `BOT_ID:secret` token format. */
export function parseTelegramNumericBotId(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return null;
  }
  const idx = token.indexOf(":");
  if (idx <= 0) {
    return null;
  }
  const id = token.slice(0, idx);
  return /^\d+$/.test(id) ? id : null;
}

/** Redirect user to Telegram OAuth; `returnToAbsolute` must include our `state` query param. */
export function buildTelegramAuthAuthorizeUrl(returnToAbsolute: string): string {
  const botId = parseTelegramNumericBotId();
  if (!botId) {
    throw new Error("TELEGRAM_BAD_BOT_TOKEN");
  }
  const origin = resolveOAuthPublicBaseUrl();
  const u = new URL("https://oauth.telegram.org/auth");
  u.searchParams.set("bot_id", botId);
  u.searchParams.set("origin", origin);
  u.searchParams.set("request_access", "write");
  u.searchParams.set("return_to", returnToAbsolute);
  return u.toString();
}

export function telegramOAuthReturnToWithState(state: string): string {
  const cb = new URL(oauthCallbackUrl("telegram"));
  cb.searchParams.set("state", state);
  return cb.toString();
}
