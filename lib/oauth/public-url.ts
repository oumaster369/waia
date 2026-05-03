import "server-only";

/** Canonical site origin for OAuth redirect_uri (no trailing slash). */
export function resolveOAuthPublicBaseUrl(): string {
  const explicit = process.env.OAUTH_PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) return site.replace(/\/$/, "");
  return "http://localhost:3000";
}

export function oauthCallbackUrl(provider: "google" | "apple" | "telegram"): string {
  const base = resolveOAuthPublicBaseUrl();
  return `${base}/api/auth/oauth/${provider}/callback`;
}
