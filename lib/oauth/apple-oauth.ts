import "server-only";

import { createRemoteJWKSet, SignJWT, importPKCS8, jwtVerify } from "jose";

import { deriveIdentityLabelFromEmail, normalizeEmail } from "@/lib/auth/email";

import { oauthCallbackUrl } from "@/lib/oauth/public-url";
import { oauthPlaceholderEmail } from "@/lib/oauth/synthetic-email";

let appleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getAppleJwks() {
  if (!appleJwks) {
    appleJwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
  }
  return appleJwks;
}

export function normalizeApplePrivateKey(raw: string): string {
  return raw.trim().replace(/\\n/g, "\n");
}

export function isAppleOauthConfigured(): boolean {
  return Boolean(
    process.env.APPLE_TEAM_ID?.trim() &&
      process.env.APPLE_KEY_ID?.trim() &&
      process.env.APPLE_CLIENT_ID?.trim() &&
      process.env.APPLE_PRIVATE_KEY?.trim(),
  );
}

export async function buildAppleClientSecretJwt(): Promise<string> {
  const teamId = process.env.APPLE_TEAM_ID!.trim();
  const clientId = process.env.APPLE_CLIENT_ID!.trim();
  const keyId = process.env.APPLE_KEY_ID!.trim();
  const pem = normalizeApplePrivateKey(process.env.APPLE_PRIVATE_KEY!);
  const key = await importPKCS8(pem, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60 * 24 * 150)
    .sign(key);
}

export function buildAppleAuthorizeUrl(params: { state: string; codeChallenge: string }): string {
  const clientId = process.env.APPLE_CLIENT_ID!.trim();
  const redirectUri = oauthCallbackUrl("apple");
  const u = new URL("https://appleid.apple.com/auth/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", "name email openid");
  u.searchParams.set("state", params.state);
  u.searchParams.set("code_challenge", params.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

function isAppleEmailVerified(raw: unknown): boolean {
  return raw === true || raw === "true";
}

export async function exchangeAppleAuthCodeAndProfile(code: string, codeVerifier: string): Promise<{
  sub: string;
  email: string;
  identityLabel: string;
}> {
  const clientSecret = await buildAppleClientSecretJwt();
  const clientId = process.env.APPLE_CLIENT_ID!.trim();
  const redirectUri = oauthCallbackUrl("apple");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  });

  const res = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`APPLE_TOKEN_HTTP_${res.status}`);
  }

  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token || json.id_token === "") {
    throw new Error("APPLE_TOKEN_MISSING_ID_TOKEN");
  }

  const { payload } = await jwtVerify(json.id_token, getAppleJwks(), {
    issuer: "https://appleid.apple.com",
    audience: clientId,
  });

  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) {
    throw new Error("APPLE_ID_TOKEN_MISSING_SUB");
  }

  const emailRaw = typeof payload.email === "string" ? payload.email.trim() : "";
  const emailVerified = isAppleEmailVerified(payload.email_verified);
  const email =
    emailVerified && emailRaw !== "" ? normalizeEmail(emailRaw) : oauthPlaceholderEmail("apple", sub);

  const identityLabel = deriveIdentityLabelFromEmail(email);

  return { sub, email, identityLabel };
}
