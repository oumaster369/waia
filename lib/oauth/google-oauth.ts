import "server-only";

import { deriveIdentityLabelFromEmail, normalizeEmail } from "@/lib/auth/email";

import { oauthCallbackUrl } from "@/lib/oauth/public-url";
import { oauthPlaceholderEmail } from "@/lib/oauth/synthetic-email";

export function isGoogleOauthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function buildGoogleAuthorizeUrl(params: { state: string; codeChallenge: string }): string {
  const clientId = process.env.GOOGLE_CLIENT_ID!.trim();
  const redirectUri = oauthCallbackUrl("google");
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", params.state);
  u.searchParams.set("code_challenge", params.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export async function exchangeGoogleAuthCode(params: {
  code: string;
  codeVerifier: string;
}): Promise<{ access_token: string }> {
  const redirectUri = oauthCallbackUrl("google");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: redirectUri,
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
    code_verifier: params.codeVerifier,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`GOOGLE_TOKEN_HTTP_${res.status}`);
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token || json.access_token === "") {
    throw new Error("GOOGLE_TOKEN_MISSING_ACCESS");
  }
  return { access_token: json.access_token };
}

export async function fetchGoogleOAuthProfile(accessToken: string): Promise<{
  sub: string;
  email: string;
  identityLabel: string;
}> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`GOOGLE_USERINFO_HTTP_${res.status}`);
  }
  const j = (await res.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  const sub = j.sub;
  if (!sub) {
    throw new Error("GOOGLE_USERINFO_MISSING_SUB");
  }

  const verified = j.email_verified === true;
  const rawEmail = typeof j.email === "string" ? j.email.trim() : "";
  const email =
    verified && rawEmail !== "" ? normalizeEmail(rawEmail) : oauthPlaceholderEmail("google", sub);

  const identityLabel =
    typeof j.name === "string" && j.name.trim().length > 0 ? j.name.trim() : deriveIdentityLabelFromEmail(email);

  return { sub, email, identityLabel };
}
