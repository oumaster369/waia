const OAUTH_PLACEHOLDER_DOMAIN = "oauth.waia.internal";

export function oauthPlaceholderEmail(provider: string, providerUserId: string): string {
  const safe = providerUserId.replace(/[^a-zA-Z0-9._+-]/g, "_").slice(0, 200);
  return `${provider}-${safe || "subject"}@${OAUTH_PLACEHOLDER_DOMAIN}`.toLowerCase();
}
