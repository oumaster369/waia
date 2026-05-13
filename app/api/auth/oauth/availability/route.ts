import { NextResponse } from "next/server";

import { isAppleOauthConfigured } from "@/lib/oauth/apple-oauth";
import { isGoogleOauthConfigured } from "@/lib/oauth/google-oauth";
import {
  isTelegramOauthConfigured,
  parseTelegramNumericBotId,
} from "@/lib/oauth/telegram-oauth";

export const dynamic = "force-dynamic";

/** Public shape for landing UI — no secrets leaked. Used to hide/disable OAuth CTAs when not configured. */
export async function GET() {
  const google = isGoogleOauthConfigured();
  const apple = isAppleOauthConfigured();
  const telegram = isTelegramOauthConfigured() && Boolean(parseTelegramNumericBotId());
  return NextResponse.json({ google, apple, telegram });
}

